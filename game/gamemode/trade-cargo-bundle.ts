// TRADE CARGO BUNDLE BEGIN
// Built by scripts\dev\Build-TradeCargoGamemode.js out of game\trade-cargo.js. Do not hand edit.
const TRADE_CARGO = (function () {
const module = { exports: {} };
'use strict';
/*
  TRADE SHIPS: THE MANIFEST (#511).

  A trade ship is a hold, a container the server places at a dock, that is
  loaded at one port, is away for a voyage, and is emptied at another. This
  file is only the manifest: what is in each hold, whose pack every piece came
  out of, who it is for, and where it went. It never touches the world, a
  pack, a purse or a price. The design, its boundaries and the questions for
  Patrick are on #511 (issuecomment-6245473792).

  WHAT IT REFUSES TO DO, because a cargo worth robbing is a cargo worth making
  out of nothing (the trap #511 names):

  - A piece is written aboard only with the receipt of the debit that already
    took it out of somebody's pack. One receipt loads once.
  - A piece leaves only in two steps. begin() takes it off the hold and holds
    it as pending; finish() records the receipt of the credit that put it into
    exactly one pack or drop box. A pending piece is still counted, so a crash
    between the two steps neither loses it nor pays it twice.
  - Every change runs the audit: for every line, what was loaded equals what
    is aboard plus what is pending plus what went out. A hold never grows.
  - Coin is not cargo. Gold (base 0xF) is refused; freight is #512's rule.
  - Saved state that does not verify is refused. It never starts empty.

  WHO IS NAMED. A person on the manifest is a character, { actor, profile }:
  the character's form id and the profile it is on, the two numbers the
  release list of deleted characters (#2351, #2668) names people by. Never a
  name: what a panel shows is read off the character when it is shown. When
  a character is deleted, reset, wiped or replaced by New-Character,
  release() takes them off: every place they are named becomes null, and
  every piece stays exactly where it was. A line whose recipient is gone
  cannot be delivered or left for them, and one whose loader is gone cannot
  be returned to them; it stays aboard for the world to settle (a piece can
  still be taken, and staff can narrate what became of it).

  TAKEN, AND LEFT AFTER SO MANY DAYS (Patrick, 22 Oct 2026, #511). Anyone who
  opens a docked hold can take from it, and the out names their character
  with how 'taken'; whether it was a robbery or a seizure is roleplay. A hold
  at sea cannot be opened: begin() refuses every way out while it sails.
  Cargo still aboard so many real days after landing goes into the port's
  hold drop box under the recipient's name, as how 'left'. landed is when a
  ship last docked at the end of a voyage, null while it sails and before
  its first voyage, and uncollected() lists what is due; how many days is
  the staff list's uncollectedDays. A hold carries as many lines as it may
  that still have something aboard or being handed out, so a hold whose
  cargo has all gone out, by any way, is free again. A cart keeps no landed:
  goods for somebody who is not at the stop wait on the cart (#3158).

  WHAT IT NEVER DECIDES. Thornswood is a player-driven RP server (Patrick,
  17 Oct 2026, 10:13 PM MT): a trade ship is a tool, and the players decide
  what happens with it in the world. So nothing here says who sails, where,
  when or for how long. The ports, the routes, their leg times and the crews
  are staff data: checkRoutes() below reads and checks them, and
  proposeRoutes() lists what a change would do so staff can confirm it before
  it is kept. Who may load, and whether opening a hold is a crime, are the
  world's business, not this file's.

  Ownership of who may run a ship, contracts and freight belong to #512 (the
  Free Skyrim Trading Company). Prices, purses and trading belong to #1373.
  Nothing here calls either.

  CARTS ARE THE SAME MANIFEST, DRIVEN (#3158). Patrick, 22 Oct 2026: people
  drive the carts that move goods between holds, and a shipment is lost only
  when people raid it, never by chance. createTradeCargo({ driven: true }) is
  a manifest of carts: a "port" is a cart stop and a "route" a road. Every
  rule above holds the same, and three differ:

  - A cart leaves only with a driver, the character who drives it, kept on
    the journey as sailing.driver. A ship never has one.
  - A cart never arrives on a clock. pullIn() brings it in at its stop when
    its driver is there and the road's least time has passed, or when staff
    bring in one whose driver is gone. arrive() refuses a driven manifest.
  - A driver deleted, reset, wiped or replaced comes off the journey the way
    a loader does; the cart stays on the road for staff to bring in.

  Taking from a cart on the road, the raid, is begin() with how 'taken',
  which this file already allows at sea. Who may raid, and where, is the
  caller's rule (game\trade-carts.js).
*/

var GOLD_BASE = 15;
var MAX_COUNT = 2147483647;
var MAX_LINES_DEFAULT = 24;
var MAX_STATE_BYTES = 512 * 1024;
var ID_RE = /^[a-z0-9][a-z0-9:_.-]{0,63}$/;
var HOWS = { delivered: 1, left: 1, returned: 1, taken: 1 };

function copy(v) { return JSON.parse(JSON.stringify(v)); }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function count(n) { return Number.isInteger(n) && n > 0 && n <= MAX_COUNT; }
function text(s, max) { return typeof s === 'string' && s.length > 0 && s.length <= (max || 128) && s.trim() === s; }
function time(t) { return Number.isInteger(t) && t >= 0; }

/* A character: its form id and its profile (0 when it has none). */
function party(p) {
  return isObj(p) && Object.keys(p).length === 2 &&
    Number.isInteger(p.actor) && p.actor > 0 && p.actor <= 0xffffffff &&
    Number.isSafeInteger(p.profile) && p.profile >= 0;
}
function partyOf(p, what) {
  if (!party(p)) { throw new Error(what + ' has to be a character.'); }
  return { actor: p.actor, profile: p.profile };
}
function same(a, b) { return !!a && !!b && a.actor === b.actor && a.profile === b.profile; }

/* A piece as the inventory holds it: base, count and every other field kept. */
function entryOf(e) {
  if (!isObj(e) || !Number.isInteger(e.baseId) || e.baseId <= 0 || e.baseId > 0xffffffff || !count(e.count)) {
    throw new Error('A piece of cargo cannot be verified.');
  }
  if (e.baseId === GOLD_BASE) { throw new Error('Coin is not cargo.'); }
  return copy(e);
}

function canonical(v) {
  if (Array.isArray(v)) { return v.map(canonical); }
  if (!isObj(v)) { return v; }
  var out = {};
  Object.keys(v).sort().forEach(function (k) { out[k] = canonical(v[k]); });
  return out;
}

/*
  opts.ports is the port keys a hold may stand at, and may be empty (a world
  with no ships). opts.routes, when given, is the one-way legs a hold may sail.
*/
function createTradeCargo(opts) {
  opts = opts || {};
  if (!Array.isArray(opts.ports)) { throw new Error('The ports cannot be verified.'); }
  var ports = {};
  opts.ports.forEach(function (p) {
    if (typeof p !== 'string' || !ID_RE.test(p) || ports[p]) { throw new Error('A port cannot be verified: ' + p); }
    ports[p] = true;
  });
  var routes = null;
  if (opts.routes !== undefined) {
    routes = {};
    if (!Array.isArray(opts.routes)) { throw new Error('The routes cannot be verified.'); }
    opts.routes.forEach(function (r) {
      if (!isObj(r) || !ports[r.from] || !ports[r.to] || r.from === r.to) { throw new Error('A route cannot be verified.'); }
      routes[r.from + '>' + r.to] = true;
    });
  }
  var maxLines = opts.maxLines === undefined ? MAX_LINES_DEFAULT : opts.maxLines;
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 256) { throw new Error('The line limit cannot be verified.'); }
  if (opts.driven !== undefined && typeof opts.driven !== 'boolean') { throw new Error('Whether it is driven cannot be verified.'); }
  var driven = opts.driven === true;

  function empty() { return { v: 1, seq: 0, holds: {}, receipts: {} }; }

  function holdOf(state, id) {
    var h = has(state.holds, id) ? state.holds[id] : null;
    if (!h) { throw new Error('No hold ' + id + '.'); }
    return h;
  }

  /* The lines of a hold still carrying something, aboard or being handed out. */
  function inUse(h) {
    var open = {};
    Object.keys(h.lines).forEach(function (k) { if (h.lines[k].aboard > 0) { open[k] = true; } });
    h.outs.forEach(function (o) { if (o.receipt === null) { open[String(o.line)] = true; } });
    return Object.keys(open).length;
  }

  function useReceipt(state, receipt) {
    if (!text(receipt, 200)) { throw new Error('A receipt cannot be verified.'); }
    if (has(state.receipts, receipt)) { throw new Error('That receipt was already used.'); }
    state.receipts[receipt] = true;
  }

  /*
    The audit. Throws on the first thing that does not add up, so a caller that
    catches it can refuse the change and keep the state it had. Answers the
    counts a load banner says.
  */
  function audit(state) {
    if (!isObj(state) || state.v !== 1 || !Number.isInteger(state.seq) || state.seq < 0 ||
        !isObj(state.holds) || !isObj(state.receipts)) {
      throw new Error('The manifest cannot be verified.');
    }
    var seen = {}, used = {}, holds = 0, sailing = 0, aboard = 0, pending = 0, out = 0;
    function receipt(r) {
      if (!text(r, 200) || used[r] || state.receipts[r] !== true) { throw new Error('A receipt does not match the manifest.'); }
      used[r] = true;
    }
    function named(p) { return p === null || party(p); }
    Object.keys(state.holds).forEach(function (id) {
      var h = state.holds[id];
      if (!ID_RE.test(id) || !isObj(h) || !ports[h.port] || !isObj(h.lines) || !Array.isArray(h.outs)) {
        throw new Error('Hold ' + id + ' cannot be verified.');
      }
      holds++;
      if (h.sailing !== null) {
        var s = h.sailing;
        if (!isObj(s) || s.from !== h.port || !ports[s.to] || s.to === s.from || !time(s.at) || !time(s.arriveAt) || s.arriveAt <= s.at ||
            (driven ? !has(s, 'driver') || !named(s.driver) : has(s, 'driver'))) {
          throw new Error('Hold ' + id + '\'s voyage cannot be verified.');
        }
        sailing++;
      }
      // A ship always says when it landed (null at sea and before its first
      // voyage); a cart never does.
      if (driven ? has(h, 'landed') : !has(h, 'landed') || (h.landed !== null && (!time(h.landed) || h.sailing !== null))) {
        throw new Error('Hold ' + id + '\'s landing cannot be verified.');
      }
      var left = {};
      var lines = Object.keys(h.lines);
      lines.forEach(function (k) {
        var l = h.lines[k];
        if (!isObj(l) || String(l.seq) !== k || !Number.isInteger(l.seq) || l.seq < 1 || l.seq > state.seq || seen[l.seq] ||
            !named(l.by) || !named(l.for) || !ports[l.from] || !Number.isInteger(l.aboard) || l.aboard < 0) {
          throw new Error('A line in hold ' + id + ' cannot be verified.');
        }
        seen[l.seq] = true;
        entryOf(l.entry);
        if (l.aboard > l.entry.count) { throw new Error('A line in hold ' + id + ' grew.'); }
        receipt(l.receipt);
        left[k] = l.entry.count - l.aboard;
        aboard += l.aboard;
      });
      h.outs.forEach(function (o) {
        if (!isObj(o) || !Number.isInteger(o.seq) || o.seq < 1 || o.seq > state.seq || seen[o.seq] || !HOWS[o.how] ||
            !named(o.who) || !count(o.count) || !time(o.at) || !has(h.lines, String(o.line))) {
          throw new Error('Something that left hold ' + id + ' cannot be verified.');
        }
        seen[o.seq] = true;
        left[o.line] -= o.count;
        if (left[o.line] < 0) { throw new Error('More left hold ' + id + ' than was loaded.'); }
        if (o.receipt === null) { pending += o.count; } else { receipt(o.receipt); out += o.count; }
      });
      Object.keys(left).forEach(function (k) {
        if (left[k] !== 0) { throw new Error('Hold ' + id + ' does not add up.'); }
      });
      if (inUse(h) > maxLines) { throw new Error('Hold ' + id + ' carries more lines than it may.'); }
    });
    Object.keys(state.receipts).forEach(function (r) {
      if (!used[r]) { throw new Error('A receipt is not on the manifest.'); }
    });
    return { holds: holds, sailing: sailing, aboard: aboard, pending: pending, out: out };
  }

  /* Every change works on a copy and replaces the state only once it audits. */
  function change(state, fn) {
    var next = copy(state);
    var result = fn(next);
    audit(next);
    Object.keys(state).forEach(function (k) { delete state[k]; });
    Object.keys(next).forEach(function (k) { state[k] = next[k]; });
    return result;
  }

  function open(state, id, port) {
    return change(state, function (s) {
      if (typeof id !== 'string' || !ID_RE.test(id)) { throw new Error('A hold needs a plain name.'); }
      if (has(s.holds, id)) { throw new Error('There is already a hold ' + id + '.'); }
      if (!ports[port]) { throw new Error('No port ' + port + '.'); }
      s.holds[id] = { port: port, sailing: null, lines: {}, outs: [] };
      if (!driven) { s.holds[id].landed = null; }
      return id;
    });
  }

  /*
    Loads one piece. The caller has already taken it out of a pack, and
    receipt names that debit. by is the character who loaded it, for the
    character it is for.
  */
  function load(state, id, piece) {
    return change(state, function (s) {
      var h = holdOf(s, id);
      if (h.sailing) { throw new Error('The hold is at sea.'); }
      if (!isObj(piece)) { throw new Error('A load needs who loaded it and who it is for.'); }
      var by = partyOf(piece.by, 'Who loaded it');
      var to = partyOf(piece.for, 'Who it is for');
      var e = entryOf(piece.entry);
      if (inUse(h) >= maxLines) { throw new Error('The hold is full.'); }
      useReceipt(s, piece.receipt);
      var seq = ++s.seq;
      h.lines[seq] = { seq: seq, by: by, for: to, from: h.port, receipt: piece.receipt, entry: e, aboard: e.count };
      return seq;
    });
  }

  /* driver is the character driving a cart, and is never given for a ship. */
  function depart(state, id, to, at, arriveAt, driver) {
    return change(state, function (s) {
      var h = holdOf(s, id);
      var who = null;
      if (driven) { who = partyOf(driver, 'Who drives it'); }
      else if (driver !== undefined) { throw new Error('A ship has no driver.'); }
      if (h.sailing) { throw new Error('The hold is already at sea.'); }
      if (!ports[to] || to === h.port || (routes && !routes[h.port + '>' + to])) {
        throw new Error('No voyage from ' + h.port + ' to ' + to + '.');
      }
      if (!time(at) || !time(arriveAt) || arriveAt <= at) { throw new Error('A voyage needs a time to leave and a later time to arrive.'); }
      var carrying = Object.keys(h.lines).some(function (k) { return h.lines[k].aboard > 0; });
      if (!carrying) { throw new Error('The hold is empty.'); }
      if (h.outs.some(function (o) { return o.receipt === null; })) { throw new Error('Something is still being handed out.'); }
      h.sailing = { from: h.port, to: to, at: at, arriveAt: arriveAt };
      if (driven) { h.sailing.driver = who; } else { h.landed = null; }
      return h.sailing;
    });
  }

  /*
    A staff tool, for narration: change a voyage that is under way, to another
    port on the list or to another time to arrive, or both. It never touches
    what is aboard. Staff routes do not bind it, because staff are the ones
    who wrote them; the port still has to be one a hold can stand at.
  */
  function amend(state, id, change_) {
    return change(state, function (s) {
      var h = holdOf(s, id);
      if (!h.sailing) { throw new Error('The hold is not at sea.'); }
      if (!isObj(change_)) { throw new Error('Say what changes.'); }
      var to = change_.to === undefined ? h.sailing.to : change_.to;
      var arriveAt = change_.arriveAt === undefined ? h.sailing.arriveAt : change_.arriveAt;
      if (!ports[to] || to === h.sailing.from) { throw new Error('No voyage from ' + h.sailing.from + ' to ' + to + '.'); }
      if (!time(arriveAt) || arriveAt <= h.sailing.at) { throw new Error('A voyage arrives after it left.'); }
      h.sailing.to = to;
      h.sailing.arriveAt = arriveAt;
      return h.sailing;
    });
  }

  /* Every hold whose voyage is over by now is docked at its destination, landed now. */
  function arrive(state, now) {
    if (driven) { throw new Error('A cart comes in only with its driver.'); }
    if (!time(now)) { throw new Error('The time cannot be verified.'); }
    return change(state, function (s) {
      var landed = [];
      Object.keys(s.holds).sort().forEach(function (id) {
        var h = s.holds[id];
        if (h.sailing && h.sailing.arriveAt <= now) {
          h.port = h.sailing.to;
          h.sailing = null;
          h.landed = now;
          landed.push(id);
        }
      });
      return landed;
    });
  }

  /*
    A cart comes in at the stop it was driven to. who is the character at the
    stop: only the driver, and only once the road's least time has passed.
    who null is staff bringing in a cart, at any time, whether or not its
    driver is still named. Answers the stop.
  */
  function pullIn(state, id, now, who) {
    if (!driven) { throw new Error('A ship docks on its own.'); }
    if (!time(now)) { throw new Error('The time cannot be verified.'); }
    return change(state, function (s) {
      var h = holdOf(s, id);
      if (!h.sailing) { throw new Error('The cart is not on the road.'); }
      if (who !== null) {
        var me = partyOf(who, 'Who brings it in');
        if (!same(me, h.sailing.driver)) { throw new Error('Only its driver brings a cart in.'); }
        if (now < h.sailing.arriveAt) { throw new Error('The road is not done yet.'); }
      }
      h.port = h.sailing.to;
      h.sailing = null;
      return h.port;
    });
  }

  /*
    What nobody collected, due to go into the drop box: every line aboard a
    hold that landed at least waitMs before now, away from the port it was
    loaded in, whose recipient is still on the manifest. A line whose
    recipient was released stays aboard for the world to settle.
    Answers [{ hold, line, count, port, for }], oldest landing first.
  */
  function uncollected(state, now, waitMs) {
    if (driven) { throw new Error('Goods on a cart wait on the cart.'); }
    if (!time(now) || !time(waitMs)) { throw new Error('The time cannot be verified.'); }
    var due = [];
    Object.keys(state.holds).sort().forEach(function (id) {
      var h = state.holds[id];
      var landed = h.landed;
      if (h.sailing !== null || landed === null || now - landed < waitMs) { return; }
      Object.keys(h.lines).map(Number).sort(function (a, b) { return a - b; }).forEach(function (k) {
        var l = h.lines[String(k)];
        if (l.aboard > 0 && l.for !== null && l.from !== h.port) {
          due.push({ hold: id, line: l.seq, count: l.aboard, port: h.port, for: copy(l.for), landed: landed });
        }
      });
    });
    due.sort(function (a, b) { return a.landed - b.landed; });
    return due.map(function (d) { delete d.landed; return d; });
  }

  /*
    When the next line comes due for the drop box, or null when none will.
    after, when given, is a time: only what comes due later than it counts,
    so what was already looked at then is not named again.
  */
  function nextUncollected(state, waitMs, after) {
    if (driven) { throw new Error('Goods on a cart wait on the cart.'); }
    if (!time(waitMs) || (after !== undefined && !time(after))) { throw new Error('The time cannot be verified.'); }
    var next = null;
    Object.keys(state.holds).forEach(function (id) {
      var h = state.holds[id];
      if (h.sailing !== null || h.landed === null) { return; }
      var due = h.landed + waitMs;
      if (after !== undefined && due <= after) { return; }
      var waiting = Object.keys(h.lines).some(function (k) {
        var l = h.lines[k];
        return l.aboard > 0 && l.for !== null && l.from !== h.port;
      });
      if (waiting && (next === null || due < next)) { next = due; }
    });
    return next;
  }

  /*
    Takes count of a line off the hold and holds it as pending, then hands
    back what the caller must put into one pack or drop box. how is
    delivered (to the recipient), left (in the drop box under the
    recipient's name), returned (to the loader, at the port it was loaded
    in) or taken (by whoever opened it, Patrick's A of 22 Oct 2026). Nothing
    leaves a ship at sea, by any way; a cart on the road can only be taken
    from, the raid. who is the character receiving it.
  */
  function begin(state, id, line, n, how, who, at) {
    return change(state, function (s) {
      var h = holdOf(s, id);
      var l = has(h.lines, String(line)) ? h.lines[String(line)] : null;
      if (!l) { throw new Error('No such line in the hold.'); }
      if (!HOWS[how]) { throw new Error('Not a way for cargo to leave.'); }
      var to = partyOf(who, 'Who receives it');
      if (!count(n) || n > l.aboard) { throw new Error('There is not that much aboard.'); }
      if (!time(at)) { throw new Error('The time cannot be verified.'); }
      // A ship at sea opens for nobody (#511). A cart on the road is raided:
      // taken, and only taken, while it is driven (#3158).
      if (h.sailing && !(driven && how === 'taken')) { throw new Error(driven ? 'The cart is on the road.' : 'The hold is at sea.'); }
      if ((how === 'delivered' || how === 'left') && (!same(to, l.for) || h.port === l.from)) {
        throw new Error('Only the person it is for receives it, at the far end.');
      }
      if (how === 'returned' && (!same(to, l.by) || h.port !== l.from)) {
        throw new Error('Only the person who loaded it takes it back, where it was loaded.');
      }
      l.aboard -= n;
      var seq = ++s.seq;
      h.outs.push({ seq: seq, line: l.seq, count: n, how: how, who: to, at: at, receipt: null });
      var e = copy(l.entry);
      e.count = n;
      return { out: seq, entry: e };
    });
  }

  /* The credit happened; receipt names it. */
  function finish(state, id, out, receipt) {
    return change(state, function (s) {
      var h = holdOf(s, id);
      var o = h.outs.filter(function (x) { return x.seq === out; })[0];
      if (!o || o.receipt !== null) { throw new Error('Nothing is waiting to be handed out under that number.'); }
      useReceipt(s, receipt);
      o.receipt = receipt;
      return o.seq;
    });
  }

  /* The credit was refused for certain; the piece goes back aboard. */
  function undo(state, id, out) {
    return change(state, function (s) {
      var h = holdOf(s, id);
      var i = -1;
      h.outs.forEach(function (x, j) { if (x.seq === out && x.receipt === null) { i = j; } });
      if (i < 0) { throw new Error('Nothing is waiting to be handed out under that number.'); }
      var o = h.outs.splice(i, 1)[0];
      h.lines[String(o.line)].aboard += o.count;
      return o.seq;
    });
  }

  /*
    THE RELEASE OF DELETED CHARACTERS (#2351, #2668). who is what the
    release list answers: who.actor(formId) and who.profile(profileId), each
    true for one the list names. A character the list names by form id, or
    whose profile it names (Delete-Person.ps1, which deletes the profile and
    every character on it), comes off every line and every hand out: the
    place becomes null. A list of characters only (Reset-Character.ps1,
    Wipe-Saves.ps1, New-Character.ps1) never names a profile, so a profile's
    other characters stay. Nothing aboard, pending or gone out changes by one
    piece, which the audit holds it to. Answers the counts, for the log.
  */
  function release(state, who) {
    if (!isObj(who) || typeof who.actor !== 'function' || typeof who.profile !== 'function') {
      throw new Error('The release list cannot be verified.');
    }
    function gone(p) { return !!p && (who.actor(p.actor) === true || (p.profile > 0 && who.profile(p.profile) === true)); }
    return change(state, function (s) {
      var c = { loaders: 0, recipients: 0, receivers: 0 };
      if (driven) { c.drivers = 0; }
      Object.keys(s.holds).forEach(function (id) {
        var h = s.holds[id];
        Object.keys(h.lines).forEach(function (k) {
          var l = h.lines[k];
          if (gone(l.by)) { l.by = null; c.loaders++; }
          if (gone(l.for)) { l.for = null; c.recipients++; }
        });
        h.outs.forEach(function (o) { if (gone(o.who)) { o.who = null; c.receivers++; } });
        if (driven && h.sailing && gone(h.sailing.driver)) { h.sailing.driver = null; c.drivers++; }
      });
      return c;
    });
  }

  /* What is aboard a hold now, line by line, for a panel. */
  function aboard(state, id) {
    var h = holdOf(state, id);
    return Object.keys(h.lines).map(Number).sort(function (a, b) { return a - b; })
      .map(function (k) { return h.lines[k]; })
      .filter(function (l) { return l.aboard > 0; })
      .map(function (l) {
        var e = copy(l.entry); e.count = l.aboard;
        return { line: l.seq, for: l.for && copy(l.for), by: l.by && copy(l.by), entry: e };
      });
  }

  function save(state) {
    audit(state);
    var out = JSON.stringify(canonical(state));
    if (Buffer.byteLength(out, 'utf8') > MAX_STATE_BYTES) { throw new Error('The manifest is too large to keep.'); }
    return out;
  }

  function load_(textIn) {
    if (typeof textIn !== 'string' || Buffer.byteLength(textIn, 'utf8') > MAX_STATE_BYTES) {
      throw new Error('The saved manifest cannot be verified.');
    }
    var s;
    try { s = JSON.parse(textIn); } catch (e) { throw new Error('The saved manifest cannot be verified.'); }
    audit(s);
    return s;
  }

  return {
    empty: empty, audit: audit, open: open, load: load, depart: depart, amend: amend, arrive: arrive, pullIn: pullIn,
    begin: begin, finish: finish, undo: undo, release: release, aboard: aboard, save: save, parse: load_,
    uncollected: uncollected, nextUncollected: nextUncollected,
    used: function (state, id) { return inUse(holdOf(state, id)); },
    PORTS: Object.keys(ports), MAX_LINES: maxLines, DRIVEN: driven
  };
}

/*
  STAFF DATA: THE PORTS, ROUTES AND CREWS.

  Nothing about where ships go is written in code. Staff keep one list:

    { v: 1,
      ports:  [{ key, name, hold, world, pos: [x, y, z], crate: '<ref>' }],
      routes: [{ from, to, minutes, crew: ['<ref>', ...] }],
      uncollectedDays: 7 }

  A port is a place a hold can stand: its key, the name people read, the hold
  whose drop box takes what nobody collects, and where it stands. crate is
  the reference of the container already in the world that is its dock
  (Patrick, 18 Oct 2026: a ship at the dock is a crate, with no new plugin;
  #2700): E on it opens the dock, never the container. One crate is one
  port's. A port with no crate yet is on the list with nothing to press. A route is
  one way between two ports with the real minutes a leg takes; the way back is
  its own row, so staff can make it longer, shorter or absent. crew is the
  references of any NPCs or special characters staff have stood up for it;
  empty is a route nobody crews. An empty list is a world with no ships.
  uncollectedDays is how many real days cargo waits aboard after landing
  before it goes into the port's hold drop box (Patrick, 22 Oct 2026: 7,
  a staff setting); a list without it is 7.

  checkRoutes() refuses the whole list on the first thing wrong, so a bad edit
  never half applies. proposeRoutes() compares the list in force with an edit
  and says, line by line, what would change, including the holds a removed
  port or route would strand, so staff confirm it knowing that.
*/
var HOLD_KEYS = { whiterun: 1, solitude: 1, riften: 1, markarth: 1, windhelm: 1, falkreath: 1,
  morthal: 1, dawnstar: 1, winterhold: 1, ravenrock: 1 };
var REF_RE = /^[0-9a-f]{1,8}:[^:\s][^:]{0,95}$/i;
var MAX_ROUTE_MINUTES = 7 * 24 * 60;
var NO_ROUTES = { v: 1, ports: [], routes: [] };
var PORT_KEYS = ['key', 'name', 'hold', 'world', 'pos', 'crate'];
var LIST_KEYS = ['v', 'ports', 'routes', 'uncollectedDays'];
var UNCOLLECTED_DAYS = 7;
var MAX_UNCOLLECTED_DAYS = 60;

function checkRoutes(cfg) {
  if (!isObj(cfg) || cfg.v !== 1 || !Array.isArray(cfg.ports) || !Array.isArray(cfg.routes) ||
      Object.keys(cfg).some(function (k) { return LIST_KEYS.indexOf(k) < 0; })) {
    throw new Error('The ship routes cannot be verified.');
  }
  var days = cfg.uncollectedDays === undefined ? UNCOLLECTED_DAYS : cfg.uncollectedDays;
  if (!Number.isInteger(days) || days < 1 || days > MAX_UNCOLLECTED_DAYS) {
    throw new Error('The days cargo waits must be a whole number from 1 to ' + MAX_UNCOLLECTED_DAYS + '.');
  }
  var keys = {}, pairs = {}, crates = {};
  var ports = cfg.ports.map(function (p, i) {
    if (!isObj(p) || typeof p.key !== 'string' || !ID_RE.test(p.key) || keys[p.key] || !text(p.name, 64) ||
        !HOLD_KEYS[p.hold] || typeof p.world !== 'string' || !REF_RE.test(p.world) ||
        !Array.isArray(p.pos) || p.pos.length !== 3 || !p.pos.every(function (n) { return typeof n === 'number' && isFinite(n); }) ||
        Object.keys(p).some(function (k) { return PORT_KEYS.indexOf(k) < 0; }) ||
        (p.crate !== undefined && (typeof p.crate !== 'string' || !REF_RE.test(p.crate) || crates[p.crate.toLowerCase()]))) {
      throw new Error('Port ' + (i + 1) + ' cannot be verified.');
    }
    keys[p.key] = true;
    var out = { key: p.key, name: p.name, hold: p.hold, world: p.world, pos: p.pos.slice() };
    if (p.crate !== undefined) { crates[p.crate.toLowerCase()] = true; out.crate = p.crate; }
    return out;
  });
  var routes = cfg.routes.map(function (r, i) {
    var crew = r && r.crew === undefined ? [] : r && r.crew;
    if (!isObj(r) || !keys[r.from] || !keys[r.to] || r.from === r.to || pairs[r.from + '>' + r.to] ||
        !Number.isInteger(r.minutes) || r.minutes < 1 || r.minutes > MAX_ROUTE_MINUTES ||
        !Array.isArray(crew) || crew.length > 64 ||
        !crew.every(function (c, j) { return typeof c === 'string' && REF_RE.test(c) && crew.indexOf(c) === j; })) {
      throw new Error('Route ' + (i + 1) + ' cannot be verified.');
    }
    pairs[r.from + '>' + r.to] = true;
    return { from: r.from, to: r.to, minutes: r.minutes, crew: crew.slice() };
  });
  return { v: 1, ports: ports, routes: routes, uncollectedDays: days };
}

/*
  What an edit would do, for staff to confirm. state is the manifest in force
  (or null), so a port or route that holds are at or sailing on is named.
*/
function proposeRoutes(current, next, state) {
  var a = checkRoutes(current), b = checkRoutes(next);
  var lines = [], strands = [];
  function byKey(list) { var o = {}; list.forEach(function (p) { o[p.key] = p; }); return o; }
  function byPair(list) { var o = {}; list.forEach(function (r) { o[r.from + '>' + r.to] = r; }); return o; }
  var pa = byKey(a.ports), pb = byKey(b.ports), ra = byPair(a.routes), rb = byPair(b.routes);
  Object.keys(pb).forEach(function (k) {
    if (!pa[k]) { lines.push('Add the port ' + pb[k].name + ' (' + k + ').'); }
    else if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) { lines.push('Change the port ' + pb[k].name + ' (' + k + ').'); }
  });
  Object.keys(pa).forEach(function (k) { if (!pb[k]) { lines.push('Remove the port ' + pa[k].name + ' (' + k + ').'); } });
  Object.keys(rb).forEach(function (k) {
    var r = rb[k];
    if (!ra[k]) { lines.push('Add the route ' + r.from + ' to ' + r.to + ', ' + r.minutes + ' minutes.'); }
    else {
      if (ra[k].minutes !== r.minutes) { lines.push('The route ' + r.from + ' to ' + r.to + ' takes ' + r.minutes + ' minutes, not ' + ra[k].minutes + '.'); }
      if (JSON.stringify(ra[k].crew) !== JSON.stringify(r.crew)) { lines.push('The route ' + r.from + ' to ' + r.to + ' has a new crew of ' + r.crew.length + '.'); }
    }
  });
  Object.keys(ra).forEach(function (k) { if (!rb[k]) { lines.push('Remove the route ' + ra[k].from + ' to ' + ra[k].to + '.'); } });
  if (a.uncollectedDays !== b.uncollectedDays) {
    lines.push('Cargo nobody collects goes to the drop box after ' + b.uncollectedDays + ' days, not ' + a.uncollectedDays + '.');
  }
  if (state && isObj(state.holds)) {
    Object.keys(state.holds).sort().forEach(function (id) {
      var h = state.holds[id];
      if (!pb[h.port]) { strands.push(id + ' is at ' + h.port + ', which this removes.'); }
      if (h.sailing && (!pb[h.sailing.to] || !rb[h.sailing.from + '>' + h.sailing.to])) {
        strands.push(id + ' is sailing ' + h.sailing.from + ' to ' + h.sailing.to + ', which this removes.');
      }
    });
  }
  return { changes: lines, strands: strands, next: b };
}

