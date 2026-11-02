// TRADE DOCK BUNDLE BEGIN
// Built by scripts\dev\Build-TradeCargoGamemode.js out of game\trade-ship-dock.js. Do not hand edit.
const TRADE_DOCK = (function () {
const module = { exports: {} };
'use strict';
/*
  TRADE SHIPS: THE DOCK, THE STAFF PANEL AND THE CLOCK (#2700, split from #511).

  game\trade-cargo.js is the manifest and the staff list of ports and routes.
  This file is what a person meets in the world, as views and as the words the
  panel sends back, and it never touches the world itself: the trade ships
  block of gamemode.js hands it what the server knows and does what it says.

  PATRICK'S ANSWERS (18 Oct 2026, 11:30 AM MT, via Smeagle; #2700):
    1. Staff edit ports, routes and crews in an in-game staff panel.
    2. A ship at the dock is a crate, with no new plugin.
    3. Arrivals happen on their own.
    4. Coin cannot be cargo.
    5. One hold carries 24 lines.

  THE CRATE. A port's crate is a container already in the world that staff
  picked (its reference, port.crate in the staff list). E on it opens the dock
  panel and never the container, so what the engine keeps in it is never
  cargo and no record is added to any plugin. portOfCrate() answers which
  port a pressed reference is.

  THE STAFF PANEL. Staff edit a draft of the list in force (editDraft); an edit
  changes nothing in force. The server proposes (staffView, through
  trade-cargo's proposeRoutes: every change and every hold the draft would
  strand) and staff confirm. A confirm names the list it was proposed against
  (baseOf), and one made against a list that has changed since is refused.

  THE CLOCK. A voyage takes the minutes staff gave its route (voyage), so
  nothing here says how long anything takes. nextArrival() is the earliest
  arrival among the holds at sea, for the one timer the block keeps; the
  manifest's arrive() docks every hold that is due. Nobody confirms an
  arrival and nobody is told: people find out at the dock.

  COIN. isCoin() is the one test; the dock never offers gold out of a pack and
  a load of it is refused before the pack is touched. trade-cargo refuses it
  again.

  THE CHARTER (#512). Loading and sailing are a charter; charterOf() is the one
  place it is asked, through the Trading Company's mayCharter(who, terms)
  (game\trading-company.js, #2687). who is { company, staff }: the Trading
  Company role and an admin. Collecting what was shipped to you, or taking
  back your own where you loaded it, is not a charter. With no company rule
  running, nobody charters, and the panel says why.

  TAKING (Patrick, 22 Oct 2026, 12:28 AM, #511: A). Anyone who opens a docked
  hold sees what is aboard and can take from it. The manifest writes it as
  taken, with their character, and staff see it in their panel (takenOf).
  Whether it was a robbery or a seizure is roleplay; this file never says.
  A hold at sea is not at any dock, so nobody can open it.

  WHAT NOBODY COLLECTS (the same answer, B). Cargo still aboard the staff
  list's uncollectedDays after landing goes into that port's hold drop box
  under the recipient's name, and the hold's lines are free again.
  trade-cargo's uncollected() says what is due; the block moves it.

  WHAT IT NEVER DECIDES. Who sails, where, when or for how long: those are the
  players' RP (Patrick, 17 Oct 2026, 10:13 PM MT). Ports, routes, minutes,
  crews and the days cargo waits are staff data.
*/

var GOLD_BASE = 15;
var MINUTE = 60 * 1000;
var DAY = 24 * 60 * MINUTE;
var TAKEN_SHOWN = 20;
var KEY_RE = /^[a-z0-9][a-z0-9:_.-]{0,63}$/;
var HOLD_KEYS = ['whiterun', 'solitude', 'riften', 'markarth', 'windhelm', 'falkreath',
  'morthal', 'dawnstar', 'winterhold', 'ravenrock'];
var NO_CHARTER = 'The Trading Company\'s charter rule is not running on this server yet, so nobody can load or sail a ship.';
var BAD_TERMS = 'The Trading Company\'s terms could not be read, so nobody can load or sail a ship until staff put them right.';
var NOT_CHARTERED = 'Only those the Trading Company charters may load or sail a ship.';

function copy(v) { return JSON.parse(JSON.stringify(v)); }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function whole(n) { return Number.isInteger(n) && n > 0; }
function hex(n) { return (Number(n) >>> 0).toString(16); }
function same(a, b) { return !!a && !!b && a.actor === b.actor && a.profile === b.profile; }

function isCoin(baseId) { return (Number(baseId) >>> 0) === GOLD_BASE; }

/* A short, stable name for the list in force, so a confirm says what it was proposed against. */
function baseOf(routes) {
  var s = JSON.stringify(routes), h = 5381;
  for (var i = 0; i < s.length; i++) { h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; }
  return h.toString(36) + '.' + s.length.toString(36);
}

function routeOf(routes, from, to) {
  var list = (routes && routes.routes) || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].from === from && list[i].to === to) { return list[i]; }
  }
  return null;
}
function portOf(routes, key) {
  var list = (routes && routes.ports) || [];
  for (var i = 0; i < list.length; i++) { if (list[i].key === key) { return list[i]; } }
  return null;
}

/* The port whose crate this reference is, or ''. */
function portOfCrate(routes, desc) {
  if (typeof desc !== 'string' || !desc) { return ''; }
  var d = desc.toLowerCase();
  var list = (routes && routes.ports) || [];
  for (var i = 0; i < list.length; i++) {
    if (typeof list[i].crate === 'string' && list[i].crate.toLowerCase() === d) { return list[i].key; }
  }
  return '';
}

