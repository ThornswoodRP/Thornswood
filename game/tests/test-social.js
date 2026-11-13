// test-social.js
//
// Friends, parties, mutes, journals and trading.
//
// Patrick, 22 September, in one message: "Friend/Party System & Journals - P
// for the Party menu... J for Journal... Add it so that when you look at
// someone, you are prompted to press buttons: one for friend, one for trade,
// and one for mute. Currently the looking at people doesnt have the trade menu
// and when it did you had to use youyr cursor and a bunch of other bs I just
// want to press a key while looking at them."
//
// THE TRADE MENU HE REMEMBERS WAS AN ADD-ON OF THE OLD MULTIPLAYER MOD, not in
// this build: the launcher carried six key bindings for it and wrote them
// into a file that does not exist. So all of this is new, and the
// first thing checked here is the loop everything else rides on - the server
// publishing who is near you, the client matching the crosshair against it.
//
// It drives the REAL social and trade blocks out of gamemode.js over a fake mp
// and a fake clock, the way test-needs.js does.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const FRONT = fs.readFileSync(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'), 'utf8');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function lift(a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i >= 0 && j >= 0) ? src.slice(i, j) : null;
}
const social = lift('// ==== thornswood social:', '// ==== end thornswood social ====');
const trade = lift('// ==== thornswood trade ====', '// ==== end thornswood trade ====');
yes('the social block is in the gamemode', social !== null);
yes('the trade block is in the gamemode', trade !== null);

/*
  One world, two blocks.

  They are run over the SAME fake mp, because they talk to each other: a trade
  asks the social block for names, and accepting a trade offer is a social
  verb that calls into the trade block. Running them apart would test two
  things that never meet.
*/
function world() {
  const store = {};      // actorId -> { prop -> value }
  const clock = { now: 1700000000000 };
  const said = [];
  const timers = [];
  const kinds = {};
  const properties = {};
  const g = {};

  const mp = {
    makeProperty: function (name, config) { properties[name] = config; },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') {
        return Object.keys(store).filter(k => store[k].here).map(Number);
      }
      const row = store[id];
      if (!row) { return undefined; }
      if (key === 'inventory') { return { entries: (row.inventory || []).slice() }; }
      return row[key];
    },
    set: function (id, key, v) {
      if (!store[id]) { store[id] = {}; }
      if (key === 'inventory') { store[id].inventory = (v && v.entries) || []; return; }
      store[id][key] = v;
    },
    lookupEspmRecordById: function (baseId) {
      const n = kinds[baseId];
      return n ? { record: { type: 'MISC', editorId: n, fields: [{ type: 'FULL', data: n }] } } : null;
    }
  };

  function run(block) {
    return new Function(
      'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
      'guard', 'say', 'notify', 'Math', 'Number', 'String', 'Object', 'Array',
      'JSON', 'isFinite', 'parseInt',
      require('../../tests/fixtures/ordinary-quest-items') + block)(
      g, mp, { now: function () { return clock.now; } },
      { log: function () { } },
      function (f) { timers.push(f); return timers.length; },
      function () { },
      function (n, f) { return f; },
      function (id, line) { said.push({ to: id, line: line }); },
      function (id, line) { said.push({ to: id, line: line }); },
      Math, Number, String, Object, Array, JSON, isFinite, parseInt);
  }

  run(social);
  run(trade);

  const api = {
    g: g,
    soc: g.__thornswoodSocial,
    trade: g.__thornswoodTrade,
    mp: mp,
    said: said,
    store: store,
    properties: properties,
    clock: clock,
    tick: function () { timers.forEach(f => f()); },
    /** Put somebody in the world. */
    person: function (id, name, profileId, cell, pos) {
      store[id] = {
        here: true, profileId: profileId, appearance: { name: name },
        worldOrCellDesc: cell || 'cell:X.esm', pos: pos || [0, 0, 0], inventory: []
      };
      return id;
    },
    moveTo: function (id, pos, cell) {
      store[id].pos = pos;
      if (cell) { store[id].worldOrCellDesc = cell; }
    },
    gone: function (id) { store[id].here = false; },
    give: function (id, baseId, count, label) {
      kinds[baseId] = label || ('thing' + baseId);
      store[id].inventory = (store[id].inventory || []).concat([{ baseId: baseId, count: count }]);
    },
    count: function (id, baseId) {
      let n = 0;
      (store[id].inventory || []).forEach(e => { if (e.baseId === baseId) { n += e.count || 1; } });
      return n;
    },
    near: function (id) {
      const v = store[id] && store[id].thornswoodNear;
      return (v && v.w) || {};
    },
    lines: function (id) {
      return said.filter(s => s.to === id).map(s => s.line);
    }
  };
  return api;
}

