// MARKET STALLS BUNDLE BEGIN
// Built by scripts\dev\Build-MarketStallsGamemode.js out of game\market-stalls.js. Do not hand edit.
const MARKET_STALLS_BOOK = (function () {
const module = { exports: {} };
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
  (scripts/dev/Build-MarketStallsGamemode.js).

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
return module.exports;
})();
// MARKET STALLS BUNDLE END
// The stalls of game\data\market-stalls.json, as scripts\dev\Build-MarketStallsGamemode.js writes them.
var MARKET_STALL_TABLE = table('MARKET_STALL_TABLE');
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined' ? globalThis : this);
  var fs = require('fs'), path = require('path');
  var BOOK = MARKET_STALLS_BOOK;
  function slog() {
    var a = Array.prototype.slice.call(arguments);
    if (typeof log === 'function') { log.apply(null, ['[stalls]'].concat(a)); } else { console.log('[thornswood] [stalls] ' + a.join(' ')); }
  }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }

  var stalls = null;
  try { stalls = BOOK.checkTable(MARKET_STALL_TABLE); }
  catch (eTable) { slog('the stall table does not read (' + ((eTable && eTable.message) || eTable) + '), so no stall is open at this start'); stalls = null; }

  // The privDir server-settings.json names, or private when it names none;
  // a settings file that will not read names no folder (#2871), as for the ships.
  var privDir = 'private';
  var settingsWhy = '';
  try {
    var cfg = JSON.parse(String(fs.readFileSync('server-settings.json', 'utf8')).replace(/^\uFEFF/, ''));
    if (cfg && cfg.privDir) { privDir = String(cfg.privDir); }
  } catch (e) { settingsWhy = String((e && (e.code || e.message)) || e); }
  var FILE = path.resolve(privDir, 'market-stalls.json');

  var unreadable = settingsWhy ? 'server-settings.json could not be read' : '';
  var state = null;
  (function read() {
    if (unreadable) { return; }
    var t = null;
    try { t = fs.readFileSync(FILE, 'utf8'); }
    catch (e) { if (!e || e.code !== 'ENOENT') { unreadable = String((e && e.code) || e); } }
    if (unreadable) { return; }
    try { state = BOOK.openRegister(t); }
    catch (e2) { unreadable = String((e2 && e2.message) || e2); state = null; }
  })();
  if (settingsWhy) {
    slog('server-settings.json could not be read (' + settingsWhy + '), so where the stall book is is not known: no stall is open at this start and nothing is written');
  } else if (unreadable) {
    slog(FILE, 'could not be read (' + unreadable + '), so no stall is open at this start and nothing is written over it until it is put right');
  }

  function commit(next) {
    if (unreadable || !state) { return false; }
    try {
      var text = BOOK.saveRegister(next);
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE + '.tmp', text);
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (e) {
      slog('could not write', FILE + ':', (e && e.message) || e);
      return false;
    }
    state = next;
    return true;
  }
  /* One change to the book: f(next) on a copy, kept only when it is written. Answers what f answered. */
  function change(f) {
    var next = copy(state);
    var r = f(next);
    if (!commit(next)) { throw new Error('The stall book could not be written, so nothing changed.'); }
    return r;
  }

  function prop() { return g.__thornswoodProperty || null; }
  function profileOf(actorId) {
    try { return Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { return 0; }
  }
  function partyOf(actorId) { return { actor: Number(actorId) >>> 0, profile: profileOf(actorId) }; }
  function nameOfActor(actorId) {
    try { var ap = mp.get(actorId, 'appearance'); return ap && ap.name ? String(ap.name) : ''; } catch (e) { return ''; }
  }
  function itemName(entry) {
    var p = prop();
    try { if (p && typeof p.itemName === 'function') { return String(p.itemName(entry)); } } catch (e) { }
    return entry && typeof entry.name === 'string' && entry.name ? entry.name : 'Goods';
  }
  function hook(name, pid) {
    var f = g[name];
    try { return typeof f === 'function' && !!f(Number(pid) || 0); } catch (e) { return false; }
  }

  /* Standing at the stall: in its world or cell, within its reach of the point in front of its counter. */
  function at(actorId, stall) {
    try {
      if (String(mp.get(actorId, 'worldOrCellDesc') || '').toLowerCase() !== stall.world.toLowerCase()) { return false; }
      var a = mp.get(actorId, 'pos');
      var dx = a[0] - stall.pos[0], dy = a[1] - stall.pos[1], dz = a[2] - stall.pos[2];
      return dx * dx + dy * dy + dz * dz <= stall.reach * stall.reach;
    } catch (e) { return false; }
  }

  /* The keeper is there: in the world, the same character, and at the stall. */
  function keeperHere(id) {
    var k = BOOK.keeperOf(state, id);
    if (!k) { return false; }
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    var inWorld = online.some(function (x) { return (Number(x) >>> 0) === k.actor; });
    return inWorld && profileOf(k.actor) === k.profile && at(k.actor, stalls[id]);
  }

  // ------------------------------------------------------------ the packs --

  function entriesOf(actorId) {
    var inv = mp.get(actorId, 'inventory');
    return copy((inv && inv.entries) || []);
  }
  function writePack(actorId, entries) { mp.set(actorId, 'inventory', { entries: entries }); }

  /* What they carry to lay out, coin and worn pieces left out: [{ baseId, nth, count, name }]. nth is which stack of that base. */
  function packList(actorId) {
    var entries = [];
    try { entries = entriesOf(actorId); } catch (e) { return []; }
    var nth = {}, out = [];
    entries.forEach(function (e) {
      if (!e || !Number.isInteger(e.baseId) || !(e.count > 0)) { return; }
      var k = nth[e.baseId] = (nth[e.baseId] === undefined ? 0 : nth[e.baseId] + 1);
      if (BOOK.isCoin(e.baseId) || e.worn || e.wornLeft || questItemBlocked(e.baseId)) { return; }
      out.push({ baseId: e.baseId, nth: k, count: e.count, name: itemName(e) });
    });
    return out.slice(0, 200);
  }

  function goldOf(actorId) {
    var n = 0;
    try { entriesOf(actorId).forEach(function (e) { if (e && BOOK.isCoin(e.baseId)) { n += Number(e.count) || 0; } }); } catch (e) { n = 0; }
    return n;
  }

  /* n of that stack out of the pack, every other field kept. */
  function packTake(actorId, base, nthOf, n) {
    if (BOOK.isCoin(base)) { throw new Error('Gold is a price, not goods.'); }
    if (questItemBlocked(base)) { throw new Error('Quest items stay with their assigned work.'); }
    var entries = entriesOf(actorId);
    var seen = -1, i = -1;
    for (var k = 0; k < entries.length; k++) {
      if (entries[k] && entries[k].baseId === base && ++seen === nthOf) { i = k; break; }
    }
    if (i < 0 || !(entries[i].count >= n)) { throw new Error('You do not carry that many.'); }
    if (entries[i].worn || entries[i].wornLeft) { throw new Error('Take it off first.'); }
    var piece = copy(entries[i]);
    piece.count = n;
    entries[i].count -= n;
    if (entries[i].count <= 0) { entries.splice(i, 1); }
    writePack(actorId, entries);
    return piece;
  }

  /* Pieces into the pack, each onto the stack it matches or as its own. */
  function packGive(actorId, pieces) {
    var entries = entriesOf(actorId);
    var shape = function (e) { var c = copy(e); delete c.count; return JSON.stringify(c); };
    pieces.forEach(function (p) {
      var want = shape(p), done = false;
      for (var i = 0; i < entries.length && !done; i++) {
        if (entries[i] && shape(entries[i]) === want) { entries[i].count += p.count; done = true; }
      }
      if (!done) { entries.push(copy(p)); }
    });
    writePack(actorId, entries);
  }

  /*
    count pieces of one record out of the pack, worn ones left alone, from
    whichever stacks hold it: the pieces as they were, each with its count.
    Gold is the record 0xF, so a gold price comes out the same way.
  */
  function packPay(actorId, base, count) {
    var entries = entriesOf(actorId);
    var have = 0;
    entries.forEach(function (e) { if (e && e.baseId === base && !e.worn && !e.wornLeft) { have += Number(e.count) || 0; } });
    if (have < count) { return null; }
    var left = count, out = [];
    for (var i = 0; i < entries.length && left > 0; i++) {
      var e = entries[i];
      if (!e || e.baseId !== base || e.worn || e.wornLeft) { continue; }
      var take = Math.min(left, Number(e.count) || 0);
      var piece = copy(e);
      piece.count = take;
      out.push(piece);
      e.count -= take;
      left -= take;
    }
    writePack(actorId, entries.filter(function (e) { return !(e && e.count <= 0); }));
    return out;
  }

  // ------------------------------------------------- the hold's drop box --

  /*
    What was on a stall whose keeping ended goes into its hold's drop box,
    for its keeper by name, who takes it back there like anything they put
    in; with no name, for the hold's officers, when the keeper is gone. The
    box keeps the receipt, so a piece the book still lists after a crash is
    not put in twice.
  */
  function sendOut() {
    var p = prop();
    if (!state || !state.out.length) { return; }
    if (!p || typeof p.boxKeep !== 'function') {
      slog(state.out.length, 'piece(s) wait to go to a drop box, and the property block has no box to take them');
      return;
    }
    state.out.slice().forEach(function (x) {
      var who = x.of ? { profile: x.of.profile, name: nameOfActor(x.of.actor) || 'the stall\'s keeper' } : null;
      if (!p.boxKeep(x.hold, x.entry, x.count, x.receipt, who, x.why)) {
        slog('a piece from a stall could not go into', x.hold + '\'s drop box; it waits on the book for the next try');
        return;
      }
      try { change(function (next) { BOOK.delivered(next, x.receipt); }); }
      catch (e) { slog('a piece is in', x.hold + '\'s drop box, and the book could not mark it; the box\'s receipt keeps it from going in twice'); }
    });
  }

  function endStall(id, why) {
    var n = change(function (next) { return BOOK.end(next, id, why); });
    sendOut();
    return n;
  }

  /* Every stall past its 14 days ends, the way a claim lapses (property.md). */
  function lapse() {
    BOOK.lapsed(state, Date.now(), BOOK.LAPSE_DAYS).forEach(function (id) {
      try { var n = endStall(id, 'its keeper was away ' + BOOK.LAPSE_DAYS + ' days'); slog('a stall lapsed;', n, 'line(s) went to its hold\'s drop box'); }
      catch (e) { slog('a stall lapsed and could not be written:', (e && e.message) || e); }
    });
  }

  function release(who) {
    if (unreadable || !state) { return { counts: { stalls: 0, pieces: 0 }, saved: false }; }
    var next = copy(state);
    var c = BOOK.release(next, who);
    if (!c.stalls && !c.pieces) { return { counts: c, saved: true }; }
    return { counts: c, saved: commit(next) };
  }
  if (typeof g.__thornswoodRelease === 'function') { g.__thornswoodRelease('stalls', release); }

  if (!stalls || !state) { return; }

  // A stall the table no longer has ends, and what was on it goes to its hold's box.
  Object.keys(state.stalls).forEach(function (id) {
    if (!stalls[id]) {
      try { endStall(id, 'the stall is no longer in the market'); } catch (e) { slog('a stall that left the table could not be ended:', (e && e.message) || e); }
    }
  });
  lapse();
  sendOut();
  var counts = BOOK.countsOf(state);
  slog('ready:', Object.keys(stalls).length, 'stall(s),', counts.kept, 'kept,', counts.lines, 'line(s) laid out,',
       counts.out, 'piece(s) waiting for a drop box');

  // ------------------------------------------------------------ the panel --

  var VIEW = 'thornswoodStallView';
  try {
    mp.makeProperty(VIEW, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: [
        '(function(){',
        '  try {',
        '    var v = ctx.value;',
        '    if (!v || typeof v !== "object") { return; }',
        '    var st = ctx.state;',
        '    if (!st || st.thornswoodStallAt === v.at) { return; }',
        '    st.thornswoodStallAt = v.at;',
        '    var body = JSON.stringify(v);',
        '    ctx.sp.browser.executeJavaScript("(function(){try{var d=" + body + ";if(window.thornswoodStall&&window.thornswoodStall.setData){window.thornswoodStall.setData(d);}}catch(e){}})();");',
        '  } catch (e) { }',
        '})();'
      ].join('\n'),
      updateNeighbor: ''
    });
  } catch (eProp) { /* made by an earlier load. harmless. */ }

  var sessions = {}, viewAt = 0;
  var SESSION_MS = 10 * 60 * 1000;   // a panel left open this long asks for the stall again

  function push(actorId, view) {
    viewAt = Math.max(Date.now(), viewAt + 1);
    view.at = viewAt;
    try { mp.set(actorId, VIEW, view); } catch (e) { }
  }

  /* May this person end somebody's keeping here: a steward of the stall's hold, or staff, logged. */
  function officer(profileId, stall) {
    var p = prop();
    try { if (p && typeof p.isStewardOf === 'function' && p.isStewardOf(profileId, stall.hold)) { return 'steward'; } } catch (e) { }
    return hook('__thornswoodIsStaff', profileId) ? 'staff' : '';
  }

  function show(actorId, profileId, said) {
    var s = sessions[actorId];
    var st = stalls[s.id];
    var me = partyOf(actorId);
    push(actorId, BOOK.stallView({
      stall: st, state: state, viewer: me, keeperHere: keeperHere(s.id), officer: !!officer(profileId, st),
      pack: BOOK.keeps(state, s.id, me) ? packList(actorId) : [], packGold: goldOf(actorId),
      itemName: itemName, found: s.found || [], said: said || ''
    }));
  }

  /* Names a goods price can ask for, out of the two name tables /give reads: at most 12. */
  function find(words) {
    var out = [], seen = {};
    var tables = [];
    if (typeof ITEM_NAMES !== 'undefined') { tables.push(ITEM_NAMES); }
    if (typeof ADMIN_ITEMS !== 'undefined') { tables.push(ADMIN_ITEMS); }
    for (var t = 0; t < tables.length && out.length < 12; t++) {
      for (var k in tables[t]) {
        if (out.length >= 12) { break; }
        if (!Object.prototype.hasOwnProperty.call(tables[t], k) || k.indexOf(words) < 0 || seen[k]) { continue; }
        var base = typeof idOf === 'function' ? (Number(idOf(tables[t][k][1])) >>> 0) : 0;
        if (!base || BOOK.isCoin(base)) { continue; }
        seen[k] = true;
        out.push({ base: base, name: String(tables[t][k][0]) });
      }
    }
    return out;
  }

  function priceFor(p) {
    if (p.gold !== undefined) { return { gold: p.gold }; }
    var nm = itemName({ baseId: p.goods.base });
    return { goods: { base: p.goods.base, count: p.goods.count, name: nm.slice(0, 60) } };
  }

  function lay(w, actorId) {
    var id = sessions[actorId].id, me = partyOf(actorId);
    if (!BOOK.keeps(state, id, me)) { throw new Error('This stall is not yours.'); }
    var price = priceFor(w.price);
    var piece = packTake(actorId, w.base, w.nth, w.count);
    try { change(function (next) { BOOK.lay(next, id, me, piece, price); }); }
    catch (e) {
      try { packGive(actorId, [piece]); } catch (eBack) {
        slog('could not lay out', JSON.stringify(piece), 'and could not put it back in the pack:', (eBack && eBack.message) || eBack);
        throw new Error('It could not be laid out, and it could not be put back in your pack. Say so in the dev channel.');
      }
      throw e;
    }
    return 'Laid out at ' + BOOK.priceWords(BOOK.priceOf(price)) + ' a piece.';
  }

  function takeBack(w, actorId) {
    var id = sessions[actorId].id, me = partyOf(actorId);
    var off = change(function (next) { return BOOK.takeBack(next, id, me, w.line, w.count); });
    try { packGive(actorId, [off.piece]); } catch (e) {
      change(function (next) { BOOK.restoreLine(next, id, off.line); });
      throw new Error('It could not be put in your pack, so it stays on the stall.');
    }
    return 'Taken back.';
  }

  /*
    A sale. The keeper must be at the stall (Patrick, 22 Oct: a stall sells
    only while its keeper is there). The price comes out of the buyer's
    pack, the book is written, the goods go to the buyer and the price to
    the keeper standing there.
  */
  function buy(w, actorId) {
    var id = sessions[actorId].id, me = partyOf(actorId);
    if (BOOK.keeps(state, id, me)) { throw new Error('It is your own stall.'); }
    if (!keeperHere(id)) { throw new Error('The keeper is not at the stall, so nothing is sold.'); }
    var probe = copy(state);
    var sale = BOOK.sell(probe, id, w.line, w.count);
    var base = sale.cost.gold ? BOOK.GOLD_BASE : sale.cost.goods.base;
    var owed = sale.cost.gold || sale.cost.goods.count;
    var paid = packPay(actorId, base, owed);
    if (!paid) {
      throw new Error(sale.cost.gold ? 'You do not carry ' + owed + ' gold.' : 'You do not carry ' + owed + ' ' + sale.cost.goods.name + '.');
    }
    var done = null;
    try { done = change(function (next) { return BOOK.sell(next, id, w.line, w.count); }); }
    catch (e) { packGive(actorId, paid); throw e; }
    // The keeper is paid before the piece moves, so a pack that will not take
    // the price undoes the whole sale and nothing is lost.
    try { packGive(done.keeper.actor, paid); }
    catch (ePay) {
      change(function (next) { BOOK.restoreLine(next, id, done.line); });
      packGive(actorId, paid);
      throw new Error('The keeper\'s pack could not take the price, so nothing was sold.');
    }
    var whatName = itemName(done.piece);
    var boxed = false;
    try { packGive(actorId, [done.piece]); }
    catch (eGive) {
      // Paid for and the keeper paid: it waits in the hold's drop box for the buyer.
      change(function (next) { BOOK.toBox(next, stalls[id].hold, done.piece, me, 'bought at a stall, and your pack would not take it'); });
      sendOut();
      boxed = true;
    }
    var keeperNote = (w.count > 1 ? w.count + ' ' : '') + whatName + ' sold for ' + (sale.cost.gold ? owed + ' gold.' : owed + ' ' + sale.cost.goods.name + '.');
    var sayLine = g.__thornswoodSayLine;
    if (typeof sayLine === 'function') { try { sayLine(done.keeper.profile, keeperNote); } catch (eSay) { } }
    if (sessions[done.keeper.actor] && sessions[done.keeper.actor].id === id) {
      show(done.keeper.actor, done.keeper.profile, keeperNote);
    }
    if (boxed) { return 'Bought ' + (w.count > 1 ? w.count + ' ' : '') + whatName + '. Your pack would not take it, so it is in this hold\'s drop box for you.'; }
    return 'Bought ' + (w.count > 1 ? w.count + ' ' : '') + whatName + '.';
  }

  function endBy(actorId, profileId, cmd) {
    var id = sessions[actorId].id, st = stalls[id];
    var k = BOOK.keeperOf(state, id);
    if (!k) { throw new Error('Nobody keeps this stall.'); }
    var as = officer(profileId, st);
    if (!as) { throw new Error('Only this hold\'s steward, or staff, can end somebody\'s keeping of a stall.'); }
    var staff = g['__thornswoodStaff'];
    if (as === 'staff') {
      if (!staff || typeof staff.unproven !== 'function' || typeof staff.record !== 'function') {
        throw new Error('The staff log is not loaded on this server, so no staff press is taken. Say so in the dev channel.');
      }
      var unproven = staff.unproven(cmd, profileId);
      if (unproven) { throw new Error(unproven); }
    }
    var whoName = nameOfActor(k.actor) || 'somebody';
    var n = endStall(id, as === 'staff' ? 'staff ended the keeping' : 'the steward ended the keeping');
    if (as === 'staff') {
      staff.record('evict', Number(profileId) || 0, nameOfActor(actorId), k.profile, whoName,
        'the market stall ' + st.place, 0, { stall: id, hold: st.hold, as: 'staff' });
    }
    slog('a stall\'s keeping was ended by the', as + ';', n, 'line(s) went to its hold\'s drop box');
    return 'The stall is free. What was on it went to the hold\'s drop box' + (n ? ', for its keeper.' : '.');
  }

  /* The panel's words. Answers a line for the chat, or ''. */
  function command(parts, actorId, profileId, cmd) {
    var w = BOOK.parse(parts);
    if (w.why) { return w.why; }
    if (w.verb === 'close') { sessions[actorId] = null; push(actorId, { open: false }); return ''; }
    if (w.verb === 'open') {
      var st = stalls[w.id];
      if (!st || !at(actorId, st)) { return 'Stand at the stall.'; }
      lapse();
      sessions[actorId] = { id: w.id, at: Date.now(), found: [] };
      var me = partyOf(actorId);
      if (BOOK.keeps(state, w.id, me)) {
        try { change(function (next) { BOOK.touch(next, w.id, me, Date.now()); }); } catch (eTouch) { }
      }
      show(actorId, profileId, '');
      return '';
    }
    var s = sessions[actorId];
    if (!s || Date.now() - s.at > SESSION_MS || !at(actorId, stalls[s.id])) {
      sessions[actorId] = null;
      push(actorId, { open: false });
      return 'Stand at the stall.';
    }
    s.at = Date.now();
    var said = '';
    try {
      if (w.verb === 'claim') {
        var who = partyOf(actorId);
        change(function (next) { BOOK.claim(next, stalls[s.id], who, Date.now()); });
        said = 'The stall is yours. Lay out what you sell; it sells only while you are here.';
      } else if (w.verb === 'lay') {
        said = lay(w, actorId);
      } else if (w.verb === 'price') {
        var me2 = partyOf(actorId), price = priceFor(w.price);
        change(function (next) { BOOK.setPrice(next, s.id, me2, w.line, price); });
        said = 'The price is ' + BOOK.priceWords(BOOK.priceOf(price)) + ' a piece.';
      } else if (w.verb === 'back') {
        said = takeBack(w, actorId);
      } else if (w.verb === 'buy') {
        said = buy(w, actorId);
      } else if (w.verb === 'find') {
        s.found = find(w.words);
        said = s.found.length ? '' : 'Nothing goes by that name.';
      } else if (w.verb === 'letgo') {
        if (!BOOK.keeps(state, s.id, partyOf(actorId))) { throw new Error('This stall is not yours.'); }
        var n = endStall(s.id, 'its keeper let it go');
        said = 'You let the stall go.' + (n ? ' What was on it is in the hold\'s drop box, for you.' : '');
      } else if (w.verb === 'end') {
        said = endBy(actorId, profileId, cmd);
      }
    } catch (e) { said = String((e && e.message) || e); }
    show(actorId, profileId, said);
    return '';
  }

  g.__thornswoodStalls = {
    command: command,
    counts: function () { return BOOK.countsOf(state); },
    table: function () { return copy(stalls); },
    keeperHere: keeperHere
  };
})();
// ==== end thornswood market stalls ====