/* When a voyage leaves and arrives: now, and now plus its route's minutes. */
function voyage(routes, from, to, now) {
  var r = routeOf(routes, from, to);
  if (!r) { throw new Error('No ship sails from here to there.'); }
  if (!Number.isInteger(now) || now < 0) { throw new Error('The time cannot be verified.'); }
  return { at: now, arriveAt: now + r.minutes * MINUTE };
}

/* The earliest arrival among the holds at sea, or null when none is. */
function nextArrival(state) {
  var next = null;
  var holds = (state && state.holds) || {};
  Object.keys(holds).forEach(function (id) {
    var s = holds[id] && holds[id].sailing;
    if (s && Number.isInteger(s.arriveAt) && (next === null || s.arriveAt < next)) { next = s.arriveAt; }
  });
  return next;
}

/* How long cargo waits aboard after landing, from the list in force. */
function waitOf(routes) {
  var d = routes && Number.isInteger(routes.uncollectedDays) ? routes.uncollectedDays : 7;
  return d * DAY;
}

/*
  THE CHARTER, ASKED IN ONE PLACE. tc is what the Trading Company publishes:
  { mayCharter(who, terms), terms() } (#2687). Answers { may, why }.
*/
function charterOf(tc, who) {
  if (!tc || typeof tc.mayCharter !== 'function') { return { may: false, why: NO_CHARTER }; }
  var w = { company: !!(who && who.company === true), staff: !!(who && who.staff === true) };
  var may = false;
  try {
    var terms = typeof tc.terms === 'function' ? tc.terms() : tc.terms;
    may = tc.mayCharter(w, terms) === true;
  } catch (e) {
    return { may: false, why: BAD_TERMS };
  }
  return may ? { may: true, why: '' } : { may: false, why: NOT_CHARTERED };
}

/*
  THE PANEL'S WORDS. Sent by game\ui\thornswood-ship.js, never typed (Patrick,
  4 Oct: no chat commands for what people do). Answers { verb, ... } or
  { why } for anything it does not know.

    /ship close
    /ship load <hold> <base hex> <nth> <count> <for actor hex>
    /ship sail <hold> <port>
    /ship collect <hold> <line> <count>
    /ship return <hold> <line> <count>
    /ship take <hold> <line> <count>  anyone at a docked hold, written as taken
    /ship staff
    /ship draft <edit ...>           see editDraft
    /ship confirm <base>
    /ship add <port>                 a new hold (ship) at a port, staff only
*/
function parse(parts) {
  var p = Array.isArray(parts) ? parts.map(function (x) { return String(x); }) : [];
  var verb = String(p[1] || '').toLowerCase();
  var n = function (s) { return /^[0-9]{1,9}$/.test(String(s)) ? Number(s) : NaN; };
  var h = function (s) { return /^[0-9a-f]{1,8}$/i.test(String(s)) ? parseInt(s, 16) >>> 0 : NaN; };
  var key = function (s) { return typeof s === 'string' && KEY_RE.test(s) ? s : ''; };
  if (verb === 'close' || verb === 'staff') { return { verb: verb }; }
  if (verb === 'load') {
    var l = { verb: 'load', hold: key(p[2]), base: h(p[3]), nth: n(p[4]), count: n(p[5]), forActor: h(p[6]) };
    if (!l.hold || !whole(l.base) || !Number.isInteger(l.nth) || !whole(l.count) || !whole(l.forActor)) { return { why: 'That load cannot be read.' }; }
    return l;
  }
  if (verb === 'sail') {
    var s = { verb: 'sail', hold: key(p[2]), to: key(p[3]) };
    return s.hold && s.to ? s : { why: 'That voyage cannot be read.' };
  }
  if (verb === 'collect' || verb === 'return' || verb === 'take') {
    var c = { verb: verb, hold: key(p[2]), line: n(p[3]), count: n(p[4]) };
    return c.hold && whole(c.line) && whole(c.count) ? c : { why: 'That cannot be read.' };
  }
  if (verb === 'draft') { return { verb: 'draft', edit: p.slice(2) }; }
  if (verb === 'confirm') { return p[2] ? { verb: 'confirm', base: String(p[2]) } : { why: 'That confirm cannot be read.' }; }
  if (verb === 'add') {
    var a = { verb: 'add', port: key(p[2]) };
    return a.port ? a : { why: 'Say which port.' };
  }
  return { why: 'The ship does not know that.' };
}