if (social && trade) {
  const GOLD = 0x0000000F;

  // --------------------------------------------- who is near, which is the loop
  {
    const w = world();
    const A = w.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const B = w.person(0xff000002, 'Sera', 102, 'town:X.esm', [200, 0, 0]);
    const C = w.person(0xff000003, 'Far', 103, 'town:X.esm', [90000, 0, 0]);
    const D = w.person(0xff000004, 'Inside', 104, 'inn:X.esm', [0, 0, 0]);
    w.soc.nearTick();

    const mine = w.near(A);
    yes('somebody standing next to you is near', !!mine[B.toString(16)]);
    yes('and is named, so the prompt can say who it is', mine[B.toString(16)].n === 'Sera');
    yes('somebody across the hold is not', !mine[C.toString(16)]);
    yes('somebody through a door is not, whatever the coordinates say',
        !mine[D.toString(16)]);
    yes('and you are not near yourself', !mine[A.toString(16)]);

    /*
      THE OTHER HALF OF THE LOOP, in the plugin. The server can publish a
      perfect list and it is worth nothing unless the client asks the game
      what is under the crosshair, which nothing in this repo did before
      today.
    */
    yes('the client asks the game what is under the crosshair',
        /getCurrentCrosshairRef/.test(FRONT));
    yes('and matches it against what the server published',
        /globalThis\.thornswoodNear/.test(FRONT));
    yes('the three verbs are sent as ordinary commands',
        /lookVerb\('friend'\)/.test(FRONT) && /lookVerb\('trade'\)/.test(FRONT) &&
        /lookVerb\('mute'\)/.test(FRONT));
    yes('P and J open their panels', /thornswoodParty&&window\.thornswoodParty\.toggle/.test(FRONT) &&
        /thornswoodJournal&&window\.thornswoodJournal\.toggle/.test(FRONT));
    yes('and the three panels are actually loaded',
        /thornswood-party\.js/.test(FRONT) && /thornswood-journal\.js/.test(FRONT) &&
        /thornswood-trade\.js/.test(FRONT));
  }

  // A new profile with no appearance must not show on the trade/party lists.
  // 3 Oct 2026, profile 598737699: the engine had already published him, and
  // the trade name fell back to "somebody" because appearance.name was empty.
  // The fallback string stays. The list itself hides him until a face is stored.
  {
    const w = world();
    const A = w.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const NEW = 0xff000099;
    w.store[NEW] = {
      here: true, profileId: 598737699, appearance: null,
      worldOrCellDesc: 'town:X.esm', pos: [50, 0, 0], inventory: []
    };
    // The chargen block's test of a stored face, which the social block asks
    // of the appearance it read once this pass (#1721).
    w.g.__thornswoodChargen = {
      hasStoredAppearance: function (a) { return !!(a && typeof a === 'object'); }
    };
    w.soc.nearTick();
    yes('a person with no stored appearance is not on the near list',
        !w.near(A)[NEW.toString(16)]);

    w.store[NEW].appearance = { name: '' };
    w.soc.nearTick();
    const row = w.near(A)[NEW.toString(16)];
    yes('once an appearance object is stored they are near, even with a blank name',
        !!row);
    yes('and the trade name fallback is still somebody when the stored name is empty',
        !!row && row.n === 'somebody');
  }

  // --------------------------------------------------------------- friends
  {
    const w = world();
    const A = w.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const B = w.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);

    yes('nobody starts with friends', w.soc.view(A).friends.length === 0);
    w.soc.offer('friend', A, B);
    yes('an offer stands for the person it was made to', !!w.soc.standingOffer(102));
    yes('and not for anybody else', !w.soc.standingOffer(101));
    const asked = w.soc.view(B);
    yes('the offer is on the view the prompt reads, with a name',
        !!asked.offer && asked.offer.kind === 'friend' && asked.offer.name === 'Bjorn');
    yes('the person who was asked is told to use the prompt',
        src.indexOf('Accept or refuse on the prompt.') >= 0 &&
        src.indexOf('/yes or /no') < 0);

    // The accept path, the way the command does it.
    w.soc.addFriend(B, A);
    w.soc.addFriend(A, B);
    yes('saying yes makes it mutual, not a follower list',
        w.soc.isFriend(A, 102) && w.soc.isFriend(B, 101));

    w.soc.dropFriend(A, 102);
    yes('and removing is one sided, so you can drop somebody quietly',
        !w.soc.isFriend(A, 102) && w.soc.isFriend(B, 101));

    // An offer nobody answered goes away on its own.
    w.soc.offer('friend', A, B);
    w.clock.now += w.soc.SOCIAL.offerFor + 1000;
    yes('an offer nobody answers lapses', !w.soc.standingOffer(102));
  }

  // ----------------------------------------------------------------- mutes
  {
    const w = world();
    const A = w.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const B = w.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);
    yes('muting says it turned on', w.soc.toggleMute(A, 102, 'Sera') === true);
    yes('and it is kept on the character', !!w.soc.stateOf(A).muted[102]);
    yes('and it is only yours', !w.soc.stateOf(B).muted[101]);
    yes('pressing again turns it off', w.soc.toggleMute(A, 102, 'Sera') === false);

    // The page is where the silence actually happens.
    const voice = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-voice.js'), 'utf8');
    yes('the voice page takes a mute list', /setMuted: function/.test(voice));
    const placeSource = voice.match(/  function place\(\) \{[\s\S]*?\n  \}/);
    if (!placeSource) { throw new Error('voice placement function missing'); }
    const rec = { profileId: 102, gain: {}, panner: {}, mode: 'local' };
    const muted = { 102: true }, hushed = {};
    const who = {
      101: { pos: [0, 0, 0], cell: 'Whiterun', angleZ: 0 },
      102: { pos: [100, 0, 0], cell: 'Whiterun' }
    };
    const place = new Function('lastWho', 'cfg', 'ctx', 'conns', 'muted', 'hushed',
      'setGain', 'hear', 'setPos', 'levelFor', 'draw', 'UNITS_PER_METRE',
      placeSource[0] + '\nreturn place;')(
        who, { profileId: 101 }, {}, new Map([[102, rec]]), muted, hushed,
        (node, value) => { node.value = value; },
        (connection, value) => { connection.hearing = value; },
        () => {}, () => 0.75, () => {}, 70);
    place();
    yes('and applies it to the gain node it already had',
        rec.gain.value === 0 && rec.hearing === false);
    delete muted[102];
    place();
    yes('unmuting restores the existing connection volume',
        rec.gain.value === 0.75 && rec.hearing === true);
    hushed[102] = true;
    place();
    yes('staff silence also closes that connection',
        rec.gain.value === 0 && rec.hearing === false);
  }

  // --------------------------------------------------------------- parties
  {
    const w = world();
    const A = w.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const B = w.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);
    const C = w.person(0xff000003, 'Thora', 103, 'town:X.esm', [200, 0, 0]);

    yes('nobody starts in a party', !w.soc.partyOf(101));
    yes('inviting makes one', w.soc.joinParty(101, 102) === '');
    const p = w.soc.partyOf(101);
    yes('with both of them in it', p && p.members.length === 2);
    yes('and the person who asked leads it', p.leader === 101);
    yes('the other one is in the same party', w.soc.partyOf(102) === p);

    w.soc.joinParty(101, 103);
    yes('a third joins the same one', w.soc.partyOf(103).members.length === 3);

    /*
      THE BONUS IS ON BEING TOGETHER. Patrick and Blade both asked for an
      experience bonus for playing together, and a bonus for being LISTED
      together is a checkbox everybody ticks once.
    */
    yes('standing with your party pays', w.soc.workBonus(A) > 1);
    w.moveTo(B, [100, 0, 0], 'far:X.esm');
    w.moveTo(C, [200, 0, 0], 'far:X.esm');
    yes('and being in the same list from two holds away does not',
        w.soc.workBonus(A) === 1);
    w.moveTo(B, [100, 0, 0], 'town:X.esm');
    yes('one of them coming back is enough', w.soc.workBonus(A) > 1);

    w.soc.leaveParty(102);
    w.soc.leaveParty(103);
    yes('a party of one is not a party', !w.soc.partyOf(101));

    // Logging out leaves it, which the tick does.
    const w2 = world();
    w2.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    w2.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);
    w2.soc.joinParty(101, 102);
    w2.gone(0xff000002);
    w2.soc.tick();
    yes('somebody who logs out leaves the party', !w2.soc.partyOf(102));

    const w3 = world();
    w3.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    w3.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);
    w3.person(0xff000003, 'Thora', 103, 'town:X.esm', [200, 0, 0]);
    w3.soc.joinParty(101, 102);
    w3.soc.joinParty(101, 103);
    yes('a member cannot disband', w3.soc.disbandParty(102) === 'Only the leader can do that.');
    yes('the leader can hand the lead across', w3.soc.leadParty(101, 102) === '');
    yes('and that person leads', w3.soc.partyOf(101).leader === 102);
    yes('the new leader can kick', w3.soc.kickParty(102, 103) === '');
    yes('and the kicked person is out', !w3.soc.partyOf(103) && w3.soc.partyOf(101).members.length === 2);
    yes('the leader can end it', w3.soc.disbandParty(102) === '');
    yes('and nobody is left in it', !w3.soc.partyOf(101) && !w3.soc.partyOf(102));
  }

  // ------------------------------------------------ text and name switches
  {
    const w = world();
    const A = w.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    w.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);
    yes('text mute turns on', w.soc.toggleText(A, 102, 'Sera') === true);
    yes('and it is kept on the character', !!w.soc.stateOf(A).textOff[102]);
    yes('pressing again turns text back on', w.soc.toggleText(A, 102, 'Sera') === false);
    yes('hiding a name turns on', w.soc.toggleName(A, 102, 'Sera') === true);
    yes('and it is kept', !!w.soc.stateOf(A).namesOff[102]);
    yes('hiding every name turns on', w.soc.toggleNamesAll(A) === true);
    yes('and again puts them back', w.soc.toggleNamesAll(A) === false);
    const known = w.soc.resolveKnown(A, 'Sera');
    yes('a known name resolves to the profile', known.pid === 102 && known.why === '');
  }

  // -------------------------------------------------------------- journals
  {
    const w = world();
    const A = w.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const B = w.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);

    const made = w.soc.newJournal(A, 'The Road North');
    yes('a journal can be started', !!made.journal && made.journal.title === 'The Road North');
    const jid = made.journal.id;
    // A second New straight after is a second journal (#2135): nothing is
    // taken as the first press arriving again, because nothing repeats one.
    const second = w.soc.newJournal(A, 'Recipes');
    yes('and more than one, which is what was asked for',
        !!second.journal && w.soc.stateOf(A).journals.length === 2);

    yes('a page can be written', w.soc.writePage(A, jid, '', 'Day one', 'It rained.') === '');
    const book = w.soc.findJournal(w.soc.stateOf(A), jid);
    yes('and it is in the journal', book.pages.length === 1 && book.pages[0].text === 'It rained.');
    const pid = book.pages[0].id;
    w.soc.writePage(A, jid, pid, 'Day one', 'It rained all week.');
    yes('writing the same page again edits it rather than adding one',
        w.soc.findJournal(w.soc.stateOf(A), jid).pages.length === 1);

    // Sharing is with a friend and nobody else.
    yes('you cannot share with somebody who is not a friend',
        w.soc.share(A, jid, '', 102) === 'You can only share with a friend.');
    w.soc.addFriend(A, B);
    yes('and you can with one', w.soc.share(A, jid, '', 102) === '');
    const mineB = w.soc.sharedWithMe(B);
    yes('it turns up on their side', mineB.length === 1 && mineB[0].from === 'Bjorn');
    yes('with the page in it', mineB[0].pages.length === 1);
    yes('and it is not a copy: they read what it says now',
        mineB[0].pages[0].text === 'It rained all week.');

    // One page rather than the whole book.
    const w2 = world();
    const X = w2.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const Y = w2.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);
    const j2 = w2.soc.newJournal(X, 'Two pages').journal;
    w2.soc.writePage(X, j2.id, '', 'Open', 'anybody may read this');
    w2.soc.writePage(X, j2.id, '', 'Shut', 'nobody may');
    w2.soc.addFriend(X, Y);
    const open = w2.soc.findJournal(w2.soc.stateOf(X), j2.id).pages[0];
    w2.soc.share(X, j2.id, open.id, 102);
    const got = w2.soc.sharedWithMe(Y);
    yes('one page can be shared without the rest',
        got.length === 1 && got[0].pages.length === 1 && got[0].pages[0].title === 'Open');

    yes('and a journal can be thrown away', w2.soc.dropJournal(X, j2.id) &&
        w2.soc.stateOf(X).journals.length === 0);

    // A friend who has logged off is still on the list, and a share is for them.
    const w3 = world();
    const P = w3.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const Q = w3.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);
    w3.soc.addFriend(P, Q);
    w3.gone(Q);
    const who = w3.soc.resolveShare(P, 'Sera');
    yes('a share finds a friend who is not online, by the stored name',
        who.pid === 102 && who.why === '');
    yes('and by the profile id the panel sends',
        w3.soc.resolveShare(P, '102').pid === 102);
    const notes = w3.soc.newJournal(P, 'Notes');
    yes('the page can be marked shared with them',
        !!notes.journal && w3.soc.share(P, notes.journal.id, '', who.pid) === '');
    w3.gone(P);
    yes('it still only appears while the person who wrote it is here',
        w3.soc.sharedWithMe(Q).length === 0);

    /*
      REMOVING A FRIEND ENDS EVERY SHARE WITH THEM (#4519). A share is a flag
      on your journal or page, and removing a friend used to take them off
      the list and leave every flag, so they kept reading the journal, pages
      written after the removal too. The flags go in the same write.
    */
    const w4 = world();
    const M = w4.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const N = w4.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);
    const O = w4.person(0xff000003, 'Thora', 103, 'town:X.esm', [200, 0, 0]);
    w4.soc.addFriend(M, N);
    w4.soc.addFriend(M, O);
    const whole = w4.soc.newJournal(M, 'Shared whole').journal;
    w4.soc.writePage(M, whole.id, '', 'Before', 'written while friends');
    const some = w4.soc.newJournal(M, 'One page shared').journal;
    w4.soc.writePage(M, some.id, '', 'Open', 'this page only');
    const somePage = w4.soc.findJournal(w4.soc.stateOf(M), some.id).pages[0];
    w4.soc.share(M, whole.id, '', 102);
    w4.soc.share(M, some.id, somePage.id, 102);
    w4.soc.share(M, whole.id, '', 103);
    yes('U0 before: a journal and a page are shared with the friend',
        w4.soc.sharedWithMe(N).length === 2);
    w4.soc.dropFriend(M, 102);
    w4.soc.writePage(M, whole.id, '', 'After', 'written once they were gone');
    yes('U1 once removed, the former friend reads none of it, a page written after included',
        w4.soc.sharedWithMe(N).length === 0);
    const kept = w4.soc.stateOf(M);
    const wholeNow = w4.soc.findJournal(kept, whole.id), someNow = w4.soc.findJournal(kept, some.id);
    yes('U2 and the flags are gone from the journal and the page',
        !wholeNow.shared[102] && !(someNow.pages[0].shared || {})[102]);
    yes('U3 a share with another friend stays',
        !!wholeNow.shared[103] && w4.soc.sharedWithMe(O).length === 1 &&
        w4.soc.sharedWithMe(O)[0].pages.length === 2);
    w4.soc.addFriend(M, N);
    yes('U4 a friend added again starts with nothing shared',
        w4.soc.sharedWithMe(N).length === 0);
  }

  // ---------------------------------------------------------------- trading
  {
    const w = world();
    const A = w.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const B = w.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);
    w.give(A, 0x900, 3, 'Iron Sword');
    w.give(A, GOLD, 100, 'Gold');
    w.give(B, 0x901, 5, 'Leek');

    yes('a trade can be started', w.trade.begin(A, B) === '');
    yes('and both of them are in it', !!w.trade.tradeOf(A) && w.trade.tradeOf(B) === w.trade.tradeOf(A));
    yes('you cannot start a second one', w.trade.begin(A, B) !== '');

    yes('you can only offer what you are carrying',
        w.trade.add(A, 'Leek', 1) === 'You are not carrying that.');
    yes('and what you are', w.trade.add(A, 'Iron Sword', 2) === '');

    // A localized FULL is a string index. The trade list must not print it.
    const named = world();
    const holder = named.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    named.give(holder, 0x12AB, 1, 'ignored');
    named.mp.lookupEspmRecordById = function (baseId) {
      if (Number(baseId) !== 0x12AB) { return null; }
      return { record: {
        type: 'WEAP',
        editorId: 'SteelSword',
        fields: [{ type: 'FULL', data: [4, 0, 18, 0] }]
      } };
    };
    const held = named.trade.carrying(holder);
    yes('a localized name is the editor id, spaced, and not a row of numbers',
        held.length === 1 && held[0].n === 'Steel Sword' && !/\d/.test(held[0].n));
    yes('and the record type is a category', held.length === 1 && held[0].k === 'Weapons');
    const t = w.trade.tradeOf(A);
    yes('it lands on your side and not theirs', t.offerA.length === 1 && t.offerB.length === 0);
    yes('and not more than you have', (w.trade.add(A, 'Iron Sword', 99), t.offerA[0].c === 3));

    yes('gold you do not have is refused', w.trade.gold(A, 500) !== '');
    yes('gold you do have is not', w.trade.gold(A, 40) === '');

    w.trade.add(B, 'Leek', 5);

    /*
      THE ONE RULE THAT MAKES A TRADE SAFE. What you agreed to is what you
      get: changing either pile takes both agreements back.
    */
    w.trade.confirm(A);
    yes('one side agreeing does not swap anything', w.count(B, 0x900) === 0);
    /*
      A REAL change, not a no-op. The first version of this added a fourth
      sword to a pile that already held all three, which answers "that is all
      of them already" and correctly changes nothing: it was testing that a
      refusal unconfirms, which would be the wrong behaviour to want.
    */
    w.trade.remove(A, 'Iron Sword');
    yes('and changing the pile takes the agreement back', t.okA === false);
    w.trade.add(A, 'Iron Sword', 3);

    w.trade.confirm(A);
    w.trade.confirm(B);
    yes('both agreeing swaps it', w.count(B, 0x900) === 3 && w.count(A, 0x901) === 5);
    yes('and the gold with it', w.count(B, GOLD) === 40 && w.count(A, GOLD) === 60);
    yes('and the trade is over', !w.trade.tradeOf(A) && !w.trade.tradeOf(B));

    // Something offered and then lost is refused whole rather than half done.
    const w2 = world();
    const X = w2.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const Y = w2.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);
    w2.give(X, 0x900, 1, 'Iron Sword');
    w2.give(Y, 0x901, 1, 'Leek');
    w2.trade.begin(X, Y);
    w2.trade.add(X, 'Iron Sword', 1);
    w2.trade.add(Y, 'Leek', 1);
    w2.trade.confirm(X);
    w2.store[X].inventory = [];            // they dropped it
    const refused = w2.trade.confirm(Y);
    yes('a thing that is gone by the time both agree refuses the whole trade',
        /does not have/.test(refused) && w2.count(Y, 0x901) === 1);
    yes('and nothing moved', w2.count(X, 0x901) === 0);

    // Walking away ends it, and so does walking off.
    const w3 = world();
    const P = w3.person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
    const Q = w3.person(0xff000002, 'Sera', 102, 'town:X.esm', [100, 0, 0]);
    w3.trade.begin(P, Q);
    w3.moveTo(Q, [90000, 0, 0]);
    w3.trade.tick();
    yes('a trade ends when the two of you walk apart', !w3.trade.tradeOf(P));
  }

  // -------------------------------------------- the party bonus is paid once
  {
    /*
      A BONUS PAID IN WHOLE PIECES. Work is counted in pieces: one seam, one
      log. There is no such thing as 1.15 of a log, and rolling a die would
      make the same swing worth different amounts with nothing on screen
      saying why. So it is banked and paid as one extra piece, which at
      fifteen percent is every seventh.
    */
    yes('the bonus is banked rather than rolled for',
        /PARTY_BANK\[actorId\] >= 1/.test(src) && !/Math\.random\(\) < over/.test(src));
    yes('and it is paid through the one place all work passes',
        /function creditWork\(actorId, key(, n)?\)/.test(src) &&
        src.slice(src.indexOf('function creditWork(actorId, key'),
                  src.indexOf('function creditWork(actorId, key') + 3000)
           .indexOf('workBonus') !== -1);
  }
}

