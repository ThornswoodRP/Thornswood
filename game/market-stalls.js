'use strict';
/*
  MARKET STALLS: THE STALL BOOK AND ITS PANEL (#3160).

  Patrick, 22 Oct 2026, on his report page: stalls are fixed market stalls,
  claimed like property, and a stall sells only while its keeper is there
  ("No this is an RP server"). docs/systems/stalls.md is the rule in prose.

  This file is only the book: who keeps each stall, what is laid out on it
  and at what price, and the words the stall's panel sends. It never touches
  the world, a pack or a purse; the market stalls block in game/gamemode.js
  does that, around these calls, and bundles this file
  (scripts/dev/Build-MarketStallsGamemode.js). The stalls themselves are
  tables (scripts/dev/Build-MarketStallTables.js).

  A STALL is a row of game/data/market-stalls.json: { id, hold, place, world,
  pos, reach }. Which stalls there are is the table's, built out of the
  plugins; the book only ever names a stall by its id.

  A KEEPER is a character, { actor, profile }, the way the trade ships'
  manifest names people (game/trade-cargo.js): never a name.

  A LINE is goods laid out on the stall: { n, entry, count, price }. entry is
  the pack's own entry with no count, so a piece crosses as it is, the way a
  trade carries it (docs/systems/trade.md). price is per piece, either
  { gold: <n> } or { goods: { base, count, name } }: n gold, or count pieces
  of the record base. An item has no gold price of its own (docs/DECIDED.md):
  the price is the keeper's, and nothing here suggests one.

  WHAT LEAVES A STALL WHEN ITS KEEPING ENDS. A claim lapses, a steward or
  staff end it, its keeper lets it go, or its keeper's character is deleted:
  the stall is free at once and what was laid out on it is written on the
  book as gone to the hold's drop box, each piece with a receipt
  (state.out). The block puts each into that box and only then takes its
  receipt off the book, and the box keeps the receipt, so a piece is put in
  once whichever of the two writes a crash comes between.

  Coin is never laid out: gold is a price, not goods.
*/

var GOLD_BASE = 15;
var MAX_LINES = 24;
var LAPSE_DAYS = 14;
var MAX_GOLD = 1000000;
var MAX_GOODS = 1000;
var MAX_COUNT = 2147483647;
var NAME_CHARS = 60;
var ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
var HOLDS = ['whiterun', 'solitude', 'riften', 'markarth', 'windhelm', 'falkreath',
             'morthal', 'dawnstar', 'winterhold', 'ravenrock'];
var DAY = 86400000;

function copy(v) { return JSON.parse(JSON.stringify(v)); }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function whole(n) { return Number.isInteger(n) && n > 0; }
function isCoin(base) { return (Number(base) >>> 0) === GOLD_BASE; }
function same(a, b) { return !!a && !!b && a.actor === b.actor && a.profile === b.profile; }
function party(v) {
  return isObj(v) && Number.isInteger(v.actor) && v.actor > 0 && v.actor <= 0xffffffff &&
    Number.isSafeInteger(v.profile) && v.profile > 0;
}

/* The stall table, checked whole. Answers the rows by id, or throws what is wrong. */
function checkTable(rows) {
  if (!Array.isArray(rows)) { throw new Error('The stall table is not a list.'); }
  var out = {};
  rows.forEach(function (r, i) {
    var at = 'stall ' + (i + 1);
    if (!isObj(r) || typeof r.id !== 'string' || !ID_RE.test(r.id)) { throw new Error(at + ' has no id.'); }
    if (has(out, r.id)) { throw new Error(at + ': ' + r.id + ' is in the table twice.'); }
    if (HOLDS.indexOf(r.hold) < 0) { throw new Error(r.id + ' is in no hold the ledgers know.'); }
    if (typeof r.place !== 'string' || !r.place) { throw new Error(r.id + ' has no place name.'); }
    if (typeof r.world !== 'string' || !/^[0-9a-f]{1,8}:[^:]+$/i.test(r.world)) { throw new Error(r.id + ' has no world or cell.'); }
    if (!Array.isArray(r.pos) || r.pos.length !== 3 || !r.pos.every(function (x) { return typeof x === 'number' && isFinite(x); })) {
      throw new Error(r.id + ' has no point.');
    }
    if (!(typeof r.reach === 'number' && r.reach > 0 && r.reach <= 2000)) { throw new Error(r.id + ' has no reach.'); }
    out[r.id] = { id: r.id, hold: r.hold, place: r.place, world: r.world, pos: r.pos.slice(), reach: r.reach };
  });
  return out;
}

