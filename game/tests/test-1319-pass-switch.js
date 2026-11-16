// test-1319-pass-switch.js
//
//     node .\game\tests\test-1319-pass-switch.js
//
// #1319. thornswoodRequirePass, the join pass hold (#410), fails closed:
// false is the one way to turn it off. true holds, and so does anything else
// (absent, null, empty, "true" as text, 1), and anything that is neither true
// nor false is said in the log with the value. Until 5 Oct only exactly true
// held, so one empty value dropped the hold for the whole server and said
// nothing. Every reader asks the join pass block's requiring(): the seats
// block, the dispatcher and the voice feed. The deploy scripts' half is
// tests\test-1319-pass-switch.ps1.
//
// The join pass block and the seats block are lifted out of game\gamemode.js
// between their markers and run in a vm with a stand-in mp, the way
// test-join-pass-game.js and test-seats.js run them.
//
// Read only. Nothing connects to anything.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const KEY = 'test-1319-key-not-a-real-one';
function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function mint(o) {
  const body = b64u(JSON.stringify({ p: o.p, s: o.s || 'dev', v: '1.1.102', d: '111', i: o.i, x: o.x }));
  return 'jp1.' + body + '.' + b64u(crypto.createHmac('sha256', KEY).update('jp1.' + body).digest());
}