// The view can arrive before the asynchronous browser overlays mount (#1275).
// Run the property's real updateOwner script and the real command branch.
if (social && trade) {
  const a = src.indexOf("    if (word === '/friend' || word === '/party' || word === '/mute' ||");
  const b = src.indexOf("    if (word === '/rest') {", a);
  const commands = src.slice(a, b);
  function command(w, actor, text) {
    const parts = text.split(/\s+/);
    return new Function('globalThis', 'actorId', 'profileId', 'parts', 'word',
      'toProfile', 'say', 'notify', 'journalCommand', commands)(
      w.g, actor, w.soc.profileOf(actor), parts, parts[0],
      function (pid, line) { w.said.push({ to: w.soc.actorForProfile(pid), line: line }); },
      function (to, line) { w.said.push({ to: to, line: line }); }, function () {}, function () {});
  }
  function deliver(w, property, actor, page, state) {
    const ctx = { value: w.store[actor][property], state: state, sp: {
      browser: { executeJavaScript(code) { new Function('window', code)(page); } }
    } };
    new Function('ctx', w.properties[property].updateOwner)(ctx);
  }
  {
    const w = world();
    const A = w.person(0xff000003, 'First', 701);
    const page = {}, state = {};
    w.soc.push(A);
    deliver(w, 'thornswoodSocialView', A, page, state);
    yes('D1: a view arriving before the panels mount is retained in the browser',
      !!page.thornswoodSocialView && page.thornswoodSocialView.me === 701);
    const before = w.store[A].thornswoodSocialView.at;
    command(w, A, '/party refresh');
    yes('D1: opening a panel forces a fresh owner view, even in the same millisecond',
      w.store[A].thornswoodSocialView.at > before);
    let received = null;
    page.thornswoodParty = { setData(v) { received = v; } };
    deliver(w, 'thornswoodSocialView', A, page, state);
    yes('D1: the ready party panel receives the refreshed connected character state',
      !!received && received.me === 701 && Array.isArray(received.friends));
  }
  {
    const w = world();
    const A = w.person(0xff000003, 'First', 701), B = w.person(0xff000004, 'Second', 702);
    command(w, A, '/friend ff000004');
    yes('D2: the friend command reaches the target and acknowledges the sender',
      !!w.soc.standingOffer(702) && w.lines(A).some(s => /Asked Second/.test(s)));
    command(w, B, '/yes');
    yes('D2: accepting the request updates both friends lists',
      w.soc.isFriend(A, 702) && w.soc.isFriend(B, 701));
    command(w, A, '/trade ff000004');
    yes('D2: the trade command reaches the target and acknowledges the sender',
      w.soc.standingOffer(702).kind === 'trade' && w.lines(A).some(s => /Asked Second/.test(s)));
    command(w, B, '/yes');
    const page = {}, state = {};
    deliver(w, 'thornswoodTrade', A, page, state);
    yes('D2: an accepted trade arriving before its panel mounts is retained',
      !!page.thornswoodTradeView && page.thornswoodTradeView.open === true);
    command(w, A, '/trade missing');
    yes('D2: invalid trade actions give a refusal rather than vanishing, and teach no typed verb (#1628)',
      w.lines(A).some(s => /already in a trade/.test(s)) && !w.lines(A).some(s => /trade: add/.test(s)));
  }

  // A whole browser reload also loses the cache while owner state survives.
  {
    const w=world(), A=w.person(0xff000003,'First',701), B=w.person(0xff000004,'Second',702);
    w.trade.begin(A,B);
    const state={}, oldPage={};
    deliver(w,'thornswoodTrade',A,oldPage,state);
    const before=w.store[A].thornswoodTrade.at, otherBefore=w.store[B].thornswoodTrade.at;
    let received=null;
    const newPage={thornswoodTrade:{setData(v){received=v;}}};
    command(w,A,'/trade refresh');
    deliver(w,'thornswoodTrade',A,newPage,state);
    yes('D6: a fresh browser receives the current trade after ready even in the same millisecond', !!received&&received.open===true&&received.them==='Second'&&received.at>before);
    yes('D6: refreshing a trade changes only the requesting owner view', w.store[B].thornswoodTrade.at===otherBefore);
    command(w,A,'/trade cancel');
    command(w,A,'/trade refresh');
    deliver(w,'thornswoodTrade',A,newPage,state);
    yes('D6: refresh with no session closes a cached trade rather than creating an offer', !!received&&received.open===false&&!w.soc.standingOffer(702));
  }
  // The relay proof and connected profile decide whose actor runs.
  {
    const w=world(), A=w.person(0xff000003,'First',701), B=w.person(0xff000004,'Second',702);
    w.g.__thornswoodJoinPass={requiring(){return true;}};
    const da=src.indexOf('  if (!globalThis.__thornswoodLastActor)'), db=src.indexOf('  /** key -> where /tp sends staff',da);
    const words=/^const WORDS = (\[[\s\S]*?\]);$/m.exec(src);
    const api=new Function('globalThis','g','mp','WORDS','handle','toProfile','log','Date',src.slice(da,db)+'; return {dispatch,actorOf};')(
      w.g,w.g,w.mp,new Function('return '+words[1])(),
      cmd=>command(w,api.actorOf(Number(cmd.profileId)),cmd.text),
      (pid,line)=>w.said.push({to:w.soc.actorForProfile(pid),line}),()=>{}, {now(){return w.clock.now;}});
    api.dispatch({profileId:701,actorId:B,name:'Second',text:'/friend ff000004',proven:false});
    yes('D4: an unproven social request produces neither an offer nor a reply under a claimed profile', !w.soc.standingOffer(702)&&w.said.length===0);
    api.dispatch({profileId:701,actorId:B,name:'Second',text:'/friend ff000004',proven:true});
    yes('D4: a proven request uses the connected profile rather than a supplied actor or name', w.soc.standingOffer(702).from===701&&w.lines(A).some(x=>/Asked Second/.test(x)));
    api.dispatch({profileId:702,text:'/yes',proven:true});
    yes('D4: acceptance through dispatch updates the two authenticated characters', w.soc.isFriend(A,702)&&w.soc.isFriend(B,701));
    api.dispatch({profileId:701,text:'/party refresh',proven:true});
    yes('D4: party refresh returns the connected profile own state', w.store[A].thornswoodSocialView.me===701&&w.store[B].thornswoodSocialView.me===702);
    w.trade.begin(A, B);
    const atA = w.store[A].thornswoodTrade.at, atB = w.store[B].thornswoodTrade.at;
    api.dispatch({ profileId: 701, actorId: B, text: '/trade refresh', proven: false });
    yes('D4: an unproven trade refresh cannot publish private owner state',
      w.store[A].thornswoodTrade.at === atA && w.store[B].thornswoodTrade.at === atB);
    api.dispatch({ profileId: 701, actorId: B, text: '/trade refresh', proven: true });
    yes('D4: authenticated trade refresh publishes only the connected character view',
      w.store[A].thornswoodTrade.at > atA && w.store[A].thornswoodTrade.them === 'Second' && w.store[B].thornswoodTrade.at === atB);

  }
}

