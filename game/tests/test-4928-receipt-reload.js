'use strict';
/*
  test-4928-receipt-reload.js

      node game/tests/test-4928-receipt-reload.js

  #4928: the trade ships block names every debit and credit
  kind:RUN:n. RUN is the server's run, kept on globalThis, which a gamemode
  reload keeps (serverRunId, #2623). n came from a counter made inside the
  block, so a reload started it again at 0 while the register on disk still
  held every name used before. The first load after a reload was then
  refused ("That receipt was already used"), and the first collect took the
  piece off the hold, put it in the pack and could not mark it finished, so
  the hold stayed with a piece being handed out and could never sail.

  Here the real trade ships block runs over a stand-in world, and a reload
  is the block run a second time in the same context, the way the server
  runs a new gamemode.js over the same globalThis:
    1 before the reload: a load and a collect of one's own goods
    2 after it: a load and a collect again, each with a name never used
    3 the ship sails, with nothing left being handed out

  Nothing leaves this machine. The scratch folder goes at the end.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const T = require('../../game/trade-cargo.js');

const REPO = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const IRON = 0x5ace4;
const CELL = '3c:Skyrim.esm';
const ROUTES = {
  v: 1,
  ports: [
    { key: 'solitude', name: 'Solitude docks', hold: 'solitude', world: CELL, pos: [0, 0, 0], crate: '1a001:Skyrim.esm' },
    { key: 'windhelm', name: 'Windhelm docks', hold: 'windhelm', world: CELL, pos: [5000, 0, 0], crate: '1a002:Skyrim.esm' }
  ],
  routes: [
    { from: 'solitude', to: 'windhelm', minutes: 90, crew: [] },
    { from: 'windhelm', to: 'solitude', minutes: 120 }
  ]
};
const A = 0xff000a01, PID_A = 5001, CRATE = { solitude: 0x1a001, windhelm: 0x1a002 };
const AT = { solitude: [10, 0, 0], windhelm: [5010, 0, 0] };

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4928-'));
function done() {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { console.log('      could not remove ' + scratch + ': ' + e.message); }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const gm = fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8').split(String.fromCharCode(13)).join('');
const a = gm.indexOf('// ==== thornswood trade ships ====');
const z = gm.indexOf('// ==== end thornswood trade ships ====');
yes('0 the trade ships block is in the gamemode', a >= 0 && z > a);
if (!(a >= 0 && z > a)) { done(); }
const blockSrc = '(function () {\n' + require('../../tests/fixtures/ordinary-quest-items') + gm.slice(a, z) + '\n})();\n';
/* The server's run, as gamemode.js makes it once and keeps on globalThis (#2623). */
const r1 = gm.indexOf('\nfunction serverRunId(');
const r2 = r1 < 0 ? -1 : gm.indexOf('\n}\n', r1);
yes('0 serverRunId is in the gamemode', r1 >= 0 && r2 > r1);
if (!(r1 >= 0 && r2 > r1)) { done(); }
const runSrc = gm.slice(r1, r2 + 3);

const dir = path.join(scratch, 'world');
fs.mkdirSync(path.join(dir, 'private'), { recursive: true });
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ privDir: 'private' }));
const r0 = T.adoptRoutes(T.openRegister(null), ROUTES);
r0.ships.open(r0.state, 'ship-1', 'solitude');
fs.writeFileSync(path.join(dir, 'private', 'trade-cargo.json'), T.saveRegister(r0));

const store = {};
function put(id, k, v) { (store[id] = store[id] || {})[k] = JSON.parse(JSON.stringify(v)); }
put(A, 'inventory', { entries: [{ baseId: IRON, count: 40 }] });
put(A, 'profileId', PID_A); put(A, 'worldOrCellDesc', CELL); put(A, 'pos', AT.solitude);
put(A, 'appearance', { name: 'Brynja' });
put(CRATE.solitude, 'worldOrCellDesc', CELL); put(CRATE.solitude, 'pos', [0, 0, 0]);
put(CRATE.windhelm, 'worldOrCellDesc', CELL); put(CRATE.windhelm, 'pos', [5000, 0, 0]);
const clock = { now: 1000000 };
const timers = [];
const box = {
  console: { log: function () { } }, require: require, Buffer: Buffer, JSON: JSON, Math: Math,
  Date: { now: function () { return clock.now; } },
  setTimeout: function (fn) { const t = { fn: fn, live: true }; timers.push(t); return t; },
  clearTimeout: function (t) { if (t) { t.live = false; } },
  log: function () { },
  __thornswoodIsStaff: function () { return false; },
  __thornswoodIsAdmin: function () { return false; },
  __thornswoodIsCompany: function (pid) { return pid === PID_A; },
  __thornswoodCompany: {
    terms: function () { return { charter: 'company' }; },
    mayCharter: function (who) { return who.company === true; }
  },
  mp: {
    getServerSettings: function () { return { privDir: 'private', thornswoodTradeShips: true }; },
    get: function (id, k) {
      if (k === 'onlinePlayers') { return [A]; }
      const v = (store[id] || {})[k];
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    },
    set: function (id, k, v) { put(id, k, v); },
    getDescFromId: function (id) { return id === CRATE.solitude ? '1a001:Skyrim.esm' : id === CRATE.windhelm ? '1a002:Skyrim.esm' : ''; },
    makeProperty: function () { }
  }
};
box.globalThis = box;
vm.createContext(box);
vm.runInContext(runSrc, box, { filename: 'gamemode.js (serverRunId)' });

