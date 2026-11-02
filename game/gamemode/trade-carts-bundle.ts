// TRADE CARTS BUNDLE BEGIN
// Built by scripts\dev\Build-TradeCargoGamemode.js out of game\trade-carts.js. Do not hand edit.
const TRADE_CARTS = (function () {
const module = { exports: {} };
'use strict';
/*
  TRADE CARTS: THE STOP, THE ROAD AND THE RAID (#3158).

  Patrick, 22 Oct 2026, on his report page (docs/DECIDED.md):
    - people drive the carts that move goods between holds;
    - a shipment is lost only when people raid it, never by chance.

  game\trade-cargo.js is the manifest, created driven: a "port" is a cart stop
  and a "route" a road, and a cart leaves only with a driver and comes in only
  with them (pullIn). This file is what a person meets, as views and as the
  words the panel sends back. It never touches the world: the trade carts
  block of gamemode.js hands it what the server knows and does what it says,
  the way game\trade-ship-dock.js serves the ships.

  THE STOP. A cart stop is a container already in the world that staff picked
  (its reference, the stop's crate), with no new plugin, as a ship's dock is.
  E on it opens the stop panel and never the container. Staff put carts at a
  stop. Anyone loads a cart standing there, for anyone in the world.

  THE ROAD. Whoever has loaded something on a cart may drive it to a stop a
  road leads to; nothing about who drives it, where or when is decided here.
  The cart then goes with its driver: it is on the road until the driver
  presses the far stop's crate. The road's minutes, staff data, are the least
  time a loaded cart takes, so a carriage ride or a teleport does not bring it
  in sooner; walking or riding the road takes what it takes. One person drives
  one cart at a time.

  THE RAID. While a cart is on the road, anyone close to its driver, with both
  in the world, may open it from Raid cart beside the driver under Near you on
  P and take what is aboard. The manifest records who took what; whether it
  was a robbery is roleplay, the rule ships have at a dock (#511). The driver
  cannot raid their own cart. Nothing is ever lost any other way: no chance,
  no clock, no weather.

  WHAT IT NEVER DECIDES. Prices, pay and contracts: a haul on the notice
  board (#1393) pays whoever carries goods, and a cart is how a lot of them
  go. Coin is not cargo, here as on a ship.
*/

var GOLD_BASE = 15;
var MINUTE = 60 * 1000;
var KEY_RE = /^[a-z0-9][a-z0-9:_.-]{0,63}$/;
var WORD = '/cart';
/* The words game\trade-ship-dock.js editDraft uses, for a cart stop and a road. */
var WORDS = { place: 'stop', crate: 'cart stop', route: 'road' };

function copy(v) { return JSON.parse(JSON.stringify(v)); }
function whole(n) { return Number.isInteger(n) && n > 0; }
function hex(n) { return (Number(n) >>> 0).toString(16); }
function same(a, b) { return !!a && !!b && a.actor === b.actor && a.profile === b.profile; }
function isCoin(baseId) { return (Number(baseId) >>> 0) === GOLD_BASE; }

function routeOf(routes, from, to) {
  var list = (routes && routes.routes) || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].from === from && list[i].to === to) { return list[i]; }
  }
  return null;
}
function stopOf(routes, key) {
  var list = (routes && routes.ports) || [];
  for (var i = 0; i < list.length; i++) { if (list[i].key === key) { return list[i]; } }
  return null;
}
function nameOfStop(routes, key) { var s = stopOf(routes, key); return s ? s.name : key; }

/* When a cart leaves and the soonest it can come in: now, and now plus its road's minutes. */
function road(routes, from, to, now) {
  var r = routeOf(routes, from, to);
  if (!r) { throw new Error('No road leads from here to there.'); }
  if (!Number.isInteger(now) || now < 0) { throw new Error('The time cannot be verified.'); }
  return { at: now, arriveAt: now + r.minutes * MINUTE };
}

/* The cart this character is driving, or ''. */
function cartOfDriver(state, me) {
  var holds = (state && state.holds) || {};
  var ids = Object.keys(holds).sort();
  for (var i = 0; i < ids.length; i++) {
    var s = holds[ids[i]] && holds[ids[i]].sailing;
    if (s && same(s.driver, me)) { return ids[i]; }
  }
  return '';
}