// The crosshair's dynamic ID belongs to the client, not the server (#1275).
{
  const w = world(), A = w.person(0xff000003, 'First', 701), B = w.person(0xff000004, 'Second', 702);
  w.soc.nearTick();
  const client = {}, state = {};
  const ctx = { value: w.store[A].thornswoodNear, state,
    getFormIdInServerFormat(id) { return id === 0xff001234 ? B : 0; } };
  new Function('ctx', 'globalThis', w.properties.thornswoodNear.updateOwner)(ctx, client);
  const start = FRONT.indexOf("  sp.on('update', guard('crosshair', () => {");
  const end = FRONT.indexOf('\n  }));', start);
  let update, target = '', prompt = null;
  const sp = { on(event, fn) { update = fn; }, Game: { getCurrentCrosshairRef() { return { getFormID() { return 0xff001234; } }; } } };
  const run = new Function('sp', 'guard', 'globalThis', 'nearList', 'drawPrompt', 'say',
    // Nothing open: no panel claim and no menu (#1739 hides the prompt under
    // them; test-1739-look-covered.js has those cases).
    'let nearAt=0, lookingAt="", lookingSig="", lookCover=""; const NEAR_EVERY=1; ' +
    // The game's own prompt, written down per new look (#2473), is
    // game\tests\test-2473-look-prompt.js's.
    'function anyClaim() { return false; } function lookCoveredBy() { return ""; } ' +
    'function gamePromptSaid() { return ""; } ' + FRONT.slice(start,end+8) + '; return function(fn){ fn(); return lookingAt; };');
  const next = run(sp, (label, fn) => fn, client, () => client.thornswoodNear, row => { prompt=row; }, () => {});
  target = next(update);
  yes('D3: a differently mapped client actor arms the prompt with its server ID', target === 'ff000004' && !!prompt && prompt.n === 'Second');
  const va=FRONT.indexOf('  function lookVerb(cmd) {'), vb=FRONT.indexOf('\n  }',va);
  const scripts=[], lines=[], notices=[];
  const page={ thornswoodNet: { say(line, how) { lines.push({line,quiet:!!(how&&how.quiet)}); return true; } },
    skyrimPlatform: { sendMessage(target, text) { notices.push(text); } } };
  const T={ready:true,js(code){ scripts.push(code); new Function('window',code)(page); return true; }};
  const verb = new Function('T','lookingAt','tellServer','say','note',FRONT.slice(va,vb+4)+'; return lookVerb;')(
    T,'ff000004',line=>lines.push({line,quiet:true}),()=>{},text=>notices.push(text));
  verb('friend'); verb('trade');
  yes('D3: friend and trade key actions send the server target through chat', lines.length===2 && lines[0].line==='/friend ff000004' && lines[1].line==='/trade ff000004');
  yes('D3: deliberate actions use the chat connection feedback rather than silent telemetry', lines.every(x=>x.quiet!==true));
  // Run chat's real offline queue path, not a stand-in acknowledgement.
  const chat = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-chat.js'), 'utf8');
  // send is what say and typed share since #2732; the methods are lifted with it.
  const fa = chat.indexOf('  function send(text, press, notice) {'), fb = chat.indexOf('  window.thornswoodNet = {', fa);
  const sa = chat.indexOf('    say: function (text, how)'), sb = chat.indexOf('    state: function', sa);
  const offline = new Function('note',
    'var ws=null, joined=false, queue=[]; const ROLL=/^\\/roll /, C_WARN="warn"; ' + chat.slice(fa,fb) +
    'return {net:{' + chat.slice(sa,sb) + '},queue};')(text=>notices.push(text));
  page.thornswoodNet = offline.net;
  verb('friend');
  yes('D3: an offline deliberate action is queued once, marked as a press, and visibly acknowledged',
    offline.queue.length===1 && offline.queue[0].text==='/friend ff000004' && offline.queue[0].press===true &&
    notices.length===1 && /queued/.test(notices[0]));
  notices.length=0;
  delete page.thornswoodNet; verb('friend');
  yes('D3: an unavailable command transport reports that the action could not be sent', notices.length===1);
}

