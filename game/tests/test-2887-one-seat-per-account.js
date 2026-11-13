// test-2887-one-seat-per-account.js
//
//     node .\game\tests\test-2887-one-seat-per-account.js
//
// #2887. The seats counted characters, so one Discord account running a
// second game under another of its characters held two seats. Patrick, 20 Oct:
// one seat per account on both servers, dev included. Every join pass names
// the account the site signed it for, so the join pass block compares it, the
// moment a pass proves a session, with every other session in the world. A
// second game from an account already there is told why and ended, the log
// names both profiles, and the first keeps its seat. A reconnect is the same
// profile and is never refused by itself, and a connection the engine has
// already let go does not count.
//
// The join pass block is lifted out of game\gamemode.js between its markers and
// run in a vm with a stand-in mp whose connections the test moves, a door.json
// in a temp folder and its own clock, the way test-1320-pass-one-session.js
// runs it. The seats block and docs\DECIDED.md are read for the rule.
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
const decided = fs.readFileSync(path.join(ROOT, 'docs', 'DECIDED.md'), 'utf8').split(CR).join('');

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

const KEY = 'test-2887-key-not-a-real-one';
function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/* The site's makePass, written out again from the format note. */
function mint(o) {
  const body = b64u(JSON.stringify({ p: o.p, s: o.s || 'dev', v: '1.2.8', d: o.d, i: o.i, x: o.x }));
  return 'jp1.' + body + '.' + b64u(crypto.createHmac('sha256', KEY).update('jp1.' + body).digest());
}