/*
  THE REGISTER: what the server keeps on disk, one file in the private
  folder (it names characters, and the data folder is served to anybody,
  #541):

    { v: 1, routes: <the staff list in force>, cargo: <the manifest> }

  The list in force is kept beside the manifest, in the same file, because
  the manifest names ports and routes off that list: written apart, a crash
  between the two writes could leave a manifest naming a port the list does
  not have, and that manifest would no longer verify. Where staff write an
  edit before it is confirmed (#511 question 1) is a separate thing; a
  confirmed edit becomes the list in force here, through adoptRoutes().

  openRegister(null) is the register of a server that never had one: no
  ports, no routes, no holds. A text that is there and does not verify is
  refused whole, never read as empty.

  The carts' register is the same shape in its own file (#3158):
  openRegister(text, { driven: true }), and the register remembers it is
  driven through every adoptRoutes.
*/
function registerOf(routes, state, driven) {
  var ships = createTradeCargo({ ports: routes.ports.map(function (p) { return p.key; }), routes: routes.routes, driven: driven === true });
  ships.audit(state);
  return { routes: routes, ships: ships, state: state };
}

function openRegister(textIn, opts) {
  var driven = !!(opts && opts.driven === true);
  if (textIn === null || textIn === undefined) {
    var none = checkRoutes(NO_ROUTES);
    return registerOf(none, createTradeCargo({ ports: [] }).empty(), driven);
  }
  if (typeof textIn !== 'string' || Buffer.byteLength(textIn, 'utf8') > MAX_STATE_BYTES * 2) {
    throw new Error('The ship register cannot be verified.');
  }
  var raw;
  try { raw = JSON.parse(textIn.replace(/^\uFEFF/, '')); } catch (e) { throw new Error('The ship register cannot be verified.'); }
  if (!isObj(raw) || raw.v !== 1 || Object.keys(raw).length !== 3 || !has(raw, 'routes') || !has(raw, 'cargo')) {
    throw new Error('The ship register cannot be verified.');
  }
  return registerOf(checkRoutes(raw.routes), raw.cargo, driven);
}

