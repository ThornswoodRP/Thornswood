// ==== thornswood character ====
/*
  What a character IS, held in one place and pushed to the one screen that
  shows it.

  The rules above decide every yes and no. This block decides nothing; it
  stores the answer on the actor as 'thornswoodCharacter', turns a /pick or a
  /spend into a call on the rules, and tells the person why when the answer
  is no. It is the only writer of that property.

  IT IS ALSO THE ONE DOOR THE WORLD KNOCKS ON. A salt seam and a nirnroot ask
  gate() whether this person's class owns that verb, a kiln asks gateHalf()
  about the charburner half, and each of them calls credit() once the yield is
  in somebody's hands, which is what counts the work and raises the rank. The
  stations hold no rules of their own: they know what was pressed and nothing
  about who is allowed to press it.

  A SPELL IS THE ONE PICK THAT LEAVES THE PROPERTY. The rules record it, and
  then it has to be put on the character in the game, which is Actor.AddSpell
  the same way a shrine blessing is. SPELL_IDS above is empty until another
  step generates it, so today a spell is learned, kept and not yet cast, and
  the log says so once per spell rather than throwing.

  THE CHANNEL TO THE PANEL is the property's updateOwner script, and it is the
  only one there is. A visible custom property reaches the client solely
  through that script, run inside skymp5-client with ctx.sp, ctx.value and
  ctx.state; there is no other reader. Until 20 September no property here
  had one, which is why the K panel could draw the rulebook and never learn a
  thing about the person in front of it. The script here hands ctx.value to
  window.thornswoodSkills.setData through executeJavaScript, and a panel that
  mounts after the first write asks for it again with /pick refresh.

  THE OLD KEYS. Characters made through the launcher carry state.class (the
  trade), state.half and state.gathering on thornswoodChargen, in the
  launcher's own names: tank, brawler, harm, mend, dinner, dessert, armour,
  weapons, weapon, apparel, robes, common. The rulebook's names are the ones
  on the public page and the ones the rules use, so the launcher's are mapped
  on first sight and never written back. Five old trades are RP-only (see
  RP_ONLY in the progression block): bard, merchant, priest, scholar, thief.
  A character carrying one does not keep Class or Profession privileges;
  migrate clears the old class key and starts them with nothing chosen, so
  they pick again from the real tables. Gatherer and Tailor stay.
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var P = g.__thornswoodProgression;
  if (!P) { console.log('[thornswood character] the rules block is missing, nothing registered'); return; }

  var CHAR_PROPERTY = 'thornswoodCharacter';

  function clog() {
    var a = Array.prototype.slice.call(arguments);
    console.log('[thornswood character] ' + a.join(' '));
  }

  // The launcher's half names, and the trades that map straight across.
  var HALF_MAP = {
    tank: 'bulwark', brawler: 'berserker',
    harm: 'blightbrewer', mend: 'physicker',
    dinner: 'hearthcook', dessert: 'confectioner',
    armour: 'platewright', weapons: 'edgewright',
    weapon: 'bladebinder', apparel: 'wardweaver',
    robes: 'liverywright', common: 'haberdasher'
  };

  function mapHalf(h) {
    h = String(h || '').toLowerCase();
    if (!h) { return ''; }
    // hasOwnProperty, not a bare lookup: '/pick profession smith constructor'
    // would otherwise map to a function off Object.prototype.
    if (P.has(HALF_MAP, h)) { return HALF_MAP[h]; }
    return h;   // already a rulebook name, or unknown and refused below
  }

  /** The spells in somebody's book, as the panel reads them: name -> true. */
  function spellMap(s) {
    var out = {};
    var known = (s && s.spells && s.spells.known) || [];
    for (var i = 0; i < known.length; i++) { out[known[i]] = true; }
    return out;
  }

  /*
    Where every rank stands and how far the work has got towards the next
    one, under the same keys as ranks: the class, the half, the sister half,
    each school. Both numbers, so the page can draw progress instead of
    guessing at it, and need 0 means there is nothing left to climb.
  */
  function workView(s) {
    var out = {};
    var ranks = (s && s.ranks) || {};
    for (var key in ranks) {
      if (!P.has(ranks, key)) { continue; }
      out[key] = { rank: ranks[key], done: P.workDone(s, key), need: P.workNeeded(s, key) };
    }
    return out;
  }

  /*
    THE PROGRESS THE PANEL DRAWS, and the half of the contract the server
    owes the client.

      progress: { '<key>': { next: '<rank being climbed to>', done: n, need: n } }

    One entry per half, school or class verb that can still climb. A key at
    Master, or one that cannot climb at all, is left out entirely rather than
    sent with a null, and the whole field is left out when there is nothing
    to say. The two halves were written at the same time last round and did
    not match: this sent work with a rank in it, the panel read progress with
    a next in it, and so nothing drew at all. work is still sent beside it
    because the harness pins it; progress is the one the panel reads.
  */
  function progressView(s) {
    var out = {};
    var ranks = (s && s.ranks) || {};
    var any = false;
    for (var key in ranks) {
      if (!P.has(ranks, key)) { continue; }
      var next = P.nextRank(s, key);
      if (!next) { continue; }
      var need = P.workNeeded(s, key);
      if (!need) { continue; }
      out[key] = { next: next, done: P.workDone(s, key), need: need };
      any = true;
    }
    return any ? out : null;
  }

  /*
    THE RECIPE BOOK, AND WHY IT IS COUNTS AND NOT A LIST.

    Patrick, 21 September: 'for non mages add a button in the K menu for the
    recipe book that tells them what all they can do/make at their current
    level', 'and with their current Class/Profession/Sub, as someone could be
    a novice hunter, Master smith and a novice tailor from being taught
    tailoring from a master tailor', and 'don't be very specific because for
    like tailor there are hundreds of clothing items'.

    WHAT IS NOT SENT, AND THE MEASUREMENT THAT SETTLED IT. RECIPES_BY_ID
    carries 1728 rows. The panel is a browser inside the game, drawn over a
    running Skyrim, and the whole of the rest of the view is a few hundred
    bytes. Sending 1728 names through the property and the updateOwner script
    on every write would be the panel's own redraw problem back again, one
    order of magnitude worse, so nothing here sends a row. What goes is what
    Patrick asked for: the families, and how many of each are open.

    A FAMILY IS READ OFF THE RECORD AND NOT DECIDED HERE. Every row in the
    block carries family, written by tools\Build-RecipeTable.ps1 out of the
    output record's own kind keyword: a weapon type, an armour slot, a
    clothing slot or a Gourmet food type. 34 families across the table and
    between 1 and 11 in any one half, which is what 'not very specific'
    means for a Haberdasher with 170 garments.

    THREE THINGS A CHARACTER HOLDS, AND ALL THREE ARE ALREADY THE RULES'.
    Their own half up to their own rank; their sister half at novice, because
    classes.md gives the novice work of the other half away; and every half a
    Master of another profession taught them, also at novice and never more.
    Those are the same three cases canWork answers for the craft gate, so the
    book and the gate cannot disagree: a family counted open here is one
    craftAnswer lets through.
  */
  var BOOK_RANKS = ['novice', 'advanced', 'expert', 'master'];

  /*
    THE FIVE HALVES THAT OWN NO RECIPE AT ALL, in the words a person reads.

    Measured rather than decided. tools\recipes.json carries the same reason
    on each of these five under "why", counted over every COBJ record in the
    load order: not one names them. classes.md names all fourteen halves and
    says nothing about any of them being empty, so the sentences are this
    file's words for what the records say. They live here rather than in the
    panel because the panel is a page and a page can be edited; what a half
    owns is a fact about the build and the server is the side that holds it.
  */
  var HALF_MAKES_NOTHING = {
    bulwark: 'Warriors do not craft. Bulwark is a half of how you fight, and classes.md gives it manoeuvres rather than recipes. There is nothing in the game records for it to make.',
    berserker: 'Warriors do not craft. Berserker is a half of how you fight, and classes.md gives it manoeuvres rather than recipes. There is nothing in the game records for it to make.',
    blightbrewer: 'Skyrim has no alchemy recipes. A potion is worked out from the effects its ingredients share, in the alchemy menu, with no recipe involved at all, so your poisons are mixed there and not from a book.',
    physicker: 'Skyrim has no alchemy recipes. A potion is worked out from the effects its ingredients share, in the alchemy menu, with no recipe involved at all, so your medicines are mixed there and not from a book.',
    wardweaver: 'Enchanting a cuirass or a robe is the enchanting table and not a recipe. The only enchanting recipes in this build are staves, and a staff is a weapon, so they belong to the Bladebinder.'
  };
  var HALF_MAKES_NOTHING_UNKNOWN = 'Nothing in this build carries a recipe for this half.';
  var BOOK_NO_PROFESSION = 'You have no profession yet, so there is nothing here to make. Pick one and its half on the Profession card and this fills with that half\'s work.';
  var BOOK_NO_HALF = 'You have a profession but no half of it yet. Pick the half you will make your own and this fills with its work.';

  /*
    Every half in the block, with its families and how its rows fall across
    the four ranks. Counted once, on the first call, and never again: the
    block is 1728 rows and the panel is written on every property change.

    Built lazily rather than at load, because RECIPES_BY_ID is assigned in
    another part of the file and a harness that runs these blocks in a
    different order would otherwise count an empty table once and cache it.
  */
  var bookIndexes = {};

  /* A race-locked output is not somebody's recipe. Keep the book on the
     same gate as onCraft: level, half and race all have to agree before a
     row contributes to the page. Unknown race data is left open so a
     load-order read failure never hides ordinary work. */
  function recipeRaceMatches(actorId, row) {
    if (!row || !row.race) { return true; }
    var mine = raceOf(actorId);
    if (!mine) { return true; }
    return mine.indexOf(String(row.race).toLowerCase()) !== -1;
  }

  function recipeIndex(actorId) {
    var race = '';
    try { race = raceOf(actorId); } catch (e) { race = ''; }
    var cacheKey = race || '*';
    if (bookIndexes[cacheKey]) { return bookIndexes[cacheKey]; }
    /*
      NO TABLE IS NO BOOK, and it is not an exception either. The recipe block
      is written into this file by tools\Build-RecipeTable.ps1 and lives
      several thousand lines above this one, so this block names something
      another block owns. Reading it through a try is the difference between
      a missing table drawing no recipe book and a missing table throwing
      inside writeState, which is every property write for every person.
      Measured on 21 September: a harness that ran the character block on its
      own, with no recipe block beside it, died with ReferenceError at the
      first stateOf. The answer is not cached, so a table that arrives later
      is still counted.
    */
    var table = null;
    try { table = RECIPES_BY_ID; } catch (e) { table = null; }
    if (!table || typeof table !== 'object') { return null; }
    var out = {};
    for (var desc in table) {
      if (!P.has(table, desc)) { continue; }
      var row = table[desc];
      if (!row || typeof row !== 'object') { continue; }
      if (!recipeRaceMatches(actorId, row)) { continue; }
      if (row.roll) { continue; }
      var half = String(row.half || '').toLowerCase();
      if (!half) { continue; }
      if (!P.has(out, half)) { out[half] = { total: 0, byRank: {}, openByRank: {}, families: [], famAt: {} }; }
      var h = out[half];
      var fam = String(row.family || '') || HALF_MAKES_NOTHING_UNKNOWN;
      if (!P.has(h.famAt, fam)) {
        h.famAt[fam] = { name: fam, total: 0, byRank: {}, openByRank: {} };
        h.families.push(h.famAt[fam]);
      }
      var f = h.famAt[fam];
      var rk = String(row.rank || 'novice').toLowerCase();
      if (BOOK_RANKS.indexOf(rk) < 0) { rk = 'novice'; }
      h.total++;
      f.total++;
      h.byRank[rk] = (P.has(h.byRank, rk) ? h.byRank[rk] : 0) + 1;
      f.byRank[rk] = (P.has(f.byRank, rk) ? f.byRank[rk] : 0) + 1;
      /*
        AND THE SAME COUNT AGAIN OVER THE ROWS SKYRIM WILL ACTUALLY LIST. Added
        21 September. Every row above carries open, written by
        tools\Build-RecipeTable.ps1 and documented in the block header: open is
        true when the recipe carries no condition of its own, and a row with
        open false needs an item, a spell or a vanilla perk first, which
        Skyrim's own crafting menu decides on the machine in front of the
        person before the server is ever asked. This loop ignored it, and the
        panel's "open to you right now" was counting rows nobody will ever be
        offered.

        Measured against the shipped table on 21 September, joined to the needs
        lists in tools\recipes.json:
          a fresh Hearthcook at novice: 49 rows at or under the rank, 48 of
            them behind a HasPerk condition for a perk nobody here can hold,
            so 1 is real and the bar read 49
          a Cook/Confectioner at novice: 7 rows, all 7 behind two vanilla
            perks, so 0 are real and the column read 7 of 28
          an Enchanter/Bladebinder at master: 161 rows, 160 behind a HasSpell
            the server itself evaluates and 1 behind the Aetherium Crest, so 0
            are real and the column read 161 of 161
        tools\recipes.json already said all three in as many words under
        behindAVanillaPerk and nothingToMakeOnDayOne. The panel was the only
        thing disagreeing with it.

        byRank is kept beside it rather than replaced, because the difference
        between the two is what is waiting on a condition, and that number is
        worth a sentence on the page instead of a silence.
      */
      if (row.open === true) {
        h.openByRank[rk] = (P.has(h.openByRank, rk) ? h.openByRank[rk] : 0) + 1;
        f.openByRank[rk] = (P.has(f.openByRank, rk) ? f.openByRank[rk] : 0) + 1;
      }
    }
    bookIndexes[cacheKey] = out;
    return out;
  }

  /** Rows at this rank and every rank under it, which is what a rank opens. */
  function openUpTo(byRank, rank) {
    var top = BOOK_RANKS.indexOf(String(rank || 'novice'));
    if (top < 0) { top = 0; }
    var n = 0;
    for (var i = 0; i <= top; i++) {
      if (P.has(byRank, BOOK_RANKS[i])) { n += byRank[BOOK_RANKS[i]]; }
    }
    return n;
  }

  /** The lowest rank that holds any row at all, or null for a half with none. */
  function lowestRungWithWork(byRank) {
    for (var i = 0; i < BOOK_RANKS.length; i++) {
      if (P.has(byRank, BOOK_RANKS[i]) && byRank[BOOK_RANKS[i]] > 0) { return BOOK_RANKS[i]; }
    }
    return null;
  }

  /** True when the key is a half of a profession, rather than a mage's school. */
  function isCraftHalf(key) {
    var profs = P.TABLE.professions;
    for (var prof in profs) {
      if (!P.has(profs, prof)) { continue; }
      if (P.has(profs[prof].halves, key)) { return true; }
    }
    return false;
  }

  /*
    One half's page of the book: what is open to this person in it, out of
    what the half holds, family by family.

    Only the families with something open are listed. Patrick asked what
    somebody can make at their current level, and a family with nothing open
    is not an answer to that; the half's own open and total say how much of
    it is still ahead. A half with nothing open at all carries why instead,
    so the page is a sentence rather than an empty box.
  */
  function bookHalf(key, how, rank, actorId) {
    var idx = recipeIndex(actorId) || {};
    var got = P.has(idx, key) ? idx[key] : null;
    var out = { key: key, name: nameOf(key), how: how, rank: rank,
                open: 0, locked: 0, total: got ? got.total : 0, families: [] };
    if (!got || !got.total) {
      out.why = P.has(HALF_MAKES_NOTHING, key) ? HALF_MAKES_NOTHING[key] : HALF_MAKES_NOTHING_UNKNOWN;
      return out;
    }
    /*
      TWO NUMBERS AND NOT ONE. open is what the crafting menu will list for
      somebody standing at this rank: rows at or under the rank that carry no
      condition. locked is the rest of what the rank reaches, every one of them
      waiting on an item, a spell or a vanilla perk that Skyrim checks before
      the server is asked. Counting the two together as open is what made the
      panel promise a new Hearthcook 49 recipes when 1 of them could be made.
    */
    out.open = openUpTo(got.openByRank, rank);
    out.locked = openUpTo(got.byRank, rank) - out.open;
    for (var i = 0; i < got.families.length; i++) {
      var f = got.families[i];
      var open = openUpTo(f.openByRank, rank);
      if (!open) { continue; }
      out.families.push({ name: f.name, open: open, total: f.total,
                          locked: openUpTo(f.byRank, rank) - open });
    }
    out.families.sort(function (a, b) { return b.open - a.open; });
    if (!out.open) {
      /*
        WHICH OF THE TWO WALLS IT IS, because they are not the same answer and
        the old sentence gave the rank one to both. A Confectioner at novice has
        7 rows on their own rung and cannot make one of them: telling that
        person the cheapest thing their half makes is novice work, and that rank
        comes from doing the work, is telling them to climb a ladder that is not
        in their way.
      */
      if (out.locked > 0) {
        out.why = 'Your rank reaches ' + out.locked + ' of these and Skyrim will not list one of them. ' +
                  'Each carries a condition of its own, a perk or a spell or something you have to be ' +
                  'holding, and the crafting menu decides that before the server is asked.';
      } else {
        var rung = lowestRungWithWork(got.byRank);
        out.why = 'Nothing in this half is open to you yet. The cheapest thing it makes is ' +
                  rankName(rung) + ' work, and rank comes from doing the work.';
      }
    }
    return out;
  }

  /*
    The whole book, or null when there is no book to draw.

    null is a mage with no craft half taught to them: they have the spell
    book and the recipe book is not theirs. Everybody else gets an object,
    even with nothing in it, because a character who left their profession
    for later has to be told that is why the page is empty rather than shown
    a blank.
  */
  function bookView(s, actorId) {
    // No table, no book. See recipeIndex: this block names something another
    // block owns, and a build that shipped without the recipes draws no
    // recipe section rather than fourteen halves that all make nothing.
    if (!recipeIndex(actorId)) { return null; }
    var halves = [];
    var seen = {};
    var prof = s && s.prof;
    var own = s && s.half;
    if (own) {
      halves.push(bookHalf(own, 'own', P.rankOf(s, own) || 'novice', actorId));
      seen[own] = true;
    }
    /*
      EVERY HALF IS READ AT THE RANK THE STATE HOLDS, INCLUDING THESE TWO, and
      that is the point rather than a shortcut. The two ceilings are rankUp's:
      a taught half is refused a step outright, so its rank never leaves
      novice, and the sister half is refused one unless a Master of it has
      taken the person on, which classes.md allows in as many words. Writing
      novice in here instead would be this function keeping a second copy of
      a rule, and the copy would be wrong for the one character whose Master
      did take them on. Asking rankOf is asking exactly what canWork asks, so
      a family counted open here is one the craft gate lets through.
    */
    var sister = (prof && own) ? P.sisterOf(prof, own) : null;
    if (sister && !P.has(seen, sister)) {
      halves.push(bookHalf(sister, 'sister', P.rankOf(s, sister) || 'novice', actorId));
      seen[sister] = true;
    }
    var taught = (s && s.taught) || [];
    for (var i = 0; i < taught.length; i++) {
      var t = taught[i];
      if (P.has(seen, t) || !isCraftHalf(t)) { continue; }
      halves.push(bookHalf(t, 'taught', P.rankOf(s, t) || 'novice', actorId));
      seen[t] = true;
    }
    if (!halves.length) {
      if (prof === 'mage') { return null; }
      return { halves: [], none: prof ? BOOK_NO_HALF : BOOK_NO_PROFESSION };
    }
    return { halves: halves, none: null };
  }

  /*
    What the panel is told. Not the whole state: the panel marks what is
    yours and shows rank and points, and nothing on the client needs more.
  */
  /*
    THE PROPERTY PAGE, and it only exists once somebody has something on it.

    Patrick, 21 September: "for non stewards once they claim a house or have a
    key to a house a property button should appear in the K menu that lists the
    Properties and wether they own them or not".

    So it is two lists in one, and the row says which it is. A place you hold is
    yours; a place you carry a key to is not, and saying so plainly is the point
    of the page. Somebody with neither gets no page at all, which is what makes
    the button appear rather than sit there empty.

    A KEY IS READ OUT OF THE PACK, not out of a register, because there is no
    register of keys and deliberately so: keys are given away and pickpocketed
    with nobody telling the server. That means this walks the pack once per
    draw, which is why it stops at the first page's worth: somebody carrying
    forty keys is a locksmith, and a list of forty is not a page anybody reads.

    STEWARDS ARE NOT HERE. Patrick said "for non stewards", and an office holder
    seeing every property in their hold is a different page with a different
    question behind it. It is on the list and it is not this.
  */
  var PROPERTY_PAGE_MAX = 24;

  function propertyView(actorId, profileId) {
    var W = g.__thornswoodProperty;
    if (!W || !W.holderOf) { return null; }
    // Who may sleep in each place you hold tonight, with a Stop beside each
    // name (#1603). See guestsOf in the beds, in the property block.
    var B = g.__thornswoodBeds;
    var rows = [], seen = {};
    try {
      /*
        AND THE RENT OWED ON EACH (#1637): what you hold is on this page and
        not behind a typed /deed, rent with it. Counted up to now first, the
        same count /rent makes, so the page and the steward agree.
      */
      if (W.rentDue) { W.rentDue(); }
      /*
        AND WHAT YOU STILL OWE ON A PLACE YOU NO LONGER HOLD (#3893): the
        deed went to somebody else and the debt stayed yours, so it is here,
        where you would look, and not only on the steward's page.
      */
      var before = {};
      var arrears = W.arrears ? W.arrears() : {};
      for (var a in arrears) {
        if (!Object.prototype.hasOwnProperty.call(arrears, a)) { continue; }
        for (var ai = 0; ai < arrears[a].length; ai++) {
          if (arrears[a][ai].by === profileId) { before[a] = arrears[a][ai].owed; }
        }
      }
      var claims = W.claims();
      for (var b in claims) {
        if (!Object.prototype.hasOwnProperty.call(claims, b)) { continue; }
        var held = W.holderOf(b);
        if (!held || held.by !== profileId) { continue; }
        seen[b] = true;
        var rent = held.rent ? { amount: Number(held.rent.amount) || 0,
                                 every: Number(held.rent.everyDays) || 7,
                                 owed: Number(held.rent.owed) || 0 } : null;
        rows.push({ name: W.placeOf(b), mine: true, locked: !!held.locked, rent: rent,
                    before: Object.prototype.hasOwnProperty.call(before, b) ? before[b] : 0,
                    master: !!(W.holdsMasterKey && W.holdsMasterKey(actorId, b)),
                    keyed: W.holdsKey(actorId, b), b: b,
                    sleep: (B && B.guestsOf) ? B.guestsOf(b) : [] });
      }
      // And the farm, one a person: ground with no building on it, which is
      // the farming block's own claim (#1637). See farmOf there.
      var F = g.__thornswoodFarming;
      var farm = (F && F.farmOf) ? F.farmOf(profileId) : null;
      if (farm) {
        rows.push({ name: 'Your farm', mine: true, farm: true,
                    days: farm.days, reach: farm.reach });
      }
      // A master key somebody handed you, while it still works (#2254): it
      // opens the door and turns the lock, so its row says both.
      var masters = W.masterKeysOf ? W.masterKeysOf(actorId) : [];
      for (var mi = 0; mi < masters.length && rows.length < PROPERTY_PAGE_MAX; mi++) {
        var mb = masters[mi];
        if (seen[mb]) { continue; }
        seen[mb] = true;
        var mh = W.holderOf(mb);
        rows.push({ name: W.placeOf(mb), mine: false, locked: !!(mh && mh.locked),
                    keyed: true, master: true, by: mh ? mh.name : null, b: mb });
      }
      // Then the places somebody let you into. A key to a building you already
      // hold is not a second row: it is the same house and the row above says
      // you carry a key to it.
      var inv = null;
      try { inv = mp.get(actorId, 'inventory'); } catch (e) { inv = null; }
      var entries = (inv && inv.entries) || [];
      var keyId = idOf(W.KEY);
      for (var i = 0; i < entries.length && rows.length < PROPERTY_PAGE_MAX; i++) {
        var e = entries[i];
        if (!e || !(e.count > 0) || e.baseId !== keyId) { continue; }
        var label = String(e.name || '');
        for (var b2 in BUILDING_NAME) {
          if (!Object.prototype.hasOwnProperty.call(BUILDING_NAME, b2)) { continue; }
          if (label !== W.keyLabel(b2) || seen[b2]) { continue; }
          seen[b2] = true;
          var h2 = W.holderOf(b2);
          rows.push({ name: W.placeOf(b2), mine: false, locked: !!(h2 && h2.locked),
                      keyed: true, by: h2 ? h2.name : null, b: b2 });
          break;
        }
      }
      // The places you owe on from before, on the row of a key you carry to one, or a row of their own.
      for (var ob in before) {
        if (!Object.prototype.hasOwnProperty.call(before, ob)) { continue; }
        var onRow = rows.filter(function (x) { return !x.mine && x.b === ob; })[0];
        if (onRow) { onRow.owes = before[ob]; continue; }
        if (seen[ob] || rows.length >= PROPERTY_PAGE_MAX) { continue; }
        seen[ob] = true;
        var oh = W.holderOf(ob);
        rows.push({ name: W.placeOf(ob), mine: false, owes: before[ob], by: oh ? oh.name : null, b: ob });
      }
    } catch (e) {
      clog('the property page threw, so it is left off:', e);
      return null;
    }
    if (!rows.length) { return null; }
    rows.sort(function (a, b) {
      if (a.mine !== b.mine) { return a.mine ? -1 : 1; }
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return rows;
  }

  /*
    actorId is here for the needs block and nothing else: hunger, thirst and
    exhaustion live on the character rather than in the rules state, because
    they move with the clock rather than with a choice. Everything else in
    this function reads s. A null actorId simply leaves the meters off the
    view, which is what a caller with no character in hand should get.
  */
  /*
    The needs block's two answers, asked for safely.

    Both are guarded rather than assumed, because this block loads before the
    needs block at the end of the file and a hot reload can leave either one
    missing for a tick. A character sheet that draws without the meters is a
    small loss; one that throws is the whole panel gone.
  */
  function withNeeds(actorId, base) {
    var n = g.__thornswoodNeeds;
    if (!n || !actorId) { return base; }
    var out = {};
    for (var k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) { out[k] = base[k]; }
    }
    try {
      var pen = n.effects(actorId, n.settle(actorId));
      for (var av in pen) {
        if (!Object.prototype.hasOwnProperty.call(pen, av)) { continue; }
        out[av] = (Object.prototype.hasOwnProperty.call(out, av) ? out[av] : 0) + pen[av];
      }
    } catch (e) { return base; }
    return out;
  }

  /*
    And what a warrior's maneuver adds while it lasts (#1386): Rush's +4
    speed for five seconds. Folded into the same map for the same reason the
    needs are: the client SETS each value to the total it is given, so a
    second map would overwrite the first. The maneuvers block loads after
    this one and is asked at write time.
  */
  function withManeuvers(actorId, base) {
    var mv = g.__thornswoodManeuvers;
    if (!mv || !mv.effects || !actorId) { return base; }
    var add = null;
    try { add = mv.effects(actorId); } catch (e) { return base; }
    if (!add) { return base; }
    var out = {};
    for (var k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) { out[k] = base[k]; }
    }
    for (var av in add) {
      if (!Object.prototype.hasOwnProperty.call(add, av)) { continue; }
      out[av] = (Object.prototype.hasOwnProperty.call(out, av) ? out[av] : 0) + add[av];
    }
    return out;
  }

  /*
    And what a running skill perk adds while it lasts (#1385): Font of
    Magic's 15 seconds of free spells, on each school's cost value. Folded in
    for the same reason as the maneuvers, and asked at write time because the
    skill perks block loads after this one.
  */
  function withPerks(actorId, base) {
    var pk = g.__thornswoodPerks;
    if (!pk || !pk.effects || !actorId) { return base; }
    var add = pk.effects(actorId);
    if (!add) { return base; }
    var out = {};
    for (var k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) { out[k] = base[k]; }
    }
    for (var av in add) {
      if (!Object.prototype.hasOwnProperty.call(add, av)) { continue; }
      out[av] = (Object.prototype.hasOwnProperty.call(out, av) ? out[av] : 0) + add[av];
    }
    return out;
  }

  /*
    And restoration strain while it lasts (#1387): the rising cost and the
    20 seconds refused, from the college block, folded in for the same
    reason as the maneuvers and asked at write time for the same reason.
    Withered too, last, because it is a share of what the rest add up to.
  */
  function withCollege(actorId, base) {
    var co = g.__thornswoodCollege;
    if (!co || !co.effects || !actorId) { return base; }
    // The map so far goes in: withered takes a fifth of the health and
    // magicka it already holds (#1387).
    var add = co.effects(actorId, undefined, base);
    if (!add) { return base; }
    var out = {};
    for (var k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) { out[k] = base[k]; }
    }
    for (var av in add) {
      if (!Object.prototype.hasOwnProperty.call(add, av)) { continue; }
      out[av] = (Object.prototype.hasOwnProperty.call(out, av) ? out[av] : 0) + add[av];
    }
    return out;
  }

  /* The College page on K (#1387): what a semester hands this character and when the next one opens. */
  function collegeView(s) {
    var co = g.__thornswoodCollege;
    return (co && co.view) ? co.view(s) : null;
  }

  /*
    The map the client applies, folded the way forPanel folds it: the tree,
    the needs, a running maneuver, a running perk and restoration strain
    (#1387). The maneuvers block
    reads its stamina to know a person's real most (#1386): the tree's
    Endurance and the needs' penalties are on it. A change to the fold in
    forPanel is a change here too.
  */
  function effectsOf(actorId) {
    return withCollege(actorId, withPerks(actorId, withManeuvers(actorId, withNeeds(actorId, P.treeApplies(stateOf(actorId))))));
  }

  /*
    A warrior's maneuvers, for the panel the maneuver key opens (#1386). The
    maneuvers block owns the rows and loads after this one, so it is asked at
    write time; absent for somebody who holds none.
  */
  function maneuversView(actorId, s) {
    var mv = g.__thornswoodManeuvers;
    if (!mv || !mv.view || !actorId) { return null; }
    try { return mv.view(actorId, s); } catch (e) {
      clog('the maneuvers view threw for', actorId.toString(16) + ':', e);
      return null;
    }
  }

  /*
    WHAT A MASTER WEAVER'S GARMENTS CARRY (#1398). Patrick's answer on #1398:
    the tailor picks one per garment, warmth or armour. The pick is on the
    profession card on K, whose two buttons send /pick weave warmth and
    /pick weave armour (nobody types either), and it is kept on the character
    as weave until they press the other. wovenOutput reads it at the craft.
    Warmth until they pick armour, which is what every garment woven before
    there was a pick carries. null for anybody who does not hold the perk.
  */
  function weaveOf(s) {
    if (!s || P.perks(s).indexOf('masterweaver') === -1) { return null; }
    return s.weave === 'armour' ? 'armour' : 'warmth';
  }

  /** What a Master Weaver is told when the pick is taken. */
  function weaveLine(weave) {
    if (weave === 'armour') {
      var M = g.__thornswoodManeuvers;
      var back = (M && M.WOVEN) ? Math.round(M.WOVEN.less * 100) : 0;
      return 'The garments you make now carry hidden armour' +
             (back ? ': one worn gives back ' + back + '% of each hit' : '') +
             '. They do not keep the weather off.';
    }
    var N = g.__thornswoodNeeds;
    var degrees = (N && N.NEEDS && N.NEEDS.wear && N.NEEDS.wear.woven) ? N.NEEDS.wear.woven.degrees : 0;
    return 'The garments you make now keep the weather off' +
           (degrees ? ': one worn ignores ' + degrees + ' degrees of exposure' : '') +
           '. They carry no hidden armour.';
  }

  function needsView(actorId) {
    var n = g.__thornswoodNeeds;
    if (!n || !actorId) { return null; }
    try { return n.view(actorId); } catch (e) { return null; }
  }

  function forPanel(s, creating, actorId) {
    if (!s) { return null; }
    var chargen = g.__thornswoodChargen;
    var view = {
      profession: s.prof || null,
      'class': s.cls || null,
      half: s.half || null,
      schools: s.schools || [],
      ranks: s.ranks || {},
      tree: s.tree || {},
      // The part of tree that was placed by the class, profession and half
      // at creation. The panel draws these as placed rather than spent, and
      // nothing takes one back out.
      placed: s.placed || {},
      points: s.points || 0,
      perks: P.perks(s),
      /*
        What the tree adds up to, for the client to apply: only the values
        that are not zero. The server cannot set any of them itself, because
        GetBaseActorValues computes the base values from the race record and
        would overwrite whatever was written. The per point amounts are in
        TUNING.perPoint.

        The name is the one the game plugin already reads: thornswood-front.js
        takes the view back off the page and looks at v.panel.effects. Both
        halves were written at the same time last round and did not match,
        which is the whole reason there is a contract, so this one is spelled
        the way the reader spells it.
      */
      /*
        The tree's totals AND what hunger, thirst and exhaustion take off
        them, added together into the one map the client already applies.

        Folded here rather than sent separately because treeApplyNow SETS each
        value to the total it is given: two maps would mean the second one
        overwriting the first, and whichever arrived last would be the only one
        that counted. One map, one total, and a penalty is simply a negative
        number in it. See the needs block at the end of this file.
      */
      effects: withManeuvers(actorId, withNeeds(actorId, P.treeApplies(s))),
      // What the maneuver key draws. See maneuversView.
      maneuvers: maneuversView(actorId, s),
      /*
        The three meters, for the panel to draw. Absent entirely when there is
        no character in hand or the needs block is not loaded, so a page from
        before this existed draws exactly what it drew.
      */
      needs: needsView(actorId),
      // The book and what is left to spend on it. The page reads spells by
      // name and spellPoints as a number; both names are the client's.
      spells: spellMap(s),
      spellPoints: P.spellPoints(s),
      // The College page: absent for somebody magic is not open to.
      college: collegeView(s),
      // Rank and progress per key. See workView.
      work: workView(s),
      home: s.home || null,
      // The last refusal, so the panel can say why under itself. The chat
      // line says the same; the panel cannot read the chat.
      note: s.note || null,
      // While creating, the panel opens itself and shows the town list; the
      // moment the home is chosen this flips and the panel closes.
      creating: !!creating,
      towns: (creating && chargen) ? chargen.towns() : []
    };
    // And a running skill perk on top of all of that (#1385): see withPerks.
    view.effects = withPerks(actorId, view.effects);
    // And restoration strain while it lasts (#1387): see withCollege.
    view.effects = withCollege(actorId, view.effects);
    /*
      The recipe book, and only in the world. Creation is about choosing who
      you are, and a page counting what a half you have not picked yet could
      make would be answering a question nobody has asked. The moment the
      home is confirmed the panel redraws with it.
    */
    if (!creating) {
      var book = bookView(s, actorId);
      if (book) { view.book = book; }
      /*
        An Enchanter's staff spells (#1128), drawn as a spell book of its own
        and left off for everybody else. The staff spells block owns the table
        and loads after this one, so it is asked at write time.
      */
      var SS = g.__thornswoodStaffSpells;
      var staff = (SS && SS.view) ? SS.view(P, s) : null;
      if (staff) { view.staff = staff; }
      /*
        When each filled perk that waits is ready again, and Font of Magic
        while it runs (#1385), so the K panel can say so beside the perk. The
        skill perks block owns the clocks and loads after this one.
      */
      var PKV = g.__thornswoodPerks;
      var perkClocks = (PKV && PKV.clocks && actorId) ? PKV.clocks(actorId, s) : null;
      if (perkClocks) { view.perkClocks = perkClocks; }
      // Masters and apprentices (#1634): see apprenticeView.
      var taughtView = apprenticeView(actorId, s);
      if (taughtView) { view.apprentice = taughtView; }
      // What a Master Weaver's next garments carry (#1398): see weaveOf.
      var weave = weaveOf(s);
      if (weave) { view.weave = weave; }
    }
    // Left out entirely when there is nothing to say, per the contract.
    var climbing = progressView(s);
    if (climbing) { view.progress = climbing; }
    return view;
  }

  /*
    WHAT COUNTS AS THE PANEL CHANGING, and why a flower is not it.

    Every credited yield used to call writeState, which fires updateOwner,
    which re-runs the panel's setData in that person's browser. So picking
    one nirnroot redrew the whole panel, and a morning of picking flowers
    redrew it a hundred times to move one number nobody was looking at.

    The counters are kept: the work is the record and the record is written
    every time. What is held back is the PANEL VIEW. This is everything the
    panel draws except the done numbers inside progress and work, so a write
    that only moved a counter carries no panel at all, and the updateOwner
    script sends nothing to the browser for it. The rank, the points, the
    spells, the tree, a note, anything else on the view: the panel goes and
    the browser redraws. The counters catch up with the next real change, or
    at once on /pick refresh, which asks for a redraw outright.
  */
  function drawn(view) {
    if (!view) { return ''; }
    var copy = JSON.parse(JSON.stringify(view));
    var groups = [copy.progress, copy.work];
    for (var i = 0; i < groups.length; i++) {
      for (var key in groups[i]) {
        if (P.has(groups[i], key)) { delete groups[i][key].done; }
      }
    }
    return JSON.stringify(copy);
  }

  /*
    The panel view last sent to each person, as the string above. Kept in
    memory rather than on the property, because it is bookkeeping about what
    the browser has already been told and not a fact about the character. An
    empty map after a restart costs one redraw each, which is right anyway.
  */
  var lastDrawn = {};

  /*
    The client side script. It runs inside skymp5-client EVERY FRAME for as
    long as the property holds a value, not once per change: the reading of
    skymp5-client that settled that is written out in full at SWING_PROPERTY
    in this file. ctx.value is whatever is on the character at that frame.
    While the server says creating, it also opens the panel, which is how
    creation lands on somebody's screen without them pressing anything.
    Everything it does is guarded, because a page that has not mounted the
    panel yet is the normal case for the first second of a session.

    SO IT COMPARES BEFORE IT DRAWS. Without that, every frame built the whole
    panel payload as a string and handed it to browser.executeJavaScript,
    sixty times a second, for the entire session. drawn() and lastDrawn above
    already hold back a WRITE that would not change the panel; this holds back
    a DRAW of a value that has not changed since the last frame, which is a
    different thing and, until now, the one nothing was holding back.

    ctx.state is one object shared by every updateOwner script on the client,
    so the key is namespaced. No state means draw, because a panel that is
    redrawn too often is a cost and one that is never drawn is a character
    sheet nobody can see.
  */
  function updateOwnerScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || typeof v !== "object") { return; }',
      // No panel on the value means the write moved a counter and nothing
      // the panel draws, so the browser is not touched at all. See drawn().
      '    if (!v.panel) { return; }',
      '    var body = JSON.stringify(v);',
      '    var st = ctx.state;',
      '    if (st) {',
      '      if (st.thornswoodPanel === body) { return; }',
      '      st.thornswoodPanel = body;',
      '    }',
      '    var open = (v.panel && v.panel.creating) ? "window.thornswoodSkills.open();" : "";',
      '    var src = "try{if(window.thornswoodSkills){window.thornswoodSkills.setData(null," + body + ");" + open + "}}catch(e){}";',
      '    ctx.sp.browser.executeJavaScript(src);',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  try {
    mp.makeProperty(CHAR_PROPERTY, {
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: updateOwnerScript(),
      updateNeighbor: ''
    });
    clog('property registered with an updateOwner script,', updateOwnerScript().length, 'chars');
  } catch (e) {
    // already made by a previous load; the script cannot be changed after
    // the fact, so a changed script needs a server restart, which a deploy is.
  }

  function readState(actorId) {
    var v = null;
    try { v = mp.get(actorId, CHAR_PROPERTY); } catch (e) { v = null; }
    if (v && typeof v === 'object' && v.v === 1) { return v; }
    return null;
  }

  /*
    A REDRAW REACHES THE PAGE (#1730). writeState's redraw is a write the
    page has to take whether anything on the panel changed or not: the
    panel's own ask (/pick refresh, sent once it is in and each time it
    opens), a refusal, the creation hall's reminder (beginCreation), an
    effect starting or ending. Measured along the way: the engine sends
    every write (CustomPropertyBinding::Set in the fork has no comparison),
    and the page draws whatever setData is handed and opens when open() is
    called. What held a repeated one back is the client's script
    (updateOwnerScript): it runs every frame, so it cannot tell a second
    write of the same value from the next frame, and it draws only a value
    unlike the one it last handed the page. A reminder is the same value as
    the reminder before it, so the panel stayed shut for somebody who closed
    it while choosing until something else on it moved. The same held back a
    refresh answering the view sent before the page was in (#1642).

    So a redraw carries asked, a number later than any redraw before it on
    this server, and the script draws it once. It sits on the value beside
    the panel and not inside it, because it is about the write and not about
    the panel: the page draws from the panel (viewKey in thornswood-skills.js),
    and a refusal or a reminder must not tear its cards down. drawn() never
    sees it, so the signature that holds back an unchanged write does not
    count it, and every other write leaves it off.
  */
  var lastAsked = 0;
  function askedNow() {
    lastAsked = Math.max(Date.now(), lastAsked + 1);
    return lastAsked;
  }

  function writeState(actorId, s, redraw) {
    s.v = 1;
    // forPanel is what the client sees; the rules state is what is stored.
    // Both travel in the one property so the panel never sees a half state.
    var chargen = g.__thornswoodChargen;
    var view = forPanel(s, !!(chargen && chargen.isChoosing(actorId)), actorId);
    /*
      The property page needs the actor and the profile, which forPanel is not
      handed: it is given the rules state and the rules know nothing about
      buildings. So it is added here, where both are in hand, and left off
      entirely when there is nothing on it.
    */
    if (view && !view.creating) {
      var pid = 0;
      try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
      var held = propertyView(actorId, pid);
      if (held) { view.property = held; }
      /*
        The Office page (#1638), for anybody who holds an office or is staff
        (#2551), and left off for everybody else. The property block owns the offices, which
        are Discord roles on the account since #2551, so it needs only the
        actor and the profile; it never asks stateOf, which from inside
        writeState would ask for itself. See officeView.
      */
      var W = g.__thornswoodProperty;
      var desk = (W && W.officeView) ? W.officeView(actorId, pid) : null;
      if (desk) { view.officePage = desk; }
      // The Hair dye page (#2675): the dyes carried, or nothing at all.
      var HD = g.__thornswoodHairDye;
      var dyePage = null;
      try { dyePage = (HD && HD.view) ? HD.view(actorId) : null; } catch (eDye) { dyePage = null; }
      if (dyePage) { view.hairDye = dyePage; }
      // First steps (#3166): a new character's guide, until the errand is done.
      var FS = g.__thornswoodFirstSteps;
      var firstSteps = null;
      try { firstSteps = (FS && FS.view) ? FS.view(actorId, s) : null; } catch (eSteps) { firstSteps = null; }
      if (firstSteps) { view.firstSteps = firstSteps; }
      // The Alchemy journal page (#3142): what was eaten and brewed, or nothing at all.
      var AJ = g.__thornswoodAlchemy;
      var alchemyPage = null;
      try { alchemyPage = (AJ && AJ.page) ? AJ.page(actorId) : null; } catch (eAlch) { alchemyPage = null; }
      if (alchemyPage) { view.alchemy = alchemyPage; }
    }
    var sig = drawn(view);
    var sending = !!redraw || lastDrawn[actorId] !== sig;
    delete s.asked;   // only the redraw below carries one (#1730)
    if (sending) {
      /*
        The Body page (#1631): the meters, the warmth with its working out
        and what is counted as worn, which /needs used to say. Put only on a
        panel that is going anyway, after the signature, because its numbers
        move every minute and a panel sent for them alone would be the flower
        redraw again. K asks for the panel outright as it opens (/pick
        refresh), so the page reads as of that moment.
      */
      var N = g.__thornswoodNeeds;
      if (view && !view.creating && N && N.view) { view.body = N.view(actorId); }
      if (redraw) { s.asked = askedNow(); }
      s.panel = view;
    } else {
      // A counter and nothing else. The record is written; the panel is not
      // sent, so the browser is left alone. See drawn() above.
      delete s.panel;
    }
    try {
      mp.set(actorId, CHAR_PROPERTY, s);
      // Only once it is actually written. A write that threw sent nothing,
      // and remembering it as sent would hold the next one back as well.
      if (sending) { lastDrawn[actorId] = sig; }
    } catch (e) {
      clog('could not write', actorId.toString(16), e);
    }
    // Twin Souls is a second enchantment slot in the menu (#1389). It lives
    // beside the craft gate, outside this block, the way spellOn does.
    if (typeof handEnchantSlots === 'function') { handEnchantSlots(actorId, s); }
    // And what the crafting menu lists, from the same answer the craft gate gives (#613).
    if (typeof handRecipesHidden === 'function') { handRecipesHidden(actorId); }
    return s;
  }

  /*
    First sight of an actor with no character state: build one from the old
    chargen fields if they are there. Each old key is applied through the
    rules, so an old value the rules refuse is simply not carried, and the
    log says which.
  */
  function migrate(actorId) {
    var s = P.fresh();
    var old = null;
    try { old = mp.get(actorId, 'thornswoodChargen'); } catch (e) { old = null; }
    if (old && typeof old === 'object') {
      var trade = String(old['class'] || '').toLowerCase();
      var half = mapHalf(old.half);
      var gathering = String(old.gathering || '').toLowerCase();
      var r;
      if (gathering) {
        r = P.pickClass(s, gathering);
        if (r.ok) { s = r.state; } else { clog('migrate', actorId.toString(16), 'old class', gathering, 'refused:', r.why); }
      }
      if (trade && P.has(P.TABLE.professions, trade)) {
        if (trade === 'mage') {
          clog('migrate', actorId.toString(16), 'was a mage under the old keys; schools were never recorded, so they will be asked for');
        } else if (half) {
          r = P.pickProfession(s, trade, half);
          if (r.ok) { s = r.state; } else { clog('migrate', actorId.toString(16), 'old trade', trade, half, 'refused:', r.why); }
        } else {
          clog('migrate', actorId.toString(16), 'old trade', trade, 'had no half recorded, so it will be asked for');
        }
      } else if (trade && P.has(P.TABLE.rpOnly, trade)) {
        /*
          RP-only: not a Class, not a Profession. Clear the old key so no
          leftover privilege (bard instruments, etc.) reads it, and leave
          the progression state empty so they re-pick like somebody new.
        */
        clog('migrate', actorId.toString(16), 'old trade', trade, 'is RP-only; cleared, they must pick a class and profession');
        try { old['class'] = ''; mp.set(actorId, 'thornswoodChargen', old); } catch (eClear) { }
      } else if (trade) {
        clog('migrate', actorId.toString(16), 'old trade', trade, 'has no home in the rulebook; left on the old property, nothing chosen here');
      }
    }
    return writeState(actorId, s);
  }

  function stateOf(actorId) {
    return readState(actorId) || migrate(actorId);
  }

  // ------------------------------------------------- gates, work, spells --

  /** The rulebook's own name for a class, a half or a school. */
  function nameOf(key) {
    var T = P.TABLE;
    if (P.has(T.classes, key)) { return T.classes[key].name; }
    for (var prof in T.professions) {
      if (!P.has(T.professions, prof)) { continue; }
      var halves = T.professions[prof].halves;
      if (P.has(halves, key)) { return halves[key]; }
    }
    return String(key).charAt(0).toUpperCase() + String(key).slice(1);
  }

  function rankName(r) {
    return String(r || '').charAt(0).toUpperCase() + String(r || '').slice(1);
  }

  /*
    What somebody is told when the work is not theirs.

    One sentence, the class that owns it named, and what to do about it,
    because 'you cannot do that' with no name in it is how a person ends up
    thinking the server is broken. classes.md: the five verbs are exclusive,
    'if you want leather you know a hunter'.
  */
  var VERB_REFUSAL = {
    loot: 'Only a hunter can take anything off a carcass. Ask one.',
    fish: 'Only a fisher can fish. Ask one.',
    harvest: 'Only a gatherer can pull that out of the ground. Ask one.',
    mine: 'Only a miner can work a seam. Ask one.',
    farm: 'Only a farmer can bring a crop in. Ask one.'
  };

  var NO_CLASS = 'You have not chosen a class yet. Press K and choose one.';
  var NO_PROFESSION = 'You have not chosen a profession yet. Press K and choose one.';

  /** null when this person may do that verb, otherwise the sentence to say. */
  function gate(actorId, verb) {
    var s = stateOf(actorId);
    if (!s.cls) { return NO_CLASS; }
    if (P.canDo(s, verb)) { return null; }
    return (P.has(VERB_REFUSAL, verb) && VERB_REFUSAL[verb]) ||
      'That work belongs to another class. Ask somebody whose it is.';
  }

  /**
    The same for a profession's half rather than a class verb: a kiln is
    Charburner work, and a Woodwright gets the novice of it for nothing
    because it is their sister half. The caller passes the sentence for
    'you do not work that half', because only the caller knows what was
    pressed.
  */
  function gateHalf(actorId, half, rank, refusal) {
    var s = stateOf(actorId);
    if (P.canWork(s, half, rank || 'novice')) { return null; }
    if (!s.prof) { return NO_PROFESSION; }
    return refusal;
  }

  /**
    A yield was handed out, so the work is counted, and the rank goes up when
    the count is there. Returns null, or the line to say about a new rank.

    Called only after the gate above said yes, so the standing is there.
  */
  function raiseLine(raised) {
    var rank = rankName(raised.to);
    // A school is a thing you are advanced IN; a class and a half are things
    // you ARE. Both sentences say the same fact and neither reads like a
    // machine wrote it.
    var line = (P.TABLE.schools.indexOf(raised.key) !== -1)
      ? 'Your ' + nameOf(raised.key) + ' is now ' + rank + '.'
      : 'You are now ' + (/^[aeiou]/i.test(rank) ? 'an ' : 'a ') +
        rank + ' ' + nameOf(raised.key) + '.';
    if (raised.points > 0) {
      line += ' ' + raised.points + ' skill point' + (raised.points === 1 ? '' : 's') +
              ' to spend, on K.';
    }
    if (raised.spellPoints > 0) {
      line += ' ' + raised.spellPoints + ' more spell point' +
              (raised.spellPoints === 1 ? '' : 's') + ' as well.';
    }
    if (raised.staffPoints > 0) {
      line += ' ' + raised.staffPoints + ' more staff spell point' +
              (raised.staffPoints === 1 ? '' : 's') + ' to unlock staff spells with, on K.';
    }
    return line;
  }

  /*
    WHAT THE NEW RANK OPENED (#3149). Patrick, 26 October, on his report page:
    at each rank up the person is told what just opened, from the same count
    the recipe book on K uses. So this reads recipeIndex, the book's own
    index, at the one rank just reached: the rows of that half at exactly that
    rank, by family, and how many of them Skyrim will list.

    A half only. A class verb and a mage's school own no recipe, and a half
    with nothing at the new rank (a Physicker at expert) says nothing more
    than the rank line already does.

    THE SECOND NUMBER IS THE BOOK'S open, said rather than left out. A row
    with open false carries a condition of its own that Skyrim's crafting menu
    checks before the server is asked, and telling a new Advanced Platewright
    that 71 recipes are theirs when the menu lists 2 is the promise bookHalf
    stopped making on 21 September. When #1402 takes the vanilla perk lines
    off and Build-RecipeTable.ps1 writes open again, this sentence shrinks by
    itself.
  */
  function unlockLine(actorId, raised) {
    if (!raised || !isCraftHalf(raised.key)) { return null; }
    var idx = recipeIndex(actorId);
    var got = (idx && P.has(idx, raised.key)) ? idx[raised.key] : null;
    var to = String(raised.to || '');
    var n = (got && P.has(got.byRank, to)) ? got.byRank[to] : 0;
    if (!n) { return null; }
    var open = P.has(got.openByRank, to) ? got.openByRank[to] : 0;
    var fams = [];
    for (var i = 0; i < got.families.length; i++) {
      var f = got.families[i];
      var c = P.has(f.byRank, to) ? f.byRank[to] : 0;
      if (c) { fams.push({ name: String(f.name).toLowerCase(), n: c, at: i }); }
    }
    // The biggest kinds first, and the book's own order between equals.
    fams.sort(function (a, b) { return (b.n - a.n) || (a.at - b.at); });
    var names = fams.map(function (x) { return x.name; });
    var list = names.length > 1
      ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
      : names[0];
    var line = rankName(to) + ' ' + nameOf(raised.key) + ' work opens ' + n + ' more recipe' +
               (n === 1 ? '' : 's') + ' to you: ' + list + '.';
    if (open < n) {
      var held = n - open;
      line += (open === 0)
        ? ' Skyrim will not list ' + (n === 1 ? 'it' : 'any of them') + ' at the bench: ' +
          (n === 1 ? 'it carries' : 'each carries') + ' a condition of its own,'
        : ' Skyrim lists ' + open + ' of them at the bench. The other ' + held + ' ' +
          (held === 1 ? 'carries' : 'each carry') + ' a condition of ' + (held === 1 ? 'its' : 'their') + ' own,';
      line += ' a perk or a spell or something you have to be holding.';
    }
    return line;
  }

  /*
    Every rank that came out of one action, in the order it happened: the one
    the work was for, and then whatever a mage's schools took from it. Each
    one is a sentence of its own rather than a list, because that is how a
    person reads it.
  */
  function raiseLines(actorId, r) {
    var raises = [];
    if (r.raised) { raises.push(r.raised); }
    var also = r.also || [];
    for (var i = 0; i < also.length; i++) { raises.push(also[i]); }
    if (!raises.length) { return null; }
    var out = [];
    for (var j = 0; j < raises.length; j++) {
      var opened = unlockLine(actorId, raises[j]);
      out.push(opened ? raiseLine(raises[j]) + ' ' + opened : raiseLine(raises[j]));
      clog(actorId.toString(16), raises[j].key, raises[j].from, '->', raises[j].to);
    }
    return out.join(' ');
  }

  function credit(actorId, key) {
    var s = stateOf(actorId);
    // The Master who took them on in this half, when one still stands, so a
    // sister half's count rises past the threshold it waits at (#1388).
    var r = P.creditWork(s, key, masterFor(actorId, s, P.classFor(key) || key));
    if (!r.ok) { return null; }
    // The first piece of work is a first step (#3166), ticked before the write
    // below so the panel it sends already shows it.
    var FS = g.__thornswoodFirstSteps;
    if (FS && FS.worked) {
      try { FS.worked(actorId); } catch (eSteps) { clog('first steps threw at a piece of work:', eSteps); }
    }
    writeState(actorId, r.state);
    return raiseLines(actorId, r);
  }

  /*
    Putting a spell on the character in the game.

    The same call the shrine blessing uses, for the same reason: Actor.AddSpell
    takes its target from self rather than from the Papyrus stack, records the
    spell on the server, and the list comes back on every spawn as
    learnedSpells. So a spell learned here survives logging out.

    SPELL_IDS is empty until another step fills it from the game files, and a
    spell with no id in it is known and not granted. That is said in the log
    and nowhere else: nothing throws, and the person keeps the spell in their
    book for the build that can hand it to them.
  */
  function grantSpell(actorId, name, on) {
    // hasOwnProperty, not a bare lookup: a spell called 'constructor' would
    // otherwise find something on Object.prototype and hand a function to
    // Papyrus as a form id.
    var desc = Object.prototype.hasOwnProperty.call(P.SPELL_IDS, name)
      ? P.SPELL_IDS[name] : null;
    if (!desc) {
      clog('no form id for', name, 'yet, so it is known and not granted');
      return false;
    }
    try {
      if (typeof spellOn === 'function') { return !!spellOn(actorId, desc, on); }
      clog('no way to reach the game from here, so', name, 'is known and not granted');
    } catch (e) {
      clog('could not grant', name, e);
    }
    return false;
  }

  /**
    Everything in somebody's book, back onto their character.

    AddSpell on a spell an actor already has does nothing at all, so this
    costs a call per spell per session and is the cheapest way to be sure a
    reconnect, a wipe of the change form or a spell learned on a build that
    had no form id for it all end up in the same place.
  */
  function grantKnown(actorId) {
    // Only the book is granted (#1387): what it does not list comes off
    // first, out of the book and off the character, in the college block.
    var college = g.__thornswoodCollege;
    if (college && college.cleanAtLogin) { college.cleanAtLogin(actorId); }
    var s = stateOf(actorId);
    var known = (s.spells && s.spells.known) || [];
    var n = 0;
    for (var i = 0; i < known.length; i++) {
      if (grantSpell(actorId, known[i], true)) { n++; }
    }
    if (known.length) {
      clog('spawn:', n, 'of', known.length, 'known spells put back on', actorId.toString(16));
    }
    /*
      And every staff spell unlocked (#1128), by its form id desc. The game's
      crafting menu lists a staff only for somebody who holds its spell (the
      recipe's HasSpell), so an unlocked staff spell has to be on the
      character as well as in the record, or the staff never shows.
    */
    var staff = P.staffKnown ? P.staffKnown(s) : [];
    var put = 0;
    for (var j = 0; j < staff.length; j++) {
      try {
        if (typeof spellOn === 'function' && spellOn(actorId, staff[j], true)) { put++; }
      } catch (e) {
        clog('could not put staff spell', staff[j], 'back on', actorId.toString(16), e);
      }
    }
    if (staff.length) {
      clog('spawn:', put, 'of', staff.length, 'staff spells put back on', actorId.toString(16));
    }
    // And the second enchantment slot Twin Souls gives (#1389): a session
    // starts from a save with no perks on it.
    if (typeof handEnchantSlots === 'function') { handEnchantSlots(actorId, s); }
    // And the recipes the crafting menu leaves out (#613): a session starts
    // from a game whose records list every one.
    if (typeof handRecipesHidden === 'function') { handRecipesHidden(actorId); }
    // And the counts set in each game (#613): a session starts from a game
    // whose records ask the mods' own.
    if (typeof handRecipeCounts === 'function') { handRecipeCounts(actorId); }
    return n;
  }

  /*
    MASTERS AND APPRENTICES (#1388, #1147). docs/systems/apprenticeship.md.

      /apprentice <id> <half>           a Master offers to take somebody on
      /apprentice end <id> <half>       the Master ends it
      /apprentice leave <half>          the apprentice ends it (#1634)
      /apprentice                       who you took on, and who took you on

    NOBODY TYPES THESE (#1634; Patrick, 4 Oct: no chat commands for anything
    people do). They are the lines the buttons send. A Master looking at
    somebody they could take on sees a row for it on the look prompt, named
    K (takeOnMark below puts it on the near list), and K opens the Masters
    and apprentices page with a Take on button for each half that could be
    meant, which sends the first line with the form id the crosshair handed
    over. The same page lists who you took on and who took you on, each
    with End, which sends the second or the third (apprenticeView below).
    No help text names them, and no line of the server's tells anybody to
    type one. A name still works in place of the id, and the half is still
    needed only when the Master could take that person on in more than one.

    The Master offers and the person answers, the way a party or a trade is
    asked: the offer stands in the social block's offers for its seconds, and
    /yes or Accept on the prompt lands it in acceptApprentice below. Taking
    somebody on is the Master's decision and nobody is owed it. The person
    saying yes is the other half of the agreement, and it matters most for an
    outside trade, which is one of only two in a life.

    WHICH ARRANGEMENT is read off the person, never chosen: the other half of
    their own profession is the sister half (P.takeOn), and a half or school
    of another profession is an outside trade (P.teach). Their own half, and
    anything else inside their own profession, the rules refuse and say why.

    WHAT IS RECORDED, on both sides, so either can be read with the other
    offline. The person carries masters[half] = { id, name, at }, the Master's
    actor. The Master carries apprentices, a row per person and half. Work is
    counted against the Master's own record: credit() hands the rules the
    Master only while that Master is still a Master of the half and still
    lists the person. Ending it takes the row off both, and nothing else
    raises a rank: there is no fee, and no gold buys one.
  */

  /** A half or a school by what somebody typed, its key, its name or the launcher's word for it, or null. */
  function halfKey(word) {
    var w = mapHalf(word);
    if (!w) { return null; }
    var T = P.TABLE;
    if (T.schools.indexOf(w) !== -1) { return w; }
    for (var prof in T.professions) {
      if (!P.has(T.professions, prof)) { continue; }
      if (P.has(T.professions[prof].halves, w)) { return w; }
    }
    return null;
  }

  /** The name over somebody's head, through the social block when it is loaded. */
  function personName(actorId) {
    var soc = g.__thornswoodSocial;
    try { if (soc && soc.nameOfPerson) { return soc.nameOfPerson(actorId); } } catch (e) { }
    try {
      var ap = mp.get(actorId, 'appearance');
      if (ap && ap.name) { return String(ap.name); }
    } catch (e2) { }
    return 'somebody';
  }

  /** Does this Master's own record still list that person in that half. */
  function lists(masterState, learnerId, half) {
    var rows = (masterState && masterState.apprentices) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].id === learnerId && rows[i].half === half) { return true; }
    }
    return false;
  }

  /*
    The Master to hand the rules when work in a half is counted, or null.

    Read off the Master's own record every time, online or not: a Master who
    ended it, or whose character is gone, hands nothing, and the count waits
    at the threshold again. Ranks already earned are in the person's own
    record and are not touched.
  */
  function masterFor(actorId, s, key) {
    var rec = (s && s.masters && P.has(s.masters, key)) ? s.masters[key] : null;
    if (!rec || !rec.id || rec.id === actorId) { return null; }
    var ms = readState(rec.id);
    if (!ms || P.rankOf(ms, key) !== 'master' || !lists(ms, actorId, key)) { return null; }
    return ms;
  }

  /** Every half and school somebody holds at Master. A class is not taught. */
  function mastered(ms) {
    var out = [];
    var ranks = (ms && ms.ranks) || {};
    for (var k in ranks) {
      if (!P.has(ranks, k) || ranks[k] !== 'master') { continue; }
      if (P.has(P.TABLE.classes, k)) { continue; }
      out.push(k);
    }
    return out;
  }

  /*
    The rules' answer for one half, as the arrangement it is for that person.
    A record of a Master that no longer stands (ended on their side, or the
    character gone) is not in the way of a new one.
  */
  function arrange(learnerId, ls, ms, half, who) {
    var own = ls && (ls.half === half || (ls.schools || []).indexOf(half) !== -1);
    var sister = (ls && ls.half) ? P.sisterOf(ls.prof, ls.half) : null;
    var r;
    if (own || (sister && sister === half)) {
      var s = ls;
      if (s && s.masters && P.has(s.masters, half) && !masterFor(learnerId, s, half)) {
        s = P.clone(s);
        delete s.masters[half];
      }
      r = P.takeOn(s, ms, half, who);
      r.kind = 'sister';
      return r;
    }
    r = P.teach(ls, ms, half, who);
    r.kind = 'outside';
    return r;
  }

  /*
    THE LOOK PROMPT'S ROW (#1634). The social block builds the near list
    every pass and asks these two, so the prompt offers a Master "Take on as
    apprentice" for exactly the people arrange lets them offer to, with the
    halves it could be. masterRecord is asked once per person per pass, and
    somebody who is a Master of nothing costs that one read and no more.
    takeOnMark is asked for each person near a Master and answers
    [{ h: half, k: 'sister' | 'outside' }], or null when there is none. The
    list decides only what is drawn: offerIt asks all of it again when the
    line arrives.
  */
  function masterRecord(actorId) {
    var ms = readState(actorId);
    return (ms && mastered(ms).length) ? ms : null;
  }
  function takeOnMark(ms, learnerId) {
    var ls = readState(learnerId);
    if (!ms || !ls || !ls.prof) { return null; }
    var mine = mastered(ms);
    var out = [];
    for (var i = 0; i < mine.length; i++) {
      var r = arrange(learnerId, ls, ms, mine[i], null);
      if (r.ok) { out.push({ h: mine[i], k: r.kind }); }
    }
    return out.length ? out : null;
  }

  /*
    THE K PANEL'S MASTERS AND APPRENTICES PAGE (#1634), under view.apprentice:

      took:     [ { id: '<form id, hex>', name, half, kind } ]  who this character took on
      by:       [ { id, name, half, kind, stands } ]            who took them on, one per half
      mastered: [ '<half>' ]                                    what they could take somebody on in
      sister:   { half, rank } or null                          their sister half, while it waits on a Master
      used:     <number>, of: <number>                          outside trades used in this life, of the two

    Each row of took and by carries End on the page: took sends
    /apprentice end <id> <half>, and by sends /apprentice leave <half>.
    stands is false for a sister half whose Master no longer lists them or
    is no longer a Master of it; End then clears their own side. Absent for
    somebody with no profession, who can neither teach nor be taught.
  */
  function apprenticeView(actorId, s) {
    if (!s || !s.prof) { return null; }
    var took = [];
    var rows = s.apprentices || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || !row.id || !row.half) { continue; }
      took.push({ id: Number(row.id).toString(16), name: String(row.name || 'somebody'), half: row.half, kind: row.kind || '' });
    }
    var by = [];
    var stands = {};
    var masters = s.masters || {};
    for (var half in masters) {
      if (!P.has(masters, half)) { continue; }
      var rec = masters[half] || {};
      var outside = (s.taught || []).indexOf(half) !== -1;
      stands[half] = outside || !!masterFor(actorId, s, half);
      by.push({ id: rec.id ? Number(rec.id).toString(16) : '', name: String(rec.name || 'somebody'), half: half,
                kind: outside ? 'outside' : 'sister', stands: stands[half] });
    }
    var sister = s.half ? P.sisterOf(s.prof, s.half) : null;
    var waits = (sister && P.rankOf(s, sister) !== 'master' && !stands[sister])
      ? { half: sister, rank: P.rankOf(s, sister) || 'novice' } : null;
    return { took: took, by: by, mastered: mastered(s), sister: waits,
             used: (s.taught || []).length + (s.untaught || []).length, of: P.TABLE.limits.secondaries };
  }

  /** What /apprentice on its own says: both sides of every arrangement this character is in. */
  function standing(actorId) {
    var s = stateOf(actorId);
    var out = [];
    var rows = s.apprentices || [];
    if (rows.length) {
      var took = [];
      for (var i = 0; i < rows.length; i++) { took.push(rows[i].name + ' in ' + nameOf(rows[i].half)); }
      out.push('You have taken on ' + took.join(', ') + '.');
    }
    var masters = s.masters || {};
    var sister = s.half ? P.sisterOf(s.prof, s.half) : null;
    for (var half in masters) {
      if (!P.has(masters, half)) { continue; }
      var who = (masters[half] && masters[half].name) || 'somebody';
      if ((s.taught || []).indexOf(half) !== -1) {
        out.push(who + ' taught you novice ' + nameOf(half) + '.');
      } else {
        out.push(who + ' has taken you on in ' + nameOf(half) +
                 (masterFor(actorId, s, half) ? ', your sister half.' : ', and that no longer stands.'));
      }
    }
    if (sister && !(P.has(masters, sister) && masterFor(actorId, s, sister)) && P.rankOf(s, sister) !== 'master') {
      out.push(nameOf(sister) + ', your sister half, waits at ' + (P.rankOf(s, sister) || 'novice') +
               ' until a Master of it takes you on.');
    }
    if (s.prof) {
      var used = (s.taught || []).length + (s.untaught || []).length;
      out.push(used + ' of your ' + P.TABLE.limits.secondaries + ' outside trades used in this life.');
    }
    out.push('K lists all of it under Masters and apprentices, each with End.');
    return out.join(' ');
  }

  /** A Master offers. Returns the line for the Master. */
  function offerIt(actorId, words) {
    var half = null;
    if (words.length > 1) {
      half = halfKey(words[words.length - 1]);
      if (half) { words = words.slice(0, -1); }
    }
    var soc = g.__thornswoodSocial;
    if (!soc || !soc.findPerson || !soc.offer) {
      return 'Asking somebody is not running on this server right now. Say so in the dev channel.';
    }
    var found = soc.findPerson(words.join(' '));
    if (!found.actorId) { return found.why; }
    var them = found.actorId;
    if (them === actorId) { return 'That is you.'; }
    var ms = stateOf(actorId);
    var ls = stateOf(them);
    var name = personName(them);
    var mine = mastered(ms);
    if (!mine.length) { return 'Only a Master takes anybody on, and you are not a Master of any half or school yet.'; }
    if (!half) {
      var can = [];
      for (var i = 0; i < mine.length; i++) {
        if (arrange(them, ls, ms, mine[i], null).ok) { can.push(mine[i]); }
      }
      if (can.length > 1) {
        var named = [];
        for (var j = 0; j < can.length; j++) { named.push(nameOf(can[j])); }
        return 'You could take ' + name + ' on in ' + named.join(' or ') + '. Look at them and press the key ' +
               'the prompt names, and pick which.';
      }
      // One that works, or none, in which case the rules say why about the
      // first half they hold at Master.
      half = can.length ? can[0] : mine[0];
    }
    var r = arrange(them, ls, ms, half, null);
    if (!r.ok) { return 'No: ' + r.why + '.'; }
    var refused = soc.offer('apprentice', actorId, them);
    if (refused) { return refused; }
    var pid = soc.profileOf ? soc.profileOf(them) : 0;
    var o = (soc.offers && pid) ? soc.offers[pid] : null;
    if (o) { o.master = actorId; o.half = half; }
    var me = personName(actorId);
    var asked = (r.kind === 'sister')
      ? me + ' offers to take you on in ' + nameOf(half) + ', your sister half, so it can climb past novice. ' +
        'It costs nothing and it is not one of your two outside trades.'
      : me + ' offers to teach you novice ' + nameOf(half) + '. It is one of your two outside trades for life, ' +
        'it never climbs past novice, and if it is ended the place does not come back.';
    try { if (typeof say === 'function') { say(them, asked + ' Accept or refuse on the prompt.'); } } catch (e) { }
    try { if (typeof notify === 'function') { notify(them, me + ' offers to take you on'); } } catch (e2) { }
    try { if (soc.push) { soc.push(them); soc.push(actorId); } } catch (e3) { }
    var secs = (soc.SOCIAL && soc.SOCIAL.offerFor) ? Math.round(soc.SOCIAL.offerFor / 1000) : 45;
    return 'Asked ' + name + ' to be your apprentice in ' + nameOf(half) + '. They have ' + secs + ' seconds.';
  }

  /*
    The person said yes. The offer is checked again from the start, because
    anything can have moved in the seconds it stood, and only then is either
    side written. Returns { learner, master }: the line for each.
  */
  function acceptApprentice(actorId, masterId, o) {
    var half = o && o.half;
    if (!half || !o.master || o.master !== masterId) {
      return { learner: 'That offer came from another of their characters, and it has gone.', master: '' };
    }
    var ls = stateOf(actorId);
    var ms = stateOf(masterId);
    var who = { id: masterId, name: personName(masterId), at: Date.now() };
    var r = arrange(actorId, ls, ms, half, who);
    if (!r.ok) {
      return { learner: 'That cannot be done now, and ' + who.name + ' has been told why.',
               master: 'No: ' + r.why + '.' };
    }
    var name = personName(actorId);
    writeState(actorId, r.state);
    var m2 = P.clone(ms);
    var rows = [];
    var had = m2.apprentices || [];
    for (var i = 0; i < had.length; i++) {
      if (had[i] && !(had[i].id === actorId && had[i].half === half)) { rows.push(had[i]); }
    }
    rows.push({ id: actorId, name: name, half: half, kind: r.kind, at: who.at });
    m2.apprentices = rows;
    writeState(masterId, m2);
    clog(masterId.toString(16), 'took', actorId.toString(16), 'on in', half, '(' + r.kind + ')');
    if (r.kind === 'sister') {
      return { learner: who.name + ' has taken you on in ' + nameOf(half) + '. Work in it climbs past novice now, ' +
                        'and the ranks you earn stay yours if it ends. Either of you can end it on K.',
               master: name + ' is your apprentice in ' + nameOf(half) + '. K lists them, with End.' };
    }
    var school = P.TABLE.schools.indexOf(half) !== -1;
    return { learner: who.name + ' taught you novice ' + nameOf(half) + '. ' +
                      (school ? 'You can learn ' + P.TABLE.limits.outsiderSpells + ' novice spells of it, each from its tome ' +
                                'with a spell point a semester at the College hands you'
                              : 'It is in your recipe book on K') +
                      ', and it never climbs past novice. It is one of your two outside trades. Either of you ' +
                      'can end it on K.',
             master: 'You taught ' + name + ' novice ' + nameOf(half) + '. K lists them, with End.' };
  }

  /** The Master ends it. Returns the line for the Master. */
  function endIt(actorId, words) {
    var ms = stateOf(actorId);
    var rows = ms.apprentices || [];
    if (!rows.length) { return 'You have taken nobody on.'; }
    var half = null;
    if (words.length > 1) {
      half = halfKey(words[words.length - 1]);
      if (half) { words = words.slice(0, -1); }
    }
    var want = words.join(' ').trim().toLowerCase();
    if (!want) { return 'End whose? K lists the people you took on, each with End.'; }
    var asId = parseInt(want, 16);
    var exact = [], part = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || (half && row.half !== half)) { continue; }
      var n = String(row.name || '').toLowerCase();
      if ((isFinite(asId) && row.id === asId) || n === want) { exact.push(row); }
      else if (n.indexOf(want) === 0) { part.push(row); }
    }
    var hit = exact.length ? exact : part;
    if (!hit.length) { return 'Nobody you have taken on answers to that.'; }
    for (var j = 1; j < hit.length; j++) {
      if (hit[j].id !== hit[0].id) { return 'More than one of yours answers to that. Use more of the name.'; }
    }
    if (hit.length > 1) {
      var named = [];
      for (var k = 0; k < hit.length; k++) { named.push(nameOf(hit[k].half)); }
      return hit[0].name + ' is with you in ' + named.join(' and ') + '. Each has its own End on K.';
    }
    var end = hit[0];
    var ended = null;
    var ls = readState(end.id);
    if (ls) {
      var r = P.release(ls, end.half, actorId);
      if (r.ok) {
        writeState(end.id, r.state);
        ended = r.ended;
      }
    }
    var m2 = P.clone(ms);
    var keep = [];
    for (var m = 0; m < rows.length; m++) {
      if (rows[m] && !(rows[m].id === end.id && rows[m].half === end.half)) { keep.push(rows[m]); }
    }
    m2.apprentices = keep;
    writeState(actorId, m2);
    clog(actorId.toString(16), 'ended', end.id.toString(16), 'in', end.half, '(' + (ended || 'their side was already gone') + ')');
    var me = personName(actorId);
    var told = (ended === 'outside')
      ? me + ' has ended your teaching in ' + nameOf(end.half) + ', and its novice list is gone. It still counts as ' +
        'one of your two outside trades.' + spellsStay(end.half)
      : me + ' has ended your apprenticeship in ' + nameOf(end.half) + '. The ranks you earned in it stay; past them ' +
        'the count waits again until a Master takes you on.';
    if (!ended) {
      // Their own record no longer named this Master in that half, or their
      // character is gone: there was nothing on their side to end.
      return 'You took ' + end.name + ' off your list. Their side no longer named you in ' +
             nameOf(end.half) + ', so nothing else changed.';
    }
    try { if (typeof say === 'function') { say(end.id, told); } } catch (e) { }
    if (ended === 'outside') {
      return 'You ended ' + end.name + '\'s novice ' + nameOf(end.half) + '. It is gone from their book, and it ' +
             'still counts as one of their two outside trades.';
    }
    return 'You ended ' + end.name + '\'s apprenticeship in ' + nameOf(end.half) + '. The ranks they earned stay.';
  }

  /*
    Patrick's answer on #1388, 4 Oct: when a taught school or a taught
    Bladebinder ends, the spells already learned stay, and no new one can be
    learned. release() leaves them on the character; this says so.
  */
  function spellsStay(half) {
    return (P.TABLE.schools.indexOf(half) !== -1 || half === 'bladebinder')
      ? ' The spells you already learned from it stay.' : '';
  }

  /*
    The apprentice ends it (#1634). Patrick's answer on #1388, 4 Oct: either
    one can end it, the apprentice as well as the Master. The same release
    as the Master's End, from the other side: the person's own record loses
    the Master in that half, and that Master's list loses the row, online or
    not, so neither side is left naming the other. An outside trade loses
    its novice list and stays counted, as it does when the Master ends it.
    Returns the line for the apprentice.
  */
  function leaveIt(actorId, words) {
    var half = halfKey(words[0]);
    var ls = stateOf(actorId);
    var rec = (half && ls.masters && P.has(ls.masters, half)) ? ls.masters[half] : null;
    if (!rec) { return 'Nobody has taken you on in that.'; }
    var r = P.release(ls, half, null);
    if (!r.ok) { return 'No: ' + r.why + '.'; }
    writeState(actorId, r.state);
    var who = rec.name || 'your Master';
    var masterId = Number(rec.id) || 0;
    var ms = masterId ? readState(masterId) : null;
    if (ms && lists(ms, actorId, half)) {
      var m2 = P.clone(ms);
      var keep = [];
      var rows = ms.apprentices || [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && !(rows[i].id === actorId && rows[i].half === half)) { keep.push(rows[i]); }
      }
      m2.apprentices = keep;
      writeState(masterId, m2);
      try {
        if (typeof say === 'function') {
          say(masterId, personName(actorId) + (r.ended === 'outside'
            ? ' has ended the novice ' + nameOf(half) + ' you taught them.'
            : ' has ended their apprenticeship with you in ' + nameOf(half) + '.'));
        }
      } catch (e) { }
    }
    clog(actorId.toString(16), 'left', masterId.toString(16), 'in', half, '(' + r.ended + ')');
    if (r.ended === 'outside') {
      return 'You ended your novice ' + nameOf(half) + ' with ' + who + '. Its novice list is gone, and it still ' +
             'counts as one of your two outside trades.' + spellsStay(half);
    }
    return 'You ended your apprenticeship in ' + nameOf(half) + ' with ' + who + '. The ranks you earned in it stay; ' +
           'past them the count waits again until a Master takes you on.';
  }

  /** /apprentice, every form of it. Answers through toProfile and always handles the word. */
  function apprenticeCommand(parts, actorId, profileId, toProfile) {
    if (!actorId) {
      toProfile(profileId, 'The server cannot find your character right now. Give it a moment and try again.');
      return;
    }
    var words = parts.slice(1);
    var first = String(words[0] || '').toLowerCase();
    if (!words.length || first === 'list') { toProfile(profileId, standing(actorId)); return; }
    if (first === 'end') { toProfile(profileId, endIt(actorId, words.slice(1))); return; }
    if (first === 'leave') { toProfile(profileId, leaveIt(actorId, words.slice(1))); return; }
    toProfile(profileId, offerIt(actorId, words));
  }

  /*
    The commands. Called from handle() in the chat block with the same
    arguments it has, so the profile id is the one the voice service stamped
    from the connection and not a number in the text.

      /pick refresh                      send the panel what it already is
      /pick class hunter
      /pick profession smith platewright
      /pick profession mage destruction,restoration
      /pick town riften                  while creating, and never after
      /pick spell Ice Spike              one spell out of the book
      /pick staffspell Thunderbolt       an Enchanter unlocks a staff spell (#1128);
                                         the K page sends the spell's desc
      /pick spend vitality               the panel's spelling of /spend
      /spend vitality

    Returns true when the word was one of these, so handle() stops.

    Creation is these same picks. Somebody whose chargen stage is choosing is
    standing in the hall with the panel open; the moment a home is set, arrive
    sends them to the town and the panel closes on the next property write.
    Class and profession can be set there too, or later in the world, since
    only a second pick of either is refused. Nothing else moves anybody.
  */
  function command(word, parts, actorId, profileId, toProfile, cmd) {
    /*
      THE FARMING WORDS, handed straight on.

      They arrive here because handle() in the chat block calls this function
      first and every word this server answers is registered in one place. What
      they do belongs to the farming block, which owns the plots and the claims;
      this is the door they come in at and nothing more.
    */
    if (word === '/plant' || word === '/claim' || word === '/plot' ||
        word === '/deed' || word === '/deeds' || word === '/lock' ||
        word === '/unlock' || word === '/mold' || word === '/moldhere' || word === '/key' ||
        word === '/companyterms' ||
        word === '/office' || word === '/evict' || word === '/dropbox' ||
        word === '/rent' || word === '/sleephere' || word === '/notice' || word === '/job' ||
        word === '/board' || word === '/take' ||
        word === '/haul' || word === '/world' ||
        word === '/letter' || word === '/deliver' ||
        word === '/dropjob' || word === '/unpin') {
      if (!actorId) {
        toProfile(profileId, 'The server cannot find your character right now. Give it a moment and try again.');
        return true;
      }
      /*
        PROPERTY GETS FIRST REFUSAL ON /claim, AND ONLY WHEN THEY ARE AT A DOOR.

        Farming has owned /claim since it was built and it claims ground. The
        property system claims a building, and Patrick settled that claiming
        happens at a door. So the same word means the doorstep when somebody is
        standing on one and the field when they are not, and neither of them has
        to guess: the property block answers false unless the engine has just
        told us they opened a door of a building it knows.

        A home and its farm are one claim, in the code as in the design: the
        house's claim carries the ground outside its front door, and
        claimCovering asks the property block (coversGround) before this
        block's own claims.
      */
      var prop = g.__thornswoodProperty;
      if (prop && prop.command) {
        try {
          if (prop.command(word, parts, actorId, profileId, toProfile, cmd)) { return true; }
        } catch (eProp) {
          clog('the property word', word, 'threw:', eProp);
          toProfile(profileId, 'That did not work. Say which door you were at in the dev channel.');
          return true;
        }
      }
      if (word !== '/plant' && word !== '/claim' && word !== '/plot') {
        // Every other word here is the property block's alone, so there is no
        // farming answer to fall through to.
        toProfile(profileId, 'Property is not running on this server right now. Say so in the dev channel.');
        return true;
      }
      var farm = g.__thornswoodFarming;
      if (!farm || !farm.command) {
        toProfile(profileId, 'Farming is not running on this server right now. Say so in the dev channel.');
        clog('a farming word arrived and the farming block is not loaded:', word);
        return true;
      }
      try {
        farm.command(word, parts, actorId, profileId, toProfile);
      } catch (eFarm) {
        clog('the farming word', word, 'threw:', eFarm);
        toProfile(profileId, 'That did not work. Say what you were standing next to in the dev channel.');
      }
      return true;
    }

    // Masters and apprentices (#1388): see apprenticeCommand above.
    if (word === '/apprentice') {
      apprenticeCommand(parts, actorId, profileId, toProfile);
      return true;
    }

    if (word !== '/pick' && word !== '/spend') { return false; }
    if (!actorId) {
      toProfile(profileId, 'The server cannot find your character right now. Give it a moment and try again.');
      return true;
    }
    var s = stateOf(actorId);
    var chargen = g.__thornswoodChargen;
    var creating = !!(chargen && chargen.isChoosing(actorId));
    var r = null;
    var spellPicked = null;   // set when this command was a spell, so it can
                              // be put on the character after the write
    var staffPicked = null;   // the same for a staff spell: { desc, name, rank }
    /*
      WHICH PICK A REFUSAL ANSWERS. Part of the contract with the panel: a
      note carries about, so the panel clears that one pick and leaves the
      others where they are. A refusal with no name on it left the panel
      guessing which of four buttons had just been told no.
    */
    var about = null;

    if (word === '/pick') {
      var what = String(parts[1] || '').toLowerCase();
      if (what === 'refresh') {
        // A refresh asks for the panel outright, so it is sent whether
        // anything changed or not: that is the whole point of the command.
        // And drawn whether anything changed or not: see askedNow.
        writeState(actorId, s, true);   // the write is what fires updateOwner
        return true;
      }
      /*
        'Not now.' The panel was closed on purpose, so stop pushing it back.

        Djinn: "There is no way to leave the character creation screen except
        to make a character then log out." Escape and K always shut it and the
        reminder reopened it thirty seconds later, which is the same as not
        being able to shut it.

        NOTHING ABOUT THE CHARACTER IS DECIDED HERE. No class, no profession,
        no home, no half made character left behind, which is the trap the
        four stamped-done-with-no-face characters fell into. It moves one
        timestamp. The reminder still comes, ten minutes later instead of
        thirty seconds, because somebody who shut the panel and then forgot
        about it still has to be told how to get back to it.
      */
      /*
        Put this away, on the First steps page (#3166): the guide stops being
        shown, and the panel is sent again without it. Nothing else changes.
      */
      if (what === 'firststeps') {
        var FSH = g.__thornswoodFirstSteps;
        var hid = false;
        try { hid = !!(FSH && FSH.hide && String(parts[2] || '').toLowerCase() === 'hide' && FSH.hide(actorId)); }
        catch (eHide) { hid = false; clog('first steps threw at put away:', eHide); }
        writeState(actorId, s, true);
        if (hid) { toProfile(profileId, 'Put away. The first steps are off your panel.'); }
        return true;
      }
      if (what === 'later') {
        var pushed = false;
        try { pushed = !!(chargen && chargen.remindLater && chargen.remindLater(actorId)); }
        catch (e) { pushed = false; }
        toProfile(profileId, pushed
          ? 'Closed. Press K when you want it back; nothing has been chosen.'
          : 'Closed. Press K to open it again.');
        return true;
      }
      /*
        A filled perk's Use button on the K panel (#1385): Font of Magic. The
        skill perks block decides and keeps the clock, so nothing about the
        character changes here. A refusal is answered like any other pick, as
        a note about 'perk' and the same line in the chat.
      */
      if (what === 'perk') {
        var PKU = g.__thornswoodPerks;
        var used = (PKU && PKU.use) ? PKU.use(actorId, s, parts[2])
          : { ok: false, why: 'perks are not running on this server right now' };
        if (!used.ok) {
          toProfile(profileId, 'No: ' + used.why + '.');
          s.note = { text: used.why, at: Date.now(), about: 'perk' };
          writeState(actorId, s, true);
          clog(word, parts.slice(1).join(' '), 'for', actorId.toString(16), 'refused:', used.why);
          return true;
        }
        // An earlier refusal is answered now, as an accepted pick clears it.
        if (s.note) { s.note = null; writeState(actorId, s, true); }
        toProfile(profileId, used.line);
        clog(word, parts.slice(1).join(' '), 'for', actorId.toString(16), 'accepted');
        return true;
      }
      if (what === 'class') {
        about = 'class';
        r = P.pickClass(s, String(parts[2] || '').toLowerCase());
      } else if (what === 'profession') {
        about = 'profession';
        var prof = String(parts[2] || '').toLowerCase();
        var rest = String(parts[3] || '').toLowerCase();
        r = (prof === 'mage')
          ? P.pickProfession(s, prof, rest ? rest.split(',') : [])
          : P.pickProfession(s, prof, mapHalf(rest));
      } else if (what === 'town') {
        about = 'town';
        var town = String(parts[2] || '').toLowerCase();
        if (!creating) {
          r = { ok: false, why: 'your home is already chosen' };
        } else if (!chargen.hasTown(town)) {
          r = { ok: false, why: 'no such town' };
        } else {
          var s2 = P.clone(s);
          s2.home = town;
          r = { ok: true, state: s2 };
        }
      } else if (what === 'spell') {
        about = 'spell';
        // The name has spaces in it, so everything after the word is the
        // name: 'Ice Spike', 'Bane of the Undead'. Case does not matter.
        var wanted = parts.slice(2).join(' ');
        var bookWanted = P.spellAt(wanted);
        var holdsTome = true;
        if (bookWanted && bookWanted.rank === 'master') {
          var tomeDesc = P.masterTomeDesc ? P.masterTomeDesc(bookWanted.name) : '';
          var tomeId = tomeDesc ? idOf(tomeDesc) : 0;
          var held = 0;
          if (tomeId) {
            try {
              var tomeInv = mp.get(actorId, 'inventory');
              var tomeEntries = (tomeInv && tomeInv.entries) || [];
              for (var ti = 0; ti < tomeEntries.length; ti++) {
                if (tomeEntries[ti] && tomeEntries[ti].baseId === tomeId) {
                  held += (tomeEntries[ti].count || 1);
                }
              }
            } catch (eHold) { held = 0; }
          }
          holdsTome = held > 0;
        }
        r = P.pickSpell(s, wanted, holdsTome);
        if (r.ok && bookWanted && bookWanted.rank === 'master') {
          var spentTome = false;
          try {
            spentTome = !!(typeof takeItemById === 'function' &&
              takeItemById(actorId, idOf(P.masterTomeDesc(bookWanted.name)), 1));
          } catch (eSpend) { spentTome = false; }
          if (!spentTome) {
            r = { ok: false, why: 'the master tome has to leave the pack, and it did not' };
          }
        }
        if (r.ok) {
          var book = P.spellAt(wanted);
          spellPicked = book ? book.name : null;
        }
      } else if (what === 'staffspell') {
        /*
          An Enchanter unlocks a staff spell (#1128): the K page sends the
          spell's desc, and a person typing can give its name. Everything
          after the word is the spell, spaces and all ('Odin - Skyrim Magic
          Overhaul.esp' has them).
        */
        about = 'staffspell';
        var SS = g.__thornswoodStaffSpells;
        r = (SS && SS.unlock) ? SS.unlock(P, s, parts.slice(2).join(' '))
          : { ok: false, why: 'staff spells are not running on this server right now' };
        if (r.ok) { staffPicked = r.spell; }
      } else if (what === 'study') {
        /*
          A semester at the College (#1387) is taken by pressing E at a
          study desk in one of its halls (Patrick, 22 October 2026, A), never
          picked: the college block's deskActivated hands out the points. A
          K panel from before the desks still sends this from its Study
          button, and is told where the desks are.
        */
        about = 'study';
        r = { ok: false, why: 'a semester is taken at a study desk in one of the College\'s halls: press E at the desk' };
      } else if (what === 'weave') {
        // A Master Weaver's pick on the profession card (#1398): see weaveOf.
        about = 'weave';
        var weave = String(parts[2] || '').toLowerCase();
        if (!weaveOf(s)) {
          r = { ok: false, why: 'only a Master Weaver picks what a garment carries' };
        } else if (weave !== 'warmth' && weave !== 'armour') {
          r = { ok: false, why: 'a garment carries warmth or armour' };
        } else {
          var woven = P.clone(s);
          woven.weave = weave;
          r = { ok: true, state: woven, line: weaveLine(weave) };
        }
      } else if (what === 'spend') {
        about = 'spend';
        r = P.spendPoint(s, String(parts[2] || '').toLowerCase(), parts[3]);
      } else {
        toProfile(profileId, 'Pick what? class, profession, spell, staffspell or town.');
        return true;
      }
    } else {
      about = 'spend';
      r = P.spendPoint(s, String(parts[1] || '').toLowerCase(), parts[2]);
    }

    if (!r.ok) {
      toProfile(profileId, 'No: ' + r.why + '.');
      // The same word to the panel, through the property, since a refusal
      // changes nothing else and the panel would otherwise sit on 'Sent'.
      // about says which pick it answers, so the panel clears that one.
      // Always sent, even when it is the same refusal as a moment ago and the
      // panel is already showing it: a refusal is an answer to something
      // somebody just pressed, and an answer that arrives sometimes is worse
      // than no answer at all.
      s.note = { text: r.why, at: Date.now(), about: about };
      writeState(actorId, s, true);
      clog(word, parts.slice(1).join(' '), 'for', actorId.toString(16), 'refused:', r.why);
      return true;
    }
    r.state.note = null;
    var st = writeState(actorId, r.state);
    clog(word, parts.slice(1).join(' '), 'for', actorId.toString(16), 'accepted');

    /*
      A point spent says what it did when that is more than the panel shows
      (#1385): the perk, the moment a sub-skill fills, and for Precision, that
      the game ignores critical chance. The skill perks block words both.
    */
    if (about === 'spend') {
      var PK = g.__thornswoodPerks;
      var spentIn = String((word === '/pick' ? parts[2] : parts[1]) || '').toLowerCase();
      var spentLine = (PK && PK.spendLine) ? PK.spendLine(st, spentIn) : '';
      if (spentLine) { toProfile(profileId, spentLine); }
    }

    /*
      A NEW FARMER GETS SEED. Patrick, 20 September: 'to make it so they can
      become full we could give farmers a few starting crops or something'.

      Here because this is the moment the server learns that somebody has become
      a Farmer, and it cannot run twice: this line is past the refusal above, and
      pickClass refuses a second class for the life of the character, so nobody
      can stand here collecting seed.

      IT IS NO LONGER THE ONLY DOOR, and that is the correction of 20 September.
      Being the only one meant two groups of Farmers could never farm: anybody
      who picked the class on an earlier build, because they have a character
      property so migrate() never runs for them and their pick is long past, and
      anybody who lost the nine crops they were handed, because nothing else in
      the server can give them one. Both of them now ask at a plot: offerSeed in
      the farming block hands seed to a Farmer whose pack holds no produce of any
      crop, at /plant, no more often than TUNING.farming.seedAgainHours. It is
      still never handed out from a read, which is what migrate() would have
      been: migrate runs inside stateOf, which every gate and every press calls,
      and handing out inventory from a read is how a pack quietly fills up.
    */
    if (about === 'class' && st.cls === 'farmer') {
      var farming = g.__thornswoodFarming;
      if (farming && farming.giveSeeds) {
        try {
          var seeded = farming.giveSeeds(actorId);
          if (seeded) { toProfile(profileId, seeded); }
        } catch (eSeed) {
          clog('could not give starting seed to', actorId.toString(16) + ':', eSeed);
        }
      }
    }

    /*
      THE TOOL THE WORK NEEDS, handed over at the pick.

      Patrick, 20 September: 'if you choose miner you should start with a
      pickaxe, unequipped is fine just in the inventory, the woodworker needs to
      start with an axe', and 'to be able to farm you need a hoe so give farmers
      a hoe'. Skyrim has no hoe and the farmer gets a shovel; the whole of that
      is written out over TOOLS.

      Here for the same reason the seed is here: this is the moment the server
      learns somebody has become a Miner, a Woodworker or a Farmer, and it
      cannot run twice, because this line is past the refusal above and neither
      pickClass nor pickProfession will take a second one.

      IT IS NOT THE ONLY DOOR, and it must not be. Every character that exists
      today picked their class before any of this was written, so the pick is
      long behind them and nothing here would ever reach them. toolGate at the
      seam, the kiln and the plot is the way back, exactly as offerSeed is the
      way back for the seed, and it is what keeps a required tool from being a
      class taken away from the people who already chose it.

      THE BENCH TRADES' TOOLS TOO (#3162, #3166). Patrick, 22 October 2026: a new
      character gets the basic tool for the profession they pick. The Smith,
      Tailor, Cook, Alchemist and Enchanter each have a tool in TOOLS since
      #3162, so their pick hands it over here the way the Miner's does: a
      hammer, a pair of shears, a wooden ladle, an alembic and a rune knife.

      A class or a profession with no tool of its own falls straight through:
      toolFor answers null and giveTool answers null, and nothing is said.
    */
    if (about === 'class' || about === 'profession') {
      var whose = (about === 'class') ? st.cls : st.prof;
      if (whose) {
        try {
          var handed = giveTool(actorId, whose);
          if (handed) { toProfile(profileId, handed); }
        } catch (eTool) {
          clog('could not give the', whose, 'tool to', actorId.toString(16) + ':', eTool);
        }
      }
    }

    /*
      A spell is the one pick that has to reach the game as well as the
      state. It is put on the character straight away rather than waiting
      for the next spawn, and put back on every spawn after that. A spell
      with no form id yet is in the book and not in the hands, which
      grantSpell says in the log and nothing else notices.
    */
    if (about === 'weave' && r.line) { toProfile(profileId, r.line); }

    if (spellPicked) {
      grantSpell(actorId, spellPicked, true);
      toProfile(profileId, 'You learn ' + spellPicked + '.');
      // The hours a spell is worth in its school can be the ones that reach
      // a threshold, and a rank reached is something a person is told.
      var climbed = raiseLines(actorId, r);
      if (climbed) { toProfile(profileId, climbed); }
    }

    /*
      A staff spell unlocked goes on the character too, by its desc: the
      crafting menu lists a staff only for somebody who holds its spell (the
      recipe's HasSpell), and grantKnown puts it back on every spawn.
    */
    if (staffPicked) {
      try {
        if (typeof spellOn === 'function') { spellOn(actorId, staffPicked.desc, true); }
      } catch (eStaff) {
        clog('could not put staff spell', staffPicked.desc, 'on', actorId.toString(16), eStaff);
      }
      var left = P.staffPoints(st);
      toProfile(profileId, 'You unlock ' + staffPicked.name + ' for staves, and you can bind it into a staff ' +
                'at a staff enchanter now. ' + (left ? left + ' staff spell point' + (left === 1 ? '' : 's') + ' left.'
                                                      : 'No staff spell points left; more come with every Bladebinder rank.'));
    }

    // The home is the one pick that ends creation. Class and profession may
    // still be unset: they are picked in the world, from the same panel, and
    // the rules (pickClass, pickProfession) refuse only a second one.
    if (creating && st.home) {
      if (chargen.arrive(actorId, st.home)) {
        // Written again so the panel hears creating is over and closes.
        writeState(actorId, st);
        clog('creation finished for', actorId.toString(16) + ':', (st.cls || 'no class yet') + ',',
             (st.prof ? st.prof + (st.half ? '/' + st.half : '') + (st.schools && st.schools.length ? '/' + st.schools.join('+') : '') : 'no profession yet') +
             ', home', st.home);
      }
    }
    return true;
  }

  /*
    The hall calls this when the face is made and on every reminder: one
    property write with creating on, which the client script turns into the
    panel opening. Nothing to decide here; the state is whatever it was.
  */
  function beginCreation(actorId) {
    // Always a redraw. A reminder is the same state as the reminder before it,
    // so a write that only goes out when something changed would send the
    // first one and none of the others, and the panel would never re-open for
    // somebody who closed it while they were still choosing. A redraw carries
    // asked, so the client's script draws it and opens the panel (#1730).
    writeState(actorId, stateOf(actorId), true);
  }

  /*
    SOMEBODY HAS COME INTO THE WORLD (#1642): the K panel's view, worked out
    now. Called from the chargen tick's first sight of them after a server
    start or a login, the hook the spells and the clothes ride on. A hot
    reload is neither (#3154): the running effects' state is on globalThis
    (__thornswoodPerkState, __thornswoodManeuverState), so the view they
    were last sent still holds.

    The view is kept on the character, and the map the client applies is in
    it (effects): the tree, what the needs take off, and what a running
    effect adds, a warrior's Rush, Font of Magic and restoration strain. Each
    of those runs in memory and ends on a timer that sends the view again
    without it. A restart loses the timers and leaves the stored view carrying
    the effect. skymp5-client reconnects by itself after a restart, with the
    page and the panel still up, so the game keeps the speed or the free
    spells it was last sent, and nothing on it asks for the view again. So
    the view a person gets on arrival is the one worked out at this moment,
    out of what is running now, which after a restart is nothing. Not a
    redraw: it is sent when it is not the view this server last sent them,
    and after a restart this server has sent them none.

    Somebody still being made is left to the creation hall, which sends
    theirs on its first pass after the settle (beginCreation).

    Withered (#1387) is the one that is kept on the character rather than in
    memory, because it lasts 30 real minutes: it is in the view while it runs,
    and its end is armed here, in this process, before the view is worked out.
  */
  function arrival(actorId) {
    var chargen = g.__thornswoodChargen;
    if (chargen && chargen.isChoosing && chargen.isChoosing(actorId)) { return null; }
    var college = g.__thornswoodCollege;
    if (college && college.witheredAtLogin) {
      try { college.witheredAtLogin(actorId); } catch (e) { clog('withered at arrival threw for', actorId.toString(16) + ':', e); }
    }
    // The game is taught what the character knows of alchemy (#3134).
    var alchemy = g.__thornswoodAlchemy;
    if (alchemy && alchemy.arrival) {
      try { alchemy.arrival(actorId); } catch (e) { clog('alchemy at arrival threw for', actorId.toString(16) + ':', e); }
    }
    return writeState(actorId, stateOf(actorId));
  }

  g.__thornswoodCharacter = {
    PROPERTY: CHAR_PROPERTY, stateOf: stateOf, writeState: writeState,
    forPanel: forPanel, mapHalf: mapHalf, migrate: migrate, command: command,
    beginCreation: beginCreation, arrival: arrival, updateOwnerScript: updateOwnerScript,
    gate: gate, gateHalf: gateHalf, credit: credit,
    grantSpell: grantSpell, grantKnown: grantKnown, nameOf: nameOf, raiseLines: raiseLines,
    acceptApprentice: acceptApprentice, masterFor: masterFor, effectsOf: effectsOf,
    masterRecord: masterRecord, takeOnMark: takeOnMark, weaveOf: weaveOf,
    rankOf: function (actorId, key) { return P.rankOf(stateOf(actorId), key); }
  };
  clog('ready');
})();
// ==== end thornswood character ====

