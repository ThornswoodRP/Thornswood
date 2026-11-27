// test-join-pass-trust.js
//
//     node .\tests\test-join-pass-trust.js
//
// With thornswoodRequirePass on, nothing on the game server takes a profile
// number at its word until the launcher's join pass has proved it (#410).
//
// WHY. Identity on the game server is the profile number the client logs in
// under. The join pass (#937) ends a session that never shows a pass, but only
// after a three minute grace, and until this change everything else in the
// gamemode believed the number the whole time: that character's inventory,
// its crafting and trades, the roles (admin, staff, playtester, Jarl), the
// commands, and one admin who was a number written into the source. So a
// client that logged in as the admin's number was the admin for three minutes,
// and a client that logged in as anybody's number could empty that person's
// pack. And the voice service, which carries the chat, followed a switch of
// its own, so chat could still go out under a claimed number and under a name
// the page picked for itself.
//
// WHAT IS HELD HERE, each piece lifted out of game\gamemode.js (or read out of
// voice\voice-server.js) and run in a vm with a stand-in mp and its own clock:
//   1. The join pass block's shown/proven/held/trusts: nothing changes while
//      the pass is only watched; with it on, a profile is trusted only with a
//      pass for the session it is in, and a held session is told once why.
//   2. guard(): every engine event a held session raises (activate, craft,
//      read, put, take, drop, appearance) is refused, and the handler never
//      runs; nobody else's are, and the timers are not touched.
//   3. dispatch(): with it on, a line from a chat connection that did not
//      prove itself is not run and not answered; a held session's lines wait
//      until its pass arrives and then run in order; a report of a moment is
//      dropped; lines whose pass never came are dropped, never run.
//   4. The roles in the chat commands block: no admin written into the
//      source any more, and no role for a profile with no pass while it is on.
//   5. The door's role answers (dev, admin, staff seat, Jarl, allowed) are
//      no for a profile the pass has not proved, while its own check of who may
//      connect is unchanged.
//   6. The voice service follows the game server's switch (refuses and closes
//      unproven connections), the feed carries the switch every tick, and a
//      proven connection's chat goes out under its character's name.
//
// Read only. Nothing connects to anything.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(process.env.GAMEMODE || path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
const voice = fs.readFileSync(path.join(ROOT, 'voice', 'voice-server.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
// A section that throws is a FAIL with its message, not a crash, so a copy
// of the gamemode without this change is reported check by check.
function section(fn) {
  try { fn(); } catch (e) { yes('a section ran to its end (' + String(e && e.message || e).slice(0, 120) + ')', false); }
}
function done() { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0; }

/* A function's whole text, from its header to its closing brace. */
function fnText(code, header, from) {
  const at = code.indexOf(header, from || 0);
  if (at < 0) return '';
  let depth = 0;
  for (let i = code.indexOf('{', at); i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) return code.slice(at, i + 1); }
  }
  return '';
}
function line(code, start) {
  const at = code.indexOf(start);
  return at < 0 ? '' : code.slice(at, code.indexOf('\n', at));
}

const KEY = 'test-join-pass-key-not-a-real-one';
function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function mint(o) {
  const body = b64u(JSON.stringify({ p: o.p, s: o.s || 'dev', v: '1.1.102', d: '111', i: o.i, x: o.x }));
  return 'jp1.' + body + '.' + b64u(crypto.createHmac('sha256', KEY).update('jp1.' + body).digest());
}
const PRIV = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-pass-trust-'));
fs.writeFileSync(path.join(PRIV, 'door.json'), JSON.stringify({ site: 'https://door.test', key: 'k', passKey: KEY }));

