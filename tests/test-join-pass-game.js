// test-join-pass-game.js
//
//     node .\tests\test-join-pass-game.js
//
// The game server ends every session that has not shown a valid join pass
// within the grace, and takes a valid one (#937). Patrick, 28 Sep: "People
// should not be allowed in at all if they don't join from our launcher."
//
// The join pass block is lifted out of game\gamemode.js between its markers and
// run in a vm with a stand-in mp, a door.json in a temp folder and its own
// clock, the way test-load-order-refusal.js runs the load order block. The
// front plugin's sender is lifted out of thornswood-front.js and run the same
// way. The dispatcher hook and the voice chat log are read.
//
// THE SHARED PASS. VECTOR_PASS below is the one site\tests\test-join-pass-site.js
// checks makePass in site\server.js writes exactly, so the site and the game
// server cannot drift apart on the format.
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
const front = fs.readFileSync(path.join(ROOT, 'game', 'plugins', 'thornswood-front.js'), 'utf8').split(CR).join('');
const voice = fs.readFileSync(path.join(ROOT, 'voice', 'voice-server.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const KEY = 'test-join-pass-key-not-a-real-one';
const VECTOR_PASS = 'jp1.eyJwIjo3MDAsInMiOiJkZXYiLCJ2IjoiMS4xLjEwMi4zIiwiZCI6IjExMSIsImkiOjE3OTAwMDAwMDAwMDAsIngiOjE3OTAwMDA2MDAwMDB9.OfS3TF2v5kDiiBwbLyy-VZHHSTv3YE4Zd0bOnAGove8';
const VECTOR_AT = 1790000000000;

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/* The site's makePass, written out again here from the format note. */
function mint(o, key) {
  const body = b64u(JSON.stringify({ p: o.p, s: o.s, v: o.v || '1.1.102', d: o.d || '111', i: o.i, x: o.x }));
  return 'jp1.' + body + '.' + b64u(crypto.createHmac('sha256', key || KEY).update('jp1.' + body).digest());
}

// ------------------------------------------------------------ the block
const a = src.indexOf('// ==== thornswood join pass ====');
const b = src.indexOf('// ==== end thornswood join pass ====');
yes('the join pass block is in gamemode.js between its markers', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }

const PRIV = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-pass-game-'));
function door(doc) {
  if (doc === null) { try { fs.unlinkSync(path.join(PRIV, 'door.json')); } catch (e) { } return; }
  fs.writeFileSync(path.join(PRIV, 'door.json'), JSON.stringify(doc));
}

function rig(settings) {
  const r = { told: [], logged: [], kicked: [], timers: [], online: [] };
  const box = {
    console: { log: function () { r.logged.push(Array.prototype.join.call(arguments, ' ')); } },
    require: require, Buffer: Buffer,
    Date: Date, Math: Math, Number: Number, String: String, Array: Array, Object: Object, JSON: JSON,
    setTimeout: function (fn) { r.timers.push(fn); return r.timers.length; },
    setInterval: function (fn) { r.interval = fn; return 1; },
    clearInterval: function () { },
    mp: {
      getServerSettings: function () { return Object.assign({ privDir: PRIV }, settings); },
      getUserByActor: function (actorId) { return actorId === 0xff000a01 ? 7 : (actorId === 0xff000a02 ? 8 : -1); },
      get: function (id, what) {
        if (id === 0 && what === 'onlinePlayers') { return r.online.map(function (o) { return o.actorId; }); }
        for (let i = 0; i < r.online.length; i++) { if (r.online[i].actorId === id) { return r.online[i].profileId; } }
        throw new Error('no such actor');
      },
      kick: function (userId) { r.kicked.push(userId); }
    }
  };
  vm.createContext(box);
  vm.runInContext(src.slice(a, b), box, { filename: 'gamemode.js (join pass)' });
  r.jp = box.__thornswoodJoinPass;
  r.box = box;
  r.sweep = function (now) { return r.jp.sweep(now, r.online, function (pid, t) { r.told.push(pid + ': ' + t); }); };
  r.fire = function () { const t = r.timers.splice(0); t.forEach(function (fn) { fn(); }); };
  return r;
}

door({ site: 'https://thornswood.net/dev', key: 'door-key', passKey: KEY });

{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  yes('the block publishes take, sweep and readPass', !!(r.jp && r.jp.take && r.jp.sweep && r.jp.readPass));
  yes('the grace is three minutes', r.jp.grace === 180000);
  const v = r.jp.readPass(VECTOR_PASS, KEY, VECTOR_AT + 1000, 'dev');
  yes('the pass the site test holds in common is read: profile 700, launcher 1.1.102.3', v.ok === true && v.p === 700 && v.v === '1.1.102.3');
  yes('and the Discord account it was signed for, which /stuck\'s staff record names (#414)', v.d === '111');
  yes('the startup line says required, the server and that the key is there',
      r.logged.some(function (s) { return /join pass REQUIRED on the dev server, key present/.test(s); }));
}

const T0 = Date.now();
function online(r, list) { r.online = list.map(function (x) { return { actorId: x[0], profileId: x[1] }; }); }

{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  const got = r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }), T0 + 10000);
  yes('a valid pass sent under its own profile is taken', got.ok === true);
  yes('and kept with its Discord account, for the staff record of a /stuck (#414)',
      r.box.__thornswoodPassSeen.passes[700].d === '111');
  r.sweep(T0 + 15000);
  r.sweep(T0 + 400000);
  r.fire();
  yes('and that session is never ended or told anything', r.kicked.length === 0 && r.told.length === 0);
  yes('the log names the launcher, never the pass',
      r.logged.some(function (s) { return /join pass for profile 700, launcher 1\.1\.102/.test(s); }) &&
      !r.logged.some(function (s) { return s.indexOf('jp1.') >= 0; }));
}

