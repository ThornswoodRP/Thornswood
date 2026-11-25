'use strict';
/*
  THE FREE SKYRIM TRADING COMPANY: ITS TERMS (#512).

  The company is Skyrim's hauler and a business (docs/systems/trading-company.md,
  #1393, #1646). Its hauls, its tenth and its sales out of the world are in the
  property block of gamemode.js. This file is the company's terms as data staff
  can change, and the arithmetic that reads them. It never touches the world, a
  pack, a ledger, a purse or a price. The gamemode reads it through
  globalThis.__thornswoodCompany (game/gamemode/company-terms.ts): the property
  block posts and pays hauls by it, the trade block splits sales out of the
  world by it, and the trade ship dock asks mayCharter before every load and
  sail (#2700). Nothing calls freightFor yet, so no freight is charged on a
  load. The design and Patrick's questions are on #512
  (issuecomment-6245906394).

  THE TERMS are one object, kept in game/data/trading-company.json:

    haulFee            gold a haul costs to post, on top of its pay
    haulCutPercent     the company's cut of a delivered haul's pay, in whole percent
    haulCutFrom        a pay under this keeps no cut, and the hauler gets it all
    saleWorkerPercent  on a sale out of the world, the worker's percent
    saleGonePercent    on a sale out of the world, the percent that leaves the server
    saleCutFrom        a price under this takes neither cut
    charter            who may charter a trade ship hold (#511): 'company', 'anyone' or 'staff'
    freightPerLoad     gold one load into a ship hold costs; 0 is no freight
    freightTo          where freight goes: 'ledger' (the loading hold's) or 'gone'

  The file's numbers are today's numbers in gamemode.js, and
  tests/test-512-trading-company.js fails the day the two differ.

  WHAT IT REFUSES. Terms that do not check are refused, never replaced with a
  default: a negative fee, a percent outside 0 to 100, two sale cuts over 100,
  an unknown or missing key. A server that silently fell back would charge
  people a number nobody chose.

  THE SERVER PROPOSES, STAFF CONFIRM (Patrick, 17 Oct 2026, 10:13 PM MT).
  proposeTerms() says what would change and how many open hauls keep the terms
  they were posted under. It changes nothing. adoptTerms() is the confirm, and
  it refuses a proposal made against terms that have changed since.

  A HAUL KEEPS ITS TERMS. stampHaul() writes the cut a haul was posted under
  onto the haul, and haulCut() reads that stamp before the current terms, so a
  haul already on the road is paid the way it was posted.

  WHAT IT NEVER DECIDES. Who hauls, for whom, between which holds, when or for
  how long: those are the players' RP. Nothing here names a person, a hold, a
  port, a time or a length.
*/

var KEYS = ['v', 'haulFee', 'haulCutPercent', 'haulCutFrom', 'saleWorkerPercent', 'saleGonePercent',
            'saleCutFrom', 'charter', 'freightPerLoad', 'freightTo'];
var CHARTER = ['company', 'anyone', 'staff'];
var FREIGHT_TO = ['ledger', 'gone'];
var MAX_GOLD = 100000;