/* A price as the panel and the book hold it, checked, or null. */
function priceOf(p) {
  if (!isObj(p)) { return null; }
  if (has(p, 'gold')) {
    return whole(p.gold) && p.gold <= MAX_GOLD && Object.keys(p).length === 1 ? { gold: p.gold } : null;
  }
  if (has(p, 'goods') && Object.keys(p).length === 1 && isObj(p.goods)) {
    var g = p.goods;
    if (!whole(g.base) || g.base > 0xffffffff || isCoin(g.base) || !whole(g.count) || g.count > MAX_GOODS) { return null; }
    if (typeof g.name !== 'string' || !g.name || g.name.length > NAME_CHARS) { return null; }
    return { goods: { base: g.base, count: g.count, name: g.name } };
  }
  return null;
}

/* What n pieces cost: { gold } or { goods: { base, count, name } }, or null past what can be paid. */
function costOf(price, n) {
  if (price.gold) {
    var t = price.gold * n;
    return t <= MAX_COUNT ? { gold: t } : null;
  }
  var c = price.goods.count * n;
  return c <= MAX_COUNT ? { goods: { base: price.goods.base, count: c, name: price.goods.name } } : null;
}

function priceWords(price) {
  if (price.gold) { return price.gold + ' gold'; }
  return price.goods.count + ' ' + price.goods.name;
}

function entryOk(e) {
  return isObj(e) && Number.isInteger(e.baseId) && e.baseId > 0 && e.baseId <= 0xffffffff && !isCoin(e.baseId) &&
    !has(e, 'count') && !has(e, 'worn') && !has(e, 'wornLeft');
}
function shape(e) { return JSON.stringify(e); }

function emptyState() { return { stalls: {}, out: [], next: 1 }; }

/*
  THE REGISTER, private/market-stalls.json: { version: 1, state }. Read row
  by row and refused whole when one does not verify: a book that is there
  and does not read is never opened empty, because the next write would
  throw away everything laid out on every stall. A stall the table no longer
  has keeps its row, and the block ends it (whatever was on it goes to the
  hold's box it was in).
*/
function openRegister(text) {
  if (text === null || text === undefined || text === '') { return emptyState(); }
  var o = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  if (!isObj(o) || o.version !== 1 || !isObj(o.state)) { throw new Error('It is not a stall book.'); }
  var s = o.state;
  if (!isObj(s.stalls) || !Array.isArray(s.out) || !whole(s.next)) { throw new Error('It is not a stall book.'); }
  var out = emptyState();
  out.next = s.next;
  Object.keys(s.stalls).forEach(function (id) {
    var r = s.stalls[id];
    if (!ID_RE.test(id) || !isObj(r)) { throw new Error('Stall ' + id + ' does not read.'); }
    if (!(r.keeper === null || party(r.keeper))) { throw new Error('Stall ' + id + ' has a keeper who does not read.'); }
    if (HOLDS.indexOf(r.hold) < 0) { throw new Error('Stall ' + id + ' is in no hold.'); }
    if (!Number.isSafeInteger(r.since) || !Number.isSafeInteger(r.last) || !Array.isArray(r.lines)) {
      throw new Error('Stall ' + id + ' does not read.');
    }
    var lines = r.lines.map(function (l) {
      if (!isObj(l) || !whole(l.n) || l.n >= s.next || !entryOk(l.entry) || !whole(l.count) || !priceOf(l.price)) {
        throw new Error('A line on stall ' + id + ' does not read.');
      }
      return { n: l.n, entry: copy(l.entry), count: l.count, price: priceOf(l.price) };
    });
    if (lines.length > MAX_LINES) { throw new Error('Stall ' + id + ' holds more than ' + MAX_LINES + ' lines.'); }
    if (r.keeper === null && lines.length) { throw new Error('Stall ' + id + ' holds goods with no keeper.'); }
    out.stalls[id] = { keeper: r.keeper ? copy(r.keeper) : null, hold: r.hold, since: r.since, last: r.last, lines: lines };
  });
  s.out.forEach(function (x) {
    if (!isObj(x) || typeof x.receipt !== 'string' || !/^stall:[0-9]+$/.test(x.receipt) || HOLDS.indexOf(x.hold) < 0 ||
        !entryOk(x.entry) || !whole(x.count) || !(x.of === null || party(x.of)) || typeof x.why !== 'string') {
      throw new Error('A piece on its way to a drop box does not read.');
    }
    out.out.push({ receipt: x.receipt, hold: x.hold, entry: copy(x.entry), count: x.count, of: x.of ? copy(x.of) : null, why: x.why });
  });
  return out;
}

