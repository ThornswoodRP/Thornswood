// ==== thornswood social: friends, parties, mutes and journals ====
/*
  ============================================================================
  THE PEOPLE AROUND YOU, AND WHAT YOU CAN DO ABOUT THEM.

  Patrick, 22 September, in one message:

    "Friend/Party System & Journals - P for the Party menu... J for Journal...
     Add it so that when you look at someone, you are prompted to press
     buttons: one for friend, one for trade, and one for mute. Currently the
     looking at people doesnt have the trade menu and when it did you had to
     use youyr cursor and a bunch of other bs I just want to press a key while
     looking at them."

  THE TRADE MENU HE REMEMBERS IS GONE AND IS NOT COMING BACK. It was an
  add-on of the old multiplayer mod: the launcher carried six key bindings
  for it (Keys.cs, "Start a trade", "Offer the selected item") and wrote
  them into that add-on's ini under Data\SKSE\Plugins. That file does not
  exist in this build and neither does the DLL, checked on 23 September. So
  every one of those rows on the controls page has been setting a key in a
  file nobody reads, which is why looking at somebody does nothing, and it is
  also the cursor he remembers: that mod's menu was a mouse menu.

  WHY THIS IS ONE BLOCK AND NOT THREE. A friend request, a trade offer and a
  mute all start with the same question, "who am I looking at", and the answer
  is split across the two machines in a way neither can fix alone:

    the client  knows what is under the crosshair. It is an ObjectReference
                with a form id and nothing else: no name, no profile, no way
                to tell a person from a bandit.
    the server  knows every profile, every name and where everybody is
                standing, and cannot see a crosshair at all.

  So the server publishes WHO IS NEAR YOU, as form id to name, on a property;
  the client matches the crosshair against that list and draws the prompt; a
  key press sends the form id back. That one loop is what all three verbs
  ride on, and it is the same shape the chopping block and the temperature
  both use.

  WHAT IS PERSISTENT AND WHAT IS NOT, decided here rather than discovered
  later. Friends, mutes and journals are on the character and survive a
  restart, because losing your friends list to a deploy is not a thing anybody
  would forgive. A PARTY IS A SESSION, held in memory and gone when the server
  bounces, because a party is who you are playing with this evening and a
  party that survived a restart would have you in a group with four people who
  logged off hours ago.
  ============================================================================
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  function slog() {
    var a = ['[thornswood social]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  var SOCIAL_PROPERTY = 'thornswoodSocial';
  var NEAR_PROPERTY = 'thornswoodNear';
  var PARTY_PROPERTY = 'thornswoodPartyAt';

  /*
    THE NUMBERS, in one table, the same way the needs block keeps its balance.
  */
  var SOCIAL = {
    // How close somebody has to be to appear in your nearby list at all. The
    // crosshair reaches about this far and a list of everybody in Whiterun
    // would be a property update a second for no reason.
    nearReach: 2600,
    // How often the nearby list is rebuilt. Fast enough that walking up to
    // somebody prompts within a step, slow enough to be free.
    nearEvery: 1500,
    // How long a friend request, a party invite or a trade offer stands.
    offerFor: 45000,
    // The most friends one character can hold. Not a rule anybody asked for,
    // it is a size limit on a property that has to be sent to a client.
    mostFriends: 120,
    // Journals, pages, and how much can go in one page. Same reason.
    mostJournals: 12,
    mostPages: 60,
    pageChars: 4000,
    /*
      What playing together is worth. Blade's pitch had an experience bonus
      for a party and Patrick said yes to it. A flat multiplier on work credit
      while at least one other person in your party is in the same cell: it
      has to be BEING together rather than being listed together, or the bonus
      is a checkbox everybody ticks once and forgets.
    */
    partyBonus: 0.15,
    mostParty: 6
  };

  // ------------------------------------------------------------- storage --

  function fresh() {
    return { friends: {}, muted: {}, textOff: {}, namesOff: {}, namesAll: false, journals: [], at: 0 };
  }

  /*
    ONE READ PER PERSON PER TICK, issue #385. The tick builds every person's
    panel, and each panel used to ask the engine for every other person's
    name, profile id and journals: at twenty people that was about 1,270
    engine reads a second, an appearance parsed 547 times a second, all to
    learn the same twenty names. While a tick runs, tickMemo holds what was
    read, so each fact is read once; outside a tick it is null and nothing is
    held, so a command always reads fresh. tests\test-server-tick-cost.js.
  */
  var tickMemo = null;

  function memo(key, get) {
    if (!tickMemo) { return get(); }
    if (Object.prototype.hasOwnProperty.call(tickMemo, key)) { return tickMemo[key]; }
    return (tickMemo[key] = get());
  }

  function read(actorId) {
    return memo('s' + actorId, function () { return readNow(actorId); });
  }

  function readNow(actorId) {
    var v = null;
    try { v = mp.get(actorId, SOCIAL_PROPERTY); } catch (e) { v = null; }
    if (!v || typeof v !== 'object') { return null; }
    /*
      Rebuilt field by field rather than handed back, the same as the needs
      block. That one learned the hard way that this is also where fields get
      silently dropped, so anything added to fresh() has to be added here too
      or it lives for exactly one call.
    */
    var out = fresh();
    if (v.friends && typeof v.friends === 'object') { out.friends = v.friends; }
    if (v.muted && typeof v.muted === 'object') { out.muted = v.muted; }
    if (v.textOff && typeof v.textOff === 'object') { out.textOff = v.textOff; }
    if (v.namesOff && typeof v.namesOff === 'object') { out.namesOff = v.namesOff; }
    out.namesAll = !!v.namesAll;
    if (Array.isArray(v.journals)) { out.journals = v.journals; }
    out.at = Number(v.at) || 0;
    return out;
  }

  function write(actorId, s) {
    s.at = Date.now();
    if (tickMemo) { tickMemo['s' + actorId] = s; }
    try { mp.set(actorId, SOCIAL_PROPERTY, s); return true; }
    catch (e) { return false; }
  }

  function stateOf(actorId) {
    var s = read(actorId);
    if (!s) { s = fresh(); write(actorId, s); }
    return s;
  }

  // ------------------------------------------------------------- people --

  function profileOf(actorId) {
    return memo('p' + actorId, function () {
      try { return Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { return 0; }
    });
  }

  /*
    A PERSON'S APPEARANCE, ONCE A PASS (#1721). Two things in a pass need
    it: whether they are published for others (online, below) and their name.
    The publish test used to ask the chargen block's publishedForOthers, which
    reads the engine itself, outside this memo, so twenty people cost forty
    appearance reads a pass, every 1.5 seconds. So the read is made here, once,
    and the chargen block's own test of a stored face (hasStoredAppearance) is
    asked of what came back. A read that throws is kept as that, and each
    reader answers it the way it always has.
  */
  function appearanceOf(actorId) {
    return memo('a' + actorId, function () {
      try { return { ap: mp.get(actorId, 'appearance') }; } catch (e) { return { threw: true }; }
    });
  }

  function nameOfPerson(actorId) {
    return memo('n' + actorId, function () {
      var seen = appearanceOf(actorId);
      var n = String((seen.ap && seen.ap.name) || '');
      return n || 'somebody';
    });
  }

  function online() {
    return memo('online', function () {
      var all = [];
      try { all = mp.get(0, 'onlinePlayers') || []; } catch (e) { return []; }
      var chargen = g.__thornswoodChargen;
      if (!chargen || !chargen.hasStoredAppearance) { return all; }
      var out = [];
      for (var i = 0; i < all.length; i++) {
        // Published as publishedForOthers says: a face is stored, or the read
        // threw, because hiding a returning character is the worse mistake.
        var seen = appearanceOf(all[i]);
        if (seen.threw || chargen.hasStoredAppearance(seen.ap)) { out.push(all[i]); }
      }
      return out;
    });
  }

  function actorForProfile(pid) {
    var all = online();
    for (var i = 0; i < all.length; i++) {
      if (profileOf(all[i]) === pid) { return all[i]; }
    }
    return 0;
  }

  /*
    Find somebody by what a person typed, or by the form id the crosshair gave.

    THE FORM ID IS THE ONE THAT MATTERS and the name is the fallback. A key
    press while looking at somebody sends a hex form id, which is exact. A
    typed name is a convenience for the chat and is matched case insensitively
    on a prefix, so two people called Bjorn are an ambiguity rather than a
    coin toss.
  */
  function findPerson(whoever) {
    var want = String(whoever || '').trim();
    if (!want) { return { actorId: 0, why: 'Who?' }; }

    var all = online();
    var asId = parseInt(want, 16);
    if (isFinite(asId) && asId > 0) {
      for (var i = 0; i < all.length; i++) {
        if (all[i] === asId) { return { actorId: all[i], why: '' }; }
      }
    }

    var low = want.toLowerCase();
    var exact = [], part = [];
    for (var j = 0; j < all.length; j++) {
      var n = nameOfPerson(all[j]).toLowerCase();
      if (n === low) { exact.push(all[j]); }
      else if (n.indexOf(low) === 0) { part.push(all[j]); }
    }
    var hit = exact.length ? exact : part;
    if (hit.length === 1) { return { actorId: hit[0], why: '' }; }
    if (hit.length > 1) {
      return { actorId: 0, why: 'More than one person here answers to that. Look at them and press the key instead.' };
    }
    return { actorId: 0, why: 'Nobody here by that name.' };
  }

  // ------------------------------------------------------- what is near --
  /*
    WHO IS CLOSE ENOUGH TO LOOK AT, published to each person's own client.

    The client cannot ask "is this a person", so it is told. One entry per
    person in the same cell and within reach, keyed by the form id the
    crosshair will hand back, carrying their name and what they already are to
    you, so the prompt can say "Remove friend" rather than "Add friend"
    without a round trip.

    EDGE TRIGGERED ON A SIGNATURE. This is a property and updateOwner runs
    every frame, so the script compares a string and does nothing the rest of
    the time; and the server only writes when the signature changes, so
    standing still in a room costs one build and no writes.
  */
  var nearWas = {};

  function nearScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || typeof v !== "object") { return; }',
      '    var st = ctx.state;',
      '    if (!st) { return; }',
      '    if (st.thornswoodNearAt === v.at) { return; }',
      '    st.thornswoodNearAt = v.at;',
      // The plugin reads this. updateOwner bodies are compiled with
      // new Function in the client's own global, so this is the same
      // globalThis a plugin sees; see the note over thornswoodCatchFire.
      '    try { globalThis.thornswoodNear = v.w || {};',
      '      globalThis.thornswoodHideAllNames = v.hideAll ? 1 : 0;',
      '      globalThis.thornswoodSocialServerId = ctx.getFormIdInServerFormat;',
      // And back (#2474): the voice feed's marks and words are keyed by the
      // server's id, and the plugin draws them over this machine's reference.
      '      globalThis.thornswoodSocialClientId = ctx.getFormIdInClientFormat;',
      '    } catch (e) { }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  function nearTick() {
    var all = online();
    if (!all.length) { return; }

    // Position and cell once per person per tick, rather than once per pair.
    var at = [];
    for (var i = 0; i < all.length; i++) {
      var id = all[i];
      var pos = null, cell = '';
      try { pos = mp.get(id, 'pos'); cell = String(mp.get(id, 'worldOrCellDesc') || ''); }
      catch (e) { continue; }
      if (!pos || !cell) { continue; }
      /*
        And the scar they agreed to (#1383): injury.md, a line other people
        are told when they look at you. The look prompt draws it.
      */
      var scar = '';
      try { scar = (g.__thornswoodHurt && g.__thornswoodHurt.scarOf) ? g.__thornswoodHurt.scarOf(id) : ''; } catch (eScar) { scar = ''; }
      // And whether they have a wound somebody could tend (#1383): the look
      // prompt's Tend their wounds.
      var care = false;
      try { care = !!(g.__thornswoodHurt && g.__thornswoodHurt.careOf && g.__thornswoodHurt.careOf(id)); } catch (eCare) { care = false; }
      at.push({ id: id, pos: pos, cell: cell, pid: profileOf(id), name: nameOfPerson(id), scar: scar, care: care });
    }

    var reach = SOCIAL.nearReach * SOCIAL.nearReach;
    // Whether the look prompt offers "Let sleep here" (#1603). See sleepMark
    // in the beds, in the property block.
    var beds = g.__thornswoodBeds;
    // Whether it offers "Hand over the letter" (#1595): who carries a letter
    // for whom, read once a tick. See lettersCarried in the property block.
    var props = g.__thornswoodProperty;
    var letters = (props && props.lettersCarried) ? props.lettersCarried() : null;
    // And whether it offers a Master "Take on as apprentice" (#1634). See
    // takeOnMark in the character block.
    var ch = g.__thornswoodCharacter;
    // And whether it offers "Dye their hair" (#2675): you carry a dye.
    var dyes = g.__thornswoodHairDye;
    for (var a = 0; a < at.length; a++) {
      var me = at[a];
      var s = read(me.id) || fresh();
      var dyeing = -1;   // asked once, and only with somebody near
      var party = partyOf(me.pid);
      var teacher = (ch && ch.masterRecord) ? ch.masterRecord(me.id) : null;
      var w = {};
      for (var b = 0; b < at.length; b++) {
        if (a === b) { continue; }
        var them = at[b];
        if (them.cell !== me.cell) { continue; }
        var dx = them.pos[0] - me.pos[0];
        var dy = them.pos[1] - me.pos[1];
        var dz = them.pos[2] - me.pos[2];
        if ((dx * dx + dy * dy + dz * dz) > reach) { continue; }
        w[them.id.toString(16)] = {
          n: them.name,
          p: them.pid,
          f: s.friends[them.pid] ? 1 : 0,
          m: s.muted[them.pid] ? 1 : 0,
          h: (s.namesAll || (s.namesOff && s.namesOff[them.pid])) ? 1 : 0,
          y: (party && party.members.indexOf(them.pid) !== -1) ? 1 : 0,
          s: (beds && beds.mark) ? beds.mark(me.pid, them.pid, me.cell) : 0
        };
        // c, not s: s is the holder's sleep key (#1603).
        if (them.scar) { w[them.id.toString(16)].c = them.scar; }
        // d: you carry a letter for them, and the prompt offers to hand it over (#1595).
        if (letters && letters.carries(me.pid, them.name)) { w[them.id.toString(16)].d = 1; }
        // a: the halves this Master could take them on in (#1634).
        var canTake = teacher ? ch.takeOnMark(teacher, them.id) : null;
        if (canTake) { w[them.id.toString(16)].a = canTake; }
        // t: they have a wound to tend, and the prompt offers it (#1383).
        if (them.care) { w[them.id.toString(16)].t = 1; }
        // hd: you carry a hair dye, and the prompt offers to dye theirs (#2675).
        if (dyeing < 0) {
          try { dyeing = (dyes && dyes.carries && dyes.carries(me.id)) ? 1 : 0; } catch (eDy) { dyeing = 0; }
        }
        if (dyeing) { w[them.id.toString(16)].hd = 1; }
      }
      var sig = JSON.stringify(w) + (s.namesAll ? ':all' : '');
      if (nearWas[me.id] === sig) { continue; }
      nearWas[me.id] = sig;
      try { mp.set(me.id, NEAR_PROPERTY, { w: w, hideAll: s.namesAll ? 1 : 0, at: Date.now() }); } catch (e) { }
    }

    // Anybody who has gone offline should not keep a slot in the signature
    // table, or a reconnect would be told nothing is near them.
    var here = {};
    for (var k = 0; k < all.length; k++) { here[all[k]] = true; }
    for (var had in nearWas) {
      if (!Object.prototype.hasOwnProperty.call(nearWas, had)) { continue; }
      if (!here[had]) { delete nearWas[had]; }
    }
  }

  /*
    ---------------------------------------- WHERE YOUR PARTY IS, WHEREVER IT IS

    Patrick, 22 September, asked the party menu to let people "see their name
    tag colour, see them on the map and compass". Those three were the part of
    that message that did not ship with the rest, because none of them can be
    drawn by a browser overlay: a name tag is the client's own text, and the
    compass and the map are the game's.

    ALL THREE NEED THE SAME THING FROM HERE, and it is not what thornswoodNear
    gives. Near is everybody within 2,600 units of you in the same cell, which
    is the right answer for "who am I looking at" and the wrong one for "where
    is my party": the whole point of a marker is that they are somewhere else.
    So this is a second list with no distance and no cell test at all, sent
    only to people who are actually in a party, and empty for everybody else.

    THE FORM ID IS THE IMPORTANT FIELD. The client needs it to find the text
    above their head, which skymp5-client stores by form id in
    sp.storage.idTextNickname, and it is what ties this list to the one thing
    the client can already see.

    ROUNDED TO A HUNDRED UNITS FOR THE SIGNATURE, not for the value. Positions
    move every frame and the signature is what stops this writing a property
    sixty times a second; a hundred units is about a second and a half of
    walking, which is this tick anyway. The coordinates themselves go over
    exactly.
  */
  var partyWas = {};

  function partyScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || typeof v !== "object") { return; }',
      '    var st = ctx.state;',
      '    if (!st) { return; }',
      '    if (st.thornswoodPartyAt === v.at) { return; }',
      '    st.thornswoodPartyAt = v.at;',
      // The plugin reads this. updateOwner bodies are compiled with new
      // Function in the client's own global; see the note over nearScript.
      '    try { globalThis.thornswoodPartyAt = v.m || []; } catch (e) { }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  function partyTick() {
    var all = online();
    if (!all.length) { return; }

    // Read every position once, rather than once per member per member.
    var at = {};
    for (var i = 0; i < all.length; i++) {
      var id = all[i];
      try {
        at[profileOf(id)] = {
          a: id.toString(16),
          n: nameOfPerson(id),
          p: mp.get(id, 'pos') || [0, 0, 0],
          c: String(mp.get(id, 'worldOrCellDesc') || '')
        };
      } catch (e) { }
    }

    for (var j = 0; j < all.length; j++) {
      var who = all[j];
      var mine = profileOf(who);
      var p = partyOf(mine);
      var list = [];
      var viewer = read(who) || fresh();
      if (p && p.members.length > 1) {
        for (var k = 0; k < p.members.length; k++) {
          var pid = p.members[k];
          if (pid === mine) { continue; }     // your own arrow is not a marker
          var row = at[pid];
          if (!row) { continue; }             // in the party and not online
          list.push({ a: row.a, n: row.n, p: row.p, c: row.c,
                      l: pid === p.leader ? 1 : 0,
                      h: (viewer.namesAll || (viewer.namesOff && viewer.namesOff[pid])) ? 1 : 0 });
        }
      }

      var sig = list.map(function (r) {
        return r.a + ':' + r.c + ':' + (r.h ? 'h' : '') + ':' +
               Math.round(r.p[0] / 100) + ',' +
               Math.round(r.p[1] / 100) + ',' +
               Math.round(r.p[2] / 100);
      }).join('|');
      if (partyWas[who] === sig) { continue; }
      partyWas[who] = sig;
      try { mp.set(who, PARTY_PROPERTY, { m: list, at: Date.now() }); } catch (e) { }
    }

    var here = {};
    for (var q = 0; q < all.length; q++) { here[all[q]] = true; }
    for (var had in partyWas) {
      if (!Object.prototype.hasOwnProperty.call(partyWas, had)) { continue; }
      if (!here[had]) { delete partyWas[had]; }
    }
  }

  // -------------------------------------------------------------- offers --
  /*
    A friend request, a party invite and a trade offer are the same thing with
    a different word on it: somebody asked, it stands for a while, and the
    other person says yes or it lapses.

    In memory rather than on the character, because an offer that survived a
    restart would be a request from somebody who is not here any more.
  */
  var offers = {};   // toProfileId -> { kind, from, fromName, at, about }

  // about: what a book invite is into, for the P prompt (#1591).
  function offer(kind, fromActor, toActor, about) {
    var fromPid = profileOf(fromActor);
    var toPid = profileOf(toActor);
    if (!fromPid || !toPid) { return 'That person is not here.'; }
    if (fromPid === toPid) { return 'That is you.'; }
    offers[toPid] = { kind: kind, from: fromPid, fromName: nameOfPerson(fromActor), at: Date.now(),
                      about: about ? String(about) : '' };
    return '';
  }

  function standingOffer(toPid) {
    var o = offers[toPid];
    if (!o) { return null; }
    if (Date.now() - o.at > SOCIAL.offerFor) { delete offers[toPid]; return null; }
    return o;
  }

  // ------------------------------------------------------------ friends --

  function addFriend(actorId, otherActor) {
    var s = stateOf(actorId);
    var pid = profileOf(otherActor);
    if (!pid) { return 'That person is not here.'; }
    if (Object.keys(s.friends).length >= SOCIAL.mostFriends) {
      return 'Your friends list is full.';
    }
    s.friends[pid] = { name: nameOfPerson(otherActor), since: Date.now() };
    write(actorId, s);
    return '';
  }

  function dropFriend(actorId, pid) {
    var s = stateOf(actorId);
    if (!s.friends[pid]) { return false; }
    delete s.friends[pid];
    write(actorId, s);
    return true;
  }

  function isFriend(actorId, pid) {
    var s = read(actorId);
    return !!(s && s.friends[pid]);
  }

  // -------------------------------------------------------------- mutes --
  /*
    MUTE IS THE SERVER'S TO REMEMBER AND THE CLIENT'S TO DO.

    The gain node that would silence somebody is in thornswood-voice.js, in
    the overlay, one per peer, already built and already being written to five
    times a second by the distance mixing. So the server keeps the list, sends
    it to the owner with everything else, and the page multiplies by zero.

    It is NOT a server side mute: the server never sees audio, and a mute the
    server enforced would be a mute everybody got, which is a moderation tool
    and not what was asked for.
  */
  function toggleMute(actorId, pid, name) {
    var s = stateOf(actorId);
    var on = !s.muted[pid];
    if (on) { s.muted[pid] = name || true; } else { delete s.muted[pid]; }
    write(actorId, s);
    return on;
  }

  function toggleText(actorId, pid, name) {
    var s = stateOf(actorId);
    if (!s.textOff) { s.textOff = {}; }
    var on = !s.textOff[pid];
    if (on) { s.textOff[pid] = name || true; } else { delete s.textOff[pid]; }
    write(actorId, s);
    pushTextMutes();
    return on;
  }

  function toggleName(actorId, pid, name) {
    var s = stateOf(actorId);
    if (!s.namesOff) { s.namesOff = {}; }
    var on = !s.namesOff[pid];
    if (on) { s.namesOff[pid] = name || true; } else { delete s.namesOff[pid]; }
    write(actorId, s);
    return on;
  }

  function toggleNamesAll(actorId) {
    var s = stateOf(actorId);
    s.namesAll = !s.namesAll;
    write(actorId, s);
    return !!s.namesAll;
  }

  /*
    The name beside a switch, for somebody who may be no friend and may have
    logged off (#1628): the person in the world, then the friend list's, then
    the name the switch was turned on with. The world's first (#1695): the
    list keeps the name a friend had the day you became friends, and a friend
    whose character ended comes back as the same profile on a new one.
  */
  function knownName(s, pid) {
    var a = actorForProfile(pid);
    if (a) { return nameOfPerson(a); }
    var f = s.friends[pid];
    if (f && f.name) { return String(f.name); }
    var kept = [s.muted, s.textOff, s.namesOff];
    for (var i = 0; i < kept.length; i++) {
      if (kept[i] && typeof kept[i][pid] === 'string') { return kept[i][pid]; }
    }
    return '';
  }

  /*
    A friend on the list, or somebody standing here. Voice, text and a hidden
    name are kept on the character, so a friend who has logged off can still
    be named. The P panel sends a profile id: a friend, somebody near, or
    somebody on the Muted and hidden list, who may be neither (#1628).
  */
  function resolveKnown(actorId, who) {
    var s = stateOf(actorId);
    var want = String(who || '').trim();
    if (!want) { return { pid: 0, name: '', why: 'Who?' }; }
    var asNum = Number(want);
    if (String(asNum) === want && asNum > 0) {
      if (asNum === profileOf(actorId)) { return { pid: 0, name: '', why: 'That is you.' }; }
      return { pid: asNum, name: knownName(s, asNum) || 'somebody', why: '' };
    }
    var low = want.toLowerCase();
    var hits = [];
    for (var pid in s.friends) {
      if (!Object.prototype.hasOwnProperty.call(s.friends, pid)) { continue; }
      var row = s.friends[pid];
      var fn = String((row && row.name) || '');
      var folded = fn.toLowerCase();
      if (folded && (folded === low || folded.indexOf(low) === 0)) {
        hits.push({ pid: Number(pid), name: fn });
      }
    }
    if (hits.length === 1) { return { pid: hits[0].pid, name: hits[0].name, why: '' }; }
    if (hits.length > 1) { return { pid: 0, name: '', why: 'More than one friend by that name.' }; }
    var target = findPerson(want);
    if (!target.actorId) { return { pid: 0, name: '', why: target.why || 'Nobody here by that name.' }; }
    if (target.actorId === actorId) { return { pid: 0, name: '', why: 'That is you.' }; }
    return { pid: profileOf(target.actorId), name: nameOfPerson(target.actorId), why: '' };
  }

  /*
    A friend on your list, by the profile id the P panel's friend row sends
    (#1695), and whoever that profile is playing now. The list keys a friend
    by profile and keeps only the name they had the day you became friends,
    so a name sent from the row missed a friend on a new character, and could
    find somebody else who answers to it. A friend who is not in the world is
    said to be away, not looked for by name.
  */
  function friendNow(actorId, pid) {
    var s = stateOf(actorId);
    if (!s.friends[pid]) { return { actorId: 0, why: 'They are not on your friends list.' }; }
    var a = actorForProfile(pid);
    if (!a) { return { actorId: 0, why: (knownName(s, pid) || 'That friend') + ' is not in the world right now.' }; }
    return { actorId: a, why: '' };
  }

  var lastTextSig = '';
  function pushTextMutes() {
    var http;
    try { http = require('http'); } catch (e) { return; }
    var by = {};
    var all = online();
    for (var i = 0; i < all.length; i++) {
      var s = read(all[i]);
      if (!s || !s.textOff) { continue; }
      var list = [];
      for (var k in s.textOff) {
        if (!Object.prototype.hasOwnProperty.call(s.textOff, k)) { continue; }
        if (s.textOff[k]) { list.push(Number(k)); }
      }
      if (list.length) { by[profileOf(all[i])] = list; }
    }
    var sig = JSON.stringify(by);
    if (sig === lastTextSig) { return; }
    lastTextSig = sig;
    var body = JSON.stringify({ by: by });
    try {
      var req = http.request({
        host: '127.0.0.1', port: voicePort(), path: '/textmute', method: 'POST', timeout: 2000,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
      }, function (res) { try { res.resume(); } catch (e2) { } });
      req.on('error', function () { });
      req.on('timeout', function () { req.destroy(); });
      req.end(body);
    } catch (e3) { }
  }

  // ------------------------------------------------------------ parties --
  /*
    A PARTY IS A SESSION AND LIVES IN MEMORY. See the block comment.

    Held as one table of parties rather than a field on each character,
    because every question anybody asks of a party is about the whole of it:
    who is in it, is anybody near me, dissolve it. A field per member would be
    the same facts written five times and five chances to disagree.
  */
  var parties = {};      // partyId -> { leader, members: [pid], at }
  var inParty = {};      // pid -> partyId
  var nextParty = 1;

  function partyOf(pid) {
    var id = inParty[pid];
    if (!id) { return null; }
    var p = parties[id];
    if (!p) { delete inParty[pid]; return null; }
    return p;
  }

  function joinParty(leaderPid, pid) {
    var p = partyOf(leaderPid);
    if (!p) {
      var id = 'p' + (nextParty++);
      p = { leader: leaderPid, members: [leaderPid], at: Date.now() };
      parties[id] = p;
      inParty[leaderPid] = id;
    }
    if (p.members.length >= SOCIAL.mostParty) { return 'That party is full.'; }
    if (p.members.indexOf(pid) !== -1) { return 'They are already with you.'; }
    leaveParty(pid);
    p.members.push(pid);
    inParty[pid] = inParty[leaderPid];
    return '';
  }

  function leaveParty(pid) {
    var p = partyOf(pid);
    if (!p) { return false; }
    var id = inParty[pid];
    var at = p.members.indexOf(pid);
    if (at !== -1) { p.members.splice(at, 1); }
    delete inParty[pid];
    if (p.leader === pid) { p.leader = p.members[0] || 0; }
    // A party of one is not a party.
    if (p.members.length < 2) {
      for (var i = 0; i < p.members.length; i++) { delete inParty[p.members[i]]; }
      delete parties[id];
    }
    return true;
  }

  function partyMember(actorId, who) {
    var mine = profileOf(actorId);
    var p = partyOf(mine);
    if (!p) { return { pid: 0, why: 'You are not in a party.' }; }
    var want = String(who || '').trim();
    if (!want) { return { pid: 0, why: 'Who?' }; }
    var asNum = Number(want);
    if (String(asNum) === want) {
      if (p.members.indexOf(asNum) === -1) { return { pid: 0, why: 'They are not in your party.' }; }
      return { pid: asNum, why: '' };
    }
    var low = want.toLowerCase();
    var hits = [];
    for (var i = 0; i < p.members.length; i++) {
      var them = actorForProfile(p.members[i]);
      var nm = them ? nameOfPerson(them).toLowerCase() : '';
      if (nm && (nm === low || nm.indexOf(low) === 0)) { hits.push(p.members[i]); }
    }
    if (hits.length === 1) { return { pid: hits[0], why: '' }; }
    if (hits.length > 1) { return { pid: 0, why: 'More than one person in the party by that name.' }; }
    return { pid: 0, why: 'They are not in your party.' };
  }

  function pushMembers(pids) {
    for (var i = 0; i < pids.length; i++) {
      var actor = actorForProfile(pids[i]);
      if (actor) { push(actor); }
    }
  }

  function kickParty(leaderPid, whoPid) {
    var p = partyOf(leaderPid);
    if (!p) { return 'You are not in a party.'; }
    if (p.leader !== leaderPid) { return 'Only the leader can do that.'; }
    if (whoPid === leaderPid) { return 'Leave, or disband, rather than kicking yourself.'; }
    if (p.members.indexOf(whoPid) === -1) { return 'They are not in your party.'; }
    var left = p.members.slice();
    leaveParty(whoPid);
    pushMembers(left);
    return '';
  }

  function leadParty(leaderPid, whoPid) {
    var p = partyOf(leaderPid);
    if (!p) { return 'You are not in a party.'; }
    if (p.leader !== leaderPid) { return 'Only the leader can do that.'; }
    if (p.members.indexOf(whoPid) === -1) { return 'They are not in your party.'; }
    if (p.leader === whoPid) { return 'They already lead this party.'; }
    p.leader = whoPid;
    pushMembers(p.members.slice());
    return '';
  }

  function disbandParty(leaderPid) {
    var p = partyOf(leaderPid);
    if (!p) { return 'You are not in a party.'; }
    if (p.leader !== leaderPid) { return 'Only the leader can do that.'; }
    var id = inParty[leaderPid];
    var left = p.members.slice();
    for (var i = 0; i < left.length; i++) { delete inParty[left[i]]; }
    delete parties[id];
    pushMembers(left);
    return '';
  }

  /*
    Is anybody from your party standing with you.

    This is what the experience bonus is paid on, rather than on being in a
    party at all: a bonus for being listed together is a checkbox everybody
    ticks once, and a bonus for BEING together is a reason to travel together,
    which is the thing Blade and Patrick were both after.
  */
  function partyNear(actorId) {
    var pid = profileOf(actorId);
    var p = partyOf(pid);
    if (!p || p.members.length < 2) { return 0; }
    var cell = '';
    try { cell = String(mp.get(actorId, 'worldOrCellDesc') || ''); } catch (e) { return 0; }
    if (!cell) { return 0; }
    var n = 0;
    for (var i = 0; i < p.members.length; i++) {
      if (p.members[i] === pid) { continue; }
      var them = actorForProfile(p.members[i]);
      if (!them) { continue; }
      try {
        if (String(mp.get(them, 'worldOrCellDesc') || '') === cell) { n++; }
      } catch (e) { }
    }
    return n;
  }

  /** The multiplier work credit is paid at, for somebody with their party. */
  function workBonus(actorId) {
    return partyNear(actorId) > 0 ? (1 + SOCIAL.partyBonus) : 1;
  }

  // ----------------------------------------------------------- journals --
  /*
    Patrick: "J for Journal... multiple journals, pages inside them, and
    sharing either a whole journal or a single page with a friend."

    Stored on the character, because a journal that did not survive a restart
    would be worse than no journal at all. Sharing is by profile id and is
    one directional: sharing a page with somebody puts it in their list of
    things shared with them, and it stays yours.
  */
  function newJournal(actorId, title) {
    var s = stateOf(actorId);
    if (s.journals.length >= SOCIAL.mostJournals) {
      return { why: 'You are carrying as many journals as you can.', full: true };
    }
    // Every /journal new that reaches this is a request of its own (#2135).
    // The panel sends one per press and holds further presses until the
    // journal shows (thornswood-journal.js, #2037), the chat sends a line
    // once, and a command offered again under its id runs once (commandsRun).
    // tests/test-2135-journal-press.js counts it. So there is no time window
    // here: the 2 s one #2037 added guessed at a repeat nothing makes.
    var j = {
      id: 'j' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36),
      title: String(title || 'Journal').slice(0, 60),
      pages: [], shared: {}, at: Date.now()
    };
    s.journals.push(j);
    write(actorId, s);
    return { journal: j, why: '' };
  }

  function findJournal(s, id) {
    for (var i = 0; i < s.journals.length; i++) {
      if (s.journals[i].id === id) { return s.journals[i]; }
    }
    return null;
  }

  function writePage(actorId, journalId, pageId, title, text) {
    var s = stateOf(actorId);
    var j = findJournal(s, journalId);
    if (!j) { return 'No such journal.'; }
    /*
      TOO LONG IS REFUSED, NOT CUT (#2563). A cut page was saved short and the
      writer was never told. The panel holds the text box to pageChars and the
      chat socket carries a page this long whole, so a longer one only comes
      from a hand typed line, and it is told how long it is.
    */
    var body = String(text || '');
    if (body.length > SOCIAL.pageChars) {
      return 'That page is too long: ' + body.length + ' characters, and a page holds ' +
             SOCIAL.pageChars + '. Nothing was saved.';
    }
    var page = null;
    for (var i = 0; i < j.pages.length; i++) {
      if (j.pages[i].id === pageId) { page = j.pages[i]; break; }
    }
    if (!page) {
      if (j.pages.length >= SOCIAL.mostPages) { return 'That journal is full.'; }
      page = { id: 'p' + Date.now().toString(36) + j.pages.length, shared: {} };
      j.pages.push(page);
    }
    page.title = String(title || 'Page').slice(0, 60);
    page.text = body;
    page.at = Date.now();
    write(actorId, s);
    return '';
  }

  function dropJournal(actorId, journalId) {
    var s = stateOf(actorId);
    for (var i = 0; i < s.journals.length; i++) {
      if (s.journals[i].id === journalId) {
        s.journals.splice(i, 1);
        write(actorId, s);
        return true;
      }
    }
    return false;
  }

  /*
    Who a share is for. A friend on the list, by the profile id the panel
    sends or by the name stored with them, whether or not they are online.
    Sharing used to ask who is standing here, so a friend who had logged off
    could not be given a page at all.
  */
  function resolveShare(actorId, who) {
    var s = stateOf(actorId);
    var want = String(who || '').trim();
    if (!want) { return { pid: 0, why: 'Share with which friend?' }; }
    var asNum = Number(want);
    if (String(asNum) === want && s.friends[asNum]) { return { pid: asNum, why: '' }; }
    var low = want.toLowerCase();
    var hits = [];
    for (var pid in s.friends) {
      if (!Object.prototype.hasOwnProperty.call(s.friends, pid)) { continue; }
      var row = s.friends[pid];
      var nm = String((row && row.name) || '').toLowerCase();
      if (nm && nm === low) { hits.push(Number(pid)); }
    }
    if (hits.length === 1) { return { pid: hits[0], why: '' }; }
    if (hits.length > 1) { return { pid: 0, why: 'More than one friend by that name.' }; }
    var target = findPerson(want);
    if (!target.actorId) { return { pid: 0, why: 'Nobody on your friends list by that name.' }; }
    return { pid: profileOf(target.actorId), why: '' };
  }

  function share(actorId, journalId, pageId, pid) {
    var s = stateOf(actorId);
    var j = findJournal(s, journalId);
    if (!j) { return 'No such journal.'; }
    if (!s.friends[pid]) { return 'You can only share with a friend.'; }
    if (!pageId) {
      j.shared[pid] = true;
    } else {
      var found = null;
      for (var i = 0; i < j.pages.length; i++) {
        if (j.pages[i].id === pageId) { found = j.pages[i]; break; }
      }
      if (!found) { return 'No such page.'; }
      if (!found.shared) { found.shared = {}; }
      found.shared[pid] = true;
    }
    write(actorId, s);
    return '';
  }

  /*
    What other people have shared with you, gathered when the panel is drawn.

    Held nowhere: it is read off the people who shared it, every time, so
    unsharing works by deleting one flag rather than by chasing copies. It only
    finds people who are ONLINE, which is a real limit and is written down
    rather than papered over: a page a friend shared last week is theirs to
    show you again when they are here.
  */
  function sharedWithMe(actorId) {
    var mine = profileOf(actorId);
    var out = [];
    var all = online();
    for (var i = 0; i < all.length; i++) {
      if (all[i] === actorId) { continue; }
      var theirs = read(all[i]);
      if (!theirs) { continue; }
      var who = nameOfPerson(all[i]);
      for (var j = 0; j < theirs.journals.length; j++) {
        var book = theirs.journals[j];
        var pages = [];
        var whole = !!(book.shared && book.shared[mine]);
        for (var p = 0; p < book.pages.length; p++) {
          var page = book.pages[p];
          if (whole || (page.shared && page.shared[mine])) {
            pages.push({ id: page.id, title: page.title, text: page.text, at: page.at });
          }
        }
        if (pages.length) {
          out.push({ from: who, title: book.title, whole: whole, pages: pages });
        }
      }
    }
    return out;
  }

  // -------------------------------------------------------- the panel view --

  function view(actorId) {
    var s = stateOf(actorId);
    var mine = profileOf(actorId);
    var p = partyOf(mine);
    var here = {};
    var all = online();
    for (var i = 0; i < all.length; i++) { here[profileOf(all[i])] = nameOfPerson(all[i]); }

    var friends = [];
    for (var pid in s.friends) {
      if (!Object.prototype.hasOwnProperty.call(s.friends, pid)) { continue; }
      var n = Number(pid);
      friends.push({
        p: n,
        // The name they are online under, then the one kept (#1695).
        name: here[n] || (s.friends[pid] && s.friends[pid].name) || 'somebody',
        on: !!here[n],
        muted: !!s.muted[pid],
        textOff: !!(s.textOff && s.textOff[n]),
        nameOff: !!(s.namesAll || (s.namesOff && s.namesOff[n])),
        party: !!(p && p.members.indexOf(n) !== -1)
      });
    }
    friends.sort(function (a, b) {
      if (a.on !== b.on) { return a.on ? -1 : 1; }
      return a.name < b.name ? -1 : 1;
    });

    var party = [];
    if (p) {
      for (var k = 0; k < p.members.length; k++) {
        var mp2 = p.members[k];
        party.push({
          p: mp2, name: here[mp2] || 'somebody',
          leader: mp2 === p.leader, on: !!here[mp2], me: mp2 === mine
        });
      }
    }

    /*
      WHO IS NEAR YOU, for the P panel's Near you list (#1628): the list the
      look prompt reads, thornswoodNear, so the panel and the prompt agree on
      who is close enough. The switches are read off the character rather
      than the list, so a press shows on the push that follows it.
    */
    var near = [];
    var nearNow = null;
    // Who is driving a trade cart, for Raid cart beside them (#3158).
    var cartsNear = g.__thornswoodTradeCarts;
    try { nearNow = mp.get(actorId, NEAR_PROPERTY); } catch (e) { nearNow = null; }
    var nearW = (nearNow && nearNow.w) || {};
    for (var hex in nearW) {
      if (!Object.prototype.hasOwnProperty.call(nearW, hex)) { continue; }
      var nr = nearW[hex] || {};
      var np = Number(nr.p) || 0;
      if (!np) { continue; }
      near.push({
        id: hex, p: np, name: String(nr.n || 'somebody'),
        friend: !!s.friends[np],
        party: !!(p && p.members.indexOf(np) !== -1),
        muted: !!s.muted[np],
        textOff: !!(s.textOff && s.textOff[np]),
        nameOff: !!(s.namesOff && s.namesOff[np]),
        cart: (function () {
          try { return !!(cartsNear && cartsNear.driving && cartsNear.driving(parseInt(hex, 16))); } catch (eCart) { return false; }
        })()
      });
    }
    near.sort(function (a, b) { return a.name < b.name ? -1 : 1; });

    /*
      EVERYBODY YOU SWITCHED OFF, friend or not, here or not (#1628), so the
      P panel can switch each one back on. A friend is on both lists. Each
      switch is the one for that person alone, not Hide every name.
    */
    var hidden = [];
    var seenOff = {};
    var offLists = [s.muted || {}, s.textOff || {}, s.namesOff || {}];
    for (var li = 0; li < offLists.length; li++) {
      for (var ok in offLists[li]) {
        if (!Object.prototype.hasOwnProperty.call(offLists[li], ok)) { continue; }
        if (!offLists[li][ok] || seenOff[ok]) { continue; }
        seenOff[ok] = true;
        var op = Number(ok);
        hidden.push({
          p: op, name: knownName(s, op) || 'somebody', on: !!here[op],
          muted: !!s.muted[op],
          textOff: !!(s.textOff && s.textOff[op]),
          nameOff: !!(s.namesOff && s.namesOff[op])
        });
      }
    }
    hidden.sort(function (a, b) {
      if (a.on !== b.on) { return a.on ? -1 : 1; }
      return a.name < b.name ? -1 : 1;
    });

    var offerNow = standingOffer(mine);
    return {
      me: mine,
      friends: friends,
      party: party,
      near: near,
      hidden: hidden,
      together: partyNear(actorId),
      bonus: Math.round(SOCIAL.partyBonus * 100),
      namesAll: !!s.namesAll,
      offer: offerNow ? { kind: offerNow.kind, from: offerNow.from, name: offerNow.fromName,
                          about: offerNow.about || '' } : null,
      // The hair dyes carried, for Dye hair under Near you (#2675).
      dyes: (function () {
        try {
          var HDv = g.__thornswoodHairDye;
          return (HDv && HDv.carried) ? HDv.carried(actorId) : [];
        } catch (eDyes) { return []; }
      })(),
      journals: s.journals,
      shared: sharedWithMe(actorId),
      muted: s.muted,
      group: (function () {
        try {
          var booksView = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodBooks;
          if (!booksView || !booksView.view) { return { show: false }; }
          return booksView.view(mine, (s && s.textOff) || {});
        } catch (e) { return { show: false }; }
      })(),
      board: (function () {
        try {
          var prop = g.__thornswoodProperty;
          if (!prop || !prop.boardPanel) { return null; }
          return prop.boardPanel(actorId, mine);
        } catch (eBoard) { return null; }
      })(),
      // J's Boards tab: the ten towns, the board picked there, read only,
      // and your jobs under it (#1627).
      boards: (function () {
        try {
          var prop = g.__thornswoodProperty;
          if (!prop || !prop.boardsView) { return null; }
          return prop.boardsView(mine);
        } catch (eBoards) { return null; }
      })()
    };
  }

  /*
    The panel script. One property, two panels and the voice mute, because
    they are all the same facts and three properties would be three updates
    every time one friend logged in.
  */
  function panelScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || typeof v !== "object") { return; }',
      '    var st = ctx.state;',
      '    if (!st) { return; }',
      '    if (st.thornswoodSocialAt === v.at) { return; }',
      '    st.thornswoodSocialAt = v.at;',
      '    var body = JSON.stringify(v);',
      '    var src = "(function(){try{" +',
      '      "var d=" + body + ";window.thornswoodSocialView=d;" +',
      '      "if(window.thornswoodParty&&window.thornswoodParty.setData){window.thornswoodParty.setData(d);}" +',
      '      "if(window.thornswoodJournal&&window.thornswoodJournal.setData){window.thornswoodJournal.setData(d);}" +',
      '      "if(window.thornswoodBoard&&window.thornswoodBoard.setData){window.thornswoodBoard.setData(d);}" +',
      // The voice page holds the gain nodes. Handing it the mute list is the
      // whole of muting; see toggleMute.
      '      "if(window.thornswoodVoice&&window.thornswoodVoice.setMuted){window.thornswoodVoice.setMuted(d.muted||{});}" +',
      '      "}catch(e){}})();";',
      '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  var panelWas = {};
  var panelAt = {};

  /** Push changes, or resend after a panel opens or mounts (#1275). */
  function push(actorId, force) {
    var v;
    try { v = view(actorId); } catch (e) { return; }
    var sig = JSON.stringify(v);
    if (!force && panelWas[actorId] === sig) { return; }
    v.at = Math.max(Date.now(), (panelAt[actorId] || 0) + 1);
    try {
      mp.set(actorId, SOCIAL_PROPERTY + 'View', v);
      panelWas[actorId] = sig;
      panelAt[actorId] = v.at;
    } catch (e) { }
  }

  // ------------------------------------------------------------ the tick --

  function tick() {
    tickMemo = {};
    try { tickBody(); } finally { tickMemo = null; }
  }

  function tickBody() {
    try { nearTick(); } catch (e) { slog('near tick:', e); }
    try { partyTick(); } catch (e) { slog('party tick:', e); }
    try { pushTextMutes(); } catch (e) { slog('text mute:', e); }
    var all = online();
    for (var i = 0; i < all.length; i++) {
      try { push(all[i]); } catch (e) { }
    }
    // Offers that nobody answered.
    var now = Date.now();
    for (var pid in offers) {
      if (!Object.prototype.hasOwnProperty.call(offers, pid)) { continue; }
      if (now - offers[pid].at > SOCIAL.offerFor) { delete offers[pid]; }
    }
    // Anybody who logged out leaves their party.
    var herePids = {};
    for (var k = 0; k < all.length; k++) { herePids[profileOf(all[k])] = true; }
    for (var member in inParty) {
      if (!Object.prototype.hasOwnProperty.call(inParty, member)) { continue; }
      if (!herePids[member]) { leaveParty(Number(member)); }
    }
  }

  // ----------------------------------------------------------- properties --

  try {
    mp.makeProperty(NEAR_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: nearScript(), updateNeighbor: ''
    });
  } catch (e) { /* already made by a previous load */ }

  try {
    mp.makeProperty(SOCIAL_PROPERTY, {
      isVisibleByOwner: false, isVisibleByNeighbors: false,
      updateOwner: '', updateNeighbor: ''
    });
  } catch (e) { }

  try {
    mp.makeProperty(PARTY_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: partyScript(), updateNeighbor: ''
    });
  } catch (e) { /* already made by a previous load */ }

  try {
    mp.makeProperty(SOCIAL_PROPERTY + 'View', {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: panelScript(), updateNeighbor: ''
    });
  } catch (e) { }

  if (g.__thornswoodSocialTimer) { try { clearInterval(g.__thornswoodSocialTimer); } catch (e) { } }
  g.__thornswoodSocialTimer = setInterval(guard('socialTick', tick), SOCIAL.nearEvery);

  g.__thornswoodSocial = {
    SOCIAL: SOCIAL,
    stateOf: stateOf, read: read, write: write, fresh: fresh,
    findPerson: findPerson, nameOfPerson: nameOfPerson, profileOf: profileOf,
    actorForProfile: actorForProfile,
    offer: offer, standingOffer: standingOffer, offers: offers,
    addFriend: addFriend, dropFriend: dropFriend, isFriend: isFriend,
    toggleMute: toggleMute, toggleText: toggleText, toggleName: toggleName,
    toggleNamesAll: toggleNamesAll, resolveKnown: resolveKnown, friendNow: friendNow,
    partyOf: partyOf, joinParty: joinParty, leaveParty: leaveParty,
    partyMember: partyMember, kickParty: kickParty, leadParty: leadParty,
    disbandParty: disbandParty,
    partyNear: partyNear, workBonus: workBonus, parties: parties, inParty: inParty,
    newJournal: newJournal, writePage: writePage, dropJournal: dropJournal,
    share: share, resolveShare: resolveShare, sharedWithMe: sharedWithMe, findJournal: findJournal,
    view: view, push: push, tick: tick, nearTick: nearTick,
    partyTick: partyTick, PARTY_PROPERTY: PARTY_PROPERTY
  };

  slog('ready: friends and journals are kept, a party is a session,',
       'nearby list every', SOCIAL.nearEvery + 'ms within', SOCIAL.nearReach + ' units');
})();
// ==== end thornswood social ====

