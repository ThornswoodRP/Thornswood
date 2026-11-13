'use strict';
/*
  test-scenario-carts.js

  Scenario: systems/carts.md

  #5198. A trade cart from Whiterun to Riften, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them. E on a stop's
  crate is onActivate; every button on the stop's panel, and Raid cart on P,
  is a /cart line through the voice queue, as the panel sends it; what the
  panel draws is the thornswoodCartView property the server writes for the
  person who pressed. The register on disk is private/trade-carts.json, here
  with the two stops and their roads staff confirmed, and one cart standing
  at Whiterun.

  Brynja loads iron at Whiterun for Onund and drives it to Riften. Hrod
  meets her on the road. Sam is staff.

    A  E on Whiterun's crate opens the stop's panel, and the engine opens no
       container. The stop shows the cart and its 24 lines.
    B  Coin is refused as cargo and nothing leaves the pack. Brynja loads 10
       iron for Onund: it leaves her pack and is on the cart. Onund, with
       nothing of his own on it, cannot drive it; Brynja drives it off to
       Riften, and the stop shows the road's minutes.
    C  On the road: Hrod beside her opens the cart with Raid cart and takes
       3: they are in his pack, and she is told somebody takes them, and not
       who. Stepped away, he takes nothing more. She cannot raid her own
       cart, and nobody raids somebody who drives none. With her out of the
       world, her cart is not raided.
    D  A restart while it is on the road: the cart is on the road, with her
       driving, and the 7 left on it.
    E  At Riften's crate before the road's 30 minutes: the cart is on its
       way and does not pull in, with the minutes left. Once they are done
       she pulls it in, and Onund collects his 7 there.
    F  Staff put a cart at Riften. Somebody who is not staff cannot.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  A driver deleted on the road, the staff's drafts of stops and roads, and a
  register that does not read are driven in tests/test-3158-trade-carts.js.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-carts.js
*/
const path = require('path');
const standIn = require('./stand-in-server.js');
const T = require(path.join(__dirname, '..', 'game', 'trade-cargo.js'));
const t = standIn.checks();
const yes = t.yes;

const MIN = 60000;
const TAMRIEL = '3c:Skyrim.esm';
const WHITERUN_AT = [17000, -12000, -4750], RIFTEN_AT = [173000, -91000, 11130];
const CRATE_BASE = '1a003:Skyrim.esm';
const ROADS = {
  v: 1,
  ports: [
    { key: 'whiterun', name: 'Whiterun stables', hold: 'whiterun', world: TAMRIEL, pos: WHITERUN_AT, crate: '1a001:Skyrim.esm' },
    { key: 'riften', name: 'Riften stables', hold: 'riften', world: TAMRIEL, pos: RIFTEN_AT, crate: '1a002:Skyrim.esm' }
  ],
  routes: [
    { from: 'whiterun', to: 'riften', minutes: 30 },
    { from: 'riften', to: 'whiterun', minutes: 30 }
  ]
};
const reg = T.adoptRoutes(T.openRegister(null, { driven: true }), ROADS);
reg.ships.open(reg.state, 'cart-1', 'whiterun');

const w = standIn.world({
  name: 'carts',
  settings: { thornswoodDevs: [1006] },
  files: { 'private/trade-carts.json': T.saveRegister(reg) }
});
const GOLD = 0xf, IRON = 0x5ace4;
w.record(CRATE_BASE, 'CONT');
const id = w.idOf;
const WCRATE = w.ref(id('1a001:Skyrim.esm'), { base: CRATE_BASE, cell: TAMRIEL, pos: WHITERUN_AT });
const RCRATE = w.ref(id('1a002:Skyrim.esm'), { base: CRATE_BASE, cell: TAMRIEL, pos: RIFTEN_AT });
function near(p, dx) { return [p[0] + dx, p[1], p[2]]; }

const BRYNJA = w.person(0xff001000, { profileId: 1000, name: 'Brynja', cell: TAMRIEL, pos: near(WHITERUN_AT, 60),
  inventory: { entries: [{ baseId: IRON, count: 40 }, { baseId: GOLD, count: 100 }] } });
