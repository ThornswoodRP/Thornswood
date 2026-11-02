// ==== thornswood company terms ====
/*
  THE FREE SKYRIM TRADING COMPANY'S TERMS, READ IN ONE PLACE (#512, #2695).

  Patrick, 18 Oct 2026 (#2695): staff change the company's terms on an
  in-game staff panel where staff confirm a proposal; the Trading Company
  role charters a ship hold by default; there is no freight fee by default,
  with a ledger fee as a setting; and the haul fee stays apart from the
  notice board's job fee.

  THE TERMS are game/data/trading-company.json, and the arithmetic that reads
  them is game/trading-company.js (its own header says what each term is).
  The server is sent this file and not game/, so both are copied in between
  the TRADING_COMPANY markers below by
  scripts/dev/Build-TradingCompanyGamemode.js, and
  tests/test-512-trading-company.js fails when they differ.

  THE TERMS IN FORCE are kept in private/company-terms.json beside war.json
  and season.json, so a restart or a deploy keeps them: the terms, every
  confirmed change (when, from and to), and the one proposal waiting. The
  file names nobody: who proposed, confirmed or dropped a change is in the
  staff log, which keeps it for the staff log's own time (#2353). Who made
  the proposal waiting now is held in memory for the card and the log lines,
  and after a restart the card says only when it was made.
  With no file they are the shipped terms. A file that does not read, or
  terms in it that do not check, are logged and left on disk, and the
  shipped terms stand until the next confirm writes a good file (it puts the
  bad one aside first). Terms are never half used and never guessed.

  globalThis.__thornswoodCompany IS THE ONE PLACE ANYTHING ASKS:
    terms()          a copy of the terms in force
    haulFee()        gold a haul costs to post, on top of its pay
    stampHaul(n)     a copy of haul n with the cut it was posted under on it
    haulCut(n)       the company's cut of haul n's pay, by its stamp
    saleCuts(price)  a sale out of the world: worker, gone and seller
    mayCharter(who)  game/trading-company.js mayCharter(who, terms) over the
                     terms in force (#511, #2700 builds on it)
    freightFor()     { gold, to } for one load into a ship hold
  The property block posts and pays hauls by these, and the trade block
  splits a sale by them. Nothing loads a ship yet; that is #2700's.

  THE STAFF CARD ON THE OFFICE PAGE OF K, the same way as #2685's world
  card: the server proposes, staff confirm, and nothing is typed. Staff see
  the terms in force and the proposal waiting, with each change, who
  proposed it, when, and how many open hauls keep the terms they were posted
  under. They set the terms on the card and press Propose; Confirm (pressed
  twice) and Drop name the proposal by when it was made, so a press on a card
  drawn before somebody else's proposal cannot act on the newer one. The
  card's buttons send /companyterms, which nobody is told to type, and every line
  is checked here again: staff by the chat block's isStaff, and the staff
  block's proof (unproven). Every press goes in the staff log
  (companypropose, companyconfirm, companydrop), and no press is taken when
  that log is not loaded. A confirm made against terms that changed since
  the proposal is refused, so two staff never overwrite each other unseen.

  WHAT IT NEVER DECIDES. Who hauls, for whom, between which holds, when or
  for how long, and who charters which ship: those are the players' RP.
  Nothing here proposes by itself, and no timer changes anything.
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  // ==== TRADING_COMPANY ====
  /* Built by scripts\dev\Build-TradingCompanyGamemode.js out of game\data\trading-company.json
     and game\trading-company.js. Do not hand edit: change those two and run it again. */
  var COMPANY_TERMS = {"v":1,"haulFee":30,"haulCutPercent":10,"haulCutFrom":10,"saleWorkerPercent":10,"saleGonePercent":10,"saleCutFrom":10,"charter":"company","freightPerLoad":0,"freightTo":"ledger"};
  var LIB = (function () {
  var module = { exports: {} };
'use strict';
/*
  THE FREE SKYRIM TRADING COMPANY: ITS TERMS (#512).

  The company is Skyrim's hauler and a business (docs/systems/trading-company.md,
  #1393, #1646). Its hauls, its tenth and its sales out of the world are in the
  property block of gamemode.js. This file is the company's terms as data staff
  can change, and the arithmetic that reads them. It never touches the world, a
  pack, a ledger, a purse or a price, and it is not wired in yet: the design and
  Patrick's questions are on #512 (issuecomment-6245906394).

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
  return module.exports;
  })();
  // ==== end TRADING_COMPANY ====

  var BY_CHARS = 80;
  var FILE_NAME = 'company-terms.json';

  /* What the card calls each term, and what kind of value it takes. v is not staff's to change. */
  var FIELDS = [
    { key: 'haulFee', label: 'Haul fee', kind: 'gold' },
    { key: 'haulCutPercent', label: 'The company\'s cut of a haul\'s pay', kind: 'percent' },
    { key: 'haulCutFrom', label: 'No haul cut on a pay under', kind: 'gold' },
    { key: 'saleWorkerPercent', label: 'The worker\'s cut of a sale', kind: 'percent' },
    { key: 'saleGonePercent', label: 'The part of a sale that leaves Skyrim', kind: 'percent' },
    { key: 'saleCutFrom', label: 'No sale cuts on a price under', kind: 'gold' },
    { key: 'charter', label: 'Who charters a ship hold', kind: 'choice', choices: LIB.CHARTER },
    { key: 'freightPerLoad', label: 'Freight for one load into a ship hold (0 is none)', kind: 'gold' },
    { key: 'freightTo', label: 'Where freight goes', kind: 'choice', choices: LIB.FREIGHT_TO }
  ];

  function clog() {
    var a = ['[thornswood company]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function fsOf() { try { return require('fs'); } catch (e) { return null; } }

  function termsPath() {
    var fs = fsOf();
    if (!fs) { return null; }
    var path = require('path');
    var priv = 'private';
    try {
      var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
      if (cfg && cfg.privDir) { priv = String(cfg.privDir); }
    } catch (e) { }
    try { if (!fs.existsSync(priv)) { fs.mkdirSync(priv, { recursive: true }); } } catch (e2) { }
    return path.join(priv, FILE_NAME);
  }

  // The shipped terms. They check, or this throws at load: tests/test-512-trading-company.js holds that.
  var SHIPPED = LIB.loadTerms(JSON.stringify(COMPANY_TERMS));

  function cleanWho(by) { return typeof by === 'string' ? by.replace(/\s+/g, ' ').trim().slice(0, BY_CHARS) : ''; }

  function historyOf(rows) {
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (r && typeof r === 'object' && Number.isInteger(r.at) && Array.isArray(r.changes)) {
        out.push({ at: r.at, changes: copy(r.changes) });
      }
    });
    return out;
  }

  function pendingOf(p) {
    if (!p || typeof p !== 'object' || !Number.isInteger(p.at) ||
        typeof p.base !== 'string' || !Array.isArray(p.changes) || !p.changes.length) { return null; }
    if (LIB.checkTerms(p.next).length) { return null; }
    return { at: p.at, base: p.base, next: copy(p.next), changes: copy(p.changes),
             openHaulsKeepTerms: Number(p.openHaulsKeepTerms) || 0 };
  }

  function readState() {
    var fresh = { terms: copy(SHIPPED), history: [], pending: null, unreadable: false };
    var fs = fsOf();
    var file = termsPath();
    if (!fs || !file) { return fresh; }
    var text = null;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') { return fresh; }
      clog('could not read', file + ':', (e && e.message) || e, '; the shipped terms stand');
      fresh.unreadable = true;
      return fresh;
    }
    var raw = null;
    try { raw = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e2) { raw = null; }
    var why = raw && typeof raw === 'object' ? LIB.checkTerms(raw.terms) : ['it is not readable JSON'];
    if (why.length) {
      clog(file, 'is refused (' + why.join(' ') + '); the shipped terms stand and the file is left as it is');
      fresh.unreadable = true;
      return fresh;
    }
    var pending = pendingOf(raw.pending);
    if (raw.pending && !pending) { clog('the proposal in', file, 'does not check; it is not kept'); }
    return { terms: copy(raw.terms), history: historyOf(raw.history), pending: pending, unreadable: false };
  }

  var state = readState();
  // Who made the proposal waiting now, as the staff log names them. Memory
  // only: the file names nobody, so after a restart this is ''.
  var proposedBy = '';

  /* Writes the next state whole, or nothing. Answers true when it is on disk. */
  function write(next) {
    var fs = fsOf();
    var file = termsPath();
    if (!fs || !file) { return false; }
    try {
      if (state.unreadable && fs.existsSync(file)) {
        fs.renameSync(file, file + '.unreadable-' + Date.now());
      }
      fs.writeFileSync(file + '.tmp', JSON.stringify({ terms: next.terms, history: next.history, pending: next.pending }));
      fs.renameSync(file + '.tmp', file);
    } catch (e) {
      clog('could not write', file + ':', (e && e.message) || e, '; nothing changed');
      return false;
    }
    state = { terms: copy(next.terms), history: next.history, pending: next.pending, unreadable: false };
    return true;
  }

  function terms() { return copy(state.terms); }
  function pending() { return state.pending ? copy(state.pending) : null; }
  function history() { return copy(state.history); }

  /* The hauls on the boards now, not yet delivered or down, that carry the cut they were posted under. */
  function openHauls() {
    var out = [];
    var P = g.__thornswoodProperty;
    var all = null;
    try { all = (P && typeof P.notices === 'function') ? P.notices() : null; } catch (e) { all = null; }
    for (var hold in (all || {})) {
      if (!Object.prototype.hasOwnProperty.call(all, hold) || !Array.isArray(all[hold])) { continue; }
      all[hold].forEach(function (n) { if (n && n.haul && n.cut && !n.down && !n.paid) { out.push(n); } });
    }
    return out;
  }

  /** Keeps one proposal, checked whole, and changes nothing else. A later one replaces it. */
  function propose(next, by) {
    var who = cleanWho(by);
    if (!who) { return { ok: false, why: 'Say who is proposing it.' }; }
    var p = LIB.proposeTerms(state.terms, next, openHauls());
    if (!p.ok) { return { ok: false, why: p.why.join(' ') }; }
    if (!p.changes.length) { return { ok: false, why: 'Those are the terms in force already.' }; }
    var was = state.pending;
    var wasBy = proposedBy;
    var row = { at: Date.now(), base: p.base, next: p.next, changes: p.changes,
                openHaulsKeepTerms: p.openHaulsKeepTerms };
    if (was && row.at <= was.at) { row.at = was.at + 1; }
    if (!write({ terms: state.terms, history: state.history, pending: row })) {
      return { ok: false, why: 'The proposal could not be written, so nothing changed.' };
    }
    proposedBy = who;
    clog(who, 'proposed', p.changes.map(function (c) { return c.term + ' ' + c.from + ' to ' + c.to; }).join(', '));
    return { ok: true, pending: pending(), replaced: was ? copy(was) : null, replacedBy: was ? wasBy : '' };
  }

  /** Adopts the proposal made at at, as a change by whoever confirms it. */
  function confirm(at, by) {
    var p = state.pending;
    if (!p) { return { ok: false, why: 'Nothing is proposed.' }; }
    if (String(at) !== String(p.at)) { return { ok: false, why: 'That is not the proposal waiting now.' }; }
    var who = cleanWho(by);
    if (!who) { return { ok: false, why: 'Say who is confirming it.' }; }
    var adopted;
    try {
      adopted = LIB.adoptTerms({ terms: state.terms, history: state.history },
                               { ok: true, base: p.base, next: p.next, changes: p.changes }, Date.now());
    } catch (e) {
      return { ok: false, why: String((e && e.message) || e) };
    }
    if (!write({ terms: adopted.terms, history: adopted.history, pending: null })) {
      return { ok: false, why: 'The new terms could not be written, so nothing changed.' };
    }
    var byWas = proposedBy;
    proposedBy = '';
    clog(who, 'confirmed', (byWas || 'an earlier') + '\'s proposal:', p.changes.map(function (c) { return c.term + ' ' + c.from + ' to ' + c.to; }).join(', '));
    return { ok: true, terms: terms(), changes: copy(p.changes), proposedBy: byWas };
  }

  /** Clears the proposal made at at, and changes nothing else. */
  function drop(at, by) {
    var p = state.pending;
    if (!p) { return { ok: false, why: 'Nothing is proposed.' }; }
    if (String(at) !== String(p.at)) { return { ok: false, why: 'That is not the proposal waiting now.' }; }
    var who = cleanWho(by);
    if (!who) { return { ok: false, why: 'Say who is dropping it.' }; }
    if (!write({ terms: state.terms, history: state.history, pending: null })) {
      return { ok: false, why: 'The proposal could not be cleared, so it stands.' };
    }
    var byWas = proposedBy;
    proposedBy = '';
    clog(who, 'dropped', (byWas || 'an earlier') + '\'s proposal');
    return { ok: true, dropped: copy(p), proposedBy: byWas };
  }

  /* ------------------------------------------------------- the staff card */
  var STAFF_LOG_GONE = 'The staff log is not loaded on this server, so no staff press is taken. Say so in the dev channel.';

  function isStaffNow(pid) {
    var f = g['__thornswoodIsStaff'];
    try { return typeof f === 'function' && !!f(Number(pid) || 0); } catch (e) { return false; }
  }

  function nameOfActor(actorId) {
    try {
      var ap = mp.get(actorId, 'appearance');
      if (ap && ap.name) { return String(ap.name); }
    } catch (e) { }
    return 'somebody';
  }

  function labelOf(key) {
    for (var i = 0; i < FIELDS.length; i++) { if (FIELDS[i].key === key) { return FIELDS[i].label; } }
    return key;
  }
  function said(changes) {
    return changes.map(function (c) { return labelOf(c.term) + ' from ' + c.from + ' to ' + c.to; }).join('; ');
  }

  /** What the staff card on the Office page draws, or null for anybody who is not staff. */
  function staffView(profileId) {
    if (!isStaffNow(profileId)) { return null; }
    var t = state.terms;
    var p = state.pending;
    return {
      fields: FIELDS.map(function (f) {
        var row = { key: f.key, label: f.label, kind: f.kind, value: t[f.key] };
        if (f.choices) { row.choices = f.choices.slice(); }
        return row;
      }),
      pending: p ? { at: p.at, by: proposedBy, openHaulsKeepTerms: p.openHaulsKeepTerms,
                     changes: p.changes.map(function (c) { return { term: c.term, label: labelOf(c.term), from: c.from, to: c.to }; }) } : null,
      openHauls: openHauls().length,
      changed: state.history.length ? { at: state.history[state.history.length - 1].at } : null
    };
  }

  /* Every staff member's K panel again, so each card says what is true now. */
  function redrawStaff() {
    var c = g.__thornswoodCharacter;
    if (!c || !c.stateOf || !c.writeState) { return; }
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    for (var i = 0; i < online.length; i++) {
      var pid = 0;
      try { pid = Number(mp.get(online[i], 'profileId')) || 0; } catch (e2) { pid = 0; }
      if (!pid || !isStaffNow(pid)) { continue; }
      try {
        var s = c.stateOf(online[i]);
        if (s) { c.writeState(online[i], s); }
      } catch (e3) { }
    }
  }

  /* The terms a propose line names: term=value pairs over the terms in force. null and why when one is wrong. */
  function nextFrom(pairs) {
    var next = copy(state.terms);
    var seen = {};
    for (var i = 0; i < pairs.length; i++) {
      var m = /^([A-Za-z]+)=([a-z0-9]+)$/.exec(String(pairs[i] || ''));
      var f = null;
      for (var j = 0; m && j < FIELDS.length; j++) { if (FIELDS[j].key === m[1]) { f = FIELDS[j]; } }
      if (!f) { return { why: 'The card sent a term the server does not know.' }; }
      if (seen[f.key]) { return { why: 'The card sent ' + f.label + ' twice.' }; }
      seen[f.key] = true;
      if (f.kind === 'choice') { next[f.key] = m[2]; } else if (/^\d+$/.test(m[2])) { next[f.key] = Number(m[2]); } else {
        return { why: f.label + ' is a whole number.' };
      }
    }
    if (!pairs.length) { return { why: 'Change a term on the card first.' }; }
    return { next: next };
  }

  /*
    The staff card's lines: propose <term>=<value>..., confirm <when> and
    drop <when>. Answers true, because the word is always this block's.
  */
  function command(parts, actorId, profileId, toProfile, cmd) {
    var pid = Number(profileId) || 0;
    var verb = String((parts && parts[1]) || '').toLowerCase();
    if (!isStaffNow(pid)) {
      clog('a line for the company\'s terms from profile', pid, 'who is not staff; nothing changed');
      toProfile(profileId, 'The company\'s terms are staff\'s. Nothing changed.');
      return true;
    }
    var log = g['__thornswoodStaff'];
    if (!log || typeof log.unproven !== 'function' || typeof log.record !== 'function') {
      toProfile(profileId, STAFF_LOG_GONE);
      return true;
    }
    var unproven = log.unproven(cmd, pid);
    if (unproven) { toProfile(profileId, unproven); return true; }
    var name = nameOfActor(actorId);
    var by = name.slice(0, 60) + ' (profile ' + pid + ')';
    var r;

    if (verb === 'propose') {
      var n = nextFrom((parts || []).slice(2));
      if (!n.next) { toProfile(profileId, n.why + ' Nothing changed.'); return true; }
      r = propose(n.next, by);
      if (!r.ok) { toProfile(profileId, r.why + ' Nothing changed.'); return true; }
      log.record('companypropose', pid, name, 0, 'the company\'s terms',
                 said(r.pending.changes) + (r.replaced ? ', in place of ' + (r.replacedBy || 'an earlier') + '\'s proposal' : ''),
                 0, { changes: r.pending.changes });
      toProfile(profileId, 'You propose new terms for the company: ' + said(r.pending.changes) + '. They change only ' +
                'when staff confirm them on this page. ' + r.pending.openHaulsKeepTerms +
                (r.pending.openHaulsKeepTerms === 1 ? ' open haul keeps' : ' open hauls keep') +
                ' the terms it was posted under. It is in the staff log.');
      redrawStaff();
      return true;
    }

    if (verb === 'confirm' || verb === 'drop') {
      var at = parts && parts[2];
      var p = state.pending;
      r = verb === 'confirm' ? confirm(at, by) : drop(at, by);
      var from = r.proposedBy ? 'proposed by ' + r.proposedBy : 'proposed before the last restart';
      if (!r.ok) {
        toProfile(profileId, r.why + (/waiting now/.test(r.why) ? ' Open the page again to see the one that is.' : '') +
                  ' Nothing changed.');
        return true;
      }
      if (verb === 'drop') {
        log.record('companydrop', pid, name, 0, 'the company\'s terms', from + ': ' + said(p.changes),
                   0, { changes: p.changes, proposedBy: r.proposedBy });
        toProfile(profileId, 'You drop the proposal. The company\'s terms stay as they are. It is in the staff log.');
        redrawStaff();
        return true;
      }
      log.record('companyconfirm', pid, name, 0, 'the company\'s terms', from + ': ' + said(r.changes),
                 0, { changes: r.changes, proposedBy: r.proposedBy });
      toProfile(profileId, 'The company\'s terms change: ' + said(r.changes) + '. Hauls already posted keep the ' +
                'terms they were posted under. It is in the staff log.');
      redrawStaff();
      return true;
    }

    toProfile(profileId, 'The company\'s card on the Office page of K proposes, confirms and drops. Nothing changed.');
    return true;
  }

  g.__thornswoodCompany = {
    terms: terms,
    haulFee: function () { return state.terms.haulFee; },
    stampHaul: function (n) { return LIB.stampHaul(n, state.terms); },
    haulCut: function (n) { return LIB.haulCut(n, state.terms); },
    saleCuts: function (price) { return LIB.saleCuts(price, state.terms); },
    mayCharter: function (who) { return LIB.mayCharter(who, state.terms); },
    freightFor: function () { return LIB.freightFor(state.terms); },
    pending: pending,
    history: history,
    propose: propose,
    confirm: confirm,
    drop: drop,
    // The staff card on the Office page of K: what it draws, and its lines.
    staffView: staffView,
    command: command,
    FIELDS: copy(FIELDS)
  };
  clog('the company\'s terms are read: haul fee', state.terms.haulFee, ', haul cut', state.terms.haulCutPercent + '%',
       ', charter', state.terms.charter, ', freight', state.terms.freightPerLoad);
})();
// ==== end thornswood company terms ====