function saveRegister(reg) {
  if (!isObj(reg) || !reg.ships || !isObj(reg.routes)) { throw new Error('The ship register cannot be verified.'); }
  var routes = checkRoutes(reg.routes);
  var cargo = JSON.parse(reg.ships.save(reg.state));
  return JSON.stringify(canonical({ v: 1, routes: routes, cargo: cargo }));
}

/* The register with a staff-confirmed list in force. It strands no hold. */
function adoptRoutes(reg, next) {
  var p = proposeRoutes(reg.routes, next, reg.state);
  if (p.strands.length) { throw new Error('The edit strands a hold: ' + p.strands.join(' ')); }
  return registerOf(p.next, copy(reg.state), reg.ships.DRIVEN);
}

/* The counts a load banner says. */
function countsOf(reg) {
  var c = reg.ships.audit(reg.state);
  c.ports = reg.routes.ports.length;
  c.routes = reg.routes.routes.length;
  return c;
}

module.exports = {
  createTradeCargo: createTradeCargo, checkRoutes: checkRoutes, proposeRoutes: proposeRoutes,
  openRegister: openRegister, saveRegister: saveRegister, adoptRoutes: adoptRoutes, countsOf: countsOf,
  GOLD_BASE: GOLD_BASE, MAX_LINES_DEFAULT: MAX_LINES_DEFAULT,
  UNCOLLECTED_DAYS: UNCOLLECTED_DAYS, MAX_UNCOLLECTED_DAYS: MAX_UNCOLLECTED_DAYS
};
return module.exports;
})();
// TRADE CARGO BUNDLE END