/* Whether this character has loaded something still aboard this cart, which is who may drive it. */
function hasLoaded(state, id, me) {
  var h = state && state.holds && state.holds[id];
  if (!h) { return false; }
  return Object.keys(h.lines).some(function (k) { return h.lines[k].aboard > 0 && same(h.lines[k].by, me); });
}

/*
  THE PANEL'S WORDS. Sent by game\ui\thornswood-ship.js and the P panel, never
  typed (Patrick, 4 Oct: no chat commands for what people do). Answers
  { verb, ... } or { why } for anything it does not know.

    /cart close
    /cart load <cart> <base hex> <nth> <count> <for actor hex>
    /cart drive <cart> <stop>
    /cart pullin <cart>
    /cart collect <cart> <line> <count>
    /cart return <cart> <line> <count>
    /cart raid <driver actor hex>          from Near you on P
    /cart take <cart> <line> <count>       in the raid
    /cart staff
    /cart draft <edit ...>                 see trade-ship-dock.js editDraft
    /cart confirm <base>
    /cart add <stop>                       a new cart at a stop, staff only
    /cart bring <cart>                     staff bring in a cart on the road
*/
function parse(parts) {
  var p = Array.isArray(parts) ? parts.map(function (x) { return String(x); }) : [];
  var verb = String(p[1] || '').toLowerCase();
  var n = function (s) { return /^[0-9]{1,9}$/.test(String(s)) ? Number(s) : NaN; };
  var h = function (s) { return /^[0-9a-f]{1,8}$/i.test(String(s)) ? parseInt(s, 16) >>> 0 : NaN; };
  var key = function (s) { return typeof s === 'string' && KEY_RE.test(s) ? s : ''; };
  if (verb === 'close' || verb === 'staff') { return { verb: verb }; }
  if (verb === 'load') {
    var l = { verb: 'load', cart: key(p[2]), base: h(p[3]), nth: n(p[4]), count: n(p[5]), forActor: h(p[6]) };
    if (!l.cart || !whole(l.base) || !Number.isInteger(l.nth) || !whole(l.count) || !whole(l.forActor)) { return { why: 'That load cannot be read.' }; }
    return l;
  }
  if (verb === 'drive') {
    var d = { verb: 'drive', cart: key(p[2]), to: key(p[3]) };
    return d.cart && d.to ? d : { why: 'That road cannot be read.' };
  }
  if (verb === 'pullin' || verb === 'bring') {
    var b = { verb: verb, cart: key(p[2]) };
    return b.cart ? b : { why: 'Say which cart.' };
  }
  if (verb === 'collect' || verb === 'return' || verb === 'take') {
    var c = { verb: verb, cart: key(p[2]), line: n(p[3]), count: n(p[4]) };
    return c.cart && whole(c.line) && whole(c.count) ? c : { why: 'That cannot be read.' };
  }
  if (verb === 'raid') {
    var r = { verb: 'raid', driver: h(p[2]) };
    return whole(r.driver) ? r : { why: 'Say whose cart.' };
  }
  if (verb === 'draft') { return { verb: 'draft', edit: p.slice(2) }; }
  if (verb === 'confirm') { return p[2] ? { verb: 'confirm', base: String(p[2]) } : { why: 'That confirm cannot be read.' }; }
  if (verb === 'add') {
    var a = { verb: 'add', stop: key(p[2]) };
    return a.stop ? a : { why: 'Say which stop.' };
  }
  return { why: 'The cart does not know that.' };
}