function saveRegister(state) { return JSON.stringify({ version: 1, state: state }, null, 1); }

function rec(state, id) {
  var r = state.stalls[id];
  return r || null;
}
function keeperOf(state, id) { var r = rec(state, id); return r ? r.keeper : null; }
function keeps(state, id, who) { return same(keeperOf(state, id), who); }

function mine(state, id, who) {
  var r = rec(state, id);
  if (!r || !r.keeper) { throw new Error('Nobody keeps this stall.'); }
  if (!same(r.keeper, who)) { throw new Error('This stall is not yours.'); }
  return r;
}

/* Claiming costs nothing, and only a free stall can be claimed (property.md). */
function claim(state, stall, who, now) {
  if (!party(who)) { throw new Error('Who is claiming cannot be read.'); }
  var r = rec(state, stall.id);
  if (r && r.keeper) {
    throw new Error(same(r.keeper, who) ? 'This stall is already yours.' : 'Somebody already keeps this stall.');
  }
  state.stalls[stall.id] = { keeper: copy(who), hold: stall.hold, since: now, last: now, lines: [] };
}

/* The keeper was here: the 14 day clock starts again, the way living in a house keeps it. */
function touch(state, id, who, now) {
  var r = rec(state, id);
  if (r && same(r.keeper, who)) { r.last = now; return true; }
  return false;
}

function lineOf(r, n) {
  for (var i = 0; i < r.lines.length; i++) { if (r.lines[i].n === n) { return i; } }
  return -1;
}

/* A piece out of the keeper's pack, onto the stall at a price. Onto its own line, or the line of the same piece at the same price. */
function lay(state, id, who, piece, price) {
  var r = mine(state, id, who);
  var p = priceOf(price);
  if (!p) { throw new Error('That price cannot be read.'); }
  if (!isObj(piece) || !whole(piece.count)) { throw new Error('That cannot be laid out.'); }
  var entry = copy(piece);
  delete entry.count;
  if (isCoin(entry.baseId)) { throw new Error('Gold is a price, not goods.'); }
  if (!entryOk(entry)) { throw new Error('That cannot be laid out.'); }
  var key = shape(entry), pk = JSON.stringify(p);
  for (var i = 0; i < r.lines.length; i++) {
    var l = r.lines[i];
    if (shape(l.entry) === key && JSON.stringify(l.price) === pk) {
      if (l.count + piece.count > MAX_COUNT) { throw new Error('That line cannot hold that many.'); }
      l.count += piece.count;
      return l.n;
    }
  }
  if (r.lines.length >= MAX_LINES) { throw new Error('The stall holds ' + MAX_LINES + ' lines at most.'); }
  var n = state.next++;
  r.lines.push({ n: n, entry: entry, count: piece.count, price: p });
  return n;
}

function setPrice(state, id, who, n, price) {
  var r = mine(state, id, who);
  var p = priceOf(price);
  if (!p) { throw new Error('That price cannot be read.'); }
  var at = lineOf(r, n);
  if (at < 0) { throw new Error('That is not on the stall.'); }
  r.lines[at].price = p;
}

/* count pieces of line n off the stall: answers the piece, with its count. */
function takeOff(state, id, n, count) {
  var r = rec(state, id);
  var at = r ? lineOf(r, n) : -1;
  if (at < 0) { throw new Error('That is not on the stall.'); }
  var l = r.lines[at];
  if (!whole(count) || count > l.count) { throw new Error('There are not that many.'); }
  var before = copy(l);
  var piece = copy(l.entry);
  piece.count = count;
  l.count -= count;
  if (l.count <= 0) { r.lines.splice(at, 1); }
  return { piece: piece, price: copy(l.price), line: before };
}

/* The keeper takes goods back off their own stall: the piece, and the line as it was for restoreLine. */
function takeBack(state, id, who, n, count) {
  mine(state, id, who);
  var off = takeOff(state, id, n, count);
  return { piece: off.piece, line: off.line };
}

/* A sale off the stall: the piece and what it costs. The block checks the keeper is there before it asks. */
function sell(state, id, n, count) {
  var r = rec(state, id);
  if (!r || !r.keeper) { throw new Error('Nobody keeps this stall.'); }
  var at = lineOf(r, n);
  if (at < 0) { throw new Error('That is not on the stall any more.'); }
  var cost = costOf(r.lines[at].price, count);
  if (!cost) { throw new Error('That is more than can be paid at once.'); }
  var off = takeOff(state, id, n, count);
  return { piece: off.piece, cost: cost, keeper: copy(r.keeper), line: off.line };
}