const back = process.cwd();
function inDir(f) { process.chdir(dir); try { return f(); } finally { process.chdir(back); } }
/* The block loaded (again): the same context, so what globalThis holds stays, as a reload keeps it. */
function load() {
  inDir(function () { vm.runInContext(blockSrc, box, { filename: 'gamemode.js (trade ships)' }); });
  return box.__thornswoodTradeShips;
}
function say(ts, line) { return inDir(function () { return ts.command(line.split(' '), A, PID_A); }); }
function press(ts, port) {
  put(A, 'pos', AT[port]);
  return inDir(function () { return ts.activated(CRATE[port], A, 'crate'); });
}
/* A voyage's minutes pass and every live clock fires: the hold docks on its own. */
function voyage(minutes) {
  clock.now += minutes * 60000;
  timers.filter(function (t) { return t.live; }).forEach(function (t) { t.live = false; inDir(function () { t.fn(); }); });
}
function note() { return String(((store[A] || {}).thornswoodShipView || {}).note || ''); }
function text() { return fs.readFileSync(path.join(dir, 'private', 'trade-cargo.json'), 'utf8'); }
function disk() { return JSON.parse(text()); }
function iron() { return store[A].inventory.entries.filter(function (e) { return e.baseId === IRON; }).reduce(function (n, e) { return n + e.count; }, 0); }
function lines() { return disk().cargo.holds['ship-1'].lines; }
function handingOut() { return T.countsOf(T.openRegister(text())).pending; }
function used() { return Object.keys(disk().cargo.receipts || {}); }

try {
  let ts = load();
  press(ts, 'solitude');
  say(ts, '/ship load ship-1 5ace4 0 5 ' + A.toString(16));
  yes('1 before the reload, a load of five goes aboard at Solitude (' + note() + ')', iron() === 35 && !!lines()['1'] && lines()['1'].aboard === 5);
  say(ts, '/ship sail ship-1 windhelm');
  voyage(91);
  const docked = disk().cargo.holds['ship-1'];
  yes('1 it sails and docks at Windhelm on its own', !docked.sailing);
  press(ts, 'windhelm');
  say(ts, '/ship collect ship-1 1 1');
  yes('1 and a collect of one of them comes back at Windhelm (' + note() + ')', iron() === 36 && lines()['1'].aboard === 4);
  const before = used();
  yes('1 the register holds both receipts (' + before.join(', ') + ')', before.length === 2);

  ts = load();
  yes('2 the reload runs the block again over the same register', !!ts && typeof ts.command === 'function');
  press(ts, 'windhelm');
  say(ts, '/ship load ship-1 5ace4 0 2 ' + A.toString(16));
  yes('2 after the reload, a load goes through (' + note() + ')', /^Loaded/.test(note()));
  yes('2 and its two go aboard as a line of their own', iron() === 34 &&
      Object.keys(lines()).some(function (k) { return k !== '1' && lines()[k].aboard === 2; }));
  say(ts, '/ship collect ship-1 1 1');
  yes('2 a collect after the reload goes through and is written down (' + note() + ')', /^Collected/.test(note()));
  yes('2 and its piece comes back, and comes off the hold', iron() === 35 && lines()['1'].aboard === 3);
  const after = used();
  yes('2 the register holds four different receipts (' + after.join(', ') + ')', after.length === 4 &&
      before.every(function (r) { return after.indexOf(r) >= 0; }));
  yes('3 nothing is left being handed out (' + handingOut() + ')', handingOut() === 0);
  say(ts, '/ship sail ship-1 solitude');
  yes('3 the ship sails again (' + note() + ')', !!disk().cargo.holds['ship-1'].sailing);
} catch (e) {
  yes('the run finished (' + ((e && e.stack) || e) + ')', false);
}
done();