// ---------------------------------------------------------------- 1. the block
const a = src.indexOf('// ==== thornswood join pass ====');
const b = src.indexOf('// ==== end thornswood join pass ====');
yes('the join pass block is in gamemode.js between its markers', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { done(); return; }

function rig(requirePass) {
  const r = { told: [], logged: [], online: [] };
  const box = {
    console: { log: function () { r.logged.push(Array.prototype.join.call(arguments, ' ')); } },
    require: require, Buffer: Buffer,
    Date: Date, Math: Math, Number: Number, String: String, Array: Array, Object: Object, JSON: JSON,
    setTimeout: function () { return 1; }, setInterval: function () { return 1; }, clearInterval: function () { },
    mp: {
      getServerSettings: function () { return { privDir: PRIV, thornswoodServer: 'dev', thornswoodRequirePass: requirePass }; },
      get: function () { return []; }, getUserByActor: function () { return -1; }, kick: function () { }
    }
  };
  vm.createContext(box);
  vm.runInContext(src.slice(a, b), box, { filename: 'gamemode.js (join pass)' });
  r.box = box;
  r.jp = box.__thornswoodJoinPass;
  r.sweep = function (now) { return r.jp.sweep(now, r.online, function (pid, t) { r.told.push(pid + ': ' + t); }); };
  return r;
}
const T0 = Date.now();

section(function () {
  const r = rig(false);
  r.online = [{ actorId: 1, profileId: 700 }];
  r.sweep(T0);
  yes('watch only: an unproven profile is trusted, as before', r.jp.trusts(700, T0 + 1000) === true && r.box.__thornswoodPassTrusts(700) === true);
  yes('watch only: and nothing is held', r.jp.held(700, T0 + 1000) === false && r.box.__thornswoodPassHeld(700) === false);
  r.sweep(T0 + 30000);
  yes('watch only: and nobody is told to wait', r.told.length === 0);
});
section(function () {
  const r = rig(true);
  r.online = [{ actorId: 1, profileId: 700 }];
  r.sweep(T0);
  yes('on: a profile with no pass is not trusted', r.jp.trusts(700, T0 + 1000) === false);
  yes('on: and is held', r.jp.held(700, T0 + 1000) === true);
  r.sweep(T0 + 5000);
  yes('on: not told anything in the first seconds, while a pass is on its way', r.told.length === 0);
  r.sweep(T0 + 16000);
  yes('on: told once, after that, why nothing it does counts', r.told.length === 1 && r.told[0] === '700: ' + r.jp.waiting);
  r.sweep(T0 + 30000);
  yes('on: and only once', r.told.length === 1);
  const got = r.jp.take(700, mint({ p: 700, i: T0, x: T0 + 600000 }), T0 + 40000);
  yes('on: its pass is taken', got.ok === true);
  yes('on: and from then it is trusted and not held', r.jp.trusts(700, T0 + 41000) === true && r.jp.held(700, T0 + 41000) === false);
  yes('on: until the pass expires, when a role no longer trusts it', r.jp.trusts(700, T0 + 600001) === false);
  yes('on: though the session stays shown, since it proved itself when it came', r.jp.held(700, T0 + 600001) === false);
  yes('on: a pass for 700 proves nothing about 701', r.jp.trusts(701, T0 + 41000) === false);
});
section(function () {
  const r = rig(true);
  // A pass for a session before this one does not carry over.
  r.online = [{ actorId: 1, profileId: 700 }];
  r.jp.take(700, mint({ p: 700, i: T0 - 400000, x: T0 + 200000 }), T0 - 300000);
  r.sweep(T0);
  yes('on: a pass older than the session (more than a minute before it) does not prove it', r.jp.held(700, T0 + 1000) === true);
  r.jp.take(700, mint({ p: 700, i: T0, x: T0 + 600000 }), T0 + 2000);
  yes('on: a fresh one does', r.jp.held(700, T0 + 3000) === false);
});
section(function () {
  const r = rig(true);
  // At the menu: no game session yet, a pass on hand.
  r.jp.take(702, mint({ p: 702, i: T0, x: T0 + 600000 }), T0);
  yes('on: a profile not in the world counts an unexpired pass', r.jp.trusts(702, T0 + 1000) === true);
  yes('on: and an expired one does not', r.jp.trusts(702, T0 + 600001) === false);
});

// ---------------------------------------------------------------- 2. guard()
section(function () {
  // guard() counts its time through countSpent() since #385, so both are lifted.
  const gText = fnText(src, 'function guard(name, fn) {') + '\n' + fnText(src, 'function countSpent(name, began) {');
  yes('guard(), with the table of who acts in each engine event, is in gamemode.js', gText.indexOf('const ACTS_AS = ') > 0);
  const heldPids = { 700: true };
  const box = {
    globalThis: null, Object: Object, Number: Number, console: { error: function () { }, log: function () { } },
    process: { hrtime: function () { return [0, 0]; } }, gmSpent: {},
    mp: { get: function (id, what) { if (what !== 'profileId') throw new Error('x'); return id === 0xff000001 ? 700 : (id === 0xff000002 ? 800 : -1); } }
  };
  box.globalThis = box;
  box.__thornswoodPassHeld = function (pid) { return !!heldPids[pid]; };
  vm.createContext(box);
  vm.runInContext(gText + '\nthis.guard = guard;', box);
  const calls = [];
  function h(name) { return box.guard(name, function () { calls.push(name); return 'ran'; }); }
  const HELD = 0xff000001, OK = 0xff000002, NPC = 0x0001a2b3;
  const cases = [
    ['onActivate', [0x000fa1, HELD]], ['onCraft', [HELD, 1, 1, 1, 1]], ['onReadBook', [HELD, 1]],
    ['onPutItem', [0x000fa1, HELD, 1, 1]], ['onTakeItem', [0x000fa1, HELD, 1, 1]], ['onDropItem', [HELD, 1, 1]],
    ['onUpdateAppearanceAttempt', [HELD, {}, true]]
  ];
  cases.forEach(function (c) {
    calls.length = 0;
    const r = h(c[0]).apply(null, c[1]);
    yes('a held session\'s ' + c[0] + ' is refused, and the handler never runs', r === false && calls.length === 0);
  });
  calls.length = 0;
  yes('a proved session\'s onPutItem runs', h('onPutItem')(0x000fa1, OK, 1, 1) === 'ran' && calls.length === 1);
  calls.length = 0;
  yes('an activation by somebody not a person (no profile) runs', h('onActivate')(0x000fa1, NPC) === 'ran');
  calls.length = 0;
  yes('onActivate looks at who activates, not at what is activated', h('onActivate')(HELD, OK) === 'ran');
  calls.length = 0;
  yes('onDeath is not a person acting and is left alone', h('onDeath')(HELD, OK) === 'ran');
  calls.length = 0;
  yes('a timer is left alone', h('needsTick')(HELD) === 'ran');
  delete box.__thornswoodPassHeld;
  calls.length = 0;
  yes('with no join pass block loaded, nothing is held', h('onPutItem')(0x000fa1, HELD, 1, 1) === 'ran');
});

// ---------------------------------------------------------------- 3. dispatch()
section(function () {
  const at = src.indexOf('  function dispatch(cmd) {');
  const parts = [
    line(src, 'if (!g.__thornswoodHeld) {'), line(src, '  var held = g.__thornswoodHeld;'),
    line(src, '  var HOLD_FOR = '), line(src, '  var HOLD_MAX = '), line(src, '  var HOLD_ALL = '),
    line(src, '  var MOMENTS = '), line(src, '  var unprovenSaid = '), line(src, '  var UNPROVEN_SAY_MS = '),
    fnText(src, '  function passHeld('), fnText(src, '  function runsNow('), fnText(src, '  function heldCount('),
    fnText(src, '  function commandParts('), fnText(src, '  function dispatch(cmd) {'), fnText(src, '  function drainHeld() {')
  ];
  yes('dispatch(), drainHeld() and their queue are in gamemode.js', at >= 0 && parts.every(function (p) { return p.length > 0; }));
  const st = { requiring: true, held: {}, ran: [], told: [], logged: [], taken: [], actors: { 700: 1, 800: 2 } };
  const box = {
    Object: Object, Number: Number, String: String, Date: Date, Math: Math,
    WORDS: ['/roll', '/help', '/give', '/trade', '/place'],
    handle: function (cmd) { st.ran.push(cmd.profileId + ' ' + cmd.text); },
    actorOf: function (pid) { return st.actors[pid] || 0; },
    toProfile: function (pid, t) { st.told.push(pid + ': ' + t); },
    log: function () { st.logged.push(Array.prototype.join.call(arguments, ' ')); }
  };
  box.g = box;
  box.__thornswoodJoinPass = {
    take: function (pid, raw) { st.taken.push(pid + ' ' + raw); },
    requiring: function () { return st.requiring; }
  };
  box.__thornswoodPassHeld = function (pid) { return st.requiring && !!st.held[pid]; };
  vm.createContext(box);
  vm.runInContext(parts.join('\n') + '\nthis.dispatch = dispatch; this.drainHeld = drainHeld;', box);

  const nowStart = Date.now();
  box.dispatch({ profileId: 900, text: '/give 12eb7', proven: false });
  yes('on: a line from a chat connection that did not prove itself is not run', st.ran.length === 0);
  yes('on: and not answered, since an answer goes to whoever really holds that number', st.told.length === 0);
  yes('on: and the log says why', st.logged.some(function (s) { return /did not prove who it is/.test(s); }));
  box.dispatch({ profileId: 900, text: '/line', proven: false });
  yes('on: not even a place in the line', st.ran.length === 0);
  box.dispatch({ profileId: 900, text: '/joinpass jp1.x.y', proven: false });
  yes('on: but the pass itself is always taken, checked against its own signature', st.taken.length === 1 && st.taken[0] === '900 jp1.x.y');

  st.held[700] = true;
  box.dispatch({ profileId: 700, text: '/trade Bjorn', proven: true });
  box.dispatch({ profileId: 700, text: '/help', proven: true });
  box.dispatch({ profileId: 700, text: '/place 1 2 3', proven: true });
  yes('on: a held session\'s lines do not run', st.ran.length === 0);
  box.drainHeld();
  yes('on: nor on the next tick while it is still held', st.ran.length === 0);
  delete st.held[700];
  box.drainHeld();
  yes('on: once its pass is here they run, in the order typed', st.ran.join('|') === '700 /trade Bjorn|700 /help');
  yes('on: and the report of a moment was dropped, not kept for later', st.ran.indexOf('700 /place 1 2 3') < 0);

  st.ran.length = 0;
  st.held[800] = true;
  box.dispatch({ profileId: 800, text: '/give 12eb7', proven: true });
  box.held[800].lines[0].at = nowStart - 100000;
  box.drainHeld();
  yes('on: a line whose pass never came is dropped when it has waited too long, never run', st.ran.length === 0 && !box.held[800]);
  yes('on: and the log says so', st.logged.some(function (s) { return /pass never arrived/.test(s); }));

  st.requiring = false;
  st.ran.length = 0;
  box.dispatch({ profileId: 900, text: '/help', proven: false });
  yes('watch only: an unproven line runs as before', st.ran.join('|') === '900 /help');
});

// ---------------------------------------------------------------- 4. the roles
section(function () {
  const parts = [fnText(src, '  function admins() {'), fnText(src, '  function passTrusts('), fnText(src, '  function isAdmin('),
                 fnText(src, '  function rolelist('), fnText(src, '  function roleFromDoor('), fnText(src, '  function isDev('),
                 fnText(src, '  function isPlaytester(')];
  yes('the role checks are in gamemode.js', parts.every(function (p) { return p.length > 0; }));
  yes('no admin profile number is written into the source any more', !/816507994/.test(src));
  const st = { settings: {}, trusted: {} };
  const box = { Array: Array, Number: Number, mp: { getServerSettings: function () { return st.settings; } } };
  box.g = box; box.globalThis = box;
  box.__thornswoodPassTrusts = function (pid) { return !!st.trusted[pid]; };
  vm.createContext(box);
  vm.runInContext(parts.join('\n') + '\nthis.isAdmin = isAdmin; this.isDev = isDev; this.isPlaytester = isPlaytester; this.admins = admins;', box);
  yes('with no thornswoodAdmins, nobody is a written admin', box.admins().length === 0);
  st.settings = { thornswoodAdmins: [111], thornswoodDevs: [222], thornswoodPlaytesters: [333] };
  yes('a written admin whose pass is not on hand is not an admin', box.isAdmin(111) === false);
  yes('nor a written dev', box.isDev(222) === false);
  yes('nor a written playtester', box.isPlaytester(333) === false);
  st.trusted = { 111: true, 222: true, 333: true };
  yes('with the pass: admin, dev and playtester as written', box.isAdmin(111) && box.isDev(222) && box.isPlaytester(333));
  yes('and the pass is not a role of its own', box.isAdmin(222) === false && box.isDev(333) === false);
  box.__thornswoodDevs = null;
  box.__thornswoodIsDev = function (pid) { return pid === 444; };
  st.trusted[444] = false;
  yes('the site\'s roles count only for a proved profile too', box.isDev(444) === false);
});

// ---------------------------------------------------------------- 5. the door
section(function () {
  const d0 = src.indexOf('// ==== thornswood door ====');
  const d1 = src.indexOf('// ==== end thornswood door ====');
  yes('the door is in gamemode.js between its markers', d0 >= 0 && d1 > d0);
  const files = {};
  files[path.join('private', 'allowed.json')] = JSON.stringify({ enforce: false, profiles: [500, 501], devProfiles: [500],
    adminProfiles: [500], staffRoleProfiles: [500],
    // The hold offices by profile (#2551), from the Discord roles.
    offices: { 500: { jarl: ['whiterun'], court: [], steward: [], guard: ['riften'] } },
    devRoleProfiles: [500], businessOwnerProfiles: [500],
    // Each faction's Leader role and who holds it (#3317).
    factionLeaderProfiles: { 'Companions Leader': [500] } });
  const fakeFs = {
    readFileSync: function (p) { if (!Object.prototype.hasOwnProperty.call(files, p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[p]; },
    writeFileSync: function (p, s) { files[p] = String(s); }, appendFileSync: function () { }, existsSync: function () { return true; },
    mkdirSync: function () { }, statSync: function () { return { mtimeMs: 0 }; }
  };
  const trusted = {};
  const box = {
    console: { log: function () { }, error: function () { } },
    require: function (m) { if (m === 'fs') return fakeFs; if (m === 'path') return path; return { get: function () { return { on: function () { }, setTimeout: function () { } }; }, request: function () { return { on: function () { }, end: function () { }, setTimeout: function () { } }; } }; },
    Buffer: Buffer, Date: Date, Math: Math, Number: Number, String: String, Array: Array, Object: Object, JSON: JSON,
    setTimeout: function () { return 1; }, setInterval: function () { return 1; }, clearInterval: function () { }, clearTimeout: function () { },
    mp: { getServerSettings: function () { return {}; }, get: function () { return []; }, kick: function () { } }
  };
  box.globalThis = box;
  box.__thornswoodPassTrusts = function (pid) { return !!trusted[pid]; };
  vm.createContext(box);
  let ran = true;
  try { vm.runInContext(src.slice(d0, d1), box, { filename: 'gamemode.js (door)' }); } catch (e) { ran = false; console.log('      ' + e); }
  yes('the door block runs over a stand-in server', ran && typeof box.__thornswoodIsDev === 'function');
  if (ran && typeof box.__thornswoodIsDev === 'function') {
    const asks = ['__thornswoodIsDev', '__thornswoodIsAdmin', '__thornswoodHoldsStaffRole', '__thornswoodIsAllowed'];
    const list = asks.filter(function (n) { return typeof box[n] === 'function'; });
    // The hold offices (#2551) replace the Jarl answer: one answer, every office.
    const offices = function () {
      const o = typeof box.__thornswoodOffices === 'function' ? box.__thornswoodOffices(500) : null;
      return !!o && o.jarl.join() === 'whiterun' && o.guard.join() === 'riften';
    };
    yes('all four role answers and the hold offices are there (' + list.length + ')',
        list.length === 4 && typeof box.__thornswoodOffices === 'function');
    yes('none of them is yes, and no office is held, for a profile the pass has not proved',
        list.every(function (n) { return box[n](500) === false; }) && !offices());
    trusted[500] = true;
    yes('every one is yes, and the offices are there, for the same profile once proved',
        list.every(function (n) { return box[n](500) === true; }) && offices());
    trusted[501] = true;
    yes('and a proved profile still needs the role itself', box.__thornswoodIsAdmin(501) === false && box.__thornswoodIsAllowed(501) === true);
  }
  /*
    The book roles (#1417): staff, Dev, Business Owner and the faction Leader
    roles held (#3317), which decide who may found or open a group book. The
    same rule as the five above: nothing for a profile the pass has not proved.
  */
  if (ran && typeof box.__thornswoodBookRoles === 'function') {
    const roles = ['staff', 'dev', 'business'];
    const led = function (r) { return Array.isArray(r.leads) ? r.leads.join() : 'none'; };
    delete trusted[500];
    const before = box.__thornswoodBookRoles(500);
    yes('the book roles are all no for a profile the pass has not proved',
        roles.every(function (r) { return before[r] === false; }) && led(before) === '');
    trusted[500] = true;
    const after = box.__thornswoodBookRoles(500);
    yes('and all yes once proved, for a profile that holds them',
        roles.every(function (r) { return after[r] === true; }) && led(after) === 'Companions Leader');
    const none = box.__thornswoodBookRoles(501);
    yes('and a proved profile with none of them holds none',
        roles.every(function (r) { return none[r] === false; }) && led(none) === '');
  } else {
    yes('the book roles answer is in the door (#1417)', false);
  }
  const door = src.slice(d0, d1);
  // The door's own check is tick(): it reads the list straight, because it
  // runs before any pass can have arrived.
  const tickAt = door.indexOf('function tick() {');
  const tickEnd = tickAt < 0 ? -1 : door.indexOf('\n  function ', tickAt + 1);
  const tickBody = tickAt < 0 ? '' : door.slice(tickAt, tickEnd < 0 ? door.length : tickEnd);
  yes('the door\'s own check of who may connect does not go through the pass (it runs before one can arrive)',
      tickAt >= 0 && /conf\.ids\[pid\]/.test(tickBody) &&
      !/__thornswoodPassTrusts|passProved\(/.test(tickBody) &&
      (door.match(/function passProved\(/g) || []).length === 1);
});

// ---------------------------------------------------------------- 6. voice and the feed
section(function () {
  const code = voice.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Since #1303 a connection that cannot prove itself is refused whatever the
  // game server's switch says, so the switch has nothing left to turn on
  // here; since #1337 that is at the handshake, before there is a socket.
  const onJoin = fnText(code, 'function onJoin(');
  const upgrade = code.slice(code.indexOf("server.on('upgrade'"), code.indexOf("const ws = new Sock(socket);"));
  yes('voice: a connection that cannot prove itself is refused at the handshake, with no setting and no switch in the way',
      /const pass = [^;]*spendToken\(/.test(upgrade) &&
      /if \(!pass\.profileId \|\| pass\.why\) \{[\s\S]*?refuseUpgrade\(socket, pass\.why\);\s*return;\s*\}/.test(upgrade) &&
      /function onJoin\(ws, msg, profileId\)/.test(onJoin) && !/AUTH|gameRequiresPass/.test(upgrade + onJoin));
  yes('voice: nothing reads the switch off /positions any more, and nothing is left to close',
      !/gameRequiresPass|closeUnproven|doc\.requirePass ===/.test(code));
  // peerName, run.
  const pn = fnText(voice, 'function peerName(');
  const box = { String: String, positions: new Map([[700, { name: 'Bjorn Iron-Hand' }]]) };
  vm.createContext(box);
  vm.runInContext(pn + '\nthis.peerName = peerName;', box);
  yes('voice: a proven connection\'s words go out under its character\'s name, not the page\'s',
      box.peerName({ proven: true, profileId: 700, name: 'Patrick' }) === 'Bjorn Iron-Hand');
  yes('voice: the page\'s name only while the game server has none (the menu)',
      box.peerName({ proven: true, profileId: 701, name: 'Somebody' }) === 'Somebody');
  yes('voice: and an unproven connection never borrows a character name for its claimed number',
      box.peerName({ proven: false, profileId: 700, name: 'Me' }) === 'Me');
  yes('voice: the room\'s chat, the roster and the chat log all use it',
      /name: peerName\(me\),\s*text: said,/.test(code) && /name: peerName\(p\), mode:/.test(code) && /name: peerName\(me\),\s*proven:/.test(code));
  const feed = src.slice(src.indexOf('// ==== thornswood voice feed'), src.indexOf('// ==== end thornswood voice feed'));
  yes('feed: the gamemode sends the switch with the positions, every tick, with nobody in the world too',
      /send\(\{ who: who, requirePass: requirePass \}\)/.test(feed) && !/if \(who\.length === 0\) return;/.test(feed));
});

done();