/* A line put back as it was, when the rest of a sale or a take back could not be done. */
function restoreLine(state, id, line) {
  var r = rec(state, id);
  if (!r || !r.keeper) { throw new Error('Nobody keeps this stall now.'); }
  var at = lineOf(r, line.n);
  if (at >= 0) { r.lines[at].count = line.count; return; }
  r.lines.push(copy(line));
  r.lines.sort(function (a, b) { return a.n - b.n; });
}

/*
  The keeping ends: the stall is free, and every line goes on its way to the
  hold's drop box with a receipt, for its keeper by name, or with no name
  when their character was deleted. Answers how many lines went.
*/
function end(state, id, why, keepName) {
  var r = rec(state, id);
  if (!r || !r.keeper) { return 0; }
  var of = keepName === false ? null : copy(r.keeper);
  var n = r.lines.length;
  r.lines.forEach(function (l) {
    state.out.push({ receipt: 'stall:' + (state.next++), hold: r.hold, entry: copy(l.entry), count: l.count, of: of, why: String(why || '') });
  });
  delete state.stalls[id];
  return n;
}

/*
  A piece bought whose buyer's pack would not take it: on its way to the
  hold's drop box for them, with a receipt like a stall's goods.
*/
function toBox(state, hold, piece, of, why) {
  if (HOLDS.indexOf(hold) < 0) { throw new Error('That is in no hold.'); }
  var entry = copy(piece);
  delete entry.count;
  if (!entryOk(entry) || !whole(piece.count)) { throw new Error('That piece cannot go to a drop box.'); }
  state.out.push({ receipt: 'stall:' + (state.next++), hold: hold, entry: entry, count: piece.count, of: of ? copy(of) : null, why: String(why || '') });
}

/* The receipt is in the drop box: off the book. */
function delivered(state, receipt) {
  var before = state.out.length;
  state.out = state.out.filter(function (x) { return x.receipt !== receipt; });
  return state.out.length < before;
}

/* The stalls whose keeper has not been there for days. */
function lapsed(state, now, days) {
  var d = whole(days) ? days : LAPSE_DAYS;
  return Object.keys(state.stalls).filter(function (id) {
    var r = state.stalls[id];
    return r.keeper && now - r.last > d * DAY;
  });
}

/*
  A deleted person, or a character reset or wiped (#2351, #2668); who is the
  release's { actor(n), profile(n) }. A stall is kept by the character who
  claimed it, so it ends when either is listed. When the person is deleted
  (their profile is listed) its goods go to the hold's box with their name
  off, and a piece already on its way loses it too, the way the box keeps a
  deleted character's coin. When only the character goes and the person
  stays, its goods go to the box for them, and they take them back there.
*/
function release(state, who) {
  var counts = { stalls: 0, pieces: 0 };
  var person = function (p) { return !!p && who.profile(p.profile); };
  var character = function (p) { return !!p && (who.actor(p.actor) || who.profile(p.profile)); };
  Object.keys(state.stalls).forEach(function (id) {
    var k = state.stalls[id].keeper;
    if (character(k)) { counts.stalls++; end(state, id, 'its keeper is gone', !person(k)); }
  });
  state.out.forEach(function (x) { if (person(x.of)) { x.of = null; counts.pieces++; } });
  return counts;
}

function countsOf(state) {
  var kept = 0, lines = 0;
  Object.keys(state.stalls).forEach(function (id) {
    if (state.stalls[id].keeper) { kept++; lines += state.stalls[id].lines.length; }
  });
  return { kept: kept, lines: lines, out: state.out.length };
}