/*
  A STAFF EDIT TO THE DRAFT. Answers the next draft, checked whole by
  trade-cargo's checkRoutes, or throws what is wrong. crate is the container
  this staff member opened in the last minute, { desc, world, pos }, or null.

    port <key> <hold> <name ...>     a port at that crate
    crate <key>                      that port's crate is now the one opened
    unport <key>                     the port off the list
    route <from> <to> <minutes>      a one way route, or its new minutes
    unroute <from> <to>              the route off the list
    crew <from> <to> <ref ...>       the route's crew references; none is no crew
    days <n>                         real days cargo waits aboard before the drop box (ships only)
    reset                            the draft back to the list in force

  words names the places for what staff read, { place, crate, route }: a
  port, a dock and a route when left out; a stop, a cart stop and a road for
  the carts (#3158, game\trade-carts.js WORDS).
*/
function editDraft(cargo, inForce, draft, edit, crate, words) {
  var w = words || { place: 'port', crate: 'dock', route: 'route' };
  var d = copy(draft || inForce);
  var e = Array.isArray(edit) ? edit.map(String) : [];
  var op = (e[0] || '').toLowerCase();
  function needCrate() {
    if (!isObj(crate) || typeof crate.desc !== 'string' || typeof crate.world !== 'string' || !Array.isArray(crate.pos)) {
      throw new Error('Open the crate first, then press this within a minute.');
    }
    if (!/^[0-9a-f]{1,8}:[^:\s][^:]{0,95}$/i.test(crate.desc)) {
      throw new Error('That container is not one of the world\'s own, so it cannot be a ' + w.crate + '.');
    }
    var taken = portOfCrate(d, crate.desc);
    if (taken) { throw new Error('That crate is already the ' + w.crate + ' of ' + taken + '.'); }
    return crate;
  }
  if (op === 'reset') { return cargo.checkRoutes(inForce); }
  if (op === 'port') {
    var c = needCrate();
    if (!e[1] || portOf(d, e[1])) { throw new Error('A ' + w.place + ' needs a new plain name.'); }
    if (HOLD_KEYS.indexOf(e[2]) < 0) { throw new Error('A ' + w.place + ' is in one of the holds.'); }
    var name = e.slice(3).join(' ').trim();
    d.ports.push({ key: e[1], name: name, hold: e[2], world: c.world, pos: c.pos.slice(0, 3), crate: c.desc });
  } else if (op === 'crate') {
    var c2 = needCrate();
    var pc = portOf(d, e[1]);
    if (!pc) { throw new Error('No ' + w.place + ' ' + e[1] + ' in the draft.'); }
    pc.crate = c2.desc; pc.world = c2.world; pc.pos = c2.pos.slice(0, 3);
  } else if (op === 'unport') {
    if (!portOf(d, e[1])) { throw new Error('No ' + w.place + ' ' + e[1] + ' in the draft.'); }
    d.ports = d.ports.filter(function (p) { return p.key !== e[1]; });
    d.routes = d.routes.filter(function (r) { return r.from !== e[1] && r.to !== e[1]; });
  } else if (op === 'route') {
    var m = /^[0-9]{1,6}$/.test(e[3] || '') ? Number(e[3]) : NaN;
    var r = routeOf(d, e[1], e[2]);
    if (r) { r.minutes = m; } else { d.routes.push({ from: e[1], to: e[2], minutes: m, crew: [] }); }
  } else if (op === 'unroute') {
    if (!routeOf(d, e[1], e[2])) { throw new Error('No ' + w.route + ' from ' + e[1] + ' to ' + e[2] + ' in the draft.'); }
    d.routes = d.routes.filter(function (x) { return !(x.from === e[1] && x.to === e[2]); });
  } else if (op === 'crew') {
    var rc = routeOf(d, e[1], e[2]);
    if (!rc) { throw new Error('No ' + w.route + ' from ' + e[1] + ' to ' + e[2] + ' in the draft.'); }
    rc.crew = e.slice(3);
  } else if (op === 'days' && !words) {
    d.uncollectedDays = /^[0-9]{1,3}$/.test(e[1] || '') ? Number(e[1]) : NaN;
  } else {
    throw new Error('The staff panel does not know that edit.');
  }
  return cargo.checkRoutes(d);
}

/*
  WHAT WAS TAKEN, newest first, for staff: the hold, the piece, how many, the
  character who took it and when. names is { nameOf(party), itemName(entry) }.
*/
function takenOf(reg, names) {
  var nameOf = (names && names.nameOf) || function () { return ''; };
  var itemName = (names && names.itemName) || function () { return 'Goods'; };
  var all = [];
  Object.keys(reg.state.holds).forEach(function (id) {
    var h = reg.state.holds[id];
    h.outs.forEach(function (o) {
      if (o.how !== 'taken' || o.receipt === null) { return; }
      var l = h.lines[String(o.line)];
      all.push({ hold: id, item: l ? itemName(l.entry) : 'Goods', count: o.count,
                 by: o.who ? (nameOf(o.who) || 'someone') : 'nobody now', at: o.at, seq: o.seq });
    });
  });
  all.sort(function (a, b) { return b.seq - a.seq; });
  return all.slice(0, TAKEN_SHOWN).map(function (t) { delete t.seq; return t; });
}

/*
  WHAT STAFF SEE: the list in force, the draft, the server's proposal of
  what confirming the draft would do, and what was taken lately, by
  character name (Patrick's A: staff see it).
*/
function staffView(cargo, reg, draft, crate, names) {
  var d = draft || reg.routes;
  var p = cargo.proposeRoutes(reg.routes, d, reg.state);
  var c = cargo.countsOf(reg);
  var holdsAt = {};
  Object.keys(reg.state.holds).sort().forEach(function (id) {
    var h = reg.state.holds[id];
    (holdsAt[h.port] = holdsAt[h.port] || []).push({ id: id, sailing: !!h.sailing });
  });
  return {
    open: true, mode: 'staff',
    base: baseOf(reg.routes),
    counts: c,
    holdKeys: HOLD_KEYS.slice(),
    inForce: { ports: reg.routes.ports.map(function (x) { return { key: x.key, name: x.name, hold: x.hold, crate: !!x.crate, ships: holdsAt[x.key] || [] }; }),
               routes: reg.routes.routes.map(function (r) { return { from: r.from, to: r.to, minutes: r.minutes, crew: r.crew.length }; }),
               days: reg.routes.uncollectedDays },
    draft: { ports: d.ports.map(function (x) { return { key: x.key, name: x.name, hold: x.hold, crate: !!x.crate }; }),
             routes: d.routes.map(function (r) { return { from: r.from, to: r.to, minutes: r.minutes, crew: r.crew.length }; }),
             days: d.uncollectedDays },
    taken: takenOf(reg, names),
    changes: p.changes.slice(), strands: p.strands.slice(),
    canConfirm: p.changes.length > 0 && p.strands.length === 0,
    crate: crate ? { here: true, dockOf: portOfCrate(d, crate.desc) || null } : null
  };
}