function refusedCase(what, send) {
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  const got = send ? send(r) : null;
  if (send) yes(what + ': the pass is not taken', !!got && got.ok !== true);
  r.sweep(T0 + 170000);
  r.fire();
  // Inside the grace nothing ends, and it is told once why nothing it does
  // counts yet (#410, test-join-pass-trust.js).
  yes(what + ': nothing ends inside the grace, and it is told once why it is held',
      r.kicked.length === 0 && r.told.length === 1 && r.told[0] === '700: ' + r.jp.waiting);
  const judged = r.sweep(T0 + 181000);
  yes(what + ': at three minutes it is judged', judged.length === 1 && judged[0] === 700);
  yes(what + ': and told the one line, to update or start from the launcher',
      r.told.length === 2 && r.told[1].indexOf('700: ') === 0 && /Thornswood launcher/.test(r.told[1]) && /update/.test(r.told[1]));
  yes(what + ': not before the line is on screen', r.kicked.length === 0);
  r.fire();
  yes(what + ': then the connection is ended', r.kicked.length === 1 && r.kicked[0] === 7);
  r.sweep(T0 + 300000);
  r.fire();
  yes(what + ': once', r.kicked.length === 1 && r.told.length === 2);
  return r;
}

refusedCase('no pass at all', null);
refusedCase('an expired pass', function (r) {
  return r.jp.take(700, mint({ p: 700, s: 'dev', i: T0 - 700000, x: T0 - 100000 }), T0 + 1000);
});
refusedCase('a pass signed with another key', function (r) {
  return r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }, 'somebody-elses-key'), T0 + 1000);
});
refusedCase('a pass whose body was edited and signature kept', function (r) {
  const good = mint({ p: 701, s: 'dev', i: T0, x: T0 + 600000 }).split('.');
  const body = b64u(JSON.stringify({ p: 700, s: 'dev', v: '1.1.102', d: '111', i: T0, x: T0 + 600000 }));
  return r.jp.take(700, 'jp1.' + body + '.' + good[2], T0 + 1000);
});
refusedCase('a pass for another profile sent by this one', function (r) {
  return r.jp.take(700, mint({ p: 701, s: 'dev', i: T0, x: T0 + 600000 }), T0 + 1000);
});
refusedCase('a pass for the live server shown to the dev one', function (r) {
  return r.jp.take(700, mint({ p: 700, s: 'main', i: T0, x: T0 + 600000 }), T0 + 1000);
});
refusedCase('something that is not a pass', function (r) { return r.jp.take(700, 'hello', T0 + 1000); });
refusedCase('a pass for the right profile sent under the wrong one', function (r) {
  return r.jp.take(701, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }), T0 + 1000);
});

