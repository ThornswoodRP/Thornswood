'use strict';
/*
  test-511-trade-cargo.js

      node game/tests/test-511-trade-cargo.js

  #511, trade ships. Holds game\trade-cargo.js to its rule that a cargo never
  grows, and the trade ships block of game\gamemode.js to its register:

    N  nothing aboard without a debit receipt, coin refused, the two-step
       hand out, a tampered save refused
    S  staff data: ports, routes and crews checked whole, an edit proposed
       with the holds it would strand, a voyage amended for narration
    L  Patrick's answers of 22 Oct 2026: nothing is handed out of a hold at
       sea, taken included; a hold keeps when it landed; what nobody collects
       comes due after the staff list's days, never at the port it was loaded
       in nor for a released recipient; a hold whose lines went out is free
       again; the days are staff data, whole days from 1 to 60
    D  the release of deleted characters: by form id, by profile, never a
       profile's other characters, every piece where it was
    G  the register: none is a world with no ships, a bad one is refused
       whole, an edit that strands a hold is refused
    B  the block, started as the server starts it: off by default with the
       counts in the log, the release answered with the switch off, a register
       that does not verify never written over, on puts the handle up and
       writes before it changes
    U  the bundle in gamemode.js is game\trade-cargo.js as it is

  Nothing leaves this machine. The scratch folder goes at the end.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const T = require('../../game/trade-cargo.js');

const REPO = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function throws(what, fn, re) {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e && e.message); }
  yes(what + (msg ? ' (' + msg + ')' : ''), msg !== null && (!re || re.test(msg)));
}

const BRYNJA = { actor: 0xff000a01, profile: 5001 };
const BRYNJA2 = { actor: 0xff000a03, profile: 5001 };   // another character on Brynja's profile
const ONUND = { actor: 0xff000a02, profile: 5002 };
const KARI = { actor: 0xff000a09, profile: 0 };
const IRON = 0x5ace4, SALT = 0x34cdf;

const ROUTES = {
  v: 1,
  ports: [
    { key: 'solitude', name: 'Solitude docks', hold: 'solitude', world: '3c:Skyrim.esm', pos: [1, 2, 3] },
    { key: 'windhelm', name: 'Windhelm docks', hold: 'windhelm', world: '3c:Skyrim.esm', pos: [4, 5, 6] },
    { key: 'dawnstar', name: 'Dawnstar', hold: 'dawnstar', world: '3c:Skyrim.esm', pos: [7, 8, 9] }
  ],
  routes: [
    { from: 'solitude', to: 'windhelm', minutes: 90, crew: [] },
    { from: 'windhelm', to: 'solitude', minutes: 120 },
    { from: 'solitude', to: 'dawnstar', minutes: 40, crew: ['1a2b3:Skyrim.esm'] }
  ]
};

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-511-'));
function done() {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

try {
  // ================================================================== N
  const code = fs.readFileSync(path.join(REPO, 'game', 'trade-cargo.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  yes('N0 the module calls nothing: no require, the world, a purse or the merchant code (#512 and #1373 are their own)', !/require\(|\bmp\.|merchant|purse|price/i.test(code));
  const ships = T.createTradeCargo({ ports: ['solitude', 'windhelm', 'dawnstar'], routes: ROUTES.routes });
  const s = ships.empty();
  ships.open(s, 'ship-1', 'solitude');
  const l1 = ships.load(s, 'ship-1', { by: BRYNJA, for: ONUND, receipt: 'debit:1', entry: { baseId: IRON, count: 10 } });
  const l2 = ships.load(s, 'ship-1', { by: BRYNJA, for: KARI, receipt: 'debit:2', entry: { baseId: SALT, count: 4, health: 1 } });
  yes('N1 two lines aboard, every field of a piece kept', ships.aboard(s, 'ship-1').length === 2 && ships.aboard(s, 'ship-1')[1].entry.health === 1);
  throws('N2 one receipt loads once', function () { ships.load(s, 'ship-1', { by: BRYNJA, for: ONUND, receipt: 'debit:1', entry: { baseId: IRON, count: 1 } }); }, /already used/);
  throws('N3 coin is not cargo', function () { ships.load(s, 'ship-1', { by: BRYNJA, for: ONUND, receipt: 'debit:3', entry: { baseId: 15, count: 100 } }); }, /Coin/);
  throws('N4 a person on the manifest is a character, never a name', function () { ships.load(s, 'ship-1', { by: 'Brynja', for: ONUND, receipt: 'debit:4', entry: { baseId: IRON, count: 1 } }); }, /character/);
  throws('N5 a load with no receipt is refused', function () { ships.load(s, 'ship-1', { by: BRYNJA, for: ONUND, entry: { baseId: IRON, count: 1 } }); }, /receipt/);
  throws('N6 delivery at the port it was loaded in is refused', function () { ships.begin(s, 'ship-1', l1, 1, 'delivered', ONUND, 1); }, /far end/);
  throws('N7 a route staff did not write is refused', function () { ships.depart(s, 'ship-1', 'windhelm', 10, 5); }, /later time/);
  ships.depart(s, 'ship-1', 'windhelm', 100, 200);
  throws('N8 nothing loads at sea', function () { ships.load(s, 'ship-1', { by: ONUND, for: BRYNJA, receipt: 'debit:5', entry: { baseId: IRON, count: 1 } }); }, /at sea/);
  yes('N9 nothing lands before its time', ships.arrive(s, 150).length === 0);
  yes('N10 and it lands at its time', ships.arrive(s, 200)[0] === 'ship-1' && s.holds['ship-1'].port === 'windhelm');
  throws('N11 only the person it is for receives it', function () { ships.begin(s, 'ship-1', l1, 1, 'delivered', KARI, 300); }, /Only the person/);
  const b1 = ships.begin(s, 'ship-1', l1, 6, 'delivered', ONUND, 300);
  yes('N12 a hand out is pending and still counted', b1.entry.count === 6 && ships.audit(s).pending === 6 && ships.audit(s).aboard === 8);
  throws('N13 a hold with a hand out pending cannot sail', function () { ships.depart(s, 'ship-1', 'solitude', 400, 500); }, /handed out/);
  ships.finish(s, 'ship-1', b1.out, 'credit:1');
  throws('N14 a credit receipt is used once', function () { ships.finish(s, 'ship-1', b1.out, 'credit:2'); }, /Nothing is waiting/);
  const b2 = ships.begin(s, 'ship-1', l1, 4, 'left', ONUND, 301);
  ships.undo(s, 'ship-1', b2.out);
  yes('N15 a refused credit puts the piece back aboard', ships.audit(s).aboard === 8 && ships.audit(s).out === 6 && ships.audit(s).pending === 0);
  const saved = ships.save(s);
  yes('N16 a save reads back the same', ships.save(ships.parse(saved)) === saved);
  const t1 = JSON.parse(saved); t1.holds['ship-1'].lines[String(l1)].aboard = 9;
  throws('N17 a save where a line grew is refused', function () { ships.parse(JSON.stringify(t1)); });
  const t3 = JSON.parse(saved); delete t3.receipts['credit:1'];
  throws('N19 a save that lost a receipt is refused', function () { ships.parse(JSON.stringify(t3)); }, /receipt/);
  throws('N20 a save that is not one is refused, not read as empty', function () { ships.parse('{}'); });
  const before = ships.save(s);
  throws('N21 a refused change changes nothing', function () { ships.begin(s, 'ship-1', l2, 99, 'delivered', KARI, 400); });
  yes('N22 the manifest is as it was', ships.save(s) === before);
  const b3 = ships.begin(s, 'ship-1', l2, 1, 'taken', ONUND, 401);
  yes('N23 at a dock anybody may take a piece, written as taken by who took it', b3.entry.count === 1 && s.holds['ship-1'].outs[s.holds['ship-1'].outs.length - 1].who.actor === ONUND.actor);
  ships.finish(s, 'ship-1', b3.out, 'credit:3');

  // ================================================================== S
  const ok = T.checkRoutes(ROUTES);
  yes('S1 the staff list reads, a missing crew is no crew', ok.routes[1].crew.length === 0 && ok.ports.length === 3);
  throws('S2 a route to a port not on the list is refused whole', function () {
    T.checkRoutes({ v: 1, ports: ROUTES.ports, routes: ROUTES.routes.concat([{ from: 'solitude', to: 'riften', minutes: 5 }]) });
  }, /Route 4/);
  throws('S3 a port in no hold is refused', function () {
    T.checkRoutes({ v: 1, ports: [{ key: 'x', name: 'X', hold: 'nowhere', world: '3c:Skyrim.esm', pos: [0, 0, 0] }], routes: [] });
  }, /Port 1/);
  yes('S4 an empty list is a world with no ships', T.checkRoutes({ v: 1, ports: [], routes: [] }).ports.length === 0);
  const edit = JSON.parse(JSON.stringify(ROUTES));
  edit.ports = edit.ports.filter(function (p) { return p.key !== 'windhelm'; });
  edit.routes = edit.routes.filter(function (r) { return r.from !== 'windhelm' && r.to !== 'windhelm'; });
  const p = T.proposeRoutes(ROUTES, edit, s);
  yes('S5 an edit says what it changes and the hold it strands', p.changes.some(function (c) { return /Remove the port Windhelm/.test(c); }) &&
      p.strands.length === 1 && /ship-1 is at windhelm/.test(p.strands[0]));
  const s2 = ships.empty();
  ships.open(s2, 'ship-2', 'solitude');
  ships.load(s2, 'ship-2', { by: ONUND, for: BRYNJA, receipt: 'debit:x', entry: { baseId: IRON, count: 2 } });
  ships.depart(s2, 'ship-2', 'dawnstar', 10, 20);
  ships.amend(s2, 'ship-2', { to: 'windhelm', arriveAt: 99 });
  yes('S6 staff can turn a voyage under way, nothing aboard changes', s2.holds['ship-2'].sailing.to === 'windhelm' && ships.audit(s2).aboard === 2);
  throws('S7 not back to where it left', function () { ships.amend(s2, 'ship-2', { to: 'solitude' }); });

  // ================================================================== L
  const DAY = 24 * 60 * 60 * 1000;
  const L = ships.empty();
  ships.open(L, 'ship-5', 'solitude');
  yes('L1 a new hold has not landed', L.holds['ship-5'].landed === null);
  const la = ships.load(L, 'ship-5', { by: BRYNJA, for: ONUND, receipt: 'l1', entry: { baseId: IRON, count: 4 } });
  const lb = ships.load(L, 'ship-5', { by: BRYNJA, for: KARI, receipt: 'l2', entry: { baseId: SALT, count: 2 } });
  yes('L2 at the port it was loaded in, nothing is ever due', ships.uncollected(L, 100 * DAY, 7 * DAY).length === 0 && ships.nextUncollected(L, 7 * DAY) === null);
  ships.depart(L, 'ship-5', 'windhelm', 10, 20);
  yes('L3 a hold that sails has no landing', L.holds['ship-5'].landed === null);
  throws('L4 nothing is taken from a hold at sea', function () { ships.begin(L, 'ship-5', la, 1, 'taken', KARI, 15); }, /at sea/);
  throws('L5 nor handed out any other way', function () { ships.begin(L, 'ship-5', la, 1, 'returned', BRYNJA, 15); }, /at sea/);
  yes('L6 nor is anything due while it sails', ships.uncollected(L, 100 * DAY, 7 * DAY).length === 0);
  ships.arrive(L, 20);
  yes('L7 it landed when it docked', L.holds['ship-5'].landed === 20 && ships.nextUncollected(L, 7 * DAY) === 20 + 7 * DAY);
  yes('L8 nothing is due a moment before the days are up', ships.uncollected(L, 20 + 7 * DAY - 1, 7 * DAY).length === 0);
  const due = ships.uncollected(L, 20 + 7 * DAY, 7 * DAY);
  yes('L9 at the days, every line aboard is due, at the port it is at, for its recipient', due.length === 2 && due[0].line === la && due[0].count === 4 &&
      due[0].port === 'windhelm' && due[0].for.actor === ONUND.actor && due[1].line === lb);
  ships.release(L, { actor: function (n) { return n === KARI.actor; }, profile: function () { return false; } });
  yes('L10 a line whose recipient was released stays aboard, for the world to settle', ships.uncollected(L, 20 + 7 * DAY, 7 * DAY).length === 1);
  const lt = ships.begin(L, 'ship-5', lb, 2, 'taken', ONUND, 30);
  ships.finish(L, 'ship-5', lt.out, 'lc1');
  const lo = ships.begin(L, 'ship-5', la, 4, 'left', ONUND, 20 + 7 * DAY);
  yes('L11 a line being moved is still in use', ships.used(L, 'ship-5') === 1);
  ships.finish(L, 'ship-5', lo.out, 'box:1');
  yes('L12 once every line went out, the hold is free again', ships.used(L, 'ship-5') === 0 && ships.uncollected(L, 30 * DAY, 7 * DAY).length === 0 &&
      ships.nextUncollected(L, 7 * DAY) === null);
  const Lsave = ships.save(L);
  yes('L13 the landing saves and reads back', ships.save(ships.parse(Lsave)) === Lsave && JSON.parse(Lsave).holds['ship-5'].landed === 20);
  const l14 = JSON.parse(Lsave); l14.holds['ship-5'].landed = 'soon';
  throws('L14 a landing that is not a time is refused', function () { ships.parse(JSON.stringify(l14)); }, /landing/);
  const l15 = JSON.parse(Lsave); l15.holds['ship-5'].sailing = { from: 'windhelm', to: 'solitude', at: 30, arriveAt: 40 };
  throws('L15 a hold at sea that says it landed is refused', function () { ships.parse(JSON.stringify(l15)); }, /landing/);
  const l16 = JSON.parse(Lsave); delete l16.holds['ship-5'].landed;
  throws('L16 a ship that does not say when it landed is refused, never read as never landed (alpha: nothing is carried over)', function () { ships.parse(JSON.stringify(l16)); }, /landing/);
  yes('L17 nothing gives a docked ship a landing time at a start', ships.clockDocked === undefined);

  const F = ships.empty();
  ships.open(F, 'ship-6', 'solitude');
  for (let i = 0; i < 24; i++) {
    const n = ships.load(F, 'ship-6', { by: BRYNJA, for: BRYNJA, receipt: 'f' + i, entry: { baseId: IRON, count: 1 } });
    const r = ships.begin(F, 'ship-6', n, 1, 'returned', BRYNJA, 1);
    ships.finish(F, 'ship-6', r.out, 'fc' + i);
  }
  yes('L18 24 lines that all went out leave the hold free: a 25th loads', ships.used(F, 'ship-6') === 0 &&
      ships.load(F, 'ship-6', { by: BRYNJA, for: ONUND, receipt: 'f24', entry: { baseId: IRON, count: 1 } }) > 0);
  for (let i = 25; i < 48; i++) { ships.load(F, 'ship-6', { by: BRYNJA, for: ONUND, receipt: 'f' + i, entry: { baseId: IRON, count: 1 } }); }
  throws('L19 but 24 open at once is full', function () { ships.load(F, 'ship-6', { by: BRYNJA, for: ONUND, receipt: 'f48', entry: { baseId: IRON, count: 1 } }); }, /full/);
  const l20 = JSON.parse(ships.save(F));
  const open1 = Object.keys(l20.holds['ship-6'].lines).filter(function (k) { return l20.holds['ship-6'].lines[k].aboard === 1; })[0];
  l20.holds['ship-6'].lines['999'] = Object.assign({}, l20.holds['ship-6'].lines[open1], { seq: 999, receipt: 'f999' });
  l20.receipts.f999 = true; l20.seq = 999;
  throws('L20 a save carrying more open lines than a hold may is refused', function () { ships.parse(JSON.stringify(l20)); }, /more lines/);

  // The carts (#3158) share the manifest, and keep their own rules.
  const carts = T.createTradeCargo({ ports: ['solitude', 'windhelm', 'dawnstar'], routes: ROUTES.routes, driven: true });
  const C = carts.empty();
  carts.open(C, 'cart-1', 'solitude');
  const cl = carts.load(C, 'cart-1', { by: BRYNJA, for: ONUND, receipt: 'c1', entry: { baseId: IRON, count: 3 } });
  yes('L20a a cart keeps no landing', !Object.prototype.hasOwnProperty.call(C.holds['cart-1'], 'landed'));
  carts.depart(C, 'cart-1', 'windhelm', 10, 20, BRYNJA);
  throws('L20b a cart on the road gives nothing out but the raid', function () { carts.begin(C, 'cart-1', cl, 1, 'returned', BRYNJA, 11); }, /on the road/);
  const raid = carts.begin(C, 'cart-1', cl, 1, 'taken', ONUND, 12);
  carts.finish(C, 'cart-1', raid.out, 'cr1');
  yes('L20c and the raid takes from it while it is driven', C.holds['cart-1'].lines[String(cl)].aboard === 2);
  carts.pullIn(C, 'cart-1', 30, BRYNJA);
  throws('L20d goods on a cart wait on the cart: no drop box', function () { carts.uncollected(C, 30 * DAY, 7 * DAY); }, /wait on the cart/);
  const c20 = JSON.parse(carts.save(C)); c20.holds['cart-1'].landed = 30;
  throws('L20e a cart that says it landed is refused', function () { carts.parse(JSON.stringify(c20)); }, /landing/);

  yes('L21 the staff list waits 7 days unless it says', T.checkRoutes(ROUTES).uncollectedDays === 7 && T.UNCOLLECTED_DAYS === 7);
  yes('L22 it keeps the days it says', T.checkRoutes(Object.assign({}, ROUTES, { uncollectedDays: 3 })).uncollectedDays === 3);
  [0, 61, 2.5, '7', -1].forEach(function (n) {
    throws('L23 days of ' + JSON.stringify(n) + ' are refused', function () { T.checkRoutes(Object.assign({}, ROUTES, { uncollectedDays: n })); }, /whole number from 1 to 60/);
  });
  yes('L24 a change of days is said in the proposal', T.proposeRoutes(ROUTES, Object.assign({}, ROUTES, { uncollectedDays: 10 }), ships.empty()).changes
      .some(function (c) { return c === 'Cargo nobody collects goes to the drop box after 10 days, not 7.'; }));

  // ================================================================== D
  function who(actors, profiles) {
    return { actor: function (n) { return actors.indexOf(n) >= 0; }, profile: function (n) { return profiles.indexOf(n) >= 0; } };
  }
  const d = ships.empty();
  ships.open(d, 'ship-3', 'solitude');
  const d1 = ships.load(d, 'ship-3', { by: BRYNJA, for: ONUND, receipt: 'r1', entry: { baseId: IRON, count: 5 } });
  const d2 = ships.load(d, 'ship-3', { by: ONUND, for: BRYNJA2, receipt: 'r2', entry: { baseId: SALT, count: 3 } });
  const d3 = ships.load(d, 'ship-3', { by: KARI, for: ONUND, receipt: 'r3', entry: { baseId: IRON, count: 7 } });
  ships.depart(d, 'ship-3', 'windhelm', 1, 2);
  ships.arrive(d, 2);
  const h1 = ships.begin(d, 'ship-3', d1, 2, 'delivered', ONUND, 3);
  ships.finish(d, 'ship-3', h1.out, 'c1');
  const was = ships.audit(d);
  const c1 = ships.release(d, who([BRYNJA.actor], []));
  const line = function (k) { return d.holds['ship-3'].lines[String(k)]; };
  yes('D1 a character listed by form id comes off the lines they loaded', line(d1).by === null && c1.loaders === 1);
  yes('D2 another character on the same profile stays, because a list of characters never names a profile', !!line(d2).for && line(d2).for.actor === BRYNJA2.actor && c1.recipients === 0);
  const now = ships.audit(d);
  yes('D3 not one piece is made or lost', now.aboard === was.aboard && now.out === was.out && now.pending === was.pending);
  const c2 = ships.release(d, who([], [5001]));
  yes('D4 a profile Delete-Person names takes every character on it off', line(d2).for === null && c2.recipients === 1);
  const c3 = ships.release(d, who([ONUND.actor], []));
  yes('D5 a receiver of a hand out comes off it too', c3.receivers === 1 && d.holds['ship-3'].outs[0].who === null && c3.loaders === 1 && c3.recipients === 2);
  yes('D6 the hand out that went out keeps its count and receipt', d.holds['ship-3'].outs[0].count === 2 && d.holds['ship-3'].outs[0].receipt === 'c1');
  throws('D7 a line whose recipient is gone cannot be delivered to anybody', function () { ships.begin(d, 'ship-3', d3, 1, 'delivered', ONUND, 4); }, /Only the person/);
  const tk = ships.begin(d, 'ship-3', d3, 7, 'taken', KARI, 5);
  ships.finish(d, 'ship-3', tk.out, 'c2');
  yes('D8 it can still be taken, for the world to settle', ships.audit(d).aboard === was.aboard - 7);
  const c4 = ships.release(d, who([BRYNJA.actor, ONUND.actor], [5001, 5002]));
  yes('D9 running again finds nothing', c4.loaders === 0 && c4.recipients === 0 && c4.receivers === 0);
  const dsave = ships.save(d);
  yes('D10 a released manifest saves, reads back, and names nobody released',
      ships.save(ships.parse(dsave)) === dsave && dsave.indexOf(String(BRYNJA.actor)) < 0 && dsave.indexOf(String(ONUND.actor)) < 0 && dsave.indexOf('5001') < 0);
  throws('D11 a release list that is not one is refused', function () { ships.release(d, {}); }, /release list/);

  // ================================================================== G
  const none = T.openRegister(null);
  yes('G1 no register is no ports, no routes, no holds', JSON.stringify(T.countsOf(none)) === JSON.stringify({ holds: 0, sailing: 0, aboard: 0, pending: 0, out: 0, ports: 0, routes: 0 }));
  throws('G2 a register that is not one is refused, not read as empty', function () { T.openRegister('{"v":1}'); }, /register/);
  let reg = T.adoptRoutes(none, ROUTES);
  yes('G3 a confirmed staff list becomes the list in force', T.countsOf(reg).ports === 3 && T.countsOf(reg).routes === 3);
  reg.ships.open(reg.state, 'ship-4', 'windhelm');
  reg.ships.load(reg.state, 'ship-4', { by: BRYNJA, for: ONUND, receipt: 'g1', entry: { baseId: IRON, count: 1 } });
  const text = T.saveRegister(reg);
  yes('G4 the register saves and reads back the same', T.saveRegister(T.openRegister(text)) === text);
  throws('G5 an edit that strands a hold is refused', function () { T.adoptRoutes(reg, edit); }, /strands/);
  const bad = JSON.parse(text); bad.routes.ports = bad.routes.ports.filter(function (x) { return x.key !== 'windhelm'; });
  bad.routes.routes = bad.routes.routes.filter(function (r) { return r.from !== 'windhelm' && r.to !== 'windhelm'; });
  throws('G6 a register whose manifest names a port its list does not have is refused', function () { T.openRegister(JSON.stringify(bad)); }, /Hold ship-4/);

  // ================================================================== B
  const gm = fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8').split(String.fromCharCode(13)).join('');
  const a = gm.indexOf('// ==== thornswood trade ships ====');
  const z = gm.indexOf('// ==== end thornswood trade ships ====');
  yes('B0 the trade ships block is in gamemode.js, after the dungeon loot', a > 0 && z > a && a > gm.indexOf('// ==== end thornswood dungeon loot ===='));
  const blockSrc = gm.slice(a, z);
  function start(dir, opt) {
    opt = opt || {};
    const logged = [];
    const box = {
      console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
      require: require, Buffer: Buffer,
      log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); },
      mp: { getServerSettings: function () { return Object.assign({ privDir: 'private' }, opt.settings || {}); } }
    };
    if (opt.release) { box.__thornswoodRelease = opt.release; }
    box.globalThis = box;
    vm.createContext(box);
    const back = process.cwd();
    process.chdir(dir);
    try { vm.runInContext(blockSrc, box, { filename: 'gamemode.js (trade ships)' }); } finally { process.chdir(back); }
    return { box: box, logged: logged.filter(function (l) { return /^\[ships\]/.test(l); }) };
  }
  function server(name, register) {
    const dir = path.join(scratch, name);
    fs.mkdirSync(path.join(dir, 'private'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ privDir: 'private' }));
    if (register !== undefined) { fs.writeFileSync(path.join(dir, 'private', 'trade-cargo.json'), register); }
    return dir;
  }
  const FILE = function (dir) { return path.join(dir, 'private', 'trade-cargo.json'); };

  const e1 = server('empty');
  let asked = null;
  const r1 = start(e1, { release: function (part, fn) { asked = { part: part, r: fn(who([BRYNJA.actor], [])) }; } });
  yes('B1 off by default: no handle, and the load says off with the counts (' + (r1.logged[0] || '') + ')',
      !r1.box.__thornswoodTradeShips && /^\[ships\] ready, off \("thornswoodTradeShips": true in server-settings\.json switches it on\): 0 port\(s\), 0 route\(s\), 0 hold\(s\)/.test(r1.logged[0] || ''));
  yes('B2 the release is asked for as part cargo and, with no register, answers done without writing one',
      !!asked && asked.part === 'cargo' && asked.r.saved === true && !fs.existsSync(FILE(e1)));

  const e2 = server('switched-off', text);
  const r2 = start(e2, { release: function (part, fn) { asked = { part: part, r: fn(who([ONUND.actor], [])) }; } });
  const kept = JSON.parse(fs.readFileSync(FILE(e2), 'utf8'));
  const kl = kept.cargo.holds['ship-4'].lines['1'];
  yes('B3 with the switch off the release still takes a character off, written through', asked.r.saved === true && asked.r.counts.recipients === 1 && kl.for === null && kl.by.actor === BRYNJA.actor);
  yes('B4 and the piece is still aboard', kl.aboard === 1 && /1 piece\(s\) aboard/.test(r2.logged[0] || ''));

  const e3 = server('unreadable', '{"v":1,"routes":{},"cargo":{}}');
  const r3 = start(e3, { release: function (part, fn) { asked = { part: part, r: fn(who([ONUND.actor], [])) }; } });
  yes('B5 a register that does not verify is said, the release waits, and nothing writes over it',
      r3.logged.some(function (l) { return /could not be read/.test(l); }) && asked.r.saved === false &&
      fs.readFileSync(FILE(e3), 'utf8') === '{"v":1,"routes":{},"cargo":{}}');
  const r3on = start(e3, { settings: { thornswoodTradeShips: true } });
  yes('B6 and with the switch on there is still no handle on a register that does not verify', !r3on.box.__thornswoodTradeShips);

  const e4 = server('on', text);
  const r4 = start(e4, { settings: { thornswoodTradeShips: true } });
  const ts = r4.box.__thornswoodTradeShips;
  yes('B7 on: the load says on and the handle is up', /^\[ships\] ready, on: 3 port\(s\)/.test(r4.logged[0] || '') && !!ts);
  ts.depart('ship-4', 'solitude', 10, 20);
  yes('B8 a change is on disk when it returns', JSON.parse(fs.readFileSync(FILE(e4), 'utf8')).cargo.holds['ship-4'].sailing.to === 'solitude');
  const disk = fs.readFileSync(FILE(e4), 'utf8');
  let refused = false;
  try { ts.load('ship-4', { by: BRYNJA, for: ONUND, receipt: 'g2', entry: { baseId: IRON, count: 1 } }); } catch (e) { refused = true; }
  yes('B9 a refused change writes nothing', refused && fs.readFileSync(FILE(e4), 'utf8') === disk);
  yes('B10 the counts read through the handle', ts.counts().sailing === 1 && ts.aboard('ship-4').length === 1);
  const all = r1.logged.concat(r2.logged, r3.logged, r4.logged).join('\n');
  yes('B11 the log never says a form id or a profile id', [BRYNJA.actor, ONUND.actor].every(function (n) { return all.indexOf(String(n)) < 0 && all.toLowerCase().indexOf(n.toString(16)) < 0; }) && all.indexOf('5001') < 0);

  // ================================================================== U
  const u = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dev', 'Build-TradeCargoGamemode.js'), '--check'], { encoding: 'utf8' });
  yes('U1 the bundle in gamemode.js is game\\trade-cargo.js as it is' + (u.status ? ': ' + (u.stderr || '').split('\n')[0] : ''), u.status === 0);
} catch (e) {
  yes('the harness ran to the end: ' + (e && e.stack || e), false);
}
done();