// Mount/open events keep focus claims and use the normal command route.
{
  // From the unavailable notice to the end of the ready block, by what they
  // say. It used to end at the first comment after the start, and #2142 put
  // the board:spots comment above the ready block, so the lifted handler
  // lost every *:ready line and D5 failed on main (#2159).
  const FR=FRONT.split(String.fromCharCode(13)).join('');
  const start=FR.indexOf("    if (what === 'social:unavailable')");
  const ready=FR.indexOf("    if (what === 'party:ready' || what === 'journal:ready' || what === 'trade:ready'", start);
  const end=FR.indexOf("\n    }\n", ready) + 7;
  yes('D5: the lifted handler holds the unavailable notice, the opened events and the ready block',
    start>=0 && ready>start && end>ready && /party:opened/.test(FR.slice(start,ready)) && /setKey/.test(FR.slice(ready,end)));
  const lines=[],focus=[],notes=[],pageJs=[];
  // PARTY_NAME: the P panel is told its key when it is ready (#1919), and
  // the J panel its own, as Settings in the game has it (#3126).
  const event=new Function('what','T','tellServer','log','note','PARTY_NAME','keyName','JOURNAL_KEY',FR.slice(start,end));
  const keyName=code=>(code===36?'J':'#'+code);
  for(const what of ['party:ready','journal:ready','party:opened','journal:opened']) {
    event(what,{claimFocus(name,value){focus.push([name,value]);},js(code){pageJs.push(code);}},line=>lines.push(line),()=>{},text=>notes.push(text),'P',keyName,36);
  }
  yes('D5: a ready P panel is told its key, a ready J panel its own, and no other panel is', pageJs.length===2&&
    pageJs[0].indexOf('thornswoodParty.setKey("P")')>=0&&pageJs[1].indexOf('thornswoodJournal.setKey("J")')>=0);
  yes('D5: mounting and opening social panels request an owner refresh', lines.length===4&&lines.every(x=>x==='/party refresh'));
  event('trade:ready',{},line=>lines.push(line),()=>{},()=>{});
  yes('D5: a ready trade panel requests its own current session',lines[4]==='/trade refresh');
  yes('D5: open events still claim the correct keyboard focus', JSON.stringify(focus)==='[["party",true],["journal",true]]');
  event('social:unavailable',{},()=>{},()=>{},text=>notes.push(text));
  yes('D5: missing transport gets a native visible retry instruction',notes.length===1&&/Try again/.test(notes[0]));
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