const ONUND = w.person(0xff001001, { profileId: 1001, name: 'Onund', cell: TAMRIEL, pos: near(WHITERUN_AT, 90) });
const HROD = w.person(0xff001002, { profileId: 1002, name: 'Hrod', cell: TAMRIEL, pos: [90000, -50000, 0] });
const SAM = w.person(0xff001003, { profileId: 1006, name: 'Sam', cell: TAMRIEL, pos: near(RIFTEN_AT, 120) });
const ALL = [BRYNJA, ONUND, HROD, SAM];

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
ALL.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function view(a) { return w.prop(a, 'thornswoodCartView') || {}; }
function cart(a, line) { w.say(a, '/cart ' + line); return view(a); }
function disk() { return w.readPrivate('trade-carts.json'); }
function cart1() { return disk().cargo.holds['cart-1']; }
function onCart() { return Object.values(cart1().lines).reduce(function (s, l) { return s + l.aboard; }, 0); }
const hex = function (n) { return (n >>> 0).toString(16); };

// ---------------------------------------------------------- A. the stop --
const a1 = w.activate(WCRATE, BRYNJA);
let v = view(BRYNJA);
yes('A1 E on Whiterun\'s crate: the engine opens no container (' + JSON.stringify(a1) + ')', !a1.allowed && !a1.opened);
yes('A1 and the stop\'s panel opens, with the cart and its 24 lines (' + JSON.stringify(v.stop && v.stop.key) + ')',
    v.open === true && v.mode === 'stop' && v.stop.key === 'whiterun' &&
    JSON.stringify(v).indexOf('cart-1') >= 0 && /"max":24/.test(JSON.stringify(v)));

// ----------------------------------------------------- B. load and drive --
v = cart(BRYNJA, 'load cart-1 f 0 10 ' + hex(ONUND));
yes('B1 coin is refused as cargo, and nothing leaves the pack (' + v.note + ')', /Coin is not cargo/.test(v.note) && w.count(BRYNJA, GOLD) === 100);
v = cart(BRYNJA, 'load cart-1 5ace4 0 10 ' + hex(ONUND));
const line1 = cart1().lines['1'];
yes('B2 she loads 10 iron for Onund: out of her pack and on the cart (' + v.note + ')',
    w.count(BRYNJA, IRON) === 30 && !!line1 && line1.aboard === 10 && line1.for.profile === 1001 && line1.by.profile === 1000);
w.activate(WCRATE, ONUND);
v = cart(ONUND, 'drive cart-1 riften');
yes('B3 Onund, with nothing of his own on it, cannot drive it (' + v.note + ')', /goods of their own/.test(v.note) && !cart1().sailing);
v = cart(BRYNJA, 'drive cart-1 riften');
const road = cart1().sailing;
yes('B4 Brynja drives it off to Riften, its road\'s 30 minutes the least it takes (' + v.note + ')',
    !!road && road.driver.profile === 1000 && road.arriveAt - road.at === 30 * MIN && /Riften stables/.test(v.note));
yes('B4 and she shows as driving, for Raid cart on P', w.box().__thornswoodTradeCarts.driving(BRYNJA, 1000) === true);

// ------------------------------------------------------------ C. the raid --
w.moveTo(BRYNJA, TAMRIEL, [90000, -50000, 0]);
w.moveTo(HROD, TAMRIEL, [90300, -50000, 0]);
v = cart(HROD, 'raid ' + hex(BRYNJA));
yes('C1 beside her on the road, Hrod\'s Raid cart opens the cart (' + JSON.stringify((v.lines || []).map(function (l) { return l.count; })) + ')',
    v.open === true && v.mode === 'raid' && v.cart === 'cart-1' && v.lines.length === 1 && v.lines[0].count === 10);
yes('C1 every piece, without whose it is', JSON.stringify(v.lines).indexOf('Onund') < 0);
let heardAt = w.heard(BRYNJA).length;
v = cart(HROD, 'take cart-1 1 3');
yes('C2 he takes 3: in his pack, and written down as taken by him', w.count(HROD, IRON) === 3 && onCart() === 7 &&
    cart1().outs[0].how === 'taken' && cart1().outs[0].who.profile === 1002);
