'use strict';
/*
  test-3158-trade-carts.js

      node tests/test-3158-trade-carts.js

  #3158, trade between holds by cart, on Patrick's two answers of 22 Oct 2026
  (docs/DECIDED.md): people drive the carts that move goods between holds,
  and a shipment is lost only when people raid it, never by chance. Holds
  game\trade-carts.js, the driven manifest in game\trade-cargo.js and the
  trade carts block of game\gamemode.js to them:

    M  the manifest, driven: a cart leaves only with a driver and a ship
       never has one; a cart comes in only with its driver once the road is
       done, or with staff; a raid on the road is a take; a driver deleted
       comes off the journey and the cart stays on the road
    P  the module: the panel's words, a road as long as staff say at the
       least, who drives, what a person sees at a stop and on a raid, the
       staff's words for stops and roads
    W  the block, started as the server starts it with a fake world: E on a
       stop's crate opens the stop; a load for somebody; only a loader
       drives; one cart a driver; a raid near the driver, told to the
       driver, refused from afar and for the driver; the cart in only at its
       stop after the road's minutes; a collect at the far end; staff stops,
       roads, carts and bringing a cart in; the switch off
    R  the routes in: mp.onActivate asks the stop after the dock, /cart is a
       word and never one anybody is told to type, the Office page offers
       staff the panel, Raid cart beside a driver on P
    U  the bundles in gamemode.js are the three modules as they are

  Nothing leaves this machine. The scratch folder goes at the end.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const T = require('../game/trade-cargo.js');
const D = require('../game/trade-ship-dock.js');
const K = require('../game/trade-carts.js');

const REPO = path.join(__dirname, '..');
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

const IRON = 0x5ace4, SALT = 0x34cdf, GOLD = 15;
const CELL = '3c:Skyrim.esm';
const MIN = 60000;
const ROADS = {
  v: 1,
  ports: [
    { key: 'whiterun', name: 'Whiterun stables', hold: 'whiterun', world: CELL, pos: [0, 0, 0], crate: '1a001:Skyrim.esm' },
    { key: 'riften', name: 'Riften stables', hold: 'riften', world: CELL, pos: [50000, 0, 0], crate: '1a002:Skyrim.esm' }
  ],
  routes: [
    { from: 'whiterun', to: 'riften', minutes: 30 },
    { from: 'riften', to: 'whiterun', minutes: 30 }
  ]
};
const A = { actor: 0xff000a01, profile: 5001 }, B = { actor: 0xff000a02, profile: 5002 };

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-3158-'));
function done() {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

try {
  // ================================================================== M
  const roads = T.checkRoutes(ROADS);
  const carts = T.createTradeCargo({ ports: ['whiterun', 'riften'], routes: roads.routes, driven: true });
  const ships = T.createTradeCargo({ ports: ['whiterun', 'riften'], routes: roads.routes });
  const cs = carts.empty();
  carts.open(cs, 'cart-1', 'whiterun');
  carts.load(cs, 'cart-1', { by: A, for: B, receipt: 'd1', entry: { baseId: IRON, count: 10 } });
  throws('M1 a cart leaves only with a driver', function () { carts.depart(cs, 'cart-1', 'riften', 0, 30 * MIN); }, /Who drives it/);
  const ss = ships.empty();
  ships.open(ss, 'ship-1', 'whiterun');
  ships.load(ss, 'ship-1', { by: A, for: B, receipt: 's1', entry: { baseId: IRON, count: 1 } });
  throws('M2 and a ship never has one', function () { ships.depart(ss, 'ship-1', 'riften', 0, 1, A); }, /no driver/);
  carts.depart(cs, 'cart-1', 'riften', 0, 30 * MIN, A);
  yes('M3 the driver goes with the cart on the road', JSON.stringify(cs.holds['cart-1'].sailing.driver) === JSON.stringify(A));
  throws('M4 a cart never arrives on a clock', function () { carts.arrive(cs, 99 * MIN); }, /only with its driver/);
  throws('M5 nobody but the driver brings it in', function () { carts.pullIn(cs, 'cart-1', 31 * MIN, B); }, /Only its driver/);
  throws('M6 nor the driver before the road is done', function () { carts.pullIn(cs, 'cart-1', 29 * MIN, A); }, /not done yet/);
  const out = carts.begin(cs, 'cart-1', 1, 3, 'taken', B, 5 * MIN);
  carts.finish(cs, 'cart-1', out.out, 'c1');
  yes('M7 a raid on the road is a take, written down as taken by whoever took it',
      cs.holds['cart-1'].lines['1'].aboard === 7 && cs.holds['cart-1'].outs[0].how === 'taken' && cs.holds['cart-1'].outs[0].who.actor === B.actor);
  throws('M8 a delivery is never made on the road', function () { carts.begin(cs, 'cart-1', 1, 1, 'delivered', B, 6 * MIN); }, /on the road|at sea/);
  yes('M9 the driver brings it in once the road is done', carts.pullIn(cs, 'cart-1', 30 * MIN, A) === 'riften' && cs.holds['cart-1'].sailing === null);
  carts.depart(cs, 'cart-1', 'whiterun', 40 * MIN, 70 * MIN, A);
  const gone = carts.release(cs, { actor: function (n) { return n === A.actor; }, profile: function () { return false; } });
  yes('M10 a driver deleted comes off the journey, and the cart stays on the road with every piece',
      gone.drivers === 1 && cs.holds['cart-1'].sailing.driver === null && cs.holds['cart-1'].lines['1'].aboard === 7);
  throws('M11 a cart with no driver named is not brought in by anybody', function () { carts.pullIn(cs, 'cart-1', 80 * MIN, A); }, /Only its driver/);
  yes('M12 staff bring it in at any time', carts.pullIn(cs, 'cart-1', 41 * MIN, null) === 'whiterun');
  throws('M13 a ship is never pulled in', function () { ships.pullIn(ss, 'ship-1', 0, null); }, /docks on its own/);
  const bad = JSON.parse(JSON.stringify(ss));
  ships.depart(bad, 'ship-1', 'riften', 0, 1);
  bad.holds['ship-1'].sailing.driver = null;
  throws('M14 a ship\'s voyage that names a driver does not verify', function () { ships.audit(bad); }, /voyage cannot be verified/);
  const bad2 = JSON.parse(JSON.stringify(cs));
  carts.depart(bad2, 'cart-1', 'riften', 0, 1, A);
  delete bad2.holds['cart-1'].sailing.driver;
  throws('M15 and a cart\'s that names none does not either', function () { carts.audit(bad2); }, /voyage cannot be verified/);
  const reg0 = T.adoptRoutes(T.openRegister(null, { driven: true }), ROADS);
  yes('M16 the carts\' register stays driven through a confirm and a save', reg0.ships.DRIVEN === true &&
      T.openRegister(T.saveRegister(reg0), { driven: true }).ships.DRIVEN === true && T.openRegister(null).ships.DRIVEN === false);

  // ================================================================== P
  const code = fs.readFileSync(path.join(REPO, 'game', 'trade-carts.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  yes('P0 the module touches nothing: no require, no world, no timer', !/require\(|\bmp\.|setTimeout|Date\.now|Math\.random/.test(code));
  yes('P1 a load reads whole', JSON.stringify(K.parse(['/cart', 'load', 'cart-1', '5ace4', '0', '3', 'ff000a02'])) ===
      JSON.stringify({ verb: 'load', cart: 'cart-1', base: IRON, nth: 0, count: 3, forActor: 0xff000a02 }));
  yes('P2 a raid names its driver, a take its line and count', K.parse(['/cart', 'raid', 'ff000a01']).driver === A.actor &&
      JSON.stringify(K.parse(['/cart', 'take', 'cart-1', '1', '2'])) === JSON.stringify({ verb: 'take', cart: 'cart-1', line: 1, count: 2 }));
  yes('P3 a word it does not know is said, not guessed', !!K.parse(['/cart', 'steal']).why && !!K.parse(['/cart', 'raid', 'x']).why);
  yes('P4 a road takes at least the minutes staff gave it', JSON.stringify(K.road(roads, 'whiterun', 'riften', 1000)) === JSON.stringify({ at: 1000, arriveAt: 1000 + 30 * MIN }));
  throws('P5 and there is no road staff did not write', function () { K.road(roads, 'whiterun', 'dawnstar', 0); }, /No road/);

  const reg = { routes: roads, ships: carts, state: carts.empty() };
  carts.open(reg.state, 'cart-1', 'whiterun');
  carts.open(reg.state, 'cart-2', 'whiterun');
  carts.load(reg.state, 'cart-1', { by: A, for: B, receipt: 'p1', entry: { baseId: IRON, count: 3 } });
  carts.load(reg.state, 'cart-1', { by: B, for: B, receipt: 'p2', entry: { baseId: SALT, count: 2 } });
  const pack = [{ baseId: IRON, nth: 0, count: 9, name: 'Iron Ingot' }, { baseId: GOLD, nth: 0, count: 50, name: 'Gold' }];
  const vA = K.stopView({ reg: reg, stop: 'whiterun', viewer: A, pack: pack, people: [A, Object.assign({ name: 'Onund' }, B)],
                          nameOf: function () { return 'Onund'; }, now: 0 });
  const c1 = vA.carts[0];
  yes('P6 at a stop: the carts, lines used of 24, a loader sees their own line and not another\'s', vA.mode === 'stop' && vA.kind === 'cart' &&
      vA.word === '/cart' && c1.used === 2 && c1.max === 24 && c1.lines.length === 1 && c1.lines[0].forName === 'Onund' && c1.others === 1);
  yes('P7 anybody loads, gold never offered', c1.canLoad && vA.pack.length === 1 && vA.pack[0].base === '5ace4');
  yes('P8 who has loaded something may drive it where a road leads, an empty cart nobody',
      c1.drive.length === 1 && c1.drive[0].to === 'riften' && c1.drive[0].minutes === 30 && vA.carts[1].drive.length === 0);
  carts.depart(reg.state, 'cart-1', 'riften', 0, 30 * MIN, A);
  carts.load(reg.state, 'cart-2', { by: A, for: A, receipt: 'p3', entry: { baseId: IRON, count: 1 } });
  const vA2 = K.stopView({ reg: reg, stop: 'whiterun', viewer: A, pack: pack, people: [A], now: MIN });
  yes('P9 one person drives one cart at a time', vA2.carts.length === 1 && vA2.carts[0].drive.length === 0 && vA2.driving.id === 'cart-1');
  yes('P10 the cart a person drives is theirs to find', K.cartOfDriver(reg.state, A) === 'cart-1' && K.cartOfDriver(reg.state, B) === '');
  const at = K.stopView({ reg: reg, stop: 'riften', viewer: A, pack: [], people: [A], now: 10 * MIN });
  yes('P11 at the far stop, before the road is done: on its way, not in', at.incoming.length === 1 && at.incoming[0].mine &&
      at.incoming[0].dueIn === 20 && !at.incoming[0].canPullIn);
  const at2 = K.stopView({ reg: reg, stop: 'riften', viewer: A, pack: [], people: [A], now: 30 * MIN });
  const atB = K.stopView({ reg: reg, stop: 'riften', viewer: B, pack: [], people: [B], now: 30 * MIN });
  yes('P12 once it is done, its driver pulls it in, and nobody else', at2.incoming[0].canPullIn && !atB.incoming[0].canPullIn && !atB.incoming[0].mine);
  const rv = K.raidView({ reg: reg, cart: 'cart-1', driverName: 'Brynja', itemName: function (e) { return e.baseId === IRON ? 'Iron Ingot' : 'Salt'; } });
  yes('P13 a raid sees every piece aboard and no name of whom it is for', rv.mode === 'raid' && rv.lines.length === 2 &&
      rv.lines[0].item === 'Iron Ingot' && rv.lines[0].count === 3 && rv.driver === 'Brynja' && !/Onund|forName|5002/.test(JSON.stringify(rv)));
  yes('P14 a cart standing at a stop is never raided', K.raidView({ reg: reg, cart: 'cart-2' }).open === false);
  yes('P15 staff see the carts on the road', K.onRoad(reg, 10 * MIN).length === 1 && K.onRoad(reg, 10 * MIN)[0].dueIn === 20 && K.onRoad(reg, 0)[0].driver);
  const crate = { desc: '1b009:Skyrim.esm', world: CELL, pos: [9000, 1, 2] };
  throws('P16 the staff draft names a stop for the carts', function () {
    D.editDraft(T, roads, null, ['port', 'x', 'riften', 'X'], { desc: '1A001:Skyrim.esm', world: CELL, pos: [0, 0, 0] }, K.WORDS);
  }, /already the cart stop of whiterun/);
  throws('P17 and a road', function () { D.editDraft(T, roads, null, ['unroute', 'riften', 'dawnstar'], null, K.WORDS); }, /No road from riften/);
  yes('P18 a stop at the crate staff opened', D.editDraft(T, roads, null, ['port', 'falkreath', 'falkreath', 'Falkreath', 'stables'], crate, K.WORDS).ports[2].crate === crate.desc);

  // ================================================================== W
  const gm = fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8').split(String.fromCharCode(13)).join('');
  const shipsSrc = gm.slice(gm.indexOf('// ==== thornswood trade ships ===='), gm.indexOf('// ==== end thornswood trade ships ===='));
  const cartsSrc = gm.slice(gm.indexOf('// ==== thornswood trade carts ===='), gm.indexOf('// ==== end thornswood trade carts ===='));
  const ACT = { a: A.actor, b: B.actor, staff: 0xff000a05 };
  const PID = {}; PID[ACT.a] = 5001; PID[ACT.b] = 5002; PID[ACT.staff] = 5005;
  const CRATE = { whiterun: 0x1a001, riften: 0x1a002, other: 0x1b009 };

  function start(dir, opt) {
    opt = opt || {};
    const clock = opt.clock || { now: 1000000 };
    const store = {}, logged = [], told = [];
    function put(id, k, v) { (store[id] = store[id] || {})[k] = JSON.parse(JSON.stringify(v)); }
    put(ACT.a, 'inventory', { entries: [{ baseId: IRON, count: 40 }, { baseId: GOLD, count: 100 }, { baseId: SALT, count: 40, health: 1.2 }] });
    put(ACT.b, 'inventory', { entries: [] });
    put(ACT.staff, 'inventory', { entries: [] });
    [ACT.a, ACT.b, ACT.staff].forEach(function (id) {
      put(id, 'profileId', PID[id]); put(id, 'worldOrCellDesc', CELL); put(id, 'pos', [10, 0, 0]);
      put(id, 'appearance', { name: id === ACT.a ? 'Brynja' : id === ACT.b ? 'Onund' : 'Staff' });
    });
    put(CRATE.whiterun, 'worldOrCellDesc', CELL); put(CRATE.whiterun, 'pos', [0, 0, 0]);
    put(CRATE.riften, 'worldOrCellDesc', CELL); put(CRATE.riften, 'pos', [50000, 0, 0]);
    put(CRATE.other, 'worldOrCellDesc', CELL); put(CRATE.other, 'pos', [9000, 1, 2]);
    const settings = { privDir: 'private' };
    if (opt.off) { settings.thornswoodTradeCarts = false; }
    const box = {
      console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
      require: require, Buffer: Buffer, JSON: JSON, Math: Math,
      Date: { now: function () { return clock.now; } },
      setTimeout: function () { return 1; }, clearTimeout: function () { },
      log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); },
      kindIsContainer: function (desc) { return desc === 'container'; },
      __thornswoodIsStaff: function (pid) { return pid === 5005; },
      __thornswoodIsAdmin: function () { return false; },
      __thornswoodToProfile: function (pid, text) { told.push({ pid: pid, text: text }); },
      mp: {
        getServerSettings: function () { return settings; },
        get: function (id, k) {
          if (k === 'onlinePlayers') { return opt.online || [ACT.a, ACT.b, ACT.staff]; }
          const v = (store[id] || {})[k];
          return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
        },
        set: function (id, k, v) { put(id, k, v); },
        getDescFromId: function (id) { return id === CRATE.whiterun ? '1a001:Skyrim.esm' : id === CRATE.riften ? '1a002:Skyrim.esm' : id === CRATE.other ? '1b009:Skyrim.esm' : ''; },
        makeProperty: function () { }
      }
    };
    box.globalThis = box;
    vm.createContext(box);
    const back = process.cwd();
    process.chdir(dir);
    try {
      vm.runInContext(require('./fixtures/ordinary-quest-items') + shipsSrc + cartsSrc, box, { filename: 'gamemode.js (trade ships and carts)' });
    } finally { process.chdir(back); }
    const tc = box.__thornswoodTradeCarts;
    return {
      box: box, tc: tc, store: store, clock: clock, logged: logged, told: told,
      say: function (actor, line) { process.chdir(dir); try { return tc.command(line.split(' '), actor, PID[actor]); } finally { process.chdir(back); } },
      press: function (actor, ref, base) { process.chdir(dir); try { return tc.activated(ref, actor, base || 'crate'); } finally { process.chdir(back); } },
      view: function (actor) { return (store[actor] || {}).thornswoodCartView; },
      pack: function (actor) { return store[actor].inventory.entries; },
      at: function (actor, pos) { store[actor].pos = pos; },
      disk: function () { return JSON.parse(fs.readFileSync(path.join(dir, 'private', 'trade-carts.json'), 'utf8')); }
    };
  }
  function server(name, register) {
    const dir = path.join(scratch, name);
    fs.mkdirSync(path.join(dir, 'private'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ privDir: 'private' }));
    if (register !== undefined) { fs.writeFileSync(path.join(dir, 'private', 'trade-carts.json'), register); }
    return dir;
  }
  function count(entries, base) { return entries.filter(function (e) { return e.baseId === base; }).reduce(function (n, e) { return n + e.count; }, 0); }

  const r0 = T.adoptRoutes(T.openRegister(null, { driven: true }), ROADS);
  r0.ships.open(r0.state, 'cart-1', 'whiterun');
  const text = T.saveRegister(r0);

  const d1 = server('world', text);
  const w = start(d1);
  yes('W0 the carts are on with no setting, and the ships stay off', !!w.tc && !w.box.__thornswoodTradeShips &&
      w.logged.some(function (l) { return /\[carts\] ready, on: 2 stop\(s\), 2 road\(s\), 1 cart\(s\)/.test(l); }));
  yes('W1 E on a stop\'s crate opens the stop, never the container', w.press(ACT.a, CRATE.whiterun) === true &&
      w.view(ACT.a).open === true && w.view(ACT.a).mode === 'stop' && w.view(ACT.a).stop.key === 'whiterun' && w.view(ACT.a).word === '/cart');
  yes('W2 any other container goes on as a container', w.press(ACT.a, CRATE.other, 'container') === false);
  const before = JSON.stringify(w.pack(ACT.a));
  w.say(ACT.a, '/cart load cart-1 f 0 10 ' + ACT.b.toString(16));
  yes('W3 coin is refused before the pack is touched (' + w.view(ACT.a).note + ')', /Coin is not cargo/.test(w.view(ACT.a).note) && JSON.stringify(w.pack(ACT.a)) === before);
  w.say(ACT.a, '/cart load cart-1 5ace4 0 10 ' + ACT.b.toString(16));
  const line1 = w.disk().cargo.holds['cart-1'].lines['1'];
  yes('W4 a load: ten out of the pack and on the cart for Onund, through a debit receipt, on disk', count(w.pack(ACT.a), IRON) === 30 &&
      line1.aboard === 10 && line1.for.actor === ACT.b && line1.by.profile === 5001 && /^cart-debit:/.test(line1.receipt));
  w.press(ACT.b, CRATE.whiterun);
  w.say(ACT.b, '/cart drive cart-1 riften');
  yes('W5 somebody with nothing on it does not drive it off', /goods of their own/.test(w.view(ACT.b).note) && !w.disk().cargo.holds['cart-1'].sailing);
  w.say(ACT.a, '/cart drive cart-1 riften');
  const road = w.disk().cargo.holds['cart-1'].sailing;
  yes('W6 the loader drives it off, the driver on the journey, the road\'s minutes the least it takes (' + w.view(ACT.a).note + ')',
      !!road && road.driver.actor === ACT.a && road.at === 1000000 && road.arriveAt === 1000000 + 30 * MIN && /Riften stables/.test(w.view(ACT.a).note));
  yes('W7 the driver shows as driving, for Raid cart on P', w.tc.driving(ACT.a, PID[ACT.a]) === true && w.tc.driving(ACT.b, PID[ACT.b]) === false);

  // The raid.
  w.at(ACT.b, [5000, 0, 0]); w.at(ACT.a, [5300, 0, 0]);
  w.say(ACT.b, '/cart raid ' + ACT.a.toString(16));
  const rv2 = w.view(ACT.b);
  yes('W8 near the driver, Raid cart opens the cart on the road', rv2.open === true && rv2.mode === 'raid' && rv2.cart === 'cart-1' &&
      rv2.lines.length === 1 && rv2.lines[0].count === 10 && rv2.driver === 'Brynja');
  w.say(ACT.b, '/cart take cart-1 1 3');
  const took = w.disk().cargo.holds['cart-1'];
  yes('W9 a take: three into the raider\'s pack, written down as taken by them, through a credit receipt', count(w.pack(ACT.b), IRON) === 3 &&
      took.lines['1'].aboard === 7 && took.outs[0].how === 'taken' && took.outs[0].who.actor === ACT.b && /^cart-credit:/.test(took.outs[0].receipt));
  yes('W10 and the driver is told, with no name', w.told.some(function (t) { return t.pid === 5001 && /^Somebody takes 3 .* from your cart\.$/.test(t.text); }));
  w.at(ACT.b, [9000, 0, 0]);
  w.say(ACT.b, '/cart take cart-1 1 1');
  yes('W11 a raider who steps away takes nothing more', /Get closer/.test(w.view(ACT.b).note || w.told.map(function (t) { return t.text; }).join(' ')) &&
      count(w.pack(ACT.b), IRON) === 3);
  yes('W12 nobody raids from afar', /Get closer/.test(w.say(ACT.b, '/cart raid ' + ACT.a.toString(16))));
  yes('W13 a driver does not raid their own cart', /your own cart/.test(w.say(ACT.a, '/cart raid ' + ACT.a.toString(16))));
  yes('W14 nobody raids a person who drives no cart', /not driving a cart/.test(w.say(ACT.a, '/cart raid ' + ACT.b.toString(16))));
  const wOff = start(server('driver-away', fs.readFileSync(path.join(d1, 'private', 'trade-carts.json'), 'utf8')), { online: [ACT.b] });
  wOff.at(ACT.b, [5300, 0, 0]);
  yes('W15 a driver not in the world is not raided', /Get closer/.test(wOff.say(ACT.b, '/cart raid ' + ACT.a.toString(16))));

  // In at the far stop.
  w.at(ACT.a, [50010, 0, 0]);
  w.clock.now = 1000000 + 10 * MIN;
  w.press(ACT.a, CRATE.riften);
  yes('W16 at the far stop early, the cart is on its way and not in', w.view(ACT.a).incoming.length === 1 && w.view(ACT.a).incoming[0].mine &&
      w.view(ACT.a).incoming[0].dueIn === 20 && !w.view(ACT.a).incoming[0].canPullIn);
  w.say(ACT.a, '/cart pullin cart-1');
  yes('W17 and pulling in is refused with the minutes left (' + w.view(ACT.a).note + ')', /in 20 more minute/.test(w.view(ACT.a).note) &&
      !!w.disk().cargo.holds['cart-1'].sailing);
  w.clock.now = 1000000 + 30 * MIN;
  w.press(ACT.a, CRATE.riften);
  w.say(ACT.a, '/cart pullin cart-1');
  yes('W18 once the road is done its driver pulls it in', w.disk().cargo.holds['cart-1'].sailing === null && w.disk().cargo.holds['cart-1'].port === 'riften' &&
      w.tc.driving(ACT.a, PID[ACT.a]) === false && /The cart is in/.test(w.view(ACT.a).note));
  w.at(ACT.b, [50020, 0, 0]);
  w.press(ACT.b, CRATE.riften);
  w.say(ACT.b, '/cart collect cart-1 1 7');
  yes('W19 the one it is for collects it at the far end, through a receipt', count(w.pack(ACT.b), IRON) === 10 &&
      w.disk().cargo.holds['cart-1'].outs[1].how === 'delivered' && w.disk().cargo.holds['cart-1'].lines['1'].aboard === 0);
  w.at(ACT.b, [3000, 0, 0]);
  yes('W20 walking away from the crate ends the stop', /press its crate/.test(w.say(ACT.b, '/cart collect cart-1 1 1')) && w.view(ACT.b).open === false);

  // Staff.
  yes('W21 only staff open the cart stops and roads', /Only staff/.test(w.say(ACT.a, '/cart staff')));
  w.say(ACT.staff, '/cart staff');
  yes('W22 staff see the list in force, a cart\'s panel', w.view(ACT.staff).mode === 'staff' && w.view(ACT.staff).kind === 'cart' &&
      w.view(ACT.staff).inForce.ports.length === 2 && Array.isArray(w.view(ACT.staff).onRoad));
  w.at(ACT.staff, [9000, 0, 0]);
  w.press(ACT.staff, CRATE.other, 'container');
  w.say(ACT.staff, '/cart draft port falkreath falkreath Falkreath stables');
  w.say(ACT.staff, '/cart draft route whiterun falkreath 20');
  const sv = w.view(ACT.staff);
  yes('W23 a stop at the crate staff just opened, and a road, are a draft and change nothing', sv.draft.ports.length === 3 &&
      w.disk().routes.ports.length === 2 && sv.canConfirm);
  w.say(ACT.staff, '/cart confirm ' + sv.base);
  yes('W24 confirmed: the list in force, written', w.disk().routes.ports.length === 3 && w.disk().routes.ports[2].crate === '1b009:Skyrim.esm' &&
      w.logged.some(function (l) { return /staff confirmed the cart stops: 3 stop\(s\), 3 road\(s\)/.test(l); }));
  w.say(ACT.staff, '/cart add whiterun');
  yes('W25 staff put a cart at a stop', w.disk().cargo.holds['cart-2'].port === 'whiterun');
  // A cart whose driver is gone, brought in by staff.
  w.at(ACT.a, [50010, 0, 0]);
  w.press(ACT.a, CRATE.riften);
  w.say(ACT.a, '/cart load cart-1 34cdf 0 2 ' + ACT.a.toString(16));
  w.say(ACT.a, '/cart drive cart-1 whiterun');
  const salt = Object.values(w.disk().cargo.holds['cart-1'].lines).filter(function (l) { return l.entry.baseId === SALT; })[0];
  yes('W26 every field of a stack goes on the cart with it', !!salt && salt.entry.health === 1.2 &&
      w.disk().cargo.holds['cart-1'].sailing.to === 'whiterun');
  w.say(ACT.staff, '/cart staff');
  yes('W27 staff see it on the road', w.view(ACT.staff).onRoad.length === 1 && w.view(ACT.staff).onRoad[0].id === 'cart-1');
  w.say(ACT.staff, '/cart bring cart-1');
  yes('W28 and bring it in at its stop', w.disk().cargo.holds['cart-1'].port === 'whiterun' && w.disk().cargo.holds['cart-1'].sailing === null);

  // The switch.
  const off = start(server('off', text), { off: true });
  yes('W29 "thornswoodTradeCarts": false switches the carts off, the register still counted', !off.tc &&
      off.logged.some(function (l) { return /\[carts\] ready, off/.test(l); }));
  const brokenDir = server('broken', '{"v":1,"routes":');
  const broken = start(brokenDir);
  yes('W30 a register that does not verify is refused whole and left as it is', !broken.tc &&
      broken.logged.some(function (l) { return /could not be read/.test(l); }) &&
      fs.readFileSync(path.join(brokenDir, 'private', 'trade-carts.json'), 'utf8') === '{"v":1,"routes":');
  const all = w.logged.concat(off.logged).join('\n');
  yes('W31 the log never says a form id or a profile id', [ACT.a, ACT.b, ACT.staff].every(function (n) { return all.indexOf(n.toString(16)) < 0 && all.indexOf(String(n)) < 0; }) &&
      ['5001', '5002', '5005'].every(function (p) { return all.indexOf(p) < 0; }));

  // ================================================================== R
  const onAct = gm.slice(gm.indexOf("mp.onActivate = guard('onActivate'"), gm.indexOf('const shut = benchGate(casterRefrId, baseDesc);'));
  yes('R1 mp.onActivate asks the stop after the dock and answers false for a crate',
      /cartStop\.activated\(refrId, casterRefrId, baseDesc\)\) \{\s*return false;/.test(onAct) && onAct.indexOf('cartStop') > onAct.indexOf('shipsDock'));
  const WORDS = new Function('return ' + /const WORDS = (\[[\s\S]*?\]);/.exec(gm)[1])();
  const PW = /PLAYER_WORDS = (\[[\s\S]*?\]);/.exec(gm);
  yes('R2 /cart is a word, and not one anybody is told to type', WORDS.indexOf('/cart') >= 0 && !!PW && PW[1].indexOf("'/cart'") < 0);
  yes('R3 the word reaches the carts', /if \(word === '\/cart'\) \{[\s\S]{0,400}cartsApi\.command\(parts, actorId, profileId\)/.test(gm));
  const skills = fs.readFileSync(path.join(REPO, 'game', 'ui', 'thornswood-skills.js'), 'utf8');
  yes('R4 the Office page offers staff Cart stops and roads while the carts are on', /if \(o\.carts\) wrap\.appendChild\(officeCarts\(\)\)/.test(skills) &&
      /officeButton\('Cart stops and roads', '\/cart staff'\)/.test(skills) && /carts: staff && !!\(g\.__thornswoodTradeCarts && g\.__thornswoodTradeCarts\.command\)/.test(gm));
  const party = fs.readFileSync(path.join(REPO, 'game', 'ui', 'thornswood-party.js'), 'utf8');
  yes('R5 Raid cart beside somebody driving one, under Near you on P', /nr\.cart \? '<button data-do="raid"/.test(party) &&
      /verb === 'raid'\) \{ net\('\/cart raid ' \+ who\)/.test(party) && /cartsNear\.driving\(parseInt\(hex, 16\), np\)/.test(gm));
  const panel = fs.readFileSync(path.join(REPO, 'game', 'ui', 'thornswood-ship.js'), 'utf8');
  yes('R6 the panel sends a cart\'s lines under /cart, and draws a stop and a raid', /data\.word === '\/cart' \? '\/cart' : '\/ship'/.test(panel) &&
      /function drawStop\(\)/.test(panel) && /function drawRaid\(\)/.test(panel) && /net\(word\(\) \+ ' close'\)/.test(panel));
  // 'carts' comes after 'cargo', with any parts whose blocks load between them (stalls) in between.
  yes('R7 the release lists know the carts\' part', /var PARTS = \[[^\]]*'cargo', ('\w+', )*'carts'/.test(gm) &&
      /'cargo', ('\w+', )*'carts'/.test(fs.readFileSync(path.join(REPO, 'scripts', 'vps', 'Server-Log.js'), 'utf8')) &&
      /'cargo', ('\w+', )*'carts'/.test(fs.readFileSync(path.join(REPO, 'scripts', 'ops', 'Wipe-Saves.ps1'), 'utf8')) &&
      /trade-carts/.test(fs.readFileSync(path.join(REPO, 'scripts', 'vps', 'Delete-Person.ps1'), 'utf8')));

  // ================================================================== U
  const u = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dev', 'Build-TradeCargoGamemode.js'), '--check'], { encoding: 'utf8' });
  yes('U1 the bundles in gamemode.js are the three modules as they are' + (u.status ? ': ' + (u.stderr || '').split('\n')[0] : ''), u.status === 0);
} catch (e) {
  yes('the harness ran to the end: ' + (e && e.stack || e), false);
}
done();