/*
  WHAT A PERSON SEES AT A CART STOP. input:
    reg       the carts' register (routes, ships, state)
    stop      the stop key of the crate pressed
    viewer    { actor, profile }, the character at the crate
    staff     true for staff, who see every line
    pack      [{ baseId, nth, count, name }], what they carry, coin left out by the caller
    people    [{ actor, profile, name }], who a load can be for, the viewer first
    nameOf    function (party) -> the name to show, or '' when it cannot be read
    itemName  function (entry) -> the name of a piece
    now       the time
  Lines are shown only to whoever they concern: the one they are for, the one
  who loaded them, and staff.
*/
function stopView(input) {
  var reg = input.reg, stop = stopOf(reg.routes, input.stop);
  if (!stop) { return { open: false }; }
  var me = input.viewer, max = reg.ships.MAX_LINES, now = input.now;
  var nameOf = input.nameOf || function () { return ''; };
  var itemName = input.itemName || function () { return 'Goods'; };
  var driving = cartOfDriver(reg.state, me);
  var carts = [], incoming = [];
  Object.keys(reg.state.holds).sort().forEach(function (id) {
    var h = reg.state.holds[id];
    if (h.sailing) {
      if (h.sailing.to === stop.key) {
        var mine = same(h.sailing.driver, me);
        var left = Math.max(0, Math.ceil((h.sailing.arriveAt - now) / MINUTE));
        incoming.push({ id: id, from: nameOfStop(reg.routes, h.sailing.from), dueIn: left,
                        mine: mine, canPullIn: mine && left === 0 });
      }
      return;
    }
    if (h.port !== stop.key) { return; }
    var lines = reg.ships.aboard(reg.state, id).map(function (l) {
      var line = h.lines[String(l.line)];
      var forMe = same(l.for, me), loaded = same(l.by, me);
      return {
        line: l.line, item: itemName(l.entry), count: l.entry.count,
        shown: forMe || loaded || input.staff === true,
        forName: l.for ? (forMe ? 'you' : (nameOf(l.for) || 'someone')) : 'nobody now',
        canCollect: forMe && line.from !== h.port,
        canReturn: loaded && line.from === h.port
      };
    });
    var used = reg.ships.used(reg.state, id);
    var others = lines.filter(function (l) { return !l.shown; }).length;
    var mayDrive = !driving && hasLoaded(reg.state, id, me);
    carts.push({
      id: id, used: used, max: max,
      lines: lines.filter(function (l) { return l.shown; }).map(function (l) { delete l.shown; return l; }),
      others: others,
      canLoad: used < max,
      drive: mayDrive ? reg.routes.routes.filter(function (r) { return r.from === stop.key; }).map(function (r) {
        return { to: r.to, name: nameOfStop(reg.routes, r.to), minutes: r.minutes };
      }) : []
    });
  });
  return {
    open: true, mode: 'stop', kind: 'cart', word: WORD,
    stop: { key: stop.key, name: stop.name },
    carts: carts, incoming: incoming,
    driving: driving ? { id: driving, to: nameOfStop(reg.routes, reg.state.holds[driving].sailing.to) } : null,
    pack: (input.pack || []).filter(function (p) { return !isCoin(p.baseId); }).map(function (p) {
      return { base: hex(p.baseId), nth: p.nth, count: p.count, name: p.name };
    }),
    people: (input.people || []).map(function (p) {
      return { actor: hex(p.actor), name: same(p, me) ? 'Yourself' : p.name };
    })
  };
}

/*
  WHAT A RAIDER SEES: every piece aboard the cart, with no name of whom it is
  for or who loaded it. Each line can be taken.
*/
function raidView(input) {
  var reg = input.reg, h = reg.state.holds[input.cart];
  if (!h || !h.sailing) { return { open: false }; }
  var itemName = input.itemName || function () { return 'Goods'; };
  return {
    open: true, mode: 'raid', kind: 'cart', word: WORD,
    cart: input.cart, driver: input.driverName || 'somebody',
    road: { from: nameOfStop(reg.routes, h.sailing.from), to: nameOfStop(reg.routes, h.sailing.to) },
    lines: reg.ships.aboard(reg.state, input.cart).map(function (l) {
      return { line: l.line, item: itemName(l.entry), count: l.entry.count };
    })
  };
}

/* The carts on the road, for the staff panel: where from and to, how long left, and whether a driver is still named. */
function onRoad(reg, now) {
  var out = [];
  Object.keys(reg.state.holds).sort().forEach(function (id) {
    var s = reg.state.holds[id].sailing;
    if (!s) { return; }
    out.push({ id: id, from: nameOfStop(reg.routes, s.from), to: nameOfStop(reg.routes, s.to),
               dueIn: Math.max(0, Math.ceil((s.arriveAt - now) / MINUTE)), driver: !!s.driver });
  });
  return out;
}

