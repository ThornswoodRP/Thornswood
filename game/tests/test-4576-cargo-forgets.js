'use strict';
/*
  test-4576-cargo-forgets.js

      node game/tests/test-4576-cargo-forgets.js

  #4576: the trade cargo register kept every line that had closed, its
  outs and every receipt, forever. game/trade-cargo.js only ever added to
  a hold's lines and outs and to state.receipts, and save() refuses a
  manifest over 512 KB, so once enough loads had gone through, every change
  was refused and the ships and carts stopped.

  Patrick, 22 Oct 2026: the cargo register keeps a closed line for 30 days.

    M  the manifest: a line closed 31 days ago goes, with its outs and its
       receipts; one closed 29 days ago stays; a line with something aboard
       or being handed out is never dropped; and a register that a load goes
       through every few hours for half a year stays under its limit
    S  the trade ships block, as the server runs it: a line delivered and
       closed is still kept 29 days on, and gone from the register on disk
       at the first write after 30
    C  the trade carts block, the same

  Nothing leaves this machine. The scratch folder goes at the end.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const T = require('../../game/trade-cargo.js');

const REPO = path.join(__dirname, '..', '..');
const DAY = 24 * 60 * 60 * 1000, MIN = 60 * 1000;
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4576-'));
function done() {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { console.log('      could not remove ' + scratch + ': ' + e.message); }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}

const IRON = 0x5ace4;
const X = { actor: 0xff000a01, profile: 5001 };

// ================================================================== M
try {
  const ships = T.createTradeCargo({ ports: ['a', 'b'], routes: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] });
  yes('M0 the manifest has forget(state, now)', typeof ships.forget === 'function');
  const s = ships.empty();
  ships.open(s, 'h1', 'a');
  const t0 = 1000 * DAY;
  let r = 0;
  function closedLine(at) {
    const seq = ships.load(s, 'h1', { by: X, for: X, receipt: 'd' + (++r), entry: { baseId: IRON, count: 2 } });
    const b = ships.begin(s, 'h1', seq, 2, 'returned', X, at);
    ships.finish(s, 'h1', b.out, 'c' + (++r));
    return seq;
  }
  const closed = closedLine(t0);
  const closedReceipts = ['d1', 'c2'];
  const openLine = ships.load(s, 'h1', { by: X, for: X, receipt: 'd' + (++r), entry: { baseId: IRON, count: 3 } });
  const pendingLine = ships.load(s, 'h1', { by: X, for: X, receipt: 'd' + (++r), entry: { baseId: IRON, count: 1 } });
  ships.begin(s, 'h1', pendingLine, 1, 'returned', X, t0);

  if (typeof ships.forget === 'function') {
    ships.forget(s, t0 + 29 * DAY);
    yes('M1 a line closed 29 days ago is kept, with its receipts', !!s.holds.h1.lines[String(closed)] &&
        closedReceipts.every(function (k) { return s.receipts[k] === true; }));
    ships.forget(s, t0 + 31 * DAY);
    yes('M2 a line closed 31 days ago is gone', !s.holds.h1.lines[String(closed)]);
    yes('M3 and so are its outs and the receipts only it used', !s.holds.h1.outs.some(function (o) { return o.line === closed; }) &&
        closedReceipts.every(function (k) { return !(k in s.receipts); }));
    yes('M4 a line with something aboard stays, however old', s.holds.h1.lines[String(openLine)].aboard === 3);
    yes('M5 a line with something being handed out stays, however old', !!s.holds.h1.lines[String(pendingLine)] &&
        s.holds.h1.outs.some(function (o) { return o.line === pendingLine && o.receipt === null; }));
    let threw = '';
    try { ships.audit(s); ships.save(s); } catch (e) { threw = e.message; }
    yes('M6 what is left still audits and saves (' + (threw || 'ok') + ')', !threw);
  } else {
    yes('M1 to M6 need forget', false);
  }

  // A load and its return every three hours for half a year, written as the blocks write.
  const big = ships.empty();
  ships.open(big, 'h1', 'a');
  let most = 0, refused = '';
  for (let i = 0; i < 1500 && !refused; i++) {
    const at = t0 + i * 3 * 60 * MIN;
    try {
      const seq = ships.load(big, 'h1', { by: X, for: X, receipt: 'bd' + i, entry: { baseId: IRON, count: 1, name: 'An iron ingot for the long road' } });
      const b = ships.begin(big, 'h1', seq, 1, 'returned', X, at);
      ships.finish(big, 'h1', b.out, 'bc' + i);
      if (typeof ships.forget === 'function') { ships.forget(big, at); }
      most = Math.max(most, Buffer.byteLength(ships.save(big), 'utf8'));
    } catch (e) { refused = 'load ' + (i + 1) + ': ' + e.message; }
  }
  yes('M7 1500 loads over half a year never fill the register (' + (refused || 'largest ' + most + ' bytes of ' + 512 * 1024) + ')',
      !refused && most < 512 * 1024);
} catch (e) {
  yes('the manifest run finished (' + ((e && e.stack) || e) + ')', false);
}

// ============================================================ S and C
const gm = fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8').split(String.fromCharCode(13)).join('');
function block(start, end) { const a = gm.indexOf(start), z = gm.indexOf(end); return a >= 0 && z > a ? gm.slice(a, z) : ''; }
const shipsSrc = block('// ==== thornswood trade ships ====', '// ==== end thornswood trade ships ====');
const cartsSrc = block('// ==== thornswood trade carts ====', '// ==== end thornswood trade carts ====');
yes('0 the trade ships and carts blocks are in the gamemode', !!shipsSrc && !!cartsSrc);
const fixture = require('../../tests/fixtures/ordinary-quest-items');
const CELL = '3c:Skyrim.esm';

function world(name, file, register, crates, ships) {
  const dir = path.join(scratch, name);
  fs.mkdirSync(path.join(dir, 'private'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ privDir: 'private' }));
  fs.writeFileSync(path.join(dir, 'private', file), register);
  const store = {}, timers = [];
  const clock = { now: 1000 * DAY };
  function put(id, k, v) { (store[id] = store[id] || {})[k] = JSON.parse(JSON.stringify(v)); }
  put(X.actor, 'inventory', { entries: [{ baseId: IRON, count: 40 }] });
  put(X.actor, 'profileId', X.profile); put(X.actor, 'worldOrCellDesc', CELL); put(X.actor, 'pos', [0, 0, 0]);
  put(X.actor, 'appearance', { name: 'Brynja' });
  Object.keys(crates).forEach(function (k) { put(crates[k].ref, 'worldOrCellDesc', CELL); put(crates[k].ref, 'pos', crates[k].pos); });
  const box = {
    console: { log: function () { } }, require: require, Buffer: Buffer, JSON: JSON, Math: Math,
    Date: { now: function () { return clock.now; } },
    setTimeout: function (fn) { const t = { fn: fn, live: true }; timers.push(t); return t; },
    clearTimeout: function (t) { if (t && typeof t === 'object') { t.live = false; } },
    log: function () { },
    __thornswoodIsStaff: function () { return false; },
    __thornswoodIsAdmin: function () { return false; },
    __thornswoodIsCompany: function (pid) { return pid === X.profile; },
    __thornswoodToProfile: function () { },
    __thornswoodCompany: { terms: function () { return { charter: 'company' }; }, mayCharter: function (who) { return who.company === true; } },
    mp: {
      getServerSettings: function () { return { privDir: 'private', thornswoodTradeShips: ships }; },
      get: function (id, k) {
        if (k === 'onlinePlayers') { return [X.actor]; }
        const v = (store[id] || {})[k];
        return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
      },
      set: function (id, k, v) { put(id, k, v); },
      getDescFromId: function (id) { const c = Object.keys(crates).filter(function (k) { return crates[k].ref === id; })[0]; return c ? crates[c].desc : ''; },
      makeProperty: function () { }
    }
  };
  box.globalThis = box;
  vm.createContext(box);
  const back = process.cwd();
  function inDir(f) { process.chdir(dir); try { return f(); } finally { process.chdir(back); } }
  inDir(function () { vm.runInContext('(function () {\n' + fixture + shipsSrc + cartsSrc + '\n})();\n', box, { filename: 'gamemode.js (trade ships and carts)' }); });
  return {
    box: box, clock: clock,
    press: function (h, port) { put(X.actor, 'pos', crates[port].pos); return inDir(function () { return h.activated(crates[port].ref, X.actor, 'crate'); }); },
    say: function (h, line) { return inDir(function () { return h.command(line.split(' '), X.actor, X.profile); }); },
    fire: function () { timers.filter(function (t) { return t.live; }).forEach(function (t) { t.live = false; inDir(function () { t.fn(); }); }); },
    disk: function () { return JSON.parse(fs.readFileSync(path.join(dir, 'private', file), 'utf8')).cargo; }
  };
}
function receiptsOf(cargo, hold, seq) {
  const h = cargo.holds[hold];
  const l = h.lines[String(seq)];
  return (l ? [l.receipt] : []).concat(h.outs.filter(function (o) { return o.line === seq && o.receipt; }).map(function (o) { return o.receipt; }));
}

// ================================================================== S
try {
  const r0 = T.adoptRoutes(T.openRegister(null), {
    v: 1,
    ports: [
      { key: 'solitude', name: 'Solitude docks', hold: 'solitude', world: CELL, pos: [0, 0, 0], crate: '1a001:Skyrim.esm' },
      { key: 'windhelm', name: 'Windhelm docks', hold: 'windhelm', world: CELL, pos: [5000, 0, 0], crate: '1a002:Skyrim.esm' }
    ],
    routes: [{ from: 'solitude', to: 'windhelm', minutes: 90 }, { from: 'windhelm', to: 'solitude', minutes: 90 }]
  });
  r0.ships.open(r0.state, 'ship-1', 'solitude');
  const w = world('ships', 'trade-cargo.json', T.saveRegister(r0), {
    solitude: { ref: 0x1a001, desc: '1a001:Skyrim.esm', pos: [0, 0, 0] },
    windhelm: { ref: 0x1a002, desc: '1a002:Skyrim.esm', pos: [5000, 0, 0] }
  }, true);
  const ts = w.box.__thornswoodTradeShips;
  w.press(ts, 'solitude');
  w.say(ts, '/ship load ship-1 5ace4 0 4 ' + X.actor.toString(16));
  w.say(ts, '/ship sail ship-1 windhelm');
  w.clock.now += 91 * MIN; w.fire();
  w.press(ts, 'windhelm');
  w.say(ts, '/ship collect ship-1 1 4');
  const closedAt = w.clock.now;
  const was = receiptsOf(w.disk(), 'ship-1', 1);
  yes('S1 a load delivered whole: line 1 closed, with its two receipts', w.disk().holds['ship-1'].lines['1'].aboard === 0 && was.length === 2);
  w.clock.now = closedAt + 29 * DAY;
  w.press(ts, 'windhelm');
  w.say(ts, '/ship load ship-1 5ace4 0 1 ' + X.actor.toString(16));
  yes('S2 29 days on, a write keeps it', !!w.disk().holds['ship-1'].lines['1'] && was.every(function (k) { return w.disk().receipts[k] === true; }));
  w.clock.now = closedAt + 31 * DAY;
  w.press(ts, 'windhelm');
  w.say(ts, '/ship load ship-1 5ace4 0 1 ' + X.actor.toString(16));
  const d = w.disk();
  yes('S3 31 days on, the next write drops line 1, its outs and its receipts', !d.holds['ship-1'].lines['1'] &&
      !d.holds['ship-1'].outs.some(function (o) { return o.line === 1; }) && was.every(function (k) { return !(k in d.receipts); }));
  yes('S4 and keeps the two loads still aboard', Object.keys(d.holds['ship-1'].lines).length === 2 &&
      Object.keys(d.holds['ship-1'].lines).every(function (k) { return d.holds['ship-1'].lines[k].aboard === 1; }));
} catch (e) {
  yes('the ships run finished (' + ((e && e.stack) || e) + ')', false);
}

// ================================================================== C
try {
  const r0 = T.adoptRoutes(T.openRegister(null, { driven: true }), {
    v: 1,
    ports: [
      { key: 'whiterun', name: 'Whiterun stables', hold: 'whiterun', world: CELL, pos: [0, 0, 0], crate: '1a001:Skyrim.esm' },
      { key: 'riften', name: 'Riften stables', hold: 'riften', world: CELL, pos: [50000, 0, 0], crate: '1a002:Skyrim.esm' }
    ],
    routes: [{ from: 'whiterun', to: 'riften', minutes: 30 }, { from: 'riften', to: 'whiterun', minutes: 30 }]
  });
  r0.ships.open(r0.state, 'cart-1', 'whiterun');
  const w = world('carts', 'trade-carts.json', T.saveRegister(r0), {
    whiterun: { ref: 0x1a001, desc: '1a001:Skyrim.esm', pos: [0, 0, 0] },
    riften: { ref: 0x1a002, desc: '1a002:Skyrim.esm', pos: [50000, 0, 0] }
  }, false);
  const tc = w.box.__thornswoodTradeCarts;
  w.press(tc, 'whiterun');
  w.say(tc, '/cart load cart-1 5ace4 0 3 ' + X.actor.toString(16));
  w.say(tc, '/cart drive cart-1 riften');
  w.clock.now += 30 * MIN;
  w.press(tc, 'riften');
  w.say(tc, '/cart pullin cart-1');
  w.say(tc, '/cart collect cart-1 1 3');
  const closedAt = w.clock.now;
  const was = receiptsOf(w.disk(), 'cart-1', 1);
  yes('C1 a load driven and collected whole: line 1 closed, with its two receipts', w.disk().holds['cart-1'].lines['1'].aboard === 0 && was.length === 2);
  w.clock.now = closedAt + 29 * DAY;
  w.press(tc, 'riften');
  w.say(tc, '/cart load cart-1 5ace4 0 1 ' + X.actor.toString(16));
  yes('C2 29 days on, a write keeps it', !!w.disk().holds['cart-1'].lines['1'] && was.every(function (k) { return w.disk().receipts[k] === true; }));
  w.clock.now = closedAt + 31 * DAY;
  w.press(tc, 'riften');
  w.say(tc, '/cart load cart-1 5ace4 0 1 ' + X.actor.toString(16));
  const d = w.disk();
  yes('C3 31 days on, the next write drops line 1, its outs and its receipts', !d.holds['cart-1'].lines['1'] &&
      !d.holds['cart-1'].outs.some(function (o) { return o.line === 1; }) && was.every(function (k) { return !(k in d.receipts); }));
} catch (e) {
  yes('the carts run finished (' + ((e && e.stack) || e) + ')', false);
}
done();