// ------------------------------------------------------------ the block
const a = src.indexOf('// ==== thornswood join pass ====');
const b = src.indexOf('// ==== end thornswood join pass ====');
yes('the join pass block is in gamemode.js between its markers', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { done(); }

const PRIV = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-1319-'));
fs.writeFileSync(path.join(PRIV, 'door.json'), JSON.stringify({ site: 'https://thornswood.net/dev', key: 'k', passKey: KEY }));

// has: false leaves the key out of the settings altogether.
function rig(value, has) {
  const r = { logged: [], told: [], online: [], settings: { privDir: PRIV, thornswoodServer: 'dev' } };
  if (has !== false) { r.settings.thornswoodRequirePass = value; }
  const box = {
    console: { log: function () { r.logged.push(Array.prototype.join.call(arguments, ' ')); } },
    require: require, Buffer: Buffer,
    Date: Date, Math: Math, Number: Number, String: String, Array: Array, Object: Object, JSON: JSON,
    setTimeout: function () { return 1; }, setInterval: function () { return 1; }, clearInterval: function () { },
    mp: {
      getServerSettings: function () { return r.settings; },
      get: function () { return []; }, getUserByActor: function () { return -1; }, kick: function () { }
    }
  };
  vm.createContext(box);
  vm.runInContext(src.slice(a, b), box, { filename: 'gamemode.js (join pass)' });
  r.box = box;
  r.jp = box.__thornswoodJoinPass;
  r.switchLines = function () { return r.logged.filter(function (s) { return /thornswoodRequirePass in server-settings\.json is /.test(s); }); };
  return r;
}

{
  const r = rig(true);
  yes('true: the hold is on', r.jp.requiring() === true);
  yes('true: nothing is said about the switch', r.switchLines().length === 0);
  yes('true: the startup line says REQUIRED', r.logged.some(function (s) { return /join pass REQUIRED on the dev server/.test(s); }));
}
{
  const r = rig(false);
  yes('false: the hold is off, the one way to turn it off', r.jp.requiring() === false);
  yes('false: nothing is said about the switch', r.switchLines().length === 0);
  yes('false: the startup line does not say REQUIRED', !r.logged.some(function (s) { return /join pass REQUIRED/.test(s); }));
}

// Each value that is neither true nor false, and how the log names it.
const BAD = [
  ['absent', undefined, false, 'missing'],
  ['undefined', undefined, true, 'missing'],
  ['null', null, true, 'null'],
  ['empty text', '', true, '"" (text)'],
  ['"true" as text', 'true', true, '"true" (text)'],
  ['"false" as text', 'false', true, '"false" (text)'],
  ['"off" as text', 'off', true, '"off" (text)'],
  ['1', 1, true, '1'],
  ['0', 0, true, '0'],
  ['an object', { on: true }, true, '{"on":true}'],
  ['a list', [false], true, '[false]']
];
BAD.forEach(function (c) {
  const r = rig(c[1], c[2]);
  yes(c[0] + ': the hold is on (it fails closed)', r.jp.requiring() === true);
  const lines = r.switchLines();
  yes(c[0] + ': the log names the value as ' + c[3] + ', and says false is the way off',
      lines.length === 1 && lines[0].indexOf('thornswoodRequirePass in server-settings.json is ' + c[3] + ', ') > 0 &&
      /neither true nor false, so the join pass hold is on/.test(lines[0]) && /false is the one way to turn it off \(#1319\)/.test(lines[0]));
  yes(c[0] + ': the startup line says REQUIRED', r.logged.some(function (s) { return /join pass REQUIRED on the dev server/.test(s); }));
  r.jp.requiring(); r.jp.requiring(); r.jp.requiring();
  yes(c[0] + ': and the line is not said again on every ask', r.switchLines().length === 1);
});

{
  const r = rig('x'.repeat(500));
  r.jp.requiring();
  const l = r.switchLines()[0] || '';
  yes('a long value is cut short in the log', l.length > 0 && l.length < 400);
}

{
  // The switch moving under a running server (a settings edit and a hot read).
  const r = rig(true);
  r.settings.thornswoodRequirePass = '';
  yes('a value that turns empty while the server runs still holds', r.jp.requiring() === true && r.switchLines().length === 1);
  r.settings.thornswoodRequirePass = false;
  yes('and false, written after, turns the hold off', r.jp.requiring() === false);
}

// ------------------------------------------------------------ what the hold does with it
const T0 = Date.now();
function heldCase(what, value, has, held) {
  const r = rig(value, has);
  r.online = [{ actorId: 1, profileId: 700 }];
  r.jp.sweep(T0, r.online, function (pid, t) { r.told.push(pid + ': ' + t); });
  yes(what + (held ? ': a profile with no pass is held and not trusted' : ': a profile with no pass is not held'),
      r.jp.held(700, T0 + 1000) === held && r.jp.trusts(700, T0 + 1000) === !held &&
      r.box.__thornswoodPassHeld(700) === held && r.box.__thornswoodPassTrusts(700) === !held);
  if (held) {
    r.jp.take(700, mint({ p: 700, i: T0, x: T0 + 600000 }), T0 + 2000);
    yes(what + ': and once its pass is in, it is trusted', r.jp.held(700, T0 + 3000) === false && r.jp.trusts(700, T0 + 3000) === true);
  }
}
heldCase('absent', undefined, false, true);
heldCase('empty', '', true, true);
heldCase('"false" as text', 'false', true, true);
heldCase('true', true, true, true);
heldCase('false', false, true, false);

// ------------------------------------------------------------ one reader
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const reads = code.match(/\.thornswoodRequirePass\b/g) || [];
  yes('the gamemode reads thornswoodRequirePass in one place, requiring()', reads.length === 1 &&
      /var v = settings\(\)\.thornswoodRequirePass;/.test(code));
  yes('nothing compares it to true by itself any more', !/thornswoodRequirePass === true/.test(code));
  yes('the voice feed sends the block\'s answer', /var requirePass = !!\(jp && jp\.requiring && jp\.requiring\(\)\);\s*try \{ send\(\{ who: who, requirePass: requirePass \}\); \} catch \(e\) \{ \}/.test(code));
  yes('the dispatcher asks the block, and a throw there enforces',
      /try \{ enforcing = !!\(jpNow && jpNow\.requiring && jpNow\.requiring\(\)\); \} catch \(eReq\) \{ enforcing = true; \}/.test(code));
}

// ------------------------------------------------------------ the seats block asks the same
{
  const sa = src.indexOf('// ==== thornswood seats ====');
  const sb = src.indexOf('// ==== end thornswood seats ====');
  yes('the seats block is in gamemode.js between its markers', sa >= 0 && sb > sa);
  function seatsHow(settings, jp) {
    const box = {
      console: { log: function () { } }, Date: Date, Math: Math, Number: Number, String: String, Object: Object, Array: Array,
      setTimeout: function () { return 1; }, setInterval: function () { return 1; }, clearInterval: function () { },
      mp: { getServerSettings: function () { return settings; }, get: function () { return []; }, getUserByActor: function () { return -1; }, kick: function () { } }
    };
    if (jp !== undefined) { box.__thornswoodJoinPass = jp; }
    vm.createContext(box);
    vm.runInContext(src.slice(sa, sb), box, { filename: 'gamemode.js (seats)' });
    return box.__thornswoodSeats.liveHow();
  }
  const SEATS = { thornswoodMostOnline: 25, maxPlayers: 30 };
  yes('seats: the hold on in the join pass block means a pass is needed to wait',
      seatsHow(SEATS, { requiring: function () { return true; } }).requirePass === true);
  yes('seats: off there means it is not',
      seatsHow(Object.assign({ thornswoodRequirePass: true }, SEATS), { requiring: function () { return false; } }).requirePass === false);
  yes('seats: a switch absent from the settings follows the block, which holds',
      seatsHow(SEATS, rig(undefined, false).jp).requirePass === true);
  yes('seats: false in the settings follows the block too',
      seatsHow(Object.assign({ thornswoodRequirePass: false }, SEATS), rig(false).jp).requirePass === false);
  yes('seats: a throw from the block is the secure side, a pass is needed',
      seatsHow(SEATS, { requiring: function () { throw new Error('half loaded'); } }).requirePass === true);
  yes('seats: with no join pass block there is nothing to require, as the dispatcher has it',
      seatsHow(Object.assign({ thornswoodRequirePass: true }, SEATS)).requirePass === false);
}

try { fs.rmSync(PRIV, { recursive: true, force: true }); } catch (e) { }
done();