function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function object(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
function copy(o) { return JSON.parse(JSON.stringify(o)); }
function gold(n) { return Number.isInteger(n) && n >= 0 && n <= MAX_GOLD; }
function percent(n) { return Number.isInteger(n) && n >= 0 && n <= 100; }
function whole(n) { var p = Math.floor(Number(n)); return Number.isFinite(p) && p > 0 ? p : 0; }
function canonical(t) {
  var out = {};
  KEYS.forEach(function (k) { out[k] = t[k]; });
  return JSON.stringify(out);
}

/** The reasons a terms object is refused; empty when it checks. */
function checkTerms(t) {
  var why = [];
  if (!object(t)) { return ['The terms are not an object.']; }
  Object.keys(t).forEach(function (k) { if (KEYS.indexOf(k) < 0) { why.push('Unknown term: ' + k + '.'); } });
  KEYS.forEach(function (k) { if (!own(t, k)) { why.push('Missing term: ' + k + '.'); } });
  if (why.length) { return why; }
  if (t.v !== 1) { why.push('Terms version must be 1.'); }
  ['haulFee', 'haulCutFrom', 'saleCutFrom', 'freightPerLoad'].forEach(function (k) {
    if (!gold(t[k])) { why.push(k + ' must be a whole number of gold from 0 to ' + MAX_GOLD + '.'); }
  });
  ['haulCutPercent', 'saleWorkerPercent', 'saleGonePercent'].forEach(function (k) {
    if (!percent(t[k])) { why.push(k + ' must be a whole percent from 0 to 100.'); }
  });
  if (percent(t.saleWorkerPercent) && percent(t.saleGonePercent) && t.saleWorkerPercent + t.saleGonePercent > 100) {
    why.push('The two sale cuts come to more than the price.');
  }
  if (CHARTER.indexOf(t.charter) < 0) { why.push('charter must be one of ' + CHARTER.join(', ') + '.'); }
  if (FREIGHT_TO.indexOf(t.freightTo) < 0) { why.push('freightTo must be one of ' + FREIGHT_TO.join(', ') + '.'); }
  return why;
}

/** Terms from the file's text. Throws on anything that does not check. */
function loadTerms(text) {
  var t;
  try { t = JSON.parse(String(text)); } catch (e) { throw new Error('The company terms are not readable JSON.'); }
  var why = checkTerms(t);
  if (why.length) { throw new Error('The company terms are refused: ' + why.join(' ')); }
  return copy(t);
}

function must(t) {
  var why = checkTerms(t);
  if (why.length) { throw new Error('The company terms are refused: ' + why.join(' ')); }
}

/** A copy of a haul with the cut it was posted under written on it. */
function stampHaul(haul, terms) {
  must(terms);
  var h = copy(haul || {});
  h.cut = { percent: terms.haulCutPercent, from: terms.haulCutFrom };
  return h;
}

/** The cut a haul is paid under: its own stamp, or the current terms for one posted before stamps. */
function cutOf(haul, terms) {
  var c = haul && haul.cut;
  if (object(c) && percent(c.percent) && gold(c.from)) { return { percent: c.percent, from: c.from }; }
  must(terms);
  return { percent: terms.haulCutPercent, from: terms.haulCutFrom };
}

/** The company's cut of a delivered haul, rounded down. */
function haulCut(haul, terms) {
  var c = cutOf(haul, terms), p = whole(haul && haul.pay);
  return p < c.from ? 0 : Math.floor(p * c.percent / 100);
}

/** A sale out of the world: the worker's cut, the cut that leaves, and the seller's rest. */
function saleCuts(price, terms) {
  must(terms);
  var p = whole(price);
  if (p < terms.saleCutFrom) { return { price: p, worker: 0, gone: 0, seller: p }; }
  var w = Math.floor(p * terms.saleWorkerPercent / 100), g = Math.floor(p * terms.saleGonePercent / 100);
  return { price: p, worker: w, gone: g, seller: p - w - g };
}

/*
  The #511 hook: may this person charter (load or sail) a ship hold. who is
  what the server already knows about the pressing character: { company }
  for the Trading Company role (__thornswoodIsCompany), { staff } for an admin.
  An admin testing the chain counts as the company, the same as inCompany.
*/
function mayCharter(who, terms) {
  must(terms);
  var w = object(who) ? who : {};
  if (terms.charter === 'anyone') { return true; }
  if (terms.charter === 'staff') { return w.staff === true; }
  return w.company === true || w.staff === true;
}

/** What one load into a ship hold costs, and where the gold goes. */
function freightFor(terms) {
  must(terms);
  return { gold: terms.freightPerLoad, to: terms.freightTo };
}

/*
  The server's proposal. Changes nothing. openHauls is the hauls on the boards
  now; each keeps the cut it was posted under.
*/
function proposeTerms(current, next, openHauls) {
  must(current);
  var why = checkTerms(next);
  if (why.length) { return { ok: false, why: why }; }
  var changes = [];
  KEYS.forEach(function (k) { if (current[k] !== next[k]) { changes.push({ term: k, from: current[k], to: next[k] }); } });
  var keep = (Array.isArray(openHauls) ? openHauls : []).length;
  return { ok: true, base: canonical(current), next: copy(next), changes: changes, openHaulsKeepTerms: keep };
}

/*
  Staff confirm a proposal. state is { terms, history }; at is the time. The
  history keeps when and what changed, never who: who proposed and who
  confirmed are in the staff log, which keeps them for its own time, and the
  terms file is not a place that names people (#2353). Refused when the
  proposal was not ok, changes nothing, or was made against other terms.
*/
function adoptTerms(state, proposal, at) {
  if (!object(state)) { throw new Error('There are no company terms to change.'); }
  must(state.terms);
  if (!object(proposal) || proposal.ok !== true) { throw new Error('That proposal was refused.'); }
  if (!proposal.changes.length) { throw new Error('That proposal changes nothing.'); }
  if (proposal.base !== canonical(state.terms)) { throw new Error('The terms changed since that proposal. Propose again.'); }
  if (!Number.isInteger(at) || at < 0) { throw new Error('A confirm says when.'); }
  must(proposal.next);
  var history = Array.isArray(state.history) ? state.history.slice() : [];
  history.push({ at: at, changes: copy(proposal.changes) });
  return { terms: copy(proposal.next), history: history };
}

module.exports = {
  KEYS: KEYS, CHARTER: CHARTER, FREIGHT_TO: FREIGHT_TO,
  checkTerms: checkTerms, loadTerms: loadTerms, stampHaul: stampHaul, cutOf: cutOf, haulCut: haulCut,
  saleCuts: saleCuts, mayCharter: mayCharter, freightFor: freightFor,
  proposeTerms: proposeTerms, adoptTerms: adoptTerms
};