module.exports = {
  GOLD_BASE: GOLD_BASE, WORD: WORD, WORDS: copy(WORDS),
  isCoin: isCoin, road: road, cartOfDriver: cartOfDriver, hasLoaded: hasLoaded,
  parse: parse, stopView: stopView, raidView: raidView, onRoad: onRoad
};
return module.exports;
})();
// TRADE CARTS BUNDLE END
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined' ? globalThis : this);
  var fs = require('fs'), path = require('path');
  function clog() {
    var a = Array.prototype.slice.call(arguments);
    if (typeof log === 'function') { log.apply(null, ['[carts]'].concat(a)); } else { console.log('[thornswood] [carts] ' + a.join(' ')); }
  }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }

  var on = true;
  try { var settings = mp.getServerSettings(); on = !(settings && settings.thornswoodTradeCarts === false); } catch (e) { on = true; }

  // Where the register is: the privDir server-settings.json names, read the
  // way the ships block reads it (#2871), so a settings file that will not
  // read names no folder and nothing is guessed.
  var privDir = 'private';
  var settingsWhy = '';
  try {
    var cfg = JSON.parse(String(fs.readFileSync('server-settings.json', 'utf8')).replace(/^\uFEFF/, ''));
    if (cfg && cfg.privDir) { privDir = String(cfg.privDir); }
  } catch (e) { settingsWhy = String((e && (e.code || e.message)) || e); }
  var FILE = path.resolve(privDir, 'trade-carts.json');

  var unreadable = settingsWhy ? 'server-settings.json could not be read' : '';
  var reg = null;
  (function read() {
    if (unreadable) { return; }
    var t = null;
    try { t = fs.readFileSync(FILE, 'utf8'); }
    catch (e) { if (!e || e.code !== 'ENOENT') { unreadable = String((e && e.code) || e); } }
    if (unreadable) { return; }
    try { reg = TRADE_CARGO.openRegister(t, { driven: true }); }
    catch (e2) { unreadable = String((e2 && e2.message) || e2); reg = null; }
  })();
  if (settingsWhy) {
    clog('server-settings.json could not be read (' + settingsWhy + '), so where the carts\' register is is not known: the carts hold nothing at this start and nothing is written until it is put right');
  } else if (unreadable) {
    clog(FILE, 'could not be read (' + unreadable + '), so the carts hold nothing at this start and nothing is written over it until it is put right');
  }

  function commit(next) {
    if (unreadable || !reg) { return false; }
    try {
      var text = TRADE_CARGO.saveRegister(next);
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE + '.tmp', text);
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (e) {
      clog('could not write', FILE + ':', (e && e.message) || e);
      return false;
    }
    reg = next;
    return true;
  }

  function release(who) {
    var none = { loaders: 0, recipients: 0, receivers: 0, drivers: 0 };
    if (unreadable || !reg) { return { counts: none, saved: false }; }
    var next = { routes: reg.routes, ships: reg.ships, state: copy(reg.state) };
    var c = reg.ships.release(next.state, who);
    if (!c.loaders && !c.recipients && !c.receivers && !c.drivers) { return { counts: c, saved: true }; }
    return { counts: c, saved: commit(next) };
  }
  if (typeof g.__thornswoodRelease === 'function') { g.__thornswoodRelease('carts', release); }

  if (reg) {
    var n = TRADE_CARGO.countsOf(reg);
    clog('ready,', on ? 'on:' : 'off ("thornswoodTradeCarts": false in server-settings.json switches it off):',
         n.ports, 'stop(s),', n.routes, 'road(s),', n.holds, 'cart(s),', n.sailing, 'on the road,',
         n.aboard, 'piece(s) aboard,', n.pending, 'being handed out');
    if (n.pending) {
      clog(n.pending, 'piece(s) were being handed out when the server stopped; they stay counted on the manifest until each is finished or undone, and their cart cannot leave before');
    }
  }

  var H = g.__thornswoodCargoHands;
  if (on && reg && !H) {
    clog('the trade ships block did not hand over what goes between a pack and a manifest, so nobody meets a cart at this start');
  }
  if (on && reg && H) {
    var act = function (name) {
      return function () {
        var next = { routes: reg.routes, ships: reg.ships, state: copy(reg.state) };
        var r = reg.ships[name].apply(null, [next.state].concat(Array.prototype.slice.call(arguments)));
        if (!commit(next)) { throw new Error('The carts\' book could not be written, so nothing changed.'); }
        return r;
      };
    };

    /*
      The panel is the ships' (game\ui\thornswood-ship.js), told it is a cart
      by kind and word in the view; this property reaches it the way the
      ships' does.
    */
    var CART_VIEW_PROPERTY = 'thornswoodCartView';
    try {
      mp.makeProperty(CART_VIEW_PROPERTY, {
        isVisibleByOwner: true, isVisibleByNeighbors: false,
        updateOwner: [
          '(function(){',
          '  try {',
          '    var v = ctx.value;',
          '    if (!v || typeof v !== "object") { return; }',
          '    var st = ctx.state;',
          '    if (!st || st.thornswoodCartAt === v.at) { return; }',
          '    st.thornswoodCartAt = v.at;',
          '    var body = JSON.stringify(v);',
          '    ctx.sp.browser.executeJavaScript("(function(){try{var d=" + body + ";if(window.thornswoodShip&&window.thornswoodShip.setData){window.thornswoodShip.setData(d);}}catch(e){}})();");',
          '  } catch (e) { }',
          '})();'
        ].join('\n'),
        updateNeighbor: ''
      });
    } catch (eProp) { /* made by an earlier load, or no world here. harmless. */ }

    var SESSION_MS = 10 * 60 * 1000;   // a stop panel left open this long asks for the crate again
    var CRATE_MS = 60 * 1000;          // staff press a container, then the staff panel, within a minute
    var NEAR = 400;                    // the reach of a stop's crate, the same as a dock's
    var RAID_REACH = 700;              // how close a raider stands to the driver: a trade's 10 metres
    var sessions = {}, drafts = {}, crateSeen = {}, viewAt = 0, receiptN = 0;
    var RUN = (function () {
      try { if (typeof serverRunId === 'function') { return String(serverRunId()); } } catch (eRun) { }
      return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
    })();
    function receipt(kind) { return 'cart-' + kind + ':' + RUN + ':' + (++receiptN); }

    function hook(name, pid) {
      var f = g[name];
      try { return typeof f === 'function' && !!f(Number(pid) || 0); } catch (e) { return false; }
    }
    function online(actorId) {
      var list = [];
      try { list = mp.get(0, 'onlinePlayers') || []; } catch (e) { list = []; }
      return list.some(function (id) { return (Number(id) >>> 0) === (Number(actorId) >>> 0); });
    }
    function within(a, b, reach) {
      try {
        var cell = mp.get(a, 'worldOrCellDesc');
        if (typeof cell !== 'string' || !cell || cell !== mp.get(b, 'worldOrCellDesc')) { return false; }
        var p = mp.get(a, 'pos'), q = mp.get(b, 'pos');
        var dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
        return dx * dx + dy * dy + dz * dz <= reach * reach;
      } catch (e) { return false; }
    }
    function tell(actorId, text) {
      var t = g.__thornswoodToProfile;
      try { if (typeof t === 'function') { t(H.profileOf(actorId), text); } } catch (e) { }
    }

    function push(actorId, view) {
      viewAt = Math.max(Date.now(), viewAt + 1);
      view.at = viewAt;
      try { mp.set(actorId, CART_VIEW_PROPERTY, view); } catch (e) { }
      return view;
    }
    function shut(actorId) { sessions[actorId] = null; push(actorId, { open: false, kind: 'cart', word: TRADE_CARTS.WORD }); }
    function crateOf(actorId) {
      var c = crateSeen[actorId];
      return c && Date.now() - c.at <= CRATE_MS ? c : null;
    }
    function pushStop(actorId, profileId, said) {
      var v = TRADE_CARTS.stopView({
        reg: reg, stop: sessions[actorId].stop, viewer: H.partyOf(actorId), staff: hook('__thornswoodIsStaff', profileId),
        pack: H.list(actorId), people: H.people(actorId), nameOf: H.nameOf, itemName: H.itemName, now: Date.now()
      });
      v.note = said || '';
      return push(actorId, v);
    }
    function pushRaid(actorId, said) {
      var s = sessions[actorId];
      var v = TRADE_CARTS.raidView({ reg: reg, cart: s.cart, driverName: H.nameOf(H.partyOf(s.driver)), itemName: H.itemName });
      if (v.open) { v.note = said || ''; return push(actorId, v); }
      sessions[actorId] = null;
      if (said) { tell(actorId, said); }
      return push(actorId, { open: false, kind: 'cart', word: TRADE_CARTS.WORD });
    }
    function pushStaff(actorId, profileId, said) {
      var v = TRADE_DOCK.staffView(TRADE_CARGO, reg, drafts[profileId] || null, crateOf(actorId),
                                   { nameOf: H.nameOf, itemName: H.itemName });
      v.kind = 'cart';
      v.word = TRADE_CARTS.WORD;
      v.onRoad = TRADE_CARTS.onRoad(reg, Date.now());
      v.note = said || '';
      return push(actorId, v);
    }

    /* One piece of a line into one pack, through a receipt, the way a ship hands out. Answers the entry. */
    function handOut(actorId, cart, line, count, how) {
      var out = act('begin')(cart, line, count, how, H.partyOf(actorId), Date.now());
      try { H.give(actorId, out.entry); } catch (eGive) {
        act('undo')(cart, out.out);
        throw new Error('It could not be put in your pack, so it stays on the cart.');
      }
      try { act('finish')(cart, out.out, receipt('credit')); } catch (eFinish) {
        clog('handed', JSON.stringify(out.entry), 'from', cart, 'to', String((Number(actorId) >>> 0).toString(16)),
             'but could not mark it finished:', (eFinish && eFinish.message) || eFinish);
        throw new Error('It is in your pack, but the carts\' book could not be written. Say so in the dev channel.');
      }
      return out.entry;
    }

    function stopWord(w, actorId) {
      var stop = sessions[actorId].stop;
      var me = H.partyOf(actorId);
      var h = reg.state.holds[w.cart];
      if (!h) { throw new Error('There is no such cart.'); }
      if (w.verb === 'pullin') {
        if (!h.sailing || h.sailing.to !== stop) { throw new Error('That cart is not on its way here.'); }
        var left = Math.ceil((h.sailing.arriveAt - Date.now()) / 60000);
        if (left > 0 && TRADE_CARTS.cartOfDriver(reg.state, me) === w.cart) {
          throw new Error('A loaded cart takes longer on this road than you have been on it: it comes in here in ' + left + ' more minute(s).');
        }
        act('pullIn')(w.cart, Date.now(), me);
        clog('a cart came in at', stop);
        return 'The cart is in.';
      }
      if (h.sailing || h.port !== stop) { throw new Error('That cart is not at this stop.'); }
      if (w.verb === 'collect') { handOut(actorId, w.cart, w.line, w.count, 'delivered'); return 'Collected.'; }
      if (w.verb === 'return') { handOut(actorId, w.cart, w.line, w.count, 'returned'); return 'Taken back.'; }
      if (w.verb === 'drive') {
        var driving = TRADE_CARTS.cartOfDriver(reg.state, me);
        if (driving) { throw new Error('You are already driving a cart.'); }
        if (!TRADE_CARTS.hasLoaded(reg.state, w.cart, me)) { throw new Error('Only somebody with goods of their own on it drives a cart.'); }
        var t = TRADE_CARTS.road(reg.routes, stop, w.to, Date.now());
        act('depart')(w.cart, w.to, t.at, t.arriveAt, me);
        var to = reg.routes.ports.filter(function (p) { return p.key === w.to; })[0];
        clog('a cart left', stop, 'for', w.to);
        return 'You drive the cart off. Press the cart stop at ' + (to ? to.name : w.to) + ' when you get there; it comes in no sooner than ' +
          Math.round((t.arriveAt - t.at) / 60000) + ' minutes from now.';
      }
      // load: coin, a full cart and the recipient are refused before the pack is touched.
      if (TRADE_CARTS.isCoin(w.base)) { throw new Error('Coin is not cargo.'); }
      if (reg.ships.used(reg.state, w.cart) >= reg.ships.MAX_LINES) { throw new Error('The cart is full.'); }
      var forWho = null;
      H.people(actorId).forEach(function (p) { if (p.actor === w.forActor) { forWho = { actor: p.actor, profile: p.profile }; } });
      if (!forWho) { throw new Error('Who it is for has to be here, in the world.'); }
      var piece = H.take(actorId, w.base, w.nth, w.count);
      try {
        act('load')(w.cart, { by: me, for: forWho, receipt: receipt('debit'), entry: piece });
      } catch (eLoad) {
        try { H.give(actorId, piece); } catch (eBack) {
          clog('could not load', JSON.stringify(piece), 'for', String((Number(actorId) >>> 0).toString(16)),
               'and could not put it back in their pack:', (eBack && eBack.message) || eBack);
          throw new Error('It could not be loaded, and it could not be put back in your pack. Say so in the dev channel.');
        }
        throw eLoad;
      }
      return 'Loaded.';
    }

    /*
      THE RAID. The cart is with its driver, so the raider stands near the
      driver, both in the world, and the cart is still on the road with that
      driver. Every take asks all of it again.
    */
    function raidable(actorId, driverId) {
      var cart = TRADE_CARTS.cartOfDriver(reg.state, H.partyOf(driverId));
      if (!cart) { throw new Error('They are not driving a cart.'); }
      if ((Number(driverId) >>> 0) === (Number(actorId) >>> 0)) { throw new Error('You cannot raid your own cart.'); }
      if (!online(driverId) || !within(actorId, driverId, RAID_REACH)) { throw new Error('Get closer to the cart first.'); }
      return cart;
    }
    function raidWord(w, actorId) {
      var s = sessions[actorId];
      var cart = raidable(actorId, s.driver);
      if (cart !== s.cart) { throw new Error('That is not the cart you were at.'); }
      var entry = handOut(actorId, cart, w.line, w.count, 'taken');
      tell(s.driver, 'Somebody takes ' + entry.count + ' ' + H.itemName(entry) + ' from your cart.');
      clog('a cart on the road was raided');
      return 'Taken.';
    }

    function staffWord(w, actorId, profileId) {
      if (w.verb === 'draft') {
        drafts[profileId] = TRADE_DOCK.editDraft(TRADE_CARGO, reg.routes, drafts[profileId] || null, w.edit, crateOf(actorId), TRADE_CARTS.WORDS);
        return 'The draft changed. Nothing is in force until you confirm.';
      }
      if (w.verb === 'confirm') {
        if (w.base !== TRADE_DOCK.baseOf(reg.routes)) { throw new Error('The list in force changed since. Look again before you confirm.'); }
        if (!drafts[profileId]) { throw new Error('There is no draft to confirm.'); }
        if (!commit(TRADE_CARGO.adoptRoutes(reg, drafts[profileId]))) { throw new Error('The carts\' book could not be written, so nothing changed.'); }
        drafts[profileId] = null;
        var c = TRADE_CARGO.countsOf(reg);
        clog('staff confirmed the cart stops:', c.ports, 'stop(s),', c.routes, 'road(s)');
        return 'Confirmed. The new list is in force.';
      }
      if (w.verb === 'add') {
        if (!reg.routes.ports.some(function (p) { return p.key === w.stop; })) { throw new Error('No stop ' + w.stop + ' in force.'); }
        var k = 1;
        while (reg.state.holds['cart-' + k]) { k++; }
        act('open')('cart-' + k, w.stop);
        clog('staff put a cart at a stop:', Object.keys(reg.state.holds).length, 'cart(s) in all');
        return 'A cart is at the stop.';
      }
      if (w.verb === 'bring') {
        var h = reg.state.holds[w.cart];
        if (!h || !h.sailing) { throw new Error('That cart is not on the road.'); }
        act('pullIn')(w.cart, Date.now(), null);
        clog('staff brought a cart in at', h.sailing.to);
        return 'The cart is in at its stop.';
      }
      return '';
    }

    /* The panel's words (game\ui\thornswood-ship.js and Raid cart on P). Answers a line for the chat, or ''. */
    function command(parts, actorId, profileId) {
      var w = TRADE_CARTS.parse(parts);
      if (w.why) { return w.why; }
      var said = '';
      if (w.verb === 'close') { shut(actorId); return ''; }
      if (w.verb === 'staff' || w.verb === 'draft' || w.verb === 'confirm' || w.verb === 'add' || w.verb === 'bring') {
        if (!hook('__thornswoodIsStaff', profileId)) { return 'Only staff keep the cart stops and roads.'; }
        try { said = staffWord(w, actorId, profileId); } catch (eStaff) { said = String((eStaff && eStaff.message) || eStaff); }
        sessions[actorId] = { mode: 'staff', at: Date.now() };
        pushStaff(actorId, profileId, said);
        return '';
      }
      if (w.verb === 'raid') {
        var cart = '';
        try { cart = raidable(actorId, w.driver); } catch (eRaid) { return String((eRaid && eRaid.message) || eRaid); }
        sessions[actorId] = { mode: 'raid', cart: cart, driver: w.driver, at: Date.now() };
        pushRaid(actorId, '');
        return '';
      }
      var s = sessions[actorId];
      if (w.verb === 'take') {
        if (!s || s.mode !== 'raid' || Date.now() - s.at > SESSION_MS) { shut(actorId); return 'Open the cart from Raid cart beside its driver first.'; }
        s.at = Date.now();
        try { said = raidWord(w, actorId); } catch (eTake) { said = String((eTake && eTake.message) || eTake); }
        pushRaid(actorId, said);
        return '';
      }
      if (!s || s.mode !== 'stop' || Date.now() - s.at > SESSION_MS || !within(actorId, s.ref, NEAR)) {
        shut(actorId);
        return 'Stand at the cart stop and press its crate.';
      }
      s.at = Date.now();
      try { said = stopWord(w, actorId); } catch (eStop) { said = String((eStop && eStop.message) || eStop); }
      pushStop(actorId, profileId, said);
      return '';
    }

    /*
      E on anything (mp.onActivate), asked after the ships' dock. A stop's
      crate opens the stop and answers true, so the container never opens. Any
      other container a staff member opens is remembered for a minute, for the
      staff panel's stop and crate edits, and the press goes on.
    */
    function activated(refrId, actorId, baseDesc) {
      var desc = '';
      try { desc = mp.getDescFromId(refrId); } catch (e) { desc = ''; }
      var stop = TRADE_DOCK.portOfCrate(reg.routes, desc);
      var pid = H.profileOf(actorId);
      if (!stop) {
        if (desc && hook('__thornswoodIsStaff', pid) && typeof kindIsContainer === 'function' && kindIsContainer(baseDesc)) {
          try {
            crateSeen[actorId] = { desc: desc, world: mp.get(refrId, 'worldOrCellDesc'), pos: mp.get(refrId, 'pos').slice(0, 3), at: Date.now() };
          } catch (eSeen) { }
        }
        return false;
      }
      sessions[actorId] = { mode: 'stop', stop: stop, ref: refrId, at: Date.now() };
      pushStop(actorId, pid, '');
      return true;
    }

    g.__thornswoodTradeCarts = {
      counts: function () { return TRADE_CARGO.countsOf(reg); },
      routes: function () { return copy(reg.routes); },
      aboard: function (id) { return reg.ships.aboard(reg.state, id); },
      // Whether this character is driving a cart, for Raid cart under Near you on P.
      driving: function (actorId) { return !!TRADE_CARTS.cartOfDriver(reg.state, H.partyOf(actorId)); },
      open: act('open'), load: act('load'), depart: act('depart'), pullIn: act('pullIn'),
      begin: act('begin'), finish: act('finish'), undo: act('undo'),
      activated: activated, command: command
    };
  }
})();
// ==== end thornswood trade carts ====