{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }), T0 + 1000);
  r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }, 'forged'), T0 + 2000);
  r.sweep(T0 + 200000);
  r.fire();
  yes('a forged pass after a good one does not undo the good one', r.kicked.length === 0);
}

// A session let in by its pass, held until then, is told to the cuffs once (#4573):
// a guard who arrived waiting on their pass is issued their pair then.
{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  const shownTo = [];
  r.box.__thornswoodCuffs = { passShown: function (pid) { shownTo.push(pid); } };
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }, 'forged'), T0 + 500);
  yes('a forged pass lets nobody in, so the cuffs hear nothing', shownTo.length === 0);
  r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }), T0 + 1000);
  yes('the pass that lets a held session in tells the cuffs, once, with its profile', shownTo.join() === '700');
  r.jp.take(700, mint({ p: 700, s: 'dev', i: T0 + 60000, x: T0 + 660000 }), T0 + 61000);
  yes('...and the launcher\'s next pass for the same session tells them nothing more', shownTo.join() === '700');
}
{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: false });
  const shownTo = [];
  r.box.__thornswoodCuffs = { passShown: function (pid) { shownTo.push(pid); } };
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }), T0 + 1000);
  yes('with the pass only watched nobody was held, so the cuffs hear nothing', shownTo.length === 0);
}
{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  r.box.__thornswoodCuffs = { passShown: function () { throw new Error('boom'); } };
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  const got = r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }), T0 + 1000);
  yes('a cuffs issue that throws still takes the pass, and says so on the console',
      got.ok === true && !r.jp.held(700, T0 + 2000) &&
      r.logged.some(function (l) { return /join pass: the cuffs issue for profile 700 failed: Error: boom/.test(l); }));
}

{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }), T0);
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0 + 30000);
  r.sweep(T0 + 250000);
  r.fire();
  yes('a pass that arrived thirty seconds before the session was seen counts', r.kicked.length === 0);
}

{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }), T0);
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0 + 120000);
  r.sweep(T0 + 120000 + 181000);
  r.fire();
  yes('one from two minutes before does not', r.kicked.length === 1);
}

{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }), T0 + 1000);
  r.sweep(T0 + 5000);
  online(r, []);
  r.sweep(T0 + 10000);
  online(r, [[0xff000a02, 700]]);
  r.sweep(T0 + 20000);
  r.sweep(T0 + 20000 + 181000);
  r.fire();
  yes('a pass is forgotten when its profile leaves: the next session under that number needs its own',
      r.kicked.length === 1 && r.kicked[0] === 8);
}

{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: false });
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  r.sweep(T0 + 181000);
  r.fire();
  yes('thornswoodRequirePass false: the session is still refused',
      r.kicked.length === 1 && r.kicked[0] === 7);
  yes('and told to update, with no WOULD REFUSE that lets them stay',
      r.told.length === 1 && r.told[0].indexOf('700: ') === 0 && /Thornswood launcher/.test(r.told[0]) && /update/.test(r.told[0]) &&
      r.logged.some(function (s) { return /refusing profile 700: no valid join pass in 181s online/.test(s); }) &&
      !r.logged.some(function (s) { return /WOULD REFUSE/.test(s); }));
}

{
  // Absent is the hold on (#1319): told why it is held, then refused.
  const r = rig({ thornswoodServer: 'dev' });
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  r.sweep(T0 + 181000);
  r.fire();
  yes('no thornswoodRequirePass: held, told why, and refused at the grace',
      r.kicked.length === 1 && r.kicked[0] === 7 && r.told.length === 2 && r.told[0] === '700: ' + r.jp.waiting);
}

