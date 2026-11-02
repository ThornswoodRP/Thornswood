// ==== thornswood hair dye ====
/*
  HAIR DYE (#2675). docs/systems/hair-dye.md is the page; game/data/hair-dyes.json
  is the staff's list, and game/hair-dye.js the sums. Both are carried below,
  between the HAIR_DYES markers, by scripts/dev/Build-HairDyeGamemode.js.

  WHO MAKES ONE is the list's who, in BENCH_ACCESS's shape: as it ships, a
  Tailor, either half from novice (Patrick, 18 Oct 2026). Anybody else
  pressing E there with a dye's inputs is told whose work it is and nothing
  is taken; their water still boils. Using a dye is anybody's.

  MAKING ONE. E on a cooking spot (the list's steepAt, the bench keyword water
  boils at) while carrying one dye's inputs starts a steep. It answers nothing
  to the engine, so the cooking menu opens as it always has. After the list's
  steepSeconds by the fire the inputs are taken and the dye is in the pack,
  one entry on the list's item with the dye's name, the way a deed is named.
  Walking away from the fire before then loses the steep and takes nothing:
  the boil's rule. One steep at a time. A relog loses a steep the same way.

  THE BOTTLE OF WATER A DYE TAKES IS SPENT FROM THE WATER LEDGER. The game
  cannot mark where a bottle's water came from, so the needs block counts
  bottles by source (n.water). Taking a bottle for a dye without telling it
  would leave a bottle counted that is no longer carried, and the next drink
  would be judged by a bottle that is gone. So the steep hands the count to
  the needs block's spendWater, the same worst-first rule a drink uses.

  ONE PRESS, A DYE AND UNBOILED WATER. The same press starts both, and they
  are settled in one order: the steep first, spending its bottle (the worst
  one carried, an unboiled one when there is one), then the boil, which turns
  whatever unboiled water is still carried into boiled. Neither eats the
  other, and a boil left with nothing to boil says nothing.

  USING ONE. Your own hair from the Hair dye page on K, anywhere. Somebody
  else's from that page with them in front of you (the look prompt's K), or
  from Dye hair beside them under Near you on P: an offer, the trade's and the
  party's, with Accept and Refuse on their prompt. Nothing is taken and
  nothing is written until they press Accept, and then everything is checked
  again: the dye still carried, both of you within the list's reach.

  THE ONE WRITE. The stored appearance is read (never anything a client sent),
  withHairColour changes the hair colour and nothing else, bodyShapeGuard has
  the last word as it does on every appearance, mp.set stores it and sends it
  to the person and everybody near them, and one log line says who, whose
  hair, which dye, and the colour before and after. The first dye on somebody
  stores the colour they were made with, which a wash goes back towards. The
  person's own game redraws the hair in the front plugin ("hair colour").

  A DYE IS NOT A PLAIN ITEM. Each dye is registered with mintedEntry, so
  addItem, takeItem, the merchants and anything else that reads the record
  alone never counts a dye as the plain item or the plain item as a dye.

  The words are /hairdye, sent by K and P and never typed, so they are in
  WORDS and not PLAYER_WORDS.
*/
(function () {
  'use strict';
  var g = globalThis;

  // ==== HAIR_DYES ====
  /* Built by scripts\dev\Build-HairDyeGamemode.js out of game\data\hair-dyes.json and
     game\hair-dye.js. Do not hand edit: change those two and run it again. */
  var HAIR_DYES = {"about":"Hair dye (#2675). The staff's list: what a dye is carried as, where and how long it steeps, how close you stand to dye somebody else's hair, who may steep, and each dye's colour and what it takes. game/hair-dye.js reads it and names none of it. docs/systems/hair-dye.md says what each field does.","item":"98626:Skyrim.esm","steepSeconds":60,"steepAt":"a5cb3:Skyrim.esm","reach":300,"who":{"anyone":false,"halves":{"haberdasher":"novice","liverywright":"novice"}},"dyes":[{"id":"black","name":"Black Hair Dye","colour":"#1b1918","strength":0.75,"wander":10,"inputs":[{"item":"15482:Thornswood-Content.esp","count":1},{"item":"16e26:Dragonborn.esm","count":1},{"item":"13f598:WindhelmSSE.esp","count":1}]},{"id":"brown","name":"Brown Hair Dye","colour":"#4a3020","strength":0.6,"wander":14,"inputs":[{"item":"5076e:Skyrim.esm","count":3},{"item":"13f598:WindhelmSSE.esp","count":1}]},{"id":"red","name":"Red Hair Dye","colour":"#7a2418","strength":0.55,"wander":16,"inputs":[{"item":"1b3bd:Skyrim.esm","count":2},{"item":"77e1d:Skyrim.esm","count":2},{"item":"13f598:WindhelmSSE.esp","count":1}]},{"id":"deep-red","name":"Deep Red Hair Dye","colour":"#5a1014","strength":0.6,"wander":12,"inputs":[{"item":"4da20:Skyrim.esm","count":1},{"item":"b701a:Skyrim.esm","count":1},{"item":"13f598:WindhelmSSE.esp","count":1}]},{"id":"gold","name":"Gold Hair Dye","colour":"#b8945a","strength":0.5,"wander":14,"inputs":[{"item":"4b0ba:Skyrim.esm","count":2},{"item":"2a78:Dawnguard.esm","count":1},{"item":"13f598:WindhelmSSE.esp","count":1}]},{"id":"copper","name":"Copper Hair Dye","colour":"#a4512a","strength":0.55,"wander":16,"inputs":[{"item":"889a2:Skyrim.esm","count":2},{"item":"13f598:WindhelmSSE.esp","count":1}]},{"id":"blue","name":"Blue Hair Dye","colour":"#2b3f6e","strength":0.5,"wander":18,"inputs":[{"item":"77e1c:Skyrim.esm","count":3},{"item":"13f598:WindhelmSSE.esp","count":1}]},{"id":"purple","name":"Purple Hair Dye","colour":"#4e2c5e","strength":0.5,"wander":18,"inputs":[{"item":"77e1e:Skyrim.esm","count":2},{"item":"45c28:Skyrim.esm","count":2},{"item":"13f598:WindhelmSSE.esp","count":1}]},{"id":"nightshade","name":"Nightshade Hair Dye","colour":"#2a1a30","strength":0.65,"wander":10,"inputs":[{"item":"516c8:Skyrim.esm","count":1},{"item":"2f44c:Skyrim.esm","count":1},{"item":"13f598:WindhelmSSE.esp","count":1}]},{"id":"green","name":"Green Hair Dye","colour":"#3d5a2c","strength":0.5,"wander":18,"inputs":[{"item":"57f91:Skyrim.esm","count":2},{"item":"134aa:Skyrim.esm","count":1},{"item":"13f598:WindhelmSSE.esp","count":1}]},{"id":"hair-wash","name":"Hair Wash","wash":true,"strength":0.6,"wander":6,"inputs":[{"item":"34cdd:Skyrim.esm","count":1},{"item":"34cdf:Skyrim.esm","count":1},{"item":"3f7f8:Skyrim.esm","count":1},{"item":"13f598:WindhelmSSE.esp","count":1}]}]};
  var HAIR_DYE = (function () {
  var module = { exports: {} };
'use strict';
/*
  game/hair-dye.js (#2675): hair dye, the data check and the colour sums.

  Pure. It reads only what it is handed: the staff list in
  game/data/hair-dyes.json, what somebody carries, an inventory entry, a
  stored appearance. It names no colour, no ingredient, no item and no bench;
  every one of those is in the data, which is the staff's to change.

  The gamemode carries this file and the list inside its hair dye block
  (scripts/dev/Build-HairDyeGamemode.js writes them there), and that block
  does the steep, the K panel's button, the offer and the one write.

  A hair colour is the engine's int32 RGB, 0xRRGGBB. TESModPlatform's
  SetNpcHairColor reads red, green and blue out of bits 16 to 23, 8 to 15 and
  0 to 7 and ignores the top byte, so a stored colour is read by its low
  24 bits and every colour written here is 0 to 0xFFFFFF.
*/
// The rank ladder, the gamemode's RANK_LADDER: a half named at expert is a real rank.
var RANKS = ['novice', 'advanced', 'expert', 'master'];
var TOP_KEYS = ['about', 'item', 'steepSeconds', 'steepAt', 'reach', 'who', 'dyes'];
var WHO_KEYS = ['anyone', 'halves'];
var DYE_KEYS = ['id', 'name', 'colour', 'wash', 'strength', 'wander', 'inputs'];
var INPUT_KEYS = ['item', 'count'];
var WANDER_MAX = 64;
var REACH_MAX = 2000;
var FORM = /^[0-9a-f]{1,8}:[^:\\\/]+\.(esm|esp|esl)$/;
var HEX = /^#[0-9a-f]{6}$/;
var ID = /^[a-z][a-z0-9-]*$/;

function own(o, key) { return Object.prototype.hasOwnProperty.call(o, key); }
function object(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
function form(s) { return typeof s === 'string' && FORM.test(s); }
function count(n) { return Number.isSafeInteger(n) && n > 0; }
function strays(o, keys, where, out) {
  Object.keys(o).forEach(function (k) { if (keys.indexOf(k) < 0) { out.push(where + ' has a key nobody reads: ' + k); } });
}
function colourOf(n) {
  if (!Number.isSafeInteger(n)) { return null; }
  return (n >>> 0) & 0xFFFFFF;
}
function hexColour(s) { return parseInt(s.slice(1), 16); }

// Every problem with the staff list, as sentences. Empty means it is good.
// Nothing here falls back: a list with any problem is a list nobody uses.
function checkDyes(data) {
  var out = [];
  if (!object(data)) { return ['the dye list is not an object']; }
  strays(data, TOP_KEYS, 'the dye list', out);
  if (own(data, 'about') && typeof data.about !== 'string') { out.push('about is not words'); }
  if (!form(data.item)) { out.push('item is not a record such as 1a2b:Skyrim.esm'); }
  if (!count(data.steepSeconds)) { out.push('steepSeconds is not a whole number above 0'); }
  if (!form(data.steepAt)) { out.push('steepAt is not a bench keyword record'); }
  if (typeof data.reach !== 'number' || !(data.reach > 0 && data.reach <= REACH_MAX)) {
    out.push('reach is not a distance above 0 and at most ' + REACH_MAX);
  }
  if (!object(data.who)) { out.push('who is not an object'); }
  else {
    strays(data.who, WHO_KEYS, 'who', out);
    if (typeof data.who.anyone !== 'boolean') { out.push('who.anyone is not true or false'); }
    if (!object(data.who.halves)) { out.push('who.halves is not an object'); }
    else {
      Object.keys(data.who.halves).forEach(function (h) {
        if (!ID.test(h)) { out.push('who.halves names ' + JSON.stringify(h) + ', which is not a half'); }
        if (RANKS.indexOf(data.who.halves[h]) < 0) { out.push('who.halves.' + h + ' is not novice, advanced, expert or master'); }
      });
      if (data.who.anyone === false && !Object.keys(data.who.halves).length) {
        out.push('who lets nobody make a dye: anyone is false and no half is named');
      }
    }
  }
  if (!Array.isArray(data.dyes) || !data.dyes.length) { out.push('dyes is not a list with a dye in it'); return out; }
  var ids = {}, names = {};
  data.dyes.forEach(function (d, i) {
    var at = 'dye ' + (i + 1);
    if (!object(d)) { out.push(at + ' is not an object'); return; }
    if (typeof d.id === 'string') { at += ' (' + d.id + ')'; }
    strays(d, DYE_KEYS, at, out);
    if (typeof d.id !== 'string' || !ID.test(d.id)) { out.push(at + ' has no id of lower-case letters, digits and dashes'); }
    else if (own(ids, d.id)) { out.push(at + ' has the same id as an earlier dye'); }
    else { ids[d.id] = true; }
    if (typeof d.name !== 'string' || !d.name.trim() || d.name !== d.name.trim()) { out.push(at + ' has no name'); }
    else if (own(names, d.name.toLowerCase())) { out.push(at + ' has the same name as an earlier dye'); }
    else { names[d.name.toLowerCase()] = true; }
    if (own(d, 'wash') && d.wash !== true) { out.push(at + ' has wash set to something other than true'); }
    if (d.wash === true) {
      if (own(d, 'colour')) { out.push(at + ' is a wash and has a colour: a wash goes back to the colour somebody was made with'); }
    } else if (typeof d.colour !== 'string' || !HEX.test(d.colour)) {
      out.push(at + ' has no colour written #rrggbb in lower case');
    }
    if (typeof d.strength !== 'number' || !(d.strength > 0 && d.strength <= 1)) { out.push(at + ' has a strength that is not above 0 and at most 1'); }
    if (!Number.isSafeInteger(d.wander) || d.wander < 0 || d.wander > WANDER_MAX) { out.push(at + ' has a wander that is not a whole number from 0 to ' + WANDER_MAX); }
    if (!Array.isArray(d.inputs) || !d.inputs.length) { out.push(at + ' takes nothing to make'); return; }
    var seen = {};
    d.inputs.forEach(function (p, j) {
      var pat = at + ' input ' + (j + 1);
      if (!object(p)) { out.push(pat + ' is not an object'); return; }
      strays(p, INPUT_KEYS, pat, out);
      if (!form(p.item)) { out.push(pat + ' is not a record such as 1a2b:Skyrim.esm'); }
      else if (own(seen, p.item)) { out.push(pat + ' names ' + p.item + ' twice'); }
      else { seen[p.item] = true; }
      if (form(p.item) && p.item === data.item) { out.push(pat + ' is the dye item itself'); }
      if (!count(p.count)) { out.push(pat + ' has a count that is not a whole number above 0'); }
    });
  });
  // A dye whose inputs hold all of an earlier dye's, as many or more of each,
  // can never be made: dyeFor gives the earlier one first.
  if (!out.length) {
    data.dyes.forEach(function (later, b) {
      for (var a = 0; a < b; a++) {
        if (covers(data.dyes[a].inputs, inputsOf(later))) {
          out.push('dye ' + (b + 1) + ' (' + later.id + ') can never be made: it takes everything ' +
                   data.dyes[a].id + ', earlier in the list, takes');
          break;
        }
      }
    });
  }
  return out;
}

function inputsOf(dye) {
  var held = {};
  dye.inputs.forEach(function (p) { held[p.item] = p.count; });
  return held;
}
function covers(inputs, carried) {
  return inputs.every(function (p) { return own(carried, p.item) && count(carried[p.item]) && carried[p.item] >= p.count; });
}

// Whether everything this one dye takes is carried, as many of each as it takes.
function hasInputs(dye, carried) {
  return object(dye) && Array.isArray(dye.inputs) && object(carried) && covers(dye.inputs, carried);
}

// The first dye in the staff list whose inputs are all carried, or null.
// carried is record -> how many, as the caller counted the pack.
function dyeFor(carried, data) {
  if (!object(carried)) { return null; }
  for (var i = 0; i < data.dyes.length; i++) {
    if (covers(data.dyes[i].inputs, carried)) { return data.dyes[i]; }
  }
  return null;
}

// Whether the list lets this person steep. canWork(half, rank) is the
// caller's: true when they work that half at that rank or above.
function mayMake(data, canWork) {
  if (data.who.anyone === true) { return true; }
  if (typeof canWork !== 'function') { return false; }
  return Object.keys(data.who.halves).some(function (h) { return canWork(h, data.who.halves[h]) === true; });
}

/*
  The colour a dye leaves. old is the colour on the head now, made the colour
  they were made with (the server keeps it from the first dye on), rand the
  caller's random number from 0 up to 1. Each channel goes strength of the way
  from old to the dye's colour, or for a wash to made, then wanders by up to
  wander either way, so two heads under one dye come out a little different.
  null when it cannot be worked out: an old colour that is not a number, a wash
  with no made colour, or a rand that is not a function giving 0 up to 1.
*/
function mixColour(old, dye, made, rand) {
  var from = colourOf(old);
  if (from === null || !object(dye) || typeof rand !== 'function') { return null; }
  var to = dye.wash === true ? colourOf(made) : (typeof dye.colour === 'string' && HEX.test(dye.colour) ? hexColour(dye.colour) : null);
  if (to === null) { return null; }
  var s = dye.strength, w = dye.wander;
  if (typeof s !== 'number' || !(s >= 0 && s <= 1) || !Number.isSafeInteger(w) || w < 0) { return null; }
  var out = 0;
  for (var shift = 16; shift >= 0; shift -= 8) {
    var r = rand();
    if (typeof r !== 'number' || !(r >= 0 && r < 1)) { return null; }
    var o = (from >> shift) & 0xFF, t = (to >> shift) & 0xFF;
    var c = Math.round(o + (t - o) * s + (r * 2 - 1) * w);
    out = out * 256 + Math.max(0, Math.min(255, c));
  }
  return out;
}

// The name a dye's inventory entry carries, the way a deed carries its own.
function dyeName(dye) { return dye.name; }

// The dye an inventory entry is, or null. itemBaseId, when given, is the
// dye item's base as the engine numbers it; an entry on any other base is
// not a dye whatever it is called.
function dyeOf(entry, data, itemBaseId) {
  if (!object(entry) || typeof entry.name !== 'string') { return null; }
  if (itemBaseId !== undefined && entry.baseId !== itemBaseId) { return null; }
  for (var i = 0; i < data.dyes.length; i++) {
    if (data.dyes[i].name === entry.name) { return data.dyes[i]; }
  }
  return null;
}

/*
  THE PACK. entries is an inventory's entries as the engine keeps them. A dye
  is an entry on the list's item with a dye's name; every other entry on that
  item, and every entry on any other record, is plain. Nothing a dye is ever
  counts as a plain item, and nothing plain is ever taken as a dye.
*/
function isDyeEntry(entry, data, itemBaseId) { return dyeOf(entry, data, itemBaseId) !== null; }

// How many of a record's plain entries the pack holds.
function plainCount(entries, baseId, data, itemBaseId) {
  var n = 0;
  (Array.isArray(entries) ? entries : []).forEach(function (e) {
    if (object(e) && e.baseId === baseId && !isDyeEntry(e, data, itemBaseId) && count(e.count)) { n += e.count; }
  });
  return n;
}

// record -> how many plain ones are carried, for every record any dye takes.
// ids is record -> the engine's base id, as the caller resolved it.
function carriedFor(entries, data, ids, itemBaseId) {
  var out = {};
  data.dyes.forEach(function (d) {
    d.inputs.forEach(function (p) {
      if (!own(out, p.item)) { out[p.item] = own(ids, p.item) && ids[p.item] ? plainCount(entries, ids[p.item], data, itemBaseId) : 0; }
    });
  });
  return out;
}

// The dyes carried, in the list's order: [{ id, name, count }].
function dyesCarried(entries, data, itemBaseId) {
  var held = {};
  (Array.isArray(entries) ? entries : []).forEach(function (e) {
    var d = dyeOf(e, data, itemBaseId);
    if (d && count(e.count)) { held[d.id] = (held[d.id] || 0) + e.count; }
  });
  return data.dyes.filter(function (d) { return own(held, d.id); })
    .map(function (d) { return { id: d.id, name: d.name, count: held[d.id] }; });
}

function copyEntries(entries) { return JSON.parse(JSON.stringify(Array.isArray(entries) ? entries : [])); }

// Take n plain entries of one record out of a copy. False when short.
function takePlain(next, baseId, n, data, itemBaseId) {
  var left = n;
  for (var i = 0; i < next.length && left > 0; i++) {
    var e = next[i];
    if (!object(e) || e.baseId !== baseId || isDyeEntry(e, data, itemBaseId) || !count(e.count)) { continue; }
    var k = Math.min(left, e.count);
    e.count -= k; left -= k;
  }
  return left === 0;
}
function tidy(next) { return next.filter(function (e) { return !object(e) || !own(e, 'count') || e.count > 0; }); }

// The pack after a steep: the dye's inputs taken from plain entries and one
// of the dye added under its name, on a plain entry of its own. null when an
// input is short or a record has no base id, and then nothing changes.
function afterSteep(entries, dye, data, ids, itemBaseId) {
  if (!object(dye) || !Number.isSafeInteger(itemBaseId) || itemBaseId <= 0) { return null; }
  var next = copyEntries(entries);
  for (var i = 0; i < dye.inputs.length; i++) {
    var p = dye.inputs[i];
    if (!own(ids, p.item) || !ids[p.item] || !takePlain(next, ids[p.item], p.count, data, itemBaseId)) { return null; }
  }
  next = tidy(next);
  var same = null;
  for (var j = 0; j < next.length; j++) {
    var e = next[j];
    if (object(e) && e.baseId === itemBaseId && e.name === dye.name && Object.keys(e).length === 3) { same = e; break; }
  }
  if (same) { same.count += 1; } else { next.push({ baseId: itemBaseId, count: 1, name: dyeName(dye) }); }
  return next;
}

// The pack with one of that dye used up, or null when none is carried.
function afterUse(entries, dye, data, itemBaseId) {
  var next = copyEntries(entries);
  for (var i = 0; i < next.length; i++) {
    if (dyeOf(next[i], data, itemBaseId) === dye && count(next[i].count)) {
      next[i].count -= 1;
      return tidy(next);
    }
  }
  return null;
}

// A copy of a stored appearance with only its hair colour changed, or null
// when it is not an appearance or the colour is not 0 to 0xFFFFFF. It never
// touches the one it is handed.
function withHairColour(appearance, rgb) {
  if (!object(appearance) || !own(appearance, 'hairColor') || !Number.isSafeInteger(appearance.hairColor) ||
      !own(appearance, 'raceId') || !Array.isArray(appearance.headpartIds)) { return null; }
  if (!Number.isSafeInteger(rgb) || rgb < 0 || rgb > 0xFFFFFF) { return null; }
  var out = JSON.parse(JSON.stringify(appearance));
  out.hairColor = rgb;
  return out;
}

module.exports = {
  checkDyes: checkDyes, dyeFor: dyeFor, hasInputs: hasInputs, mayMake: mayMake, mixColour: mixColour,
  dyeName: dyeName, dyeOf: dyeOf, withHairColour: withHairColour,
  isDyeEntry: isDyeEntry, plainCount: plainCount, carriedFor: carriedFor, dyesCarried: dyesCarried,
  afterSteep: afterSteep, afterUse: afterUse, WANDER_MAX: WANDER_MAX, REACH_MAX: REACH_MAX
};
  return module.exports;
  })();
  // ==== end HAIR_DYES ====

  function hlog() {
    var a = ['[thornswood hair dye]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  var problems = HAIR_DYE.checkDyes(HAIR_DYES);
  var LIST = problems.length ? null : HAIR_DYES;
  if (!LIST) { hlog('the dye list is refused, so no dye is made or used:', problems.join('; ')); }

  var MADE_PROPERTY = 'thornswoodHairMade';
  try {
    mp.makeProperty(MADE_PROPERTY, {
      isVisibleByOwner: false, isVisibleByNeighbors: false, updateOwner: '', updateNeighbor: ''
    });
  } catch (e) { /* already made by a previous load */ }

  var itemBase = 0;
  function dyeItemId() {
    if (!itemBase && LIST) { try { itemBase = idOf(LIST.item) || 0; } catch (e) { itemBase = 0; } }
    return itemBase;
  }
  var ids = null;
  function inputIds() {
    if (!ids && LIST) {
      ids = {};
      LIST.dyes.forEach(function (d) {
        d.inputs.forEach(function (p) {
          if (!Object.prototype.hasOwnProperty.call(ids, p.item)) {
            try { ids[p.item] = idOf(p.item) || 0; } catch (e) { ids[p.item] = 0; }
          }
        });
      });
    }
    return ids || {};
  }
  function byId(id) {
    if (!LIST) { return null; }
    for (var i = 0; i < LIST.dyes.length; i++) { if (LIST.dyes[i].id === id) { return LIST.dyes[i]; } }
    return null;
  }

  function packOf(actorId) {
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { inv = null; }
    return (inv && Array.isArray(inv.entries)) ? inv.entries : [];
  }
  function setPack(actorId, entries) {
    mp.set(actorId, 'inventory', { entries: entries });
  }

  // A dye entry, for mintedEntry: never the plain item.
  function isDye(entry) {
    return !!LIST && !!dyeItemId() && HAIR_DYE.isDyeEntry(entry, LIST, dyeItemId());
  }
  mintedBy('hair dye', isDye);

  function carried(actorId) {
    if (!LIST || !dyeItemId()) { return []; }
    return HAIR_DYE.dyesCarried(packOf(actorId), LIST, dyeItemId());
  }
  function carries(actorId) { return carried(actorId).length > 0; }

  /*
    Whether somebody works a half at a rank, asked the way a bench asks it
    (benchGate): the progression block's canWork on their character, so an
    apprentice's sister half and every rank on the ladder count the same at
    the cooking spot as at the loom. Without the character or progression
    block nobody may steep: the list is closed, and the press says so.
  */
  function canWork(actorId) {
    return function (half, rank) {
      var C = g.__thornswoodCharacter, P = g.__thornswoodProgression;
      if (!C || !C.stateOf || !P || !P.canWork) { return false; }
      try { return !!P.canWork(C.stateOf(actorId), half, rank); } catch (e) { return false; }
    };
  }

  /*
    THE LINE FOR SOMEBODY THE LIST DOES NOT LET STEEP (Patrick, 18 Oct: making
    dye is a tailor's job). Built from the list's own halves, named the way
    the bench refusal names them, so it says whose work it is without naming
    a half in code. Nothing is taken, and the boil on the same press still
    runs: this answers only for the dye.
  */
  function notYours() {
    var C = g.__thornswoodCharacter;
    var who = Object.keys(LIST.who.halves).map(function (h) {
      var name = h;
      try { name = (C && C.nameOf) ? C.nameOf(h) : h; } catch (e) { name = h; }
      var rank = LIST.who.halves[h];
      return name + (rank === 'novice' ? '' : ' at ' + rank);
    });
    var whose = who.length === 1 ? who[0] : who.slice(0, -1).join(', ') + ' or ' + who[who.length - 1];
    return 'Steeping hair dye is ' + (whose ? 'work for a ' + whose : 'nobody\'s work here') +
           '. Nothing was taken from your pack.';
  }

  function hex6(c) { return '#' + ('000000' + ((Number(c) >>> 0) & 0xFFFFFF).toString(16)).slice(-6); }

  function redraw(actorId) {
    try {
      var C = g.__thornswoodCharacter;
      if (C && C.writeState && C.stateOf) { C.writeState(actorId, C.stateOf(actorId)); }
    } catch (e) { hlog('could not redraw K for', Number(actorId).toString(16) + ':', e); }
    try {
      var S = g.__thornswoodSocial;
      if (S && S.push) { S.push(actorId); }
    } catch (e2) { }
  }

  // ------------------------------------------------------------ the steep --
  var steeps = {};   // actorId -> { dye, from, fire }

  /*
    E on something. Starts a steep at the list's cooking spot when one dye's
    inputs are carried and none is steeping. Answers a line, or '' when this
    press is none of the dye's business. Never refuses anything.
  */
  function pressed(actorId, benchKeyword) {
    if (!LIST || !benchKeyword || benchKeyword !== LIST.steepAt) { return ''; }
    if (Object.prototype.hasOwnProperty.call(steeps, actorId)) { return ''; }
    var dye = HAIR_DYE.dyeFor(HAIR_DYE.carriedFor(packOf(actorId), LIST, inputIds(), dyeItemId()), LIST);
    if (!dye) { return ''; }
    if (!HAIR_DYE.mayMake(LIST, canWork(actorId))) { return notYours(); }
    var N = g.__thornswoodNeeds;
    var fire = !!(N && N.fireNear && N.fireNear(actorId));
    steeps[actorId] = { dye: dye.id, from: Date.now(), fire: fire };
    var secs = LIST.steepSeconds;
    return 'You set ' + dye.name + ' to steep. Stay by the fire for ' +
           (secs % 60 === 0 ? (secs / 60) + (secs === 60 ? ' minute.' : ' minutes.') : secs + ' seconds.');
  }

  /*
    What the client just said about the fire, from the needs block's boilSay,
    BEFORE the boil is settled (see the note over this block). Finishes a
    steep that has had its time, loses one left early. Answers a line or ''.
  */
  function fireCheck(actorId, near) {
    if (!Object.prototype.hasOwnProperty.call(steeps, actorId)) { return ''; }
    var st = steeps[actorId];
    var dye = byId(st.dye);
    if (!dye) { delete steeps[actorId]; return ''; }
    if (st.fire && !near) {
      delete steeps[actorId];
      return 'You left the fire, and ' + dye.name + ' did not steep.';
    }
    if (Date.now() - st.from < LIST.steepSeconds * 1000) { return ''; }
    delete steeps[actorId];
    return finishSteep(actorId, dye);
  }

  function finishSteep(actorId, dye) {
    if (!HAIR_DYE.mayMake(LIST, canWork(actorId))) { return notYours(); }
    var pack = packOf(actorId);
    var next = HAIR_DYE.afterSteep(pack, dye, LIST, inputIds(), dyeItemId());
    if (!next) { return 'You no longer carry everything ' + dye.name + ' takes, so nothing steeped.'; }
    var N = g.__thornswoodNeeds;
    var water = (N && N.waterItem) ? N.waterItem() : '';
    var bottles = 0;
    dye.inputs.forEach(function (p) { if (p.item === water) { bottles += p.count; } });
    try { setPack(actorId, next); } catch (e) {
      hlog('could not write the pack of', Number(actorId).toString(16), 'for', dye.name + ':', e);
      return 'The dye would not steep. Say so in the dev channel.';
    }
    if (bottles && N && N.spendWater) { N.spendWater(actorId, bottles); }
    hlog(auditPerson(actorId), 'steeped', dye.name);
    redraw(actorId);
    return dye.name + ' has steeped. It is in your pack.';
  }

  // ------------------------------------------------------------ the write --

  function madeOf(actorId) {
    var m = null;
    try { m = mp.get(actorId, MADE_PROPERTY); } catch (e) { m = null; }
    return (m && Number.isSafeInteger(m.c)) ? m.c : null;
  }

  /*
    Dye the hair of target with one of by's dyes. Everything is read again
    here. Answers { ok, why }.
  */
  function applyDye(target, dye, by) {
    var stored = null;
    try { stored = mp.get(target, 'appearance'); } catch (e) { stored = null; }
    if (!stored || typeof stored !== 'object') { return { ok: false, why: 'There is no stored look to dye yet.' }; }
    var old = stored.hairColor;
    var made = madeOf(target);
    var first = made === null;
    if (first) { made = (Number.isSafeInteger(old) ? (old >>> 0) & 0xFFFFFF : null); }
    var rgb = HAIR_DYE.mixColour(old, dye, made, Math.random);
    var next = rgb === null ? null : HAIR_DYE.withHairColour(stored, rgb);
    var guarded = next ? bodyShapeGuard(next) : null;
    if (!guarded) { return { ok: false, why: 'That hair cannot be dyed. Say so in the dev channel.' }; }
    var pack = packOf(by);
    var used = HAIR_DYE.afterUse(pack, dye, LIST, dyeItemId());
    if (!used) { return { ok: false, why: 'You are not carrying ' + dye.name + '.' }; }
    // The colour the hair was made with is kept before the first dye takes, so
    // a wash always has it to go back to; without it nothing is dyed.
    if (first && made !== null) {
      try { mp.set(target, MADE_PROPERTY, { c: made, at: Date.now() }); } catch (e4) {
        hlog('could not keep the made hair colour of', Number(target).toString(16) + ':', e4);
        return { ok: false, why: 'The dye would not take. Say so in the dev channel.' };
      }
    }
    try { setPack(by, used); } catch (e) { return { ok: false, why: 'The dye would not come out of the pack.' }; }
    try {
      mp.set(target, 'appearance', guarded.appearance);
    } catch (e2) {
      hlog('could not write the hair of', Number(target).toString(16) + ':', e2);
      try { setPack(by, pack); } catch (e3) {
        hlog('and could not put the dye back in the pack of', Number(by).toString(16) + ':', e3);
      }
      return { ok: false, why: 'The dye would not take. Say so in the dev channel.' };
    }
    log('hair dye:', auditPerson(by), by === target ? 'dyed their own hair' : 'dyed the hair of ' + auditPerson(target),
        'with', dye.name + ',', 'from', hex6(old), 'to', hex6(rgb) +
        (guarded.changes.length ? ' (body shape: ' + guarded.changes.join(', ') + ')' : ''));
    redraw(by);
    if (by !== target) { redraw(target); }
    return { ok: true, why: '' };
  }

  // Both in one cell, within the list's reach of each other.
  function within(a, b) {
    try {
      if (String(mp.get(a, 'worldOrCellDesc')) !== String(mp.get(b, 'worldOrCellDesc'))) { return false; }
      var p = mp.get(a, 'pos'), q = mp.get(b, 'pos');
      var dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
      return dx * dx + dy * dy + dz * dz <= LIST.reach * LIST.reach;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------- the words --
  /*
    /hairdye self <dye>          K's Dye my hair.
    /hairdye offer <form id> <dye>  K with somebody in front of you, or P's
                                 Dye hair beside them: an offer they answer.
  */
  function command(parts, actorId) {
    if (!LIST) { return 'Hair dye is not running on this server. Say so in the dev channel.'; }
    var verb = String(parts[1] || '').toLowerCase();
    if (verb === 'self') {
      var mine = byId(String(parts[2] || ''));
      if (!mine) { return 'There is no such dye.'; }
      var r = applyDye(actorId, mine, actorId);
      return r.ok ? 'You dye your hair with ' + mine.name + '.' : r.why;
    }
    if (verb === 'offer') {
      var dye = byId(String(parts[3] || ''));
      if (!dye) { return 'There is no such dye.'; }
      if (!carried(actorId).some(function (c) { return c.id === dye.id; })) { return 'You are not carrying ' + dye.name + '.'; }
      var soc = g.__thornswoodSocial;
      if (!soc || !soc.findPerson || !soc.offer) { return 'Asking somebody is not running on this server right now.'; }
      var found = soc.findPerson(String(parts[2] || ''));
      if (!found.actorId) { return found.why; }
      var them = found.actorId;
      if (them === actorId) { return 'That is you. Dye my hair on the Hair dye page of K is for your own.'; }
      var name = soc.nameOfPerson(them);
      if (!within(actorId, them)) { return 'Stand closer to ' + name + ' to dye their hair.'; }
      var refused = soc.offer('dye', actorId, them, dye.name);
      if (refused) { return refused; }
      var pid = soc.profileOf(them);
      var o = soc.offers[pid];
      if (o) { o.dye = dye.id; o.dyer = actorId; }
      var me = soc.nameOfPerson(actorId);
      try { say(them, me + ' offers to dye your hair with ' + dye.name + '. Accept or refuse on the prompt.'); } catch (e) { }
      try { notify(them, me + ' offers to dye your hair'); } catch (e2) { }
      try { soc.push(them); soc.push(actorId); } catch (e3) { }
      return 'Asked ' + name + '. They have ' + Math.round(soc.SOCIAL.offerFor / 1000) + ' seconds.';
    }
    return 'Hair dye is the Hair dye page on K.';
  }

  /*
    They pressed Accept. The offer is checked again from the start, because
    anything can have moved in the seconds it stood. Answers { them, dyer }:
    the line for each.
  */
  function accept(actorId, dyerId, o) {
    if (!LIST) { return { them: 'Hair dye is not running on this server.', dyer: '' }; }
    if (!o || o.dyer !== dyerId) { return { them: 'That offer came from another of their characters, and it has gone.', dyer: '' }; }
    var dye = byId(o.dye);
    var soc = g.__thornswoodSocial;
    var me = soc ? soc.nameOfPerson(actorId) : 'They';
    var them = soc ? soc.nameOfPerson(dyerId) : 'They';
    if (!dye) { return { them: 'That dye is not on the list any more.', dyer: '' }; }
    if (!within(actorId, dyerId)) {
      return { them: them + ' has to stand closer to dye your hair.', dyer: 'Stand closer to ' + me + ' to dye their hair.' };
    }
    var r = applyDye(actorId, dye, dyerId);
    if (!r.ok) { return { them: 'Your hair is as it was. ' + r.why, dyer: r.why }; }
    return { them: them + ' dyes your hair with ' + dye.name + '.', dyer: 'You dye ' + me + '\'s hair with ' + dye.name + '.' };
  }

  // ------------------------------------------------------------- the view --
  // The Hair dye page of K: the dyes carried and a steep under way, or null.
  function view(actorId) {
    if (!LIST) { return null; }
    var dyes = carried(actorId);
    var st = Object.prototype.hasOwnProperty.call(steeps, actorId) ? steeps[actorId] : null;
    var steeping = st && byId(st.dye) ? { name: byId(st.dye).name,
      left: Math.max(0, Math.ceil((st.from + LIST.steepSeconds * 1000 - Date.now()) / 1000)) } : null;
    if (!dyes.length && !steeping) { return null; }
    return { dyes: dyes, steeping: steeping };
  }

  g.__thornswoodHairDye = {
    list: function () { return LIST; },
    pressed: pressed, fireCheck: fireCheck, command: command, accept: accept,
    view: view, carried: carried, carries: carries, isDye: isDye, applyDye: applyDye,
    steeps: steeps
  };
  hlog(LIST ? 'ready: ' + LIST.dyes.length + ' dyes on the list' : 'not ready: the list was refused');
})();
// ==== end thornswood hair dye ====


