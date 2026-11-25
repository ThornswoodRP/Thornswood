// test-1320-pass-one-session.js
//
//     node .\tests\test-1320-pass-one-session.js
//
// #1320. A join pass is a note anybody holding it could show, so the game
// server binds it to the first session it proves and it never proves another:
// not the session after a reconnect, not a second connection under the same
// profile number. A session is one engine connection behind a profile (its
// GUID), and a new connection is a new session, held and judged afresh. A pass
// starts a session only when the site issued it at most a minute and a half
// before the session began; its ten minutes after that only keep the session
// it proved trusted. The launcher renews it every minute, so a reconnect has
// a new one within a minute.
//
// The join pass block is lifted out of game\gamemode.js between its markers and
// run in a vm with a stand-in mp whose connections (user slots and GUIDs) the
// test moves, a door.json in a temp folder and its own clock, the way
// test-join-pass-game.js runs it. JoinPass.cs is read for its renewal.
//
// Read only. Nothing connects to anything.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
const joinPassCs = fs.readFileSync(path.join(ROOT, 'launcher', 'app', 'JoinPass.cs'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}

const KEY = 'test-1320-key-not-a-real-one';
function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/* The site's makePass, written out again from the format note. */
function mint(o) {
  const body = b64u(JSON.stringify({ p: o.p, s: o.s || 'dev', v: o.v || '1.1.102', d: '111', i: o.i, x: o.x }));
  return 'jp1.' + body + '.' + b64u(crypto.createHmac('sha256', KEY).update('jp1.' + body).digest());
}

const a = src.indexOf('// ==== thornswood join pass ====');
const b = src.indexOf('// ==== end thornswood join pass ====');
yes('the join pass block is in gamemode.js between its markers', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { done(); return; }
const BLOCK = src.slice(a, b);

const PRIV = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-1320-'));
fs.writeFileSync(path.join(PRIV, 'door.json'), JSON.stringify({ site: 'https://thornswood.net/dev', key: 'k', passKey: KEY }));

/*
  online: [{ actorId, profileId, user, guid }]. guids: false stands in for an
  engine with no getUserGuid. box: a vm context to run the block in again, as
  a hot reload does.
*/
function rig(opts) {
  opts = opts || {};
  const r = { told: [], logged: [], kicked: [], timers: [], online: [] };
  const mp = {
    getServerSettings: function () { return { privDir: PRIV, thornswoodServer: 'dev', thornswoodRequirePass: true }; },
    getUserByActor: function (actorId) {
      for (let i = 0; i < r.online.length; i++) { if (r.online[i].actorId === actorId) { return r.online[i].user; } }
      return -1;
    },
    get: function () { return []; },
    kick: function (userId) { r.kicked.push(userId); }
  };
  if (opts.guids !== false) {
    mp.getUserGuid = function (userId) {
      for (let i = 0; i < r.online.length; i++) { if (r.online[i].user === userId) { return r.online[i].guid; } }
      return '';
    };
  }
  const box = opts.box || {};
  box.console = { log: function () { r.logged.push(Array.prototype.join.call(arguments, ' ')); } };
  box.require = require; box.Buffer = Buffer;
  box.Date = Date; box.Math = Math; box.Number = Number; box.String = String; box.Array = Array; box.Object = Object; box.JSON = JSON;
  box.setTimeout = function (fn) { r.timers.push(fn); return r.timers.length; };
  box.setInterval = function () { return 1; };
  box.clearInterval = function () { };
  box.mp = mp;
  if (!opts.box) { vm.createContext(box); }
  vm.runInContext(BLOCK, box, { filename: 'gamemode.js (join pass)' });
  r.box = box;
  r.jp = box.__thornswoodJoinPass;
  r.at = function (list) { r.online = list.map(function (x) { return { actorId: x[0], profileId: x[1], user: x[2], guid: x[3] }; }); };
  r.sweep = function (now) { return r.jp.sweep(now, r.online, function (pid, t) { r.told.push(pid + ': ' + t); }); };
  r.fire = function () { const t = r.timers.splice(0); t.forEach(function (fn) { fn(); }); };
  r.lines = function (re) { return r.logged.filter(function (s) { return re.test(s); }); };
  return r;
}

const T0 = 1790000000000;
const A1 = 0xff000a01, A2 = 0xff000a02;

// ------------------------------------------------------------ the pass names what it binds
{
  const r = rig();
  const p = mint({ p: 700, i: T0, x: T0 + 600000 });
  const v = r.jp.readPass(p, KEY, T0 + 1000, 'dev');
  yes('readPass gives when the site issued it and its signature as its id',
      v.ok === true && v.i === T0 && v.id === p.split('.')[2]);
}

// ------------------------------------------------------------ one session, the pass sent again
{
  const r = rig();
  r.at([[A1, 700, 7, 'g-one']]);
  r.sweep(T0);
  const p = mint({ p: 700, i: T0, x: T0 + 600000 });
  yes('a session\'s own pass is taken', r.jp.take(700, p, T0 + 2000).ok === true);
  r.sweep(T0 + 5000);
  yes('and proves it', r.jp.held(700, T0 + 5000) === false && r.jp.trusts(700, T0 + 5000) === true);
  yes('the front sending it again every minute is still taken, for the same session',
      r.jp.take(700, p, T0 + 62000).ok === true && r.jp.take(700, p, T0 + 122000).ok === true);
  yes('and nothing is said about it', r.lines(/not taken/).length === 0);
  r.sweep(T0 + 400000);
  r.fire();
  yes('and that session is never ended', r.kicked.length === 0);
  const p2 = mint({ p: 700, i: T0 + 60000, x: T0 + 660000 });
  yes('a renewed pass, issued after the session began, is taken for it', r.jp.take(700, p2, T0 + 61000).ok === true);
  yes('and after the first one runs out the session is still trusted on the second',
      r.jp.trusts(700, T0 + 600500) === true && r.jp.held(700, T0 + 600500) === false);
}

// ------------------------------------------------------------ a reconnect needs a pass it has not used
{
  const r = rig();
  r.at([[A1, 700, 7, 'g-one']]);
  r.sweep(T0);
  const p = mint({ p: 700, i: T0, x: T0 + 600000 });
  r.jp.take(700, p, T0 + 1000);
  r.sweep(T0 + 5000);
  r.at([]);
  r.sweep(T0 + 10000);
  r.at([[A2, 700, 8, 'g-two']]);
  r.sweep(T0 + 20000);
  const again = r.jp.take(700, p, T0 + 21000);
  yes('after a reconnect, the pass the last session used is refused', again.ok !== true && again.why === 'a pass an earlier session already used');
  yes('and the log says why, never the pass', r.lines(/join pass from profile 700 not taken: a pass an earlier session already used/).length === 1 &&
      !r.logged.some(function (s) { return s.indexOf('jp1.') >= 0; }));
  yes('and the new session is held', r.jp.held(700, T0 + 22000) === true && r.jp.trusts(700, T0 + 22000) === false);
  const p2 = mint({ p: 700, i: T0 + 50000, x: T0 + 650000 });
  yes('the launcher\'s next pass is taken', r.jp.take(700, p2, T0 + 51000).ok === true);
  r.sweep(T0 + 55000);
  yes('and proves the new session', r.jp.held(700, T0 + 55000) === false);
  r.sweep(T0 + 20000 + 181000);
  r.fire();
  yes('which is not ended', r.kicked.length === 0);
}
{
  const r = rig();
  r.at([[A1, 700, 7, 'g-one']]);
  r.sweep(T0);
  const p = mint({ p: 700, i: T0, x: T0 + 600000 });
  r.jp.take(700, p, T0 + 1000);
  r.sweep(T0 + 5000);
  r.at([]);
  r.sweep(T0 + 10000);
  r.jp.take(700, p, T0 + 15000);
  yes('at the menu after leaving, the spent pass is not kept as one on hand', !r.box.__thornswoodPassSeen.passes[700]);
  r.at([[A2, 700, 8, 'g-two']]);
  r.sweep(T0 + 20000);
  r.jp.take(700, p, T0 + 30000);
  r.sweep(T0 + 20000 + 181000);
  r.fire();
  yes('a reconnect that only ever shows the spent pass is ended at the grace', r.kicked.length === 1 && r.kicked[0] === 8);
}

// ------------------------------------------------------------ a second connection under the same number
function swapped(guids, user2, guid2) {
  const r = rig({ guids: guids });
  r.at([[A1, 700, 7, 'g-one']]);
  r.sweep(T0);
  const p = mint({ p: 700, i: T0, x: T0 + 600000 });
  r.jp.take(700, p, T0 + 1000);
  r.sweep(T0 + 5000);
  // Another client logs in under 700 between two sweeps; the engine hands it the character.
  r.at([[A1, 700, user2, guid2]]);
  r.sweep(T0 + 10000);
  r.p = p;
  return r;
}
{
  const r = swapped(true, 9, 'g-other');
  yes('another connection behind the same character is a new session, and the log says so',
      r.lines(/profile 700 is on another connection now, so that session needs a join pass of its own/).length === 1);
  yes('it is held: the pass the first connection showed does not prove it', r.jp.held(700, T0 + 11000) === true && r.jp.trusts(700, T0 + 11000) === false);
  const again = r.jp.take(700, r.p, T0 + 12000);
  yes('and that pass, sent again by anybody, is refused for it', again.ok !== true && again.why === 'a pass an earlier session already used');
  r.sweep(T0 + 10000 + 181000);
  r.fire();
  yes('it is ended at the grace with no pass of its own, on its own connection', r.kicked.length === 1 && r.kicked[0] === 9);
}
{
  const r = swapped(true, 7, 'g-reused-slot');
  yes('the same engine slot with a new GUID is a new connection too', r.jp.held(700, T0 + 11000) === true);
}
{
  const r = swapped(true, 7, 'g-one');
  yes('the same connection is the same session', r.jp.held(700, T0 + 11000) === false &&
      r.lines(/another connection/).length === 0);
}
{
  const r = swapped(false, 9, '');
  yes('an engine with no GUIDs: a new slot is a new connection', r.jp.held(700, T0 + 11000) === true);
}
{
  const r = rig();
  r.at([[A1, 700, 7, 'g-one']]);
  r.sweep(T0);
  r.jp.take(700, mint({ p: 700, i: T0, x: T0 + 600000 }), T0 + 1000);
  r.sweep(T0 + 5000);
  r.at([[A1, 700, -1, '']]);
  r.sweep(T0 + 10000);
  yes('a connection the engine cannot name for a moment changes nothing', r.jp.held(700, T0 + 11000) === false &&
      r.lines(/another connection/).length === 0);
}

// ------------------------------------------------------------ a pass starts a session only while it is fresh
{
  const r = rig();
  const p = mint({ p: 700, i: T0, x: T0 + 600000 });
  r.jp.take(700, p, T0 + 1000);
  r.at([[A1, 700, 7, 'g-one']]);
  r.sweep(T0 + 60000);
  yes('a pass from the menu, issued a minute before the session, proves it', r.jp.held(700, T0 + 61000) === false);
}
{
  const r = rig();
  const p = mint({ p: 700, i: T0, x: T0 + 600000 });
  r.jp.take(700, p, T0 + 1000);
  r.at([[A1, 700, 7, 'g-one']]);
  // Kept fresh at the menu by the front, but issued long before.
  r.jp.take(700, p, T0 + 100000);
  r.sweep(T0 + 120000);
  yes('one issued two minutes before the session does not, however recently it was sent', r.jp.held(700, T0 + 121000) === true);
  const late = r.jp.take(700, p, T0 + 130000);
  yes('and sent again inside the session it is refused, saying why', late.ok !== true && late.why === 'a pass issued before this session began');
  r.sweep(T0 + 120000 + 181000);
  r.fire();
  yes('so a pass picked up at the menu, off a disk or off the wire cannot start a session ten minutes later', r.kicked.length === 1);
}
{
  const r = rig();
  r.at([[A1, 700, 7, 'g-one']]);
  r.sweep(T0);
  const old = r.jp.take(700, mint({ p: 700, i: T0 - 200000, x: T0 + 400000 }), T0 + 1000);
  yes('a never used pass issued before the session began is refused for it', old.ok !== true && old.why === 'a pass issued before this session began');
  yes('one issued inside the minute and a half before it is taken', r.jp.take(700, mint({ p: 700, i: T0 - 80000, x: T0 + 520000 }), T0 + 2000).ok === true);
}

// ------------------------------------------------------------ a pass for one session cannot be moved to another profile
{
  const r = rig();
  r.at([[A1, 700, 7, 'g-one'], [A2, 701, 8, 'g-two']]);
  r.sweep(T0);
  const p = mint({ p: 700, i: T0, x: T0 + 600000 });
  r.jp.take(700, p, T0 + 1000);
  yes('a pass for 700 still never proves 701', r.jp.take(701, p, T0 + 2000).ok !== true && r.jp.held(701, T0 + 3000) === true);
}

// ------------------------------------------------------------ a hot reload keeps the bindings; a restart keeps ISSUED_MS
{
  const r = rig();
  r.at([[A1, 700, 7, 'g-one']]);
  r.sweep(T0);
  const p = mint({ p: 700, i: T0, x: T0 + 600000 });
  r.jp.take(700, p, T0 + 1000);
  r.sweep(T0 + 5000);
  const r2 = rig({ box: r.box });
  r2.at([[A1, 700, 7, 'g-one']]);
  yes('after a hot reload the session is still proved', r2.jp.held(700, T0 + 6000) === false);
  r2.at([]);
  r2.sweep(T0 + 10000);
  r2.at([[A2, 700, 8, 'g-two']]);
  r2.sweep(T0 + 20000);
  yes('and the pass is still spent for the next session', r2.jp.take(700, p, T0 + 21000).ok !== true);
}
{
  // A box whose sessions were made by the block before #1320, then hot reloaded.
  const box = {};
  vm.createContext(box);
  box.__thornswoodPassSeen = { passes: { 700: { at: T0, x: T0 + 600000, v: '1.1.102', d: '111' } },
                                online: { 700: { joined: T0 - 1000, judged: true, actorId: A1 },
                                          701: { joined: T0 - 1000, judged: false, actorId: A2 } }, said: {} };
  const r = rig({ box: box });
  r.at([[A1, 700, 7, 'g-one'], [A2, 701, 8, 'g-two']]);
  yes('sessions from before #1320 are numbered on a hot reload, and one already proved stays proved',
      r.jp.held(700, T0 + 2000) === false && r.jp.held(701, T0 + 2000) === true);
}
{
  // A restart: nothing kept. The reconnect after it is a new session in a new process.
  const r = rig();
  r.at([[A2, 700, 8, 'g-two']]);
  r.sweep(T0 + 70000);
  yes('after a restart, the pass on hand starts the new session while it is fresh',
      r.jp.take(700, mint({ p: 700, i: T0 + 20000, x: T0 + 620000 }), T0 + 71000).ok === true);
  const r2 = rig();
  r2.at([[A2, 700, 8, 'g-two']]);
  r2.sweep(T0 + 200000);
  yes('and not once ISSUED_MS has gone', r2.jp.take(700, mint({ p: 700, i: T0, x: T0 + 600000 }), T0 + 201000).ok !== true);
}

// ------------------------------------------------------------ a game relaunched before the last connection timed out (#2013)
// Measured on dev on 5 Oct: the game closed at 11:29:22 PM, the new one logged
// in at 11:29:54 while the old connection lived on until its timeout at
// 11:30:19, the launcher's new pass came at 11:29:55 and the sweep that saw the
// new connection ran at 11:29:58. The pass was spent on the old session and the
// sweep threw it away, so the new session was held until the next pass.
{
  const r = rig();
  r.at([[A1, 700, 1, 'g-old']]);
  r.sweep(T0);
  const p = mint({ p: 700, i: T0, x: T0 + 600000 });
  r.jp.take(700, p, T0 + 1000);
  r.sweep(T0 + 5000);
  // The game is closed and started again; the engine hands the character to
  // the new connection while the old one has not yet timed out.
  r.at([[A1, 700, 2, 'g-new']]);
  const p2 = mint({ p: 700, i: T0 + 31000, x: T0 + 631000 });
  const took = r.jp.take(700, p2, T0 + 32000);
  yes('the relaunched game\'s pass, sent before the next sweep, is taken', took.ok === true);
  r.sweep(T0 + 35000);
  yes('and proves the new connection\'s session', r.jp.held(700, T0 + 35000) === false && r.jp.trusts(700, T0 + 35000) === true);
  yes('the log says once that the character is on another connection',
      r.lines(/profile 700 is on another connection now/).length === 1);
  yes('and names the pass taken for the new session', r.lines(/join pass for profile 700, launcher/).length === 2);
  yes('the old session\'s pass still proves nothing for it', r.jp.take(700, p, T0 + 36000).ok !== true);
  r.sweep(T0 + 35000 + 181000);
  r.fire();
  yes('and the new session is not ended at the grace', r.kicked.length === 0);
}

// ------------------------------------------------------------ nothing grows
{
  const r = rig();
  for (let k = 0; k < 20; k++) {
    r.jp.take(800 + k, mint({ p: 800 + k, i: T0, x: T0 + 600000 }), T0 + 1000);
  }
  const used = r.box.__thornswoodPassSeen.used || {};
  yes('every pass taken is remembered while it lives', Object.keys(used).length === 20);
  r.sweep(T0 + 600001);
  yes('and let go once it has run out', Object.keys(used).length === 0);
}

// ------------------------------------------------------------ the launcher renews inside the window
{
  const m = /const int RenewMinutes = (\d+);/.exec(joinPassCs);
  const iss = /var ISSUED_MS = (\d+);/.exec(src);
  yes('the launcher renews the pass every minute', !!m && Number(m[1]) === 1);
  yes('which is inside the game server\'s window for starting a session, with room for a slow fetch',
      !!m && !!iss && Number(m[1]) * 60000 + 20000 <= Number(iss[1]));
  yes('and a reconnect has a new pass well inside the grace', !!m && Number(m[1]) * 60000 < r0grace());
}
function r0grace() { return rig().jp.grace; }

try { fs.rmSync(PRIV, { recursive: true, force: true }); } catch (e) { }
done();