{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: 'yes' });
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  r.sweep(T0 + 181000);
  r.fire();
  yes('a value other than true does not let them stay', r.kicked.length === 1 && r.kicked[0] === 7);
}

{
  const r = rig({ thornswoodRequirePass: true });
  const got = r.jp.take(700, mint({ p: 700, s: 'main', i: T0, x: T0 + 600000 }), T0);
  yes('a server with no thornswoodServer is the main one', got.ok === true);
  const dev = r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }), T0);
  yes('and refuses a dev pass', dev.ok !== true);
}

door({ site: 'https://thornswood.net/dev', key: 'door-key' });
{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  yes('with no passKey in door.json the startup line says the key is MISSING',
      r.logged.some(function (s) { return /key MISSING/.test(s); }));
  const got = r.jp.take(700, mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 }), T0);
  yes('no key: no pass can be taken', got.ok !== true);
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  r.sweep(T0 + 181000);
  r.fire();
  yes('no key: the session is refused, the secure side, and the log says why',
      r.kicked.length === 1 && r.logged.some(function (s) { return /refusing profile 700: this server has no join pass key in door\.json/.test(s); }));
}
door(null);
{
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  online(r, [[0xff000a01, 700]]);
  r.sweep(T0);
  r.sweep(T0 + 181000);
  r.fire();
  yes('no door.json at all: refused too', r.kicked.length === 1);
}

// ------------------------------------------------------------ the dispatcher
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  yes('dispatch() hands /joinpass to the block before anything else, with the relay\'s profile',
      /var word = parts\[0\]\.toLowerCase\(\);\s*if \(word === '\/joinpass'\) \{[\s\S]{0,200}jp\.take\(profileId, parts\[1\], Date\.now\(\)\)[\s\S]{0,120}return;\s*\}\s*(var jpNow = [\s\S]{0,900}?if \(enforcing && profileId && cmd\.proven !== true\) \{[\s\S]{0,500}?return;\s*\}\s*)?(if \(word === '\/line'\) \{[\s\S]{0,1400}?return;\s*\}\s*)?(if \(word === '\/afk'\) \{[\s\S]{0,500}?return;\s*\}\s*)?(if \(enforcing && profileId && passHeld\(profileId\)\) \{[\s\S]{0,900}?return;\s*\}\s*)?if \(!profileId \|\| runsNow\(word, parts\)\)/.test(code));
}

