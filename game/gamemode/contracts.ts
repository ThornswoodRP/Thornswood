// ==== thornswood contracts ====
/*
  CONTRACTS BETWEEN PEOPLE (#4561). docs/systems/contracts.md.

  Two people write a contract with each other, a supply deal or hiring a
  guard or an escort, both sign it, and the signed copy is kept in the
  contracts ledger. Nothing enforces the terms; people do. Terms are in
  goods, coin or service, as the two of them agree, written in their own
  words. Patrick, 22 Oct: a signed contract is read by the people who signed
  it, and staff.

  NOBODY TYPES THESE. K's Contracts section sends them (Patrick, 4 Oct:
  buttons, not commands), the way it sends /apprentice and /hairdye:

      /contract offer <id> :: <terms>   Write a contract with the person the
                                        look prompt's K opened it on, and sign it
      /contract sign <n>                Sign a contract written to you
      /contract refuse <n>              Refuse one
      /contract withdraw <n>            Take back one you wrote, unsigned

  so /contract is in WORDS and kept out of PLAYER_WORDS. The look prompt
  offers K on a person as Write a contract when it is not Take on as
  apprentice or Dye their hair, and as Read their contract while they have
  one waiting for you (the near list's ct, social.ts).

  WRITING. The writer signs it as they send it, and must be within trade
  reach of the other person, in the same place, the way a letter is handed
  over. It is an offer until the other person signs, and an offer is never
  in the ledger's signed list: a refusal or a withdrawal takes it away, and
  nobody reads it but the two of them while it waits. At most OFFERS_EACH
  offers from one writer wait at once, so nobody can bury somebody's K.

  SIGNING. Only the person it is written to signs or refuses it, from K,
  wherever they are. Signing keeps it in the ledger with both names, the
  words, and when each signed. Nothing moves with it: no gold, no goods, no
  fee.

  READING. Each signer reads their own on K; staff (__thornswoodIsStaff, the
  same check as the Office page's staff views) read every signed one there
  too. Nobody else reads one, and the view for anybody else holds none.

  THE FILE. contracts.json in the server's private folder, read once at the
  start and written whole on every change, through storeWrite: a file that
  did not read is set aside, never written over (#4529).
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var fs = require('fs');
  var path = require('path');

  var TERMS_CHARS = 1000;  // as long as the J panel's box takes
  var OFFERS_EACH = 5;     // offers from one writer that may wait at once
  var REACH = 700;         // the trade's reach, unless the trade block says otherwise

  function clog() {
    var a = ['[contracts]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    console.log(a.join(' '));
  }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function ledgerPath() {
    var dir = 'private';
    try {
      var s = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
      if (s && typeof s.privDir === 'string' && s.privDir) { dir = s.privDir; }
    } catch (e) { }
    return path.join(dir, 'contracts.json');
  }

  // -- store: read and write (#4529), begin --
  /*
    storeRead(file, what) is { doc } for a file that reads, { doc: null }
    for one that is not there, and { doc: null, bad } for one that is there
    and does not read: that start holds nothing from it, and the first save
    sets it aside rather than writing over it.
  */
  function storeRead(file, what) {
    var text, doc, why = '';
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) {
      if (e && e.code === 'ENOENT') { return { doc: null, bad: '' }; }
      why = 'it could not be opened (' + ((e && e.code) || e) + ')';
    }
    if (!why) {
      try { doc = JSON.parse(String(text).replace(/^\uFEFF/, '')); }
      catch (e2) { why = 'it does not parse (' + ((e2 && e2.message) || e2) + ')'; }
    }
    if (!why && (!doc || typeof doc !== 'object')) { why = 'it holds no ' + what; }
    if (!why) { return { doc: doc, bad: '' }; }
    console.log('[thornswood] ' + file + ' could not be read: ' + why + '. This start holds no ' + what +
                ' from it, and it is never written over: the first save sets it aside as ' + file + '.unreadable-<time>');
    return { doc: null, bad: why };
  }
  function storeWrite(file, text, read) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (read && read.bad) {
      if (fs.existsSync(file)) {
        var aside = file + '.unreadable-' + Date.now();
        fs.renameSync(file, aside);
        console.log('[thornswood] ' + file + ' did not read at this start (' + read.bad + '), so it is kept as ' +
                    aside + ' and a new one is written');
      }
      read.bad = '';
    }
    fs.writeFileSync(file + '.tmp', text);
    fs.renameSync(file + '.tmp', file);
  }
  // -- store: read and write (#4529), end --

  // The ledger as it was read at this start (#4529).
  var contractsRead = storeRead(ledgerPath(), 'contract');
  var book = (function () {
    var d = contractsRead.doc || {};
    return {
      next: Math.max(1, Math.floor(Number(d.next)) || 1),
      offers: Array.isArray(d.offers) ? d.offers.filter(function (c) { return c && c.n; }) : [],
      signed: Array.isArray(d.signed) ? d.signed.filter(function (c) { return c && c.n; }) : []
    };
  })();

  function save() {
    storeWrite(ledgerPath(), JSON.stringify({ version: 1, next: book.next, offers: book.offers, signed: book.signed }, null, 1),
               contractsRead);
  }

  function social() { return g.__thornswoodSocial || null; }
  function isStaff(pid) {
    var f = g.__thornswoodIsStaff;
    try { return typeof f === 'function' && !!f(Number(pid) || 0); } catch (e) { return false; }
  }

  /*
    K is drawn again for somebody when a contract they are in changes: the
    character block sends their panel when it is not what it last sent, and
    the contracts page is part of it (contractsPage in character.ts).
  */
  function redraw(actorId) {
    var C = g.__thornswoodCharacter;
    if (!actorId || !C || !C.writeState || !C.stateOf) { return; }
    try { C.writeState(actorId, C.stateOf(actorId)); } catch (e) { clog('K could not be drawn again for', Number(actorId).toString(16) + ':', e); }
  }

  /* Within the trade's reach of each other, in the same place: how a letter is handed over. */
  function inReach(a, b) {
    var reach = REACH;
    try {
      var tr = g.__thornswoodTrade;
      if (tr && tr.TRADE && Number(tr.TRADE.reach) > 0) { reach = Number(tr.TRADE.reach); }
    } catch (e) { }
    try {
      var ca = String(mp.get(a, 'worldOrCellDesc') || '');
      var cb = String(mp.get(b, 'worldOrCellDesc') || '');
      if (!ca || ca !== cb) { return false; }
      var pa = mp.get(a, 'pos'), pb = mp.get(b, 'pos');
      if (!pa || !pb) { return false; }
      var dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
      return (dx * dx + dy * dy + dz * dz) <= reach * reach;
    } catch (e2) { return false; }
  }

  function findIn(list, n) {
    var want = Math.floor(Number(n)) || 0;
    for (var i = 0; i < list.length; i++) { if (Number(list[i].n) === want) { return i; } }
    return -1;
  }

  // The words after " :: ", with the J panel's \n made a line break again.
  function termsOf(text) {
    var t = String(text || '');
    var at = t.indexOf('::');
    if (at < 0) { return ''; }
    return t.slice(at + 2).replace(/\\n/g, '\n').trim();
  }

  function offer(a) {
    var soc = social();
    var want = String(a.parts[2] || '').trim();
    if (!want || want === '::') { return 'Look at the person the contract is with, then press K.'; }
    var terms = termsOf(a.text);
    if (!terms) { return 'Write the terms of the contract. Nothing was sent.'; }
    if (terms.length > TERMS_CHARS) {
      return 'A contract is up to ' + TERMS_CHARS + ' characters. That one is ' + terms.length + '. Nothing was sent.';
    }
    var found = soc.findPerson(want);
    if (!found || !found.actorId) { return (found && found.why) || 'Nobody here by that name.'; }
    var them = found.actorId;
    if (them === a.actorId) { return 'A contract is with somebody else.'; }
    var theirPid = Number(soc.profileOf(them)) || 0;
    if (!theirPid) { return 'The server cannot tell who that is right now. Nothing was sent.'; }
    if (!inReach(a.actorId, them)) {
      return 'Stand with them. A contract is written within about 10 metres of the person it is with. Nothing was sent.';
    }
    var waiting = book.offers.filter(function (c) { return Number(c.from) === Number(a.profileId); }).length;
    if (waiting >= OFFERS_EACH) {
      return 'You have ' + waiting + ' contracts waiting to be signed. Take one back on K before you write another.';
    }
    var c = {
      n: book.next++,
      from: Number(a.profileId), fromName: soc.nameOfPerson(a.actorId),
      to: theirPid, toName: soc.nameOfPerson(them),
      terms: terms, at: Date.now()
    };
    book.offers.push(c);
    save();
    clog(c.fromName, '(profile ' + c.from + ') wrote contract', c.n, 'with', c.toName, '(profile ' + c.to + ')');
    a.toProfile(theirPid, c.fromName + ' has written you a contract and signed it. Read it under Contracts on K, ' +
                'and sign or refuse it there.');
    redraw(them);
    return 'You signed the contract and gave it to ' + c.toName + '. It is kept once they sign it too.';
  }

  function answer(a, verb) {
    var at = findIn(book.offers, a.parts[2]);
    if (at < 0) { return 'That contract is not waiting for anybody.'; }
    var c = book.offers[at];
    var me = Number(a.profileId);
    if (verb === 'withdraw') {
      if (Number(c.from) !== me) { return 'Only the person who wrote a contract can take it back.'; }
      book.offers.splice(at, 1);
      save();
      clog(c.fromName, 'took back contract', c.n, 'with', c.toName);
      a.toProfile(c.to, c.fromName + ' took back the contract they wrote you.');
      return 'You took the contract back. ' + c.toName + ' never signed it, so it is not in the ledger.';
    }
    if (Number(c.to) !== me) { return 'That contract is not written to you.'; }
    book.offers.splice(at, 1);
    if (verb === 'refuse') {
      save();
      clog(c.toName, 'refused contract', c.n, 'from', c.fromName);
      a.toProfile(c.from, c.toName + ' refused the contract you wrote them.');
      return 'You refused the contract from ' + c.fromName + '. It is not in the ledger.';
    }
    c.signedAt = Date.now();
    book.signed.push(c);
    save();
    clog(c.toName, 'signed contract', c.n, 'from', c.fromName);
    a.toProfile(c.from, c.toName + ' signed your contract. Both of you can read it under Contracts on K.');
    return 'You signed the contract with ' + c.fromName + '. It is kept, and both of you can read it on K.';
  }

  function command(a) {
    var soc = social();
    if (!soc || !soc.findPerson || !soc.profileOf || !soc.nameOfPerson) { return 'That is not running on this server.'; }
    var verb = String(a.parts[1] || '');
    var said = 'Contracts are written and signed under Contracts on K.';
    if (verb === 'offer') { said = offer(a); }
    else if (verb === 'sign' || verb === 'refuse' || verb === 'withdraw') { said = answer(a, verb); }
    redraw(a.actorId);
    return said;
  }

  function row(c) {
    var r = { n: c.n, from: c.fromName, to: c.toName, terms: c.terms, at: c.at };
    if (c.signedAt) { r.signedAt = c.signedAt; }
    return r;
  }

  /*
    What K shows this person: offers written to them, offers they wrote that
    wait, and every signed contract they are in. Staff also get every signed
    contract they are not in, as all. Nobody gets a contract they are not
    in, unless staff. null when there is nothing to show, so K leaves the
    section off until there is (or the look prompt opens it on somebody).
  */
  function viewFor(pid) {
    var me = Number(pid) || 0;
    if (!me) { return null; }
    var mine = function (c) { return Number(c.from) === me || Number(c.to) === me; };
    var v = {
      chars: TERMS_CHARS,
      waiting: book.offers.filter(function (c) { return Number(c.to) === me; }).map(row),
      sent: book.offers.filter(function (c) { return Number(c.from) === me; }).map(row),
      signed: book.signed.filter(mine).map(row)
    };
    var any = v.waiting.length || v.sent.length || v.signed.length;
    if (isStaff(me)) {
      v.all = book.signed.filter(function (c) { return !mine(c); }).map(row);
      any = any || v.all.length;
    }
    return any ? v : null;
  }

  /* K's Contracts page for an actor (character.ts), by their profile. */
  function pageFor(actorId) {
    var pid = 0;
    try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
    return viewFor(pid);
  }

  /* Whether fromPid has a contract waiting for toPid to sign: the near list's ct (social.ts). */
  function waitingFrom(toPid, fromPid) {
    for (var i = 0; i < book.offers.length; i++) {
      if (Number(book.offers[i].to) === Number(toPid) && Number(book.offers[i].from) === Number(fromPid)) { return true; }
    }
    return false;
  }

  g.__thornswoodContracts = {
    command: command, viewFor: viewFor, pageFor: pageFor, waitingFrom: waitingFrom,
    TERMS_CHARS: TERMS_CHARS, OFFERS_EACH: OFFERS_EACH, ledgerPath: ledgerPath, storeRead: storeRead
  };
  clog('ready:', book.signed.length, 'signed,', book.offers.length, 'waiting');
})();
// ==== end thornswood contracts ====