/*
  WHAT A PERSON SEES AT A DOCK. input:
    reg       the register (routes, ships, state)
    port      the port key of the crate pressed
    viewer    { actor, profile }, the character at the crate
    charter   charterOf()'s answer for them
    pack      [{ baseId, nth, count, name }], what they carry, coin left out by the caller
    people    [{ actor, profile, name }], who a load can be for, the viewer first
    nameOf    function (party) -> the name to show, or '' when it cannot be read
    itemName  function (entry) -> the name of a piece
    now       the time
  Everything aboard a docked hold is shown to whoever opened it, because
  anyone there can take it (Patrick's A). Who a line is for is shown only to
  whoever it concerns: the one it is for, the one who loaded it, and staff
  (input.staff). Anybody else reads someone else.
*/
function dockView(input) {
  var reg = input.reg, port = portOf(reg.routes, input.port);
  if (!port) { return { open: false }; }
  var me = input.viewer, max = reg.ships.MAX_LINES, now = input.now;
  var nameOf = input.nameOf || function () { return ''; };
  var itemName = input.itemName || function () { return 'Goods'; };
  var holds = [], incoming = [];
  Object.keys(reg.state.holds).sort().forEach(function (id) {
    var h = reg.state.holds[id];
    if (h.sailing) {
      if (h.sailing.to === port.key) {
        var from = portOf(reg.routes, h.sailing.from);
        incoming.push({ id: id, from: from ? from.name : h.sailing.from,
                        dueIn: Math.max(0, Math.ceil((h.sailing.arriveAt - now) / MINUTE)) });
      }
      return;
    }
    if (h.port !== port.key) { return; }
    var lines = reg.ships.aboard(reg.state, id).map(function (l) {
      var line = reg.state.holds[id].lines[String(l.line)];
      var mine = same(l.for, me), loaded = same(l.by, me);
      var concerns = mine || loaded || input.staff === true;
      var canCollect = mine && line.from !== h.port, canReturn = loaded && line.from === h.port;
      return {
        line: l.line, item: itemName(l.entry), count: l.entry.count,
        forName: !l.for ? 'nobody now' : (mine ? 'you' : (concerns ? (nameOf(l.for) || 'someone') : 'someone else')),
        canCollect: canCollect,
        canReturn: canReturn,
        canTake: !canCollect && !canReturn
      };
    });
    var used = reg.ships.used(reg.state, id);
    holds.push({
      id: id, used: used, max: max,
      lines: lines,
      canLoad: input.charter.may && used < max,
      sail: input.charter.may ? reg.routes.routes.filter(function (r) { return r.from === port.key; }).map(function (r) {
        var to = portOf(reg.routes, r.to);
        return { to: r.to, name: to ? to.name : r.to, minutes: r.minutes };
      }) : []
    });
  });
  return {
    open: true, mode: 'dock',
    port: { key: port.key, name: port.name },
    holds: holds, incoming: incoming,
    charter: { may: input.charter.may, why: input.charter.why },
    pack: input.charter.may ? (input.pack || []).filter(function (p) { return !isCoin(p.baseId); }).map(function (p) {
      return { base: hex(p.baseId), nth: p.nth, count: p.count, name: p.name };
    }) : [],
    people: input.charter.may ? (input.people || []).map(function (p) {
      return { actor: hex(p.actor), name: same(p, me) ? 'Yourself' : p.name };
    }) : []
  };
}