// ------------------------------------------------------------ the voice log
// Since #1131 what a command writes to the chat log is commandLogText's word,
// run here: the pass masked, whatever the case of the command. The front
// plugin's own pass, sent with press, is not written at all since #2723
// (voice\tests\test-2723-plugin-reports.js); this is the typed one.
{
  const at = voice.indexOf('function commandLogText(');
  let body = '';
  if (at >= 0) {
    let d = 0;
    for (let i = voice.indexOf('{', at); i < voice.length; i++) {
      if (voice[i] === '{') d++;
      else if (voice[i] === '}') { d--; if (d === 0) { body = voice.slice(at, i + 1); break; } }
    }
  }
  const box = {};
  if (body) vm.runInNewContext(body + '\nthis.commandLogText = commandLogText;', box);
  yes('the voice service writes /joinpass to the chat log without the pass',
      /const logged = commandLogText\(me, text, press\);\s*if \(logged\) chatWrite\('command', myId, me, logged,/.test(voice) &&
      typeof box.commandLogText === 'function' &&
      box.commandLogText({ profileId: 700 }, '/joinpass ' + VECTOR_PASS) === '/joinpass [pass]' &&
      box.commandLogText(null, '/JOINPASS ' + VECTOR_PASS) === '/joinpass [pass]');
}

// ------------------------------------------------------------ the front plugin
{
  const fa = front.indexOf('  const PASS_FILE = ');
  const fb = front.indexOf('  }));', fa);
  yes('the front plugin\'s join pass sender is where this expects it', fa > 0 && fb > fa);
  const block = front.slice(fa, fb + 6);
  const f = { sent: [], logged: [], file: '', now: T0, handler: null };
  // Whose a pass is (#3128): only this game's character's is taken.
  const pa = front.indexOf('  function passProfile(raw) {');
  const pb = front.indexOf('\n  }\n', pa);
  yes('passProfile is in the front plugin', pa > 0 && pb > pa);
  const box = {
    PROFILE: 700, String: String, Number: Number, JSON: JSON,
    Date: { now: function () { return f.now; } },
    sp: { on: function (ev, fn) { if (ev === 'update') f.handler = fn; }, storage: {} },
    guard: function (name, fn) { return fn; },
    readText: function (p) {
      if (p === 'Data/Platform/thornswood-pass.txt') { return f.file; }
      if (p === 'Data/Platform/thornswood-pass-key.txt') { return f.key || ''; }
      return '';
    },
    tellServer: function (line) { f.sent.push(line); },
    log: function () { f.logged.push(Array.prototype.join.call(arguments, ' ')); }
  };
  vm.createContext(box);
  vm.runInContext(front.slice(pa, pb + 4), box);
  vm.runInContext(block, box, { filename: 'thornswood-front.js (join pass)' });
  yes('it runs on update', typeof f.handler === 'function');
  const p1 = mint({ p: 700, s: 'dev', i: T0, x: T0 + 600000 });
  const p2 = mint({ p: 700, s: 'dev', i: T0 + 240000, x: T0 + 840000 });
  f.handler();
  yes('no file: nothing is sent', f.sent.length === 0);
  f.now += 5000; f.file = 'not a pass\n'; f.handler();
  yes('a file that is not a pass is not sent', f.sent.length === 0);
  f.now += 5000; f.file = mint({ p: 701, s: 'dev', i: T0, x: T0 + 600000 }) + '\r\n'; f.handler();
  yes('another character\'s pass, left from before a change of character, is not sent or stored (#3128)',
      f.sent.length === 0 && !box.sp.storage.thornswoodJoinPass);
  f.now += 5000; f.file = p1 + '\r\n'; f.handler();
  yes('the launcher\'s pass is sent as "/joinpass <pass>" as soon as it is there', f.sent.length === 1 && f.sent[0] === '/joinpass ' + p1);
  f.now += 1000; f.handler();
  f.now += 20000; f.handler();
  yes('not again inside the minute', f.sent.length === 1);
  f.now += 40000; f.handler();
  yes('and again after it, so a restarted server or relay has it', f.sent.length === 2 && f.sent[1] === '/joinpass ' + p1);
  f.now += 5000; f.file = p2; f.handler();
  yes('a renewed pass goes at once', f.sent.length === 3 && f.sent[2] === '/joinpass ' + p2);
  yes('the pass is never written to its log', !f.logged.some(function (s) { return s.indexOf('jp1.') >= 0; }) && f.logged.length === 1);

  // The pass's own key, for the fork's login challenge (#1320).
  const st = box.sp.storage;
  yes('no key file: nothing is put in storage for the login', st.thornswoodJoinPass === undefined);
  const K2 = 'k2-the-key-the-site-gave-with-p2';
  f.now += 5000; f.key = p1.split('.')[2] + ' ' + K2; f.handler();
  yes('a key named for another pass is not paired with this one', st.thornswoodJoinPass === undefined);
  f.now += 5000; f.key = p2.split('.')[2] + ' ' + K2 + '\r\n'; f.handler();
  yes('the key named for this pass goes in storage beside it',
      !!st.thornswoodJoinPass && st.thornswoodJoinPass.pass === p2 && st.thornswoodJoinPass.key === K2);
  yes('and the key is never written to the log', !f.logged.some(function (s) { return s.indexOf(K2) >= 0; }));
}

// ------------------------------------------------------------ the login's proof (#1320)
// The fork's offline login (skymp5-server, thornswoodLogin.ts) asks
// mp.onThornswoodLogin: at the login with no proof, and again with the pass and
// the mac the client made over this connection's nonce, under the pass's own
// key. Watched only: the login is handed over as asked and the proof is logged.
{
  door({ site: 'https://thornswood.net/dev', key: 'door-key', passKey: KEY });
  const r = rig({ thornswoodServer: 'dev', thornswoodRequirePass: true });
  const hook = r.box.mp.onThornswoodLogin;
  yes('the block sets mp.onThornswoodLogin for the fork\'s login', typeof hook === 'function');
  // The shared pass's own key, the value site\tests\test-join-pass-site.js checks
  // passLoginKey in site\server.js derives.
  const VECTOR_LOGIN_KEY = 'Wh9OwaY7Rg7e4duCPpNl3c_DZb9RfUB0FUT9Pphs9L4';
  const ownKey = function (p) { return b64u(crypto.createHmac('sha256', KEY).update('jpk1.' + p.split('.')[2]).digest()); };
  yes('the pass\'s own key is the one the site derives for the shared pass', ownKey(VECTOR_PASS) === VECTOR_LOGIN_KEY);
  const macOf = function (k, n) { return b64u(crypto.createHmac('sha256', k).update('jlp1.' + n).digest()); };
  const N1 = 'nonce-of-connection-one-aaaa';
  const N2 = 'nonce-of-connection-two-bbbb';
  const now = Date.now();
  const p = mint({ p: 700, s: 'dev', i: now, x: now + 600000 });

  yes('at the login, with no proof, the profile asked for is handed over (watching)',
      hook({ userId: 7, profileId: 700, nonce: N1, proof: null }) === 700);
  yes('and the log says it was challenged', r.logged.some(function (s) { return /login of profile 700 on user 7 challenged/.test(s); }));

  const good = { userId: 7, profileId: 700, nonce: N1, proof: { pass: p, mac: macOf(ownKey(p), N1) } };
  yes('a good proof waits for nothing more: the character was handed over at the login', hook(good) === -1);
  yes('and is logged as good', r.logged.some(function (s) { return /login proof from profile 700 on user 7: good \(watching/.test(s); }));
  yes('loginProof says good, for the pass\'s profile', r.jp.loginProof(good, now).ok === true && r.jp.loginProof(good, now).p === 700);

  const replay = { userId: 8, profileId: 700, nonce: N2, proof: good.proof };
  yes('the same pass and mac on another connection does not check out',
      r.jp.loginProof(replay, now).ok !== true && /does not check out for this connection/.test(r.jp.loginProof(replay, now).why));
  const guessed = { userId: 8, profileId: 700, nonce: N2, proof: { pass: p, mac: macOf('a-guess-at-the-key', N2) } };
  yes('the pass with a guessed key does not check out', r.jp.loginProof(guessed, now).ok !== true);
  const old = mint({ p: 700, s: 'dev', i: now - 700000, x: now - 100000 });
  yes('an expired pass is refused for that', /expired/.test(r.jp.loginProof({ userId: 7, profileId: 700, nonce: N1, proof: { pass: old, mac: macOf(ownKey(old), N1) } }, now).why));
  const forged = mint({ p: 700, s: 'dev', i: now, x: now + 600000 }, 'another-key');
  yes('a pass signed with another key is refused for that',
      /signature/.test(r.jp.loginProof({ userId: 7, profileId: 700, nonce: N1, proof: { pass: forged, mac: 'x' } }, now).why));
  const theirs = { userId: 7, profileId: 816507994, nonce: N1, proof: { pass: p, mac: macOf(ownKey(p), N1) } };
  const v = r.jp.loginProof(theirs, now);
  yes('a good proof for another profile than the one asked for names the pass\'s profile', v.ok === true && v.p === 700 && /logged in as 816507994/.test(v.why));
  yes('nothing is refused and nobody is kicked while watching', hook(theirs) === -1 && r.kicked.length === 0);
  yes('neither the pass nor the key is ever written to the log',
      !r.logged.some(function (s) { return s.indexOf('jp1.') >= 0 || s.indexOf(ownKey(p)) >= 0; }));
}

try { fs.rmSync(PRIV, { recursive: true, force: true }); } catch (e) { }
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