/*
  THE WORDS THE PANEL SENDS (game/ui/thornswood-stall.js), never typed:

    /stall open <id>                            the lock key at a stall
    /stall claim                                Claim this stall
    /stall lay <base> <nth> <count> gold <n>    Lay it out, at n gold a piece
    /stall lay <base> <nth> <count> goods <base> <n>   at n of those a piece
    /stall price <line> gold <n> | goods <base> <n>
    /stall back <line> <count>                  Take back
    /stall buy <line> <count>                   Buy
    /stall find <words ...>                     what a goods price can name
    /stall letgo                                Let the stall go
    /stall end                                  a steward or staff: End this claim
    /stall close

  A base is hex, every other number decimal.
*/
function parse(parts) {
  var p = Array.isArray(parts) ? parts.map(function (x) { return String(x); }) : [];
  var verb = String(p[1] || '').toLowerCase();
  var n = function (s) { return /^[0-9]{1,10}$/.test(String(s)) ? Number(s) : NaN; };
  var h = function (s) { return /^[0-9a-f]{1,8}$/i.test(String(s)) ? parseInt(s, 16) >>> 0 : NaN; };
  var price = function (at) {
    var k = String(p[at] || '').toLowerCase();
    if (k === 'gold') { return { gold: n(p[at + 1]) }; }
    if (k === 'goods') { return { goods: { base: h(p[at + 1]), count: n(p[at + 2]) } }; }
    return null;
  };
  var priced = function (pr) {
    if (!pr) { return false; }
    if (pr.gold !== undefined) { return whole(pr.gold) && pr.gold <= MAX_GOLD; }
    return whole(pr.goods.base) && !isCoin(pr.goods.base) && whole(pr.goods.count) && pr.goods.count <= MAX_GOODS;
  };
  if (verb === 'close' || verb === 'claim' || verb === 'letgo' || verb === 'end') { return { verb: verb }; }
  if (verb === 'open') {
    return ID_RE.test(String(p[2] || '')) ? { verb: 'open', id: p[2] } : { why: 'Which stall?' };
  }
  if (verb === 'lay') {
    var l = { verb: 'lay', base: h(p[2]), nth: n(p[3]), count: n(p[4]), price: price(5) };
    if (!whole(l.base) || !Number.isInteger(l.nth) || !whole(l.count)) { return { why: 'That cannot be read.' }; }
    if (!priced(l.price)) { return { why: 'Say a price: a number of gold, or a number of something.' }; }
    return l;
  }
  if (verb === 'price') {
    var r = { verb: 'price', line: n(p[2]), price: price(3) };
    if (!whole(r.line)) { return { why: 'That cannot be read.' }; }
    if (!priced(r.price)) { return { why: 'Say a price: a number of gold, or a number of something.' }; }
    return r;
  }
  if (verb === 'back' || verb === 'buy') {
    var b = { verb: verb, line: n(p[2]), count: n(p[3]) };
    return whole(b.line) && whole(b.count) ? b : { why: 'Say how many.' };
  }
  if (verb === 'find') {
    var words = p.slice(2).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    return words.length >= 2 && words.length <= NAME_CHARS ? { verb: 'find', words: words } : { why: 'Say at least two letters of its name.' };
  }
  return { why: 'The stall does not know that.' };
}

/*
  What the panel shows this person at this stall. Worked out here, never in
  the page: the keeper's own controls only to the keeper, End this claim
  only to an officer, and the wares to everybody. The keeper is never named:
  whoever stands at the stall is who sells there.

    input: { stall, state, viewer, keeperHere, officer, pack, packGold,
             itemName, found, said }
*/
function stallView(input) {
  var st = input.stall, r = rec(input.state, st.id);
  var keeper = r ? r.keeper : null;
  var mineToo = !!keeper && same(keeper, input.viewer);
  var v = {
    open: true, id: st.id, place: st.place, free: !keeper, mine: mineToo,
    keeperHere: !!keeper && !!input.keeperHere, officer: !!input.officer && !!keeper && !mineToo,
    lines: [], max: MAX_LINES, said: input.said || ''
  };
  if (r && keeper) {
    v.lines = r.lines.map(function (l) {
      return { n: l.n, what: input.itemName(Object.assign({ count: l.count }, l.entry)), count: l.count,
               price: copy(l.price), words: priceWords(l.price) };
    });
  }
  if (mineToo) {
    v.pack = (input.pack || []).map(function (x) { return { base: x.baseId.toString(16), nth: x.nth, count: x.count, what: x.name }; });
    v.found = (input.found || []).map(function (f) { return { base: f.base.toString(16), name: f.name }; });
    v.lapseDays = LAPSE_DAYS;
  }
  if (!mineToo && keeper) { v.packGold = Number(input.packGold) || 0; }
  return v;
}

module.exports = {
  GOLD_BASE: GOLD_BASE, MAX_LINES: MAX_LINES, LAPSE_DAYS: LAPSE_DAYS, MAX_GOLD: MAX_GOLD, MAX_GOODS: MAX_GOODS,
  HOLDS: HOLDS, isCoin: isCoin, same: same,
  checkTable: checkTable, priceOf: priceOf, costOf: costOf, priceWords: priceWords,
  openRegister: openRegister, saveRegister: saveRegister, emptyState: emptyState,
  keeperOf: keeperOf, keeps: keeps, claim: claim, touch: touch, lay: lay, setPrice: setPrice,
  takeBack: takeBack, sell: sell, restoreLine: restoreLine, end: end, toBox: toBox, delivered: delivered, lapsed: lapsed,
  release: release, countsOf: countsOf, parse: parse, stallView: stallView
};