yes('C2 and she is told somebody takes them, and not who (' + w.heardSince(BRYNJA, heardAt).join(' | ') + ')',
    w.heardSince(BRYNJA, heardAt).some(function (l) { return /^Somebody takes 3 .* from your cart\.$/.test(l); }) &&
    !w.heardSince(BRYNJA, heardAt).some(function (l) { return /Hrod/.test(l); }));
w.moveTo(HROD, TAMRIEL, [94000, -50000, 0]);
v = cart(HROD, 'take cart-1 1 1');
yes('C3 stepped away, he takes nothing more (' + (v.note || last(HROD)) + ')', /Get closer/.test(v.note || last(HROD)) && w.count(HROD, IRON) === 3);
w.say(BRYNJA, '/cart raid ' + hex(BRYNJA));
yes('C4 she cannot raid her own cart (' + last(BRYNJA) + ')', /your own cart/.test(last(BRYNJA)));
w.say(BRYNJA, '/cart raid ' + hex(ONUND));
yes('C4 and nobody raids somebody who drives none (' + last(BRYNJA) + ')', /not driving a cart/.test(last(BRYNJA)));

w.moveTo(HROD, TAMRIEL, [90300, -50000, 0]);
w.leave(BRYNJA);
v = cart(HROD, 'raid ' + hex(BRYNJA));
yes('C5 with her out of the world, standing where she was, her cart is not raided (' + (v.note || last(HROD)) + ')',
    /Get closer/.test(v.note || last(HROD)) && onCart() === 7);
w.arrive(BRYNJA);
w.run(30000);

// ------------------------------------------------------- D. a restart --
const r = w.restart();
yes('D1 the server restarts', r.loaded);
ALL.forEach(w.arrive);
w.run(30000);
yes('D1 the cart is still on the road, with her driving and the 7 left',
    !!cart1().sailing && cart1().sailing.driver.profile === 1000 && onCart() === 7 && w.box().__thornswoodTradeCarts.driving(BRYNJA, 1000) === true);

// --------------------------------------------------- E. in at Riften --
w.moveTo(BRYNJA, TAMRIEL, near(RIFTEN_AT, 60));
w.activate(RCRATE, BRYNJA);
v = view(BRYNJA);
const incoming = (v.incoming || [])[0] || {};
yes('E1 at Riften\'s crate early, the cart is on its way and not in (' + JSON.stringify(incoming) + ')',
    incoming.mine === true && incoming.dueIn > 0 && !incoming.canPullIn);
v = cart(BRYNJA, 'pullin cart-1');
yes('E1 and does not pull in, with the minutes left (' + v.note + ')', /more minute/.test(v.note) && !!cart1().sailing);
w.run(30 * MIN);
w.activate(RCRATE, BRYNJA);
v = cart(BRYNJA, 'pullin cart-1');
yes('E2 once the road is done she pulls it in (' + v.note + ')', cart1().sailing === null && cart1().port === 'riften' &&
    w.box().__thornswoodTradeCarts.driving(BRYNJA, 1000) === false);
w.moveTo(ONUND, TAMRIEL, near(RIFTEN_AT, 90));
w.activate(RCRATE, ONUND);
v = cart(ONUND, 'collect cart-1 1 7');
yes('E3 and Onund collects his 7 at Riften (' + v.note + ')', w.count(ONUND, IRON) === 7 && onCart() === 0 &&
    cart1().outs.some(function (o) { return o.how === 'delivered'; }));

// ------------------------------------------------------------- F. staff --
w.say(ONUND, '/cart add riften');
yes('F1 somebody who is not staff cannot put a cart anywhere (' + last(ONUND) + ')', !disk().cargo.holds['cart-2']);
w.say(SAM, '/cart staff');
v = cart(SAM, 'add riften');
yes('F2 staff put a cart at Riften', !!disk().cargo.holds['cart-2'] && disk().cargo.holds['cart-2'].port === 'riften');

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