module.exports = {
  GOLD_BASE: GOLD_BASE, HOLD_KEYS: HOLD_KEYS,
  isCoin: isCoin, baseOf: baseOf, portOfCrate: portOfCrate, voyage: voyage, nextArrival: nextArrival,
  waitOf: waitOf, takenOf: takenOf,
  charterOf: charterOf, parse: parse, editDraft: editDraft, staffView: staffView, dockView: dockView
};
return module.exports;
})();
// TRADE DOCK BUNDLE END
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined' ? globalThis : this);
  var fs = require('fs'), path = require('path');
  function slog() {
    var a = Array.prototype.slice.call(arguments);
    if (typeof log === 'function') { log.apply(null, ['[ships]'].concat(a)); } else { console.log('[thornswood] [ships] ' + a.join(' ')); }
  }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }

  var on = false;
  try { var settings = mp.getServerSettings(); on = !!settings && settings.thornswoodTradeShips === true; } catch (e) { on = false; }

  // The privDir server-settings.json names, or private when it names none.
  // A settings file that will not read or parse names no folder (#2871): the
  // manifest is not looked for in one guessed for it, where a missing file
  // would open an empty one and the next write would start a second manifest.
  // It is said, and the ships hold nothing until it is put right.
  var privDir = 'private';
  var settingsWhy = '';
  try {
    var cfg = JSON.parse(String(fs.readFileSync('server-settings.json', 'utf8')).replace(/^\uFEFF/, ''));
    if (cfg && cfg.privDir) { privDir = String(cfg.privDir); }
  } catch (e) { settingsWhy = String((e && (e.code || e.message)) || e); }
  // Resolved once, at load, against the server's own folder.
  var FILE = path.resolve(privDir, 'trade-cargo.json');

  var unreadable = settingsWhy ? 'server-settings.json could not be read' : '';
  var reg = null;
  (function read() {
    if (unreadable) { return; }
    var t = null;
    try { t = fs.readFileSync(FILE, 'utf8'); }
    catch (e) { if (!e || e.code !== 'ENOENT') { unreadable = String((e && e.code) || e); } }
    if (unreadable) { return; }
    try { reg = TRADE_CARGO.openRegister(t); }
    catch (e2) { unreadable = String((e2 && e2.message) || e2); reg = null; }
  })();
  if (settingsWhy) {
    slog('server-settings.json could not be read (' + settingsWhy + '), so where the manifest is is not known: the ships hold nothing at this start and nothing is written until it is put right');
  } else if (unreadable) {
    slog(FILE, 'could not be read (' + unreadable + '), so the ships hold nothing at this start and nothing is written over it until it is put right');
  }

  function commit(next) {
    if (unreadable || !reg) { return false; }
    try {
      var text = TRADE_CARGO.saveRegister(next);
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE + '.tmp', text);
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (e) {
      slog('could not write', FILE + ':', (e && e.message) || e);
      return false;
    }
    reg = next;
    return true;
  }

  function release(who) {
    var none = { loaders: 0, recipients: 0, receivers: 0 };
    if (unreadable || !reg) { return { counts: none, saved: false }; }
    var next = { routes: reg.routes, ships: reg.ships, state: copy(reg.state) };
    var c = reg.ships.release(next.state, who);
    if (!c.loaders && !c.recipients && !c.receivers) { return { counts: c, saved: true }; }
    return { counts: c, saved: commit(next) };
  }
  if (typeof g.__thornswoodRelease === 'function') { g.__thornswoodRelease('cargo', release); }

  if (reg) {
    var n = TRADE_CARGO.countsOf(reg);
    slog('ready,', on ? 'on:' : 'off ("thornswoodTradeShips": true in server-settings.json switches it on):',
         n.ports, 'port(s),', n.routes, 'route(s),', n.holds, 'hold(s),', n.sailing, 'at sea,',
         n.aboard, 'piece(s) aboard,', n.pending, 'being handed out');
    if (n.pending) {
      slog(n.pending, 'piece(s) were being handed out when the server stopped; they stay counted on the manifest until each is finished or undone, and their hold cannot sail before');
    }
  }

  /*
    WHAT GOES BETWEEN A PACK AND A MANIFEST, kept here once for the ships and
    for the carts block below (#3158), which hands goods the same way: who a
    character is on a manifest, the names shown, what a pack offers, the
    debit out of it, the credit into it, and who a load can be for. Published
    as __thornswoodCargoHands whether or not the ships are on, because the
    carts have their own switch.
  */
  function profileOf(actorId) {
    try { return Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { return 0; }
  }
  function partyOf(actorId) { return { actor: Number(actorId) >>> 0, profile: profileOf(actorId) }; }
  function nameOf(p) {
    try { var ap = mp.get(p.actor, 'appearance'); return ap && ap.name ? String(ap.name) : ''; } catch (e) { return ''; }
  }
  function itemName(entry) {
    var prop = g.__thornswoodProperty;
    try { if (prop && typeof prop.itemName === 'function') { return String(prop.itemName(entry)); } } catch (e) { }
    return entry && typeof entry.name === 'string' && entry.name ? entry.name : 'Goods';
  }

  /* What they carry, coin left out: [{ baseId, nth, count, name }]. nth is which stack of that base. */
  function packList(actorId) {
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return []; }
    var nth = {}, out = [];
    ((inv && inv.entries) || []).forEach(function (e) {
      if (!e || !Number.isInteger(e.baseId) || !(e.count > 0)) { return; }
      var k = nth[e.baseId] = (nth[e.baseId] === undefined ? 0 : nth[e.baseId] + 1);
      if (TRADE_DOCK.isCoin(e.baseId) || questItemBlocked(e.baseId)) { return; }
      out.push({ baseId: e.baseId, nth: k, count: e.count, name: itemName(e) });
    });
    return out.slice(0, 200);
  }

  /* The debit: n of that stack out of the pack, every other field kept. Coin is refused before the pack is read. */
  function packTake(actorId, base, nthOf, n) {
    if(questItemBlocked(base))throw new Error('Quest items stay with their assigned work.');
    if (TRADE_DOCK.isCoin(base)) { throw new Error('Coin is not cargo.'); }
    var inv = mp.get(actorId, 'inventory');
    var entries = copy((inv && inv.entries) || []);
    var seen = -1, at = -1;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i].baseId === base && ++seen === nthOf) { at = i; break; }
    }
    if (at < 0 || !(entries[at].count >= n)) { throw new Error('You do not carry that many.'); }
    var piece = copy(entries[at]);
    piece.count = n;
    entries[at].count -= n;
    if (entries[at].count <= 0) { entries.splice(at, 1); }
    mp.set(actorId, 'inventory', { entries: entries });
    return piece;
  }

  /* The credit: a piece the manifest handed out, onto the stack it matches or as its own. */
  function packGive(actorId, entry) {
    if(questItemBlocked(entry.baseId))throw new Error('Quest items cannot be cargo.');
    var inv = mp.get(actorId, 'inventory');
    var entries = copy((inv && inv.entries) || []);
    var shape = function (e) { var c = copy(e); delete c.count; return JSON.stringify(c); };
    var want = shape(entry), done = false;
    for (var i = 0; i < entries.length && !done; i++) {
      if (entries[i] && shape(entries[i]) === want) { entries[i].count += entry.count; done = true; }
    }
    if (!done) { entries.push(copy(entry)); }
    mp.set(actorId, 'inventory', { entries: entries });
  }

  function people(actorId) {
    var me = partyOf(actorId), out = [me], online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    online.forEach(function (id) {
      if ((Number(id) >>> 0) === me.actor || out.length >= 60) { return; }
      var p = partyOf(id), nm = nameOf(p);
      if (nm) { p.name = nm; out.push(p); }
    });
    return out;
  }

  g.__thornswoodCargoHands = {
    profileOf: profileOf, partyOf: partyOf, nameOf: nameOf, itemName: itemName,
    list: packList, take: packTake, give: packGive, people: people
  };

  if (on && reg) {
    var act = function (name) {
      return function () {
        var next = { routes: reg.routes, ships: reg.ships, state: copy(reg.state) };
        var r = reg.ships[name].apply(null, [next.state].concat(Array.prototype.slice.call(arguments)));
        if (!commit(next)) { throw new Error('The ship register could not be written, so nothing changed.'); }
        // Every write that went through sets the clock again: a departure or an
        // amended voyage moves the next arrival, a hold whose docking could
        // not be written (arriveNow) docks now that the register writes again,
        // and a line that could not go into the drop box (uncollectedNow) is
        // looked at again. The sweep's own writes do not count.
        if (!sweeping) { sweptAt = -1; }
        schedule();
        return r;
      };
    };

    /*
      THE DOCK, THE STAFF PANEL AND THE CLOCK (#2700). game\trade-ship-dock.js
      is the views and the panel's words; this is the world's side of them.
      Patrick, 18 Oct 2026, 11:30 AM MT (via Smeagle): an in-game staff panel,
      a crate at the dock with no new plugin, arrivals on their own, no coin
      as cargo, 24 lines a hold.
    */
    var SHIP_VIEW_PROPERTY = 'thornswoodShipView';
    try {
      mp.makeProperty(SHIP_VIEW_PROPERTY, {
        isVisibleByOwner: true, isVisibleByNeighbors: false,
        updateOwner: [
          '(function(){',
          '  try {',
          '    var v = ctx.value;',
          '    if (!v || typeof v !== "object") { return; }',
          '    var st = ctx.state;',
          '    if (!st || st.thornswoodShipAt === v.at) { return; }',
          '    st.thornswoodShipAt = v.at;',
          '    var body = JSON.stringify(v);',
          '    ctx.sp.browser.executeJavaScript("(function(){try{var d=" + body + ";if(window.thornswoodShip&&window.thornswoodShip.setData){window.thornswoodShip.setData(d);}}catch(e){}})();");',
          '  } catch (e) { }',
          '})();'
        ].join('\n'),
        updateNeighbor: ''
      });
    } catch (eProp) { /* made by an earlier load, or no world here. harmless. */ }

    var SESSION_MS = 10 * 60 * 1000;   // a dock panel left open this long asks for the crate again
    var CRATE_MS = 60 * 1000;          // staff press a container, then the staff panel, within a minute
    var NEAR = 400;                    // the reach of a dock crate, the same as a hold's box
    var sessions = {}, drafts = {}, crateSeen = {}, viewAt = 0, receiptN = 0, timer = null;
    var RUN = (function () {
      try { if (typeof serverRunId === 'function') { return String(serverRunId()); } } catch (eRun) { }
      return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
    })();
    function receipt(kind) { return kind + ':' + RUN + ':' + (++receiptN); }

    function hook(name, pid) {
      var f = g[name];
      try { return typeof f === 'function' && !!f(Number(pid) || 0); } catch (e) { return false; }
    }

    /*
      THE ONE CHARTER SPOT (#512, #2687). The Trading Company publishes
      globalThis.__thornswoodCompany, whose mayCharter(who) and terms() read the terms in force;
      who is the Trading Company role and an admin, the same two inCompany reads.
    */
    function charter(profileId) {
      return TRADE_DOCK.charterOf(g.__thornswoodCompany, {
        company: hook('__thornswoodIsCompany', profileId),
        staff: hook('__thornswoodIsAdmin', profileId)
      });
    }

    function near(actorId, refrId) {
      try {
        var cell = mp.get(actorId, 'worldOrCellDesc');
        if (typeof cell !== 'string' || !cell || cell !== mp.get(refrId, 'worldOrCellDesc')) { return false; }
        var a = mp.get(actorId, 'pos'), b = mp.get(refrId, 'pos');
        var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
        return dx * dx + dy * dy + dz * dz <= NEAR * NEAR;
      } catch (e) { return false; }
    }


    function push(actorId, view) {
      viewAt = Math.max(Date.now(), viewAt + 1);
      view.at = viewAt;
      try { mp.set(actorId, SHIP_VIEW_PROPERTY, view); } catch (e) { }
      return view;
    }
    function crateOf(actorId) {
      var c = crateSeen[actorId];
      return c && Date.now() - c.at <= CRATE_MS ? c : null;
    }
    function pushDock(actorId, profileId, said) {
      var s = sessions[actorId];
      var me = partyOf(actorId);
      var v = TRADE_DOCK.dockView({
        reg: reg, port: s.port, viewer: me, charter: charter(profileId), staff: hook('__thornswoodIsStaff', profileId),
        pack: packList(actorId), people: people(actorId), nameOf: nameOf, itemName: itemName, now: Date.now()
      });
      v.note = said || '';
      return push(actorId, v);
    }
    function pushStaff(actorId, profileId, said) {
      var v = TRADE_DOCK.staffView(TRADE_CARGO, reg, drafts[profileId] || null, crateOf(actorId),
                                   { nameOf: nameOf, itemName: itemName });
      v.note = said || '';
      return push(actorId, v);
    }

    /*
      THE CLOCK: one timer for the next hold to dock and the next cargo nobody
      collected. Anything overdue happens now. sweptAt is when the drop box
      sweep last ran: what came due by then and is still aboard could not go
      into the box (no name to put on it, or the box would not write), and
      the sweep said so. It is not on a timer. It is looked at again at the
      next write to the register that goes through, or the next start, the
      way a docking that could not be written is (arriveNow).
    */
    var sweptAt = -1;
    var sweeping = false;
    function nextDue() {
      var a = TRADE_DOCK.nextArrival(reg.state);
      var b = reg.ships.nextUncollected(reg.state, TRADE_DOCK.waitOf(reg.routes), sweptAt >= 0 ? sweptAt : undefined);
      return a === null ? b : (b === null ? a : Math.min(a, b));
    }
    function schedule(wait) {
      if (typeof setTimeout !== 'function') { return; }
      if (timer) { clearTimeout(timer); timer = null; }
      var next = nextDue();
      if (next === null && wait === undefined) { return; }
      var ms = wait !== undefined ? wait : Math.min(Math.max(0, next - Date.now()), 60 * 60 * 1000);
      timer = setTimeout(function () { timer = null; tick(); }, ms);
    }
    function tick() {
      var due = nextDue();
      if (due === null || due > Date.now()) { schedule(); return; }
      if (!arriveNow()) { return; }
      uncollectedNow();
      schedule();
    }
    function arriveNow() {
      var due = TRADE_DOCK.nextArrival(reg.state);
      if (due === null || due > Date.now()) { return true; }
      var next = { routes: reg.routes, ships: reg.ships, state: copy(reg.state) };
      var landed = reg.ships.arrive(next.state, Date.now());
      // No timed retry: a register that will not write is said once, and the
      // overdue holds dock at the next write that goes through, or at the next
      // start, which docks every overdue ship.
      if (!commit(next)) { slog('could not write the register, so', landed.length, 'ship(s) stay at sea past their time; they dock at the next change to the register or the next start'); return false; }
      slog(landed.length, 'ship(s) docked');
      return true;
    }

    /*
      WHAT NOBODY COLLECTED (Patrick, 22 Oct 2026: B). Every line due goes off
      its ship as left and into the drop box of the port's hold, under the
      recipient's name, through the property block's boxShipped. The box
      first, the manifest's finish after: a box that will not write puts the
      piece back aboard. The log says how many, never who.
    */
    function uncollectedNow() {
      sweeping = true;
      try { sweep(); } finally { sweeping = false; }
    }
    function sweep() {
      var now = Date.now();
      sweptAt = now;
      var due = reg.ships.uncollected(reg.state, now, TRADE_DOCK.waitOf(reg.routes));
      if (!due.length) { return; }
      var prop = g.__thornswoodProperty;
      if (!prop || typeof prop.boxShipped !== 'function') {
        slog(due.length, 'line(s) nobody collected wait aboard, because the drop boxes are not running');
        return;
      }
      var moved = 0, waiting = 0;
      due.forEach(function (d) {
        var port = null;
        reg.routes.ports.forEach(function (p) { if (p.key === d.port) { port = p; } });
        var forName = nameOf(d.for);
        if (!port || !forName) { waiting++; return; }
        var out = null;
        try { out = act('begin')(d.hold, d.line, d.count, 'left', d.for, now); } catch (eBegin) { waiting++; return; }
        var n = 0;
        try { n = prop.boxShipped(port.hold, out.entry, forName, port.name + ', off ' + d.hold); } catch (eBox) { n = 0; }
        if (!n) {
          try { act('undo')(d.hold, out.out); } catch (eUndo) {
            slog('a line nobody collected could not go into the drop box and could not go back aboard', d.hold + ':', (eUndo && eUndo.message) || eUndo);
          }
          waiting++;
          return;
        }
        try { act('finish')(d.hold, out.out, receipt('box')); } catch (eFinish) {
          slog('a line nobody collected is in the drop box, but', d.hold, 'could not mark it finished:', (eFinish && eFinish.message) || eFinish);
        }
        moved++;
      });
      slog(moved, 'line(s) nobody collected went into the drop box', waiting ? '(' + waiting + ' wait aboard until the next change to the register or the next start)' : '');
    }

    function hand(actorId, w, how) {
      var h = reg.state.holds[w.hold];
      if (!h || h.sailing || h.port !== sessions[actorId].port) { throw new Error('That ship is not at this dock.'); }
      var out = act('begin')(w.hold, w.line, w.count, how, partyOf(actorId), Date.now());
      try { packGive(actorId, out.entry); } catch (eGive) {
        act('undo')(w.hold, out.out);
        throw new Error('It could not be put in your pack, so it stays aboard.');
      }
      try { act('finish')(w.hold, out.out, receipt('credit')); } catch (eFinish) {
        // The piece is in the pack and the line is still being handed out on
        // the manifest. Said, with what staff need to settle it by hand.
        slog('handed', JSON.stringify(out.entry), 'from', w.hold, 'to', String(actorId.toString(16)),
             'but could not mark it finished:', (eFinish && eFinish.message) || eFinish);
        throw new Error('It is in your pack, but the ship\'s book could not be written. Say so in the dev channel.');
      }
      return how === 'delivered' ? 'Collected.' : (how === 'taken' ? 'Taken.' : 'Taken back.');
    }

    function dockWord(w, actorId, profileId) {
      var port = sessions[actorId].port;
      var h = reg.state.holds[w.hold];
      if (w.verb === 'collect') { return hand(actorId, w, 'delivered'); }
      if (w.verb === 'return') { return hand(actorId, w, 'returned'); }
      // Anyone who opened a docked hold (Patrick, 22 Oct 2026: A); hand() checks it is docked here.
      if (w.verb === 'take') { return hand(actorId, w, 'taken'); }
      if (!h || h.sailing || h.port !== port) { throw new Error('That ship is not at this dock.'); }
      var c = charter(profileId);
      if (!c.may) { throw new Error(c.why); }
      if (w.verb === 'sail') {
        var t = TRADE_DOCK.voyage(reg.routes, port, w.to, Date.now());
        act('depart')(w.hold, w.to, t.at, t.arriveAt);
        return 'The ship has sailed.';
      }
      // load: coin, a full hold and the recipient are refused before the pack is touched.
      if (TRADE_DOCK.isCoin(w.base)) { throw new Error('Coin is not cargo.'); }
      if (reg.ships.used(reg.state, w.hold) >= reg.ships.MAX_LINES) { throw new Error('The hold is full.'); }
      var to = null;
      people(actorId).forEach(function (p) { if (p.actor === w.forActor) { to = { actor: p.actor, profile: p.profile }; } });
      if (!to) { throw new Error('Who it is for has to be here, in the world.'); }
      var piece = packTake(actorId, w.base, w.nth, w.count);
      try {
        act('load')(w.hold, { by: partyOf(actorId), for: to, receipt: receipt('debit'), entry: piece });
      } catch (eLoad) {
        try { packGive(actorId, piece); } catch (eBack) {
          slog('could not load', JSON.stringify(piece), 'for', String(actorId.toString(16)),
               'and could not put it back in their pack:', (eBack && eBack.message) || eBack);
          throw new Error('It could not be loaded, and it could not be put back in your pack. Say so in the dev channel.');
        }
        throw eLoad;
      }
      return 'Loaded.';
    }

    function staffWord(w, actorId, profileId) {
      if (w.verb === 'draft') {
        drafts[profileId] = TRADE_DOCK.editDraft(TRADE_CARGO, reg.routes, drafts[profileId] || null, w.edit, crateOf(actorId));
        return 'The draft changed. Nothing is in force until you confirm.';
      }
      if (w.verb === 'confirm') {
        if (w.base !== TRADE_DOCK.baseOf(reg.routes)) { throw new Error('The list in force changed since. Look again before you confirm.'); }
        if (!drafts[profileId]) { throw new Error('There is no draft to confirm.'); }
        if (!commit(TRADE_CARGO.adoptRoutes(reg, drafts[profileId]))) { throw new Error('The ship register could not be written, so nothing changed.'); }
        drafts[profileId] = null;
        var n = TRADE_CARGO.countsOf(reg);
        slog('staff confirmed the ship list:', n.ports, 'port(s),', n.routes, 'route(s)');
        return 'Confirmed. The new list is in force.';
      }
      if (w.verb === 'add') {
        if (!reg.routes.ports.some(function (p) { return p.key === w.port; })) { throw new Error('No port ' + w.port + ' in force.'); }
        var k = 1;
        while (reg.state.holds['ship-' + k]) { k++; }
        act('open')('ship-' + k, w.port);
        slog('staff put a ship at a port:', Object.keys(reg.state.holds).length, 'ship(s) in all');
        return 'A ship is at the dock.';
      }
      return '';
    }

    /* The panel's words (game\ui\thornswood-ship.js). Answers a line for the chat, or ''. */
    function command(parts, actorId, profileId) {
      var w = TRADE_DOCK.parse(parts);
      if (w.why) { return w.why; }
      var said = '';
      if (w.verb === 'close') { sessions[actorId] = null; push(actorId, { open: false }); return ''; }
      if (w.verb === 'staff' || w.verb === 'draft' || w.verb === 'confirm' || w.verb === 'add') {
        if (!hook('__thornswoodIsStaff', profileId)) { return 'Only staff keep the ports and routes.'; }
        try { said = staffWord(w, actorId, profileId); } catch (eStaff) { said = String((eStaff && eStaff.message) || eStaff); }
        sessions[actorId] = { mode: 'staff', at: Date.now() };
        pushStaff(actorId, profileId, said);
        return '';
      }
      var s = sessions[actorId];
      if (!s || s.mode !== 'dock' || Date.now() - s.at > SESSION_MS || !near(actorId, s.ref)) {
        sessions[actorId] = null;
        push(actorId, { open: false });
        return 'Stand at the dock and press its crate.';
      }
      s.at = Date.now();
      try { said = dockWord(w, actorId, profileId); } catch (eDock) { said = String((eDock && eDock.message) || eDock); }
      pushDock(actorId, profileId, said);
      return '';
    }

    /*
      E on anything (mp.onActivate). A dock crate opens the dock and answers
      true, so the container never opens. Any other container a staff member
      opens is remembered for a minute, for the staff panel's port and crate
      edits, and the press goes on.
    */
    function activated(refrId, actorId, baseDesc) {
      var desc = '';
      try { desc = mp.getDescFromId(refrId); } catch (e) { desc = ''; }
      var port = TRADE_DOCK.portOfCrate(reg.routes, desc);
      var pid = profileOf(actorId);
      if (!port) {
        if (desc && hook('__thornswoodIsStaff', pid) && typeof kindIsContainer === 'function' && kindIsContainer(baseDesc)) {
          try {
            crateSeen[actorId] = { desc: desc, world: mp.get(refrId, 'worldOrCellDesc'), pos: mp.get(refrId, 'pos').slice(0, 3), at: Date.now() };
          } catch (eSeen) { }
        }
        return false;
      }
      sessions[actorId] = { mode: 'dock', port: port, ref: refrId, at: Date.now() };
      pushDock(actorId, pid, '');
      return true;
    }

    g.__thornswoodTradeShips = {
      counts: function () { return TRADE_CARGO.countsOf(reg); },
      routes: function () { return copy(reg.routes); },
      aboard: function (id) { return reg.ships.aboard(reg.state, id); },
      propose: function (next) { return TRADE_CARGO.proposeRoutes(reg.routes, next, reg.state); },
      adopt: function (next) {
        if (!commit(TRADE_CARGO.adoptRoutes(reg, next))) { throw new Error('The ship register could not be written, so nothing changed.'); }
        return TRADE_CARGO.countsOf(reg);
      },
      open: act('open'), load: act('load'), depart: act('depart'), amend: act('amend'), arrive: act('arrive'),
      begin: act('begin'), finish: act('finish'), undo: act('undo'),
      activated: activated, command: command
    };
    // Anything that came due while the server was down happens now, and the clock runs.
    tick();
  }
})();
// ==== end thornswood trade ships ====