const a = src.indexOf('// ==== thornswood join pass ====');
const b = src.indexOf('// ==== end thornswood join pass ====');
yes('the join pass block is in gamemode.js between its markers', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { done(); }
const BLOCK = src.slice(a, b);

const PRIV = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-2887-'));
fs.writeFileSync(path.join(PRIV, 'door.json'), JSON.stringify({ site: 'https://thornswood.net/dev', key: 'k', passKey: KEY }));

/* online: [{ actorId, profileId, user, guid }]; opts.server and opts.require as server-settings.json has them. */
function rig(opts) {
  opts = opts || {};
  const r = { told: [], ended: [], logged: [], kicked: [], timers: [], online: [] };
  const mp = {
    getServerSettings: function () {
      return { privDir: PRIV, thornswoodServer: opts.server || 'dev',
               thornswoodRequirePass: opts.require === undefined ? true : opts.require };
    },
    getUserByActor: function (actorId) {
      for (let i = 0; i < r.online.length; i++) { if (r.online[i].actorId === actorId) { return r.online[i].user; } }
      return -1;
    },
    getUserGuid: function (userId) {
      for (let i = 0; i < r.online.length; i++) { if (r.online[i].user === userId) { return r.online[i].guid; } }
      return '';
    },
    get: function () { return []; },
    kick: function (userId) { r.kicked.push(userId); }
  };
  const box = {};
  box.console = { log: function () { r.logged.push(Array.prototype.join.call(arguments, ' ')); } };
  box.require = require; box.Buffer = Buffer;
  box.Date = Date; box.Math = Math; box.Number = Number; box.String = String; box.Array = Array; box.Object = Object; box.JSON = JSON;
  box.setTimeout = function (fn) { r.timers.push(fn); return r.timers.length; };
  box.setInterval = function () { return 1; };
  box.clearInterval = function () { };
  box.mp = mp;
  box.__thornswoodSayLine = function (pid, what) { r.ended.push(pid + ': ' + (what && what.end)); };
  vm.createContext(box);
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
const A1 = 0xff000a01, A2 = 0xff000a02, A3 = 0xff000a03;
const ME = '187900000000000001', YOU = '187900000000000002';

/* Character 700 of account ME in the world, proved by its pass. */
function first(opts) {
  const r = rig(opts);
  const s = (opts && opts.server) || 'dev';
  r.at([[A1, 700, 7, 'g-one']]);
  r.sweep(T0);
  r.jp.take(700, mint({ p: 700, s: s, d: ME, i: T0, x: T0 + 600000 }), T0 + 1000);
  r.sweep(T0 + 5000);
  return r;
}

// ------------------------------------------------------------ the rule and its sentence
const SAY = rig().jp.accountSentence;
yes('the sentence says the account already has a character in the world and one account holds one seat',
    typeof SAY === 'string' && /already has a character in the world/.test(SAY) && /one account holds one seat/.test(SAY));
yes('and what to do when the other game was just closed', /wait a minute, then press Play again/.test(SAY));
yes('in plain words: no "player", no em dash', !/player/i.test(SAY) && SAY.indexOf('—') < 0);
yes('docs\\DECIDED.md has the decision, on both servers', /\*\*One Discord account holds one seat\*\*, on main and on dev/.test(decided) &&
    decided.indexOf('issues/2887') >= 0);
yes('the seats block says a seat is an account\'s', /A SEAT IS AN ACCOUNT'S, NOT A CHARACTER'S \(#2887\)/.test(src));

// ------------------------------------------------------------ two games, two characters, one account
{
  const r = first();
  yes('the first game is in the world and trusted', r.jp.held(700, T0 + 5000) === false && r.jp.trusts(700, T0 + 5000) === true);
  r.at([[A1, 700, 7, 'g-one'], [A2, 701, 8, 'g-two']]);
  r.sweep(T0 + 10000);
  const second = r.jp.take(701, mint({ p: 701, d: ME, i: T0 + 9000, x: T0 + 609000 }), T0 + 11000);
  yes('a second game\'s pass for another character of the same account is not taken', second.ok !== true &&
      second.why === 'its Discord account is already in the world as profile 700');
  yes('and the log says so, naming both', r.lines(/join pass from profile 701 not taken: its Discord account is already in the world as profile 700/).length === 1);
  yes('the second game is held: nothing it does counts', r.jp.held(701, T0 + 12000) === true && r.jp.trusts(701, T0 + 12000) === false);
  r.sweep(T0 + 15000);
  yes('at the next sweep it is told why', r.told.indexOf('701: ' + SAY) >= 0);
  yes('the log names the second and the first', r.lines(/refusing profile 701: its Discord account is already in the world as profile 700/).length === 1);
  yes('the sentence ends the session on its screen, so the game does not reconnect by itself', r.ended.indexOf('701: ' + SAY) >= 0);
  r.fire();
  yes('and its connection is ended, not the first one\'s', r.kicked.length === 1 && r.kicked[0] === 8);
  yes('the first keeps its seat', r.jp.held(700, T0 + 16000) === false && r.jp.trusts(700, T0 + 16000) === true &&
      r.told.every(function (s) { return s.indexOf('700:') !== 0; }));
  const renew = r.jp.take(701, mint({ p: 701, d: ME, i: T0 + 69000, x: T0 + 669000 }), T0 + 70000);
  yes('the second game\'s next pass, while it is being ended, is not taken either', renew.ok !== true && r.jp.held(701, T0 + 70000) === true);
  r.sweep(T0 + 20000);
  r.sweep(T0 + 15000 + 181000);
  r.fire();
  yes('it is told and ended once, not again at every sweep or at the grace', r.told.filter(function (s) { return s.indexOf('701:') === 0; }).length === 1 &&
      r.kicked.length === 1);
  yes('the first game\'s renewals are still taken', r.jp.take(700, mint({ p: 700, d: ME, i: T0 + 60000, x: T0 + 660000 }), T0 + 61000).ok === true);
}

// ------------------------------------------------------------ a pass picked up at the menu is judged when its session starts
{
  const r = first();
  r.jp.take(701, mint({ p: 701, d: ME, i: T0 + 8000, x: T0 + 608000 }), T0 + 9000);
  r.at([[A1, 700, 7, 'g-one'], [A2, 701, 8, 'g-two']]);
  r.sweep(T0 + 10000);
  yes('a second game whose pass came at the menu is told why at the sweep that starts its session',
      r.told.indexOf('701: ' + SAY) >= 0 && r.lines(/refusing profile 701: its Discord account is already in the world as profile 700/).length === 1);
  yes('and is held from that sweep on', r.jp.held(701, T0 + 10000) === true);
  r.fire();
  yes('and ended; the first stays', r.kicked.length === 1 && r.kicked[0] === 8 && r.jp.held(700, T0 + 11000) === false);
}
{
  // Both games' passes came at the menu and both sessions start in the same sweep.
  const r = rig();
  r.jp.take(700, mint({ p: 700, d: ME, i: T0, x: T0 + 600000 }), T0 + 1000);
  r.jp.take(701, mint({ p: 701, d: ME, i: T0, x: T0 + 600000 }), T0 + 1000);
  r.at([[A1, 700, 7, 'g-one'], [A2, 701, 8, 'g-two']]);
  r.sweep(T0 + 5000);
  r.fire();
  const kept = [700, 701].filter(function (p) { return r.jp.held(p, T0 + 6000) === false; });
  yes('two games of one account arriving in the same sweep: exactly one is kept, the other ended',
      kept.length === 1 && r.kicked.length === 1);
}

// ------------------------------------------------------------ a reconnect is not refused
{
  const r = first();
  r.at([[A1, 700, 9, 'g-again']]);
  r.sweep(T0 + 30000);
  const back = r.jp.take(700, mint({ p: 700, d: ME, i: T0 + 29000, x: T0 + 629000 }), T0 + 31000);
  yes('a reconnect of the first game (new connection, same character) is taken', back.ok === true && r.jp.held(700, T0 + 31000) === false);
  r.sweep(T0 + 35000);
  r.sweep(T0 + 30000 + 181000);
  r.fire();
  yes('and is never ended or told the account line', r.kicked.length === 0 && r.told.every(function (s) { return s.indexOf(SAY) < 0; }));
}
{
  // The engine hands the character to the new connection before the sweep has seen it (#2013).
  const r = first();
  r.at([[A1, 700, 9, 'g-again']]);
  const back = r.jp.take(700, mint({ p: 700, d: ME, i: T0 + 29000, x: T0 + 629000 }), T0 + 31000);
  r.sweep(T0 + 35000);
  r.fire();
  yes('a reconnect whose pass comes before the sweep sees it is taken too', back.ok === true && r.kicked.length === 0 && r.jp.held(700, T0 + 35000) === false);
}

// ------------------------------------------------------------ the first game closed, the second goes in
{
  const r = first();
  // The engine has let the first connection go; the sweep has not run since.
  r.at([[A2, 701, 8, 'g-two']]);
  const next = r.jp.take(701, mint({ p: 701, d: ME, i: T0 + 7000, x: T0 + 607000 }), T0 + 8000);
  yes('another character of the account, once the engine has let the first game go, is taken before the sweep catches up',
      next.ok === true);
  r.sweep(T0 + 10000);
  r.fire();
  yes('and keeps its seat', r.kicked.length === 0 && r.jp.held(701, T0 + 10000) === false);
}
{
  const r = first();
  r.at([]);
  r.sweep(T0 + 10000);
  r.at([[A2, 701, 8, 'g-two']]);
  r.sweep(T0 + 15000);
  r.jp.take(701, mint({ p: 701, d: ME, i: T0 + 14000, x: T0 + 614000 }), T0 + 16000);
  r.sweep(T0 + 20000);
  r.fire();
  yes('and after the sweep has seen it leave as well', r.kicked.length === 0 && r.jp.held(701, T0 + 20000) === false);
}

// ------------------------------------------------------------ other accounts, other servers, the hold off
{
  const r = first();
  r.at([[A1, 700, 7, 'g-one'], [A2, 701, 8, 'g-two'], [A3, 702, 10, 'g-three']]);
  r.sweep(T0 + 10000);
  r.jp.take(701, mint({ p: 701, d: YOU, i: T0 + 9000, x: T0 + 609000 }), T0 + 11000);
  r.jp.take(702, mint({ p: 702, d: '', i: T0 + 9000, x: T0 + 609000 }), T0 + 11000);
  r.sweep(T0 + 15000);
  r.fire();
  yes('another account\'s game is in the world beside it', r.jp.held(701, T0 + 15000) === false);
  yes('a pass that names no account is not compared with anything', r.jp.held(702, T0 + 15000) === false);
  yes('and nobody is ended', r.kicked.length === 0);
}
{
  const r = first({ server: 'main' });
  r.at([[A1, 700, 7, 'g-one'], [A2, 701, 8, 'g-two']]);
  r.sweep(T0 + 10000);
  r.jp.take(701, mint({ p: 701, s: 'main', d: ME, i: T0 + 9000, x: T0 + 609000 }), T0 + 11000);
  r.sweep(T0 + 15000);
  r.fire();
  yes('on main the same: the second game is ended, the first stays', r.kicked.length === 1 && r.kicked[0] === 8 &&
      r.jp.held(700, T0 + 15000) === false);
}
{
  const r = first({ require: false });
  r.at([[A1, 700, 7, 'g-one'], [A2, 701, 8, 'g-two']]);
  r.sweep(T0 + 10000);
  r.jp.take(701, mint({ p: 701, d: ME, i: T0 + 9000, x: T0 + 609000 }), T0 + 11000);
  r.sweep(T0 + 15000);
  r.fire();
  yes('with the hold off the second game is still ended: the hold does not decide it', r.kicked.length === 1 && r.kicked[0] === 8);
}

done();
