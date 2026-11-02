// ==== thornswood property ====
/*
  PROPERTY: CLAIMING A BUILDING, AND THE DEED THAT SAYS SO.

  Settled with Patrick on 21 September, and every sentence here is one of his:
  every building in the game is claimable, shops and halls and palaces included,
  so people can lock doors and own shops. Claiming costs nothing, and that holds
  even for a building the city owns but is not renting out: somebody can claim it
  for nothing and it becomes the city's problem to solve, which is the point. You
  may hold more than one, and disputes are the court's problem rather than the
  server's. A home and its farm are one claim. A claim lapses after two weeks.
  Claiming hands you the deed there and then, which is why it has to happen at
  the door.

  WHAT THIS BLOCK IS. It began as the claim, the deed and the lapse. Locks,
  keys and key molds (#615, #1637), the master key (#2254), the hold offices
  (#2551), rent, the drop box (#2298), beds (#1603) and the notice boards
  (#1627) have joined it since, each with its own note further down.

  WHERE THE DOOR COMES FROM. mp.onActivate is handed the door, so the door a
  person last opened is written on them and the lock key's Claim, which sends
  /claim (#1637), reads it back. That is why
  there is no proximity search here: the engine has already told us which door
  they touched, and searching for the nearest one would be a worse answer to a
  question already answered. A door touched longer ago than DOOR_MEMORY_MS does
  not count, so a /claim that reaches the server from a field claims no house.

  A DEED IS ONE RECORD. ThornswoodBookDeed, and the property it is for is the
  per-instance name on the inventory entry: Inventory::Entry in the fork carries
  an optional name, serialised by name in Inventory.h, so one book becomes 'Deed
  to Breezehome' in one pack and 'Deed to Honeyside' in another. 852 buildings,
  one record.

  THE SERVER KEEPS ITS OWN RECORD of every claim it made, in private/property.json
  (registerPath, #541),
  and that record is what decides who holds a building. The deed in somebody's
  pack is the thing that can be stolen; it is not the register. A book somebody
  renamed by hand is not a deed, because the server never issued it.
*/
(function () {
  'use strict';
  var g = globalThis;
  function plog() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[property]');
    console.log(a.join(' '));
  }

  /* The deed record. One for the whole game; see the block comment. */
  var DEED = '15493:Thornswood-Content.esp';

  /*
    How long after opening a door /claim still means that door. A minute.

    INVENTED, and the argument is that it is long enough to open a door, read
    what the server said and type six characters, and short enough that a door
    opened on the way past cannot be claimed from the other side of a town.
  */
  var DOOR_MEMORY_MS = 60000;

  /* Where the last door somebody touched is written. Invisible to everybody:
     nothing on the client reads it and nobody standing next to you has any
     business knowing which doors you have been trying. */
  var DOOR_PROPERTY = 'thornswoodDoor';

  /*
    THE LINE AT THE DOOR (#1637). Patrick, 4 October: no chat commands for
    anything people do. So the door you just opened says what the lock key
    will do there, and the key does it: Claim when nobody holds the building,
    Lock or Unlock when it is yours. The client cannot know any of that, since
    a door is one of 4,891 and the register is here, so this is written to the
    person on every door they open and again after every press, and their
    client draws the line while one of that building's doors is under the
    crosshair. Visible to its owner only, for the reason the lock list is.
  */
  var DOOR_LINE_PROPERTY = 'thornswoodDoorLine';

  function ready() {
    try {
      mp.makeProperty(DOOR_PROPERTY, {
        isVisibleByOwner: false, isVisibleByNeighbors: false,
        updateOwner: '', updateNeighbor: ''
      });
    } catch (e) { /* already made by a previous load. harmless. */ }
    try {
      mp.makeProperty(BENCH_PROPERTY, {
        isVisibleByOwner: false, isVisibleByNeighbors: false,
        updateOwner: '', updateNeighbor: ''
      });
    } catch (e) { }
    try {
      /*
        The one property here the client reads. Visible to its owner and to
        nobody else: which doors are shut to you is nobody else's business, and
        telling a neighbour would be telling them which houses you cannot get
        into. The script cannot be changed once the property is made, so a
        changed lockScript needs a server restart, which a deploy is.
      */
      mp.makeProperty(LOCK_PROPERTY, {
        isVisibleByOwner: true, isVisibleByNeighbors: false,
        updateOwner: lockScript(), updateNeighbor: ''
      });
    } catch (e) { }
    try {
      mp.makeProperty(DOOR_LINE_PROPERTY, {
        isVisibleByOwner: true, isVisibleByNeighbors: false,
        updateOwner: doorLineScript(), updateNeighbor: ''
      });
    } catch (e) { }
  }

  /*
    TWO WEEKS, AND IT IS THE FARM'S NUMBER RATHER THAN A SECOND ONE.

    Patrick settled two weeks for property on 21 September and
    TUNING.farming.claimLapseDays has read 14 since farming was built. A home and
    its farm are one claim, so two numbers that are meant to be the same number
    would be a bug waiting for somebody to move one of them. This reads the
    farming one, and falls back to 14 only when the progression block is not
    loaded at all.
  */
  function lapseDays() {
    var P = g.__thornswoodProgression;
    try {
      var n = P.TABLE.tuning.farming.claimLapseDays;
      if (typeof n === 'number' && n > 0) { return n; }
    } catch (e) { }
    return 14;
  }

  // ----------------------------------------------------------- the register --

  function registerPath() {
    // In the private folder, not data. Issue #541, 25 September: the
    // resources server hands anything under data to anybody who asks, and
    // every record here carries the profile id of the person it belongs to,
    // which is what the door checks. Measured the same day: the live
    // property.json answered 200 on port 3000. The door list moved for the
    // same reason (privDir, above). Nothing is read from data: the alpha
    // carries no data over a change (#3094).
    var privDir = 'private';
    try {
      var cfg = JSON.parse(require('fs').readFileSync('server-settings.json', 'utf8'));
      if (cfg && cfg.privDir) { privDir = String(cfg.privDir); }
    } catch (e) { }
    return require('path').join(privDir, 'property.json');
  }

  /*
    The register off disk, rebuilt field by field rather than trusted whole.

    Same discipline as the farming block's claims and for the same reason: a
    record that goes back out through JSON.stringify must not be able to carry a
    function, a prototype member or anything else that was never a claim.
    '__proto__' is skipped by name, because assigning to it on a plain object
    sets the prototype rather than a key.
  */
  function load() {
    var out = {};
    var raw = null;
    try { raw = JSON.parse(require('fs').readFileSync(registerPath(), 'utf8')); }
    catch (e) { return out; }
    var held = (raw && typeof raw === 'object' && raw.claims &&
                typeof raw.claims === 'object') ? raw.claims : {};
    var kept = 0, dropped = 0;
    for (var k in held) {
      if (!Object.prototype.hasOwnProperty.call(held, k)) { continue; }
      if (k === '__proto__') { continue; }
      var c = held[k];
      if (!c || typeof c !== 'object') { dropped++; continue; }
      var by = Number(c.by) || 0;
      var at = Number(c.at) || 0;
      var touched = Number(c.touched) || at;
      if (!by || !at) { dropped++; continue; }
      /*
        THREE FIELDS THAT WERE WRITTEN AND NEVER READ BACK, AND A RESTART ATE
        ALL THREE.

        save() writes the whole claim object, so locked, ground and rent were
        on disk the whole time. This rebuilt each row field by field, which is
        the right discipline and the reason nothing malformed ever gets in, and
        it only ever copied four of them. So every deploy and every restart
        silently unlocked every locked house, broke every home-and-farm link
        back into two claims, and wiped every rent record and the arrears with
        it. Nothing said a word, because a claim with no lock is a perfectly
        valid claim.

        Found by the audit of 21 September. Each one is rebuilt rather than
        trusted, the same as the four above: a lock is a boolean, ground has to
        look like ground, and a rent row has to be four numbers.
      */
      var row = { by: by, name: String(c.name || 'somebody'), at: at, touched: touched,
                  locked: !!c.locked };

      // Ground is a cell descriptor and a point in it, or it is not ground.
      if (c.ground && typeof c.ground === 'object' && c.ground.cell &&
          Object.prototype.toString.call(c.ground.pos) === '[object Array]' &&
          c.ground.pos.length === 3) {
        row.ground = { cell: String(c.ground.cell),
                       pos: [Number(c.ground.pos[0]) || 0,
                            Number(c.ground.pos[1]) || 0,
                            Number(c.ground.pos[2]) || 0] };
      } else if (typeof c.ground === 'string' && c.ground) {
        // The farming block's own shape, which is a plot key.
        row.ground = c.ground;
      }

      // Rent is an amount, a period, what is owed and when it was last counted.
      if (c.rent && typeof c.rent === 'object') {
        var amount = Number(c.rent.amount) || 0;
        if (amount > 0) {
          row.rent = { amount: amount,
                       everyDays: Number(c.rent.everyDays) || 7,
                       owed: Number(c.rent.owed) || 0,
                       since: Number(c.rent.since) || at };
        }
      }

      // The master key cut for this holding (#2254): whose and which number.
      if (c.master && typeof c.master === 'object' && Number(c.master.for) > 0 &&
          Number(c.master.no) > 0) {
        row.master = { for: Number(c.master.for), no: Number(c.master.no) };
      }

      out[k] = row;
      kept++;
    }
    if (dropped) { plog('dropped', dropped, 'row(s) that were not claims'); }
    plog('read', kept, 'claim(s)');
    return out;
  }

  function save() {
    try {
      var dir = require('path').dirname(registerPath());
      try { require('fs').mkdirSync(dir, { recursive: true }); } catch (e) { }
      require('fs').writeFileSync(registerPath(),
        JSON.stringify({ claims: claims, arrears: arrears,
                        funds: funds, notices: notices, boards: boards, steps: steps,
                        masters: masterCut, dropbox: dropbox, word: wordBook }, null, 1));
      return true;
    } catch (e) {
      plog('could not write the register:', e);
      return false;
    }
  }

  var claims = load();
  var arrears = loadArrears();
  var masterCut = loadMasterCut();
  var wordBook = loadWord();

  /*
    RENT STILL OWED BY SOMEBODY WHO NO LONGER HOLDS THE PLACE (#3893), from
    the register's arrears key: by building, one row a person, with the
    profile, the character's name, the gold and when it was first owed.

    Rent owed was a field of the claim and nothing else, so the deed
    presented at the door, which writes the building a new claim, ended the
    debt with the old one. Patrick, 27 Oct: the debt stays owed by whoever
    owed it, and the new holder starts at nothing owed. So what the old
    holder owed moves here, beside the claims rather than inside one,
    because a claim can end or be written again and a debt is a person's.
    The drop box pays it (boxPutGold) and so does a steward's Rent paid
    (rentPaid), and the steward sees it at the door on the Office page.

    Rebuilt row by row the way the claims are: a row that is not a debt is
    dropped and counted.
  */
  function loadArrears() {
    var out = {};
    var raw = null;
    try { raw = JSON.parse(require('fs').readFileSync(registerPath(), 'utf8')); } catch (e) { return out; }
    var src = (raw && raw.arrears && typeof raw.arrears === 'object') ? raw.arrears : {};
    var kept = 0, dropped = 0;
    for (var b in src) {
      if (!Object.prototype.hasOwnProperty.call(src, b) || b === '__proto__') { continue; }
      var list = Object.prototype.toString.call(src[b]) === '[object Array]' ? src[b] : [];
      var rows = [];
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        var by = (r && Number(r.by)) || 0;
        var owed = (r && Number(r.owed)) || 0;
        var at = (r && Number(r.at)) || 0;
        if (!(by > 0) || !(owed > 0) || !(at > 0) || rows.some(function (x) { return x.by === by; })) {
          dropped++;
          continue;
        }
        rows.push({ by: by, name: String(r.name || 'somebody'), owed: owed, at: at });
        kept++;
      }
      if (rows.length) { out[b] = rows; }
    }
    if (dropped) { plog('dropped', dropped, 'row(s) of rent still owed that were not debts'); }
    if (kept) { plog('read', kept, 'debt(s) of rent owed by somebody who no longer holds the place'); }
    return out;
  }

  // What this person still owes on this building from before, or null.
  function arrearsRow(building, profileId) {
    if (!Object.prototype.hasOwnProperty.call(arrears, building)) { return null; }
    var list = arrears[building];
    for (var i = 0; i < list.length; i++) {
      if (list[i].by === Number(profileId)) { return list[i]; }
    }
    return null;
  }

  // Owed from before, added to whatever this person already owes here.
  function arrearsAdd(building, profileId, name, amount) {
    var n = Number(amount) || 0;
    var by = Number(profileId) || 0;
    if (!(n > 0) || !(by > 0) || building === '__proto__') { return; }
    var row = arrearsRow(building, by);
    if (row) {
      row.owed += n;
      if (name) { row.name = String(name); }
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(arrears, building)) { arrears[building] = []; }
    arrears[building].push({ by: by, name: String(name || 'somebody'), owed: n, at: Date.now() });
  }

  // Paid down by up to amount; the row goes when nothing is left. Says how much it took.
  function arrearsPay(building, profileId, amount) {
    var row = arrearsRow(building, profileId);
    var n = Number(amount) || 0;
    if (!row || !(n > 0)) { return 0; }
    var take = Math.min(n, row.owed);
    row.owed -= take;
    if (row.owed <= 0) {
      arrears[building] = arrears[building].filter(function (x) { return x !== row; });
      if (!arrears[building].length) { delete arrears[building]; }
    }
    return take;
  }

  /*
    The holders' word (#2680), from the register's word key, rebuilt row by
    row the way the claims are: a row that is not a word is dropped and
    counted. See word to the holder. Plain numbers here, because this runs
    before that section's own values are set.
  */
  function loadWord() {
    var out = { list: [] };
    var raw = null;
    try { raw = JSON.parse(require('fs').readFileSync(registerPath(), 'utf8')); } catch (e) { return out; }
    var src = (raw && raw.word && typeof raw.word === 'object' &&
               Object.prototype.toString.call(raw.word.list) === '[object Array]') ? raw.word.list : [];
    var dropped = 0;
    for (var i = 0; i < src.length; i++) {
      var w = wordRow(src[i]);
      if (w) { out.list.push(w); } else { dropped++; }
    }
    if (dropped) { plog('word: dropped', dropped, 'row(s) of the holders\' word that were not words'); }
    if (out.list.length) { plog('word: read', out.list.length, 'word(s) for holders'); }
    return out;
  }
  function wordRow(r) {
    if (!r || typeof r !== 'object') { return null; }
    var kind = (r.kind === 'pick' || r.kind === 'deed') ? r.kind : null;
    var building = typeof r.building === 'string' ? r.building : '';
    var holder = Number(r.holder) || 0;
    var at = Number(r.at) || 0;
    var last = Number(r.last) || at;
    var due = Number(r.due) || 0;
    if (!kind || !building || building === '__proto__' || !(holder > 0) || !(at > 0) ||
        !(due > 0) || last < at) { return null; }
    var by = [];
    var rb = Object.prototype.toString.call(r.by) === '[object Array]' ? r.by : [];
    for (var b = 0; b < rb.length && by.length < 10; b++) {
      var p = Number(rb[b]) || 0;
      if (p > 0 && by.indexOf(p) === -1) { by.push(p); }
    }
    var looks = [];
    var rl = Object.prototype.toString.call(r.looks) === '[object Array]' ? r.looks : [];
    for (var j = 0; j < rl.length && looks.length < 3; j++) {
      var s = String(rl[j] || '').slice(0, 40);
      if (s && looks.indexOf(s) === -1) { looks.push(s); }
    }
    var count = Math.floor(Number(r.count)) || 1;
    return { kind: kind, building: building, holder: holder, by: by, at: at, last: last,
             count: Math.max(1, Math.min(99, count)), due: due, looks: looks,
             sent: Number(r.sent) > 0 ? Number(r.sent) : 0 };
  }

  /*
    The last number a master key was cut with (#2254), from the register. Never
    lower than any number a claim still names, so a register written before
    the counter was can never hand out a number already in somebody's pack.
    See MASTER KEYS in locks and keys.
  */
  function loadMasterCut() {
    var top = 0;
    try {
      var raw = JSON.parse(require('fs').readFileSync(registerPath(), 'utf8'));
      top = Number(raw && raw.masters) || 0;
    } catch (e) { top = 0; }
    for (var b in claims) {
      if (!Object.prototype.hasOwnProperty.call(claims, b)) { continue; }
      var m = claims[b] && claims[b].master;
      if (m && m.no > top) { top = m.no; }
    }
    return top;
  }

  /*
    STEPS THAT RUN ONCE ON THE REGISTER, and the mark that each has run.
    steps.<name> is the time it ran. A step reads its mark at server start,
    runs only when the mark is missing, and writes the mark in the same save
    as what it changed, so it never runs twice and never needs a timer.
  */
  var steps = (function () {
    var out = {};
    var raw = null;
    try { raw = JSON.parse(require('fs').readFileSync(registerPath(), 'utf8')); } catch (e) { return out; }
    var st = (raw && raw.steps && typeof raw.steps === 'object') ? raw.steps : {};
    for (var k in st) {
      if (Object.prototype.hasOwnProperty.call(st, k) && k !== '__proto__' && Number(st[k]) > 0) {
        out[k] = Number(st[k]);
      }
    }
    return out;
  })();

  /*
    ------------------------------------------------------------ the offices

    THE HOLD OFFICES ARE DISCORD ROLES (#2551). Patrick, 15 October:
      - a Jarl's hold comes from their "Jarl of <Hold>" Discord role, and
        nobody picks a hold in the game;
      - if two accounts hold the same hold's Jarl role, neither acts as Jarl
        until staff fix it, and staff are told which accounts clash;
      - each hold has a Court ("<Hold> Court"), a Steward ("Steward of
        <Hold>", in place of the one shared steward office this block kept
        in property.json) and Guards ("Guard of <Hold>"), all Discord roles;
      - that hold's Jarl gives and takes those three, for their own hold
        only: from the bot's office panel in Discord, and here, on the Office
        page of K, where the game asks the site and the bot's account sets
        the role, so the role stays the one truth.

    So the role is the one truth for who may hold an office. The door reads
    every account's roles from the site with the other roles
    (__thornswoodOffices), this block keeps only which character of the
    account holds it (below), and officeOf is the one place anything asks.
    The seat each hold's Jarl had in law.json (#2508), the hold chosen on the
    Office page (#2476), the stewards in property.json and the guards in
    law.json are gone; a law.json or property.json written before still
    carries them, nothing reads them, and the next write leaves them out.

    THE OFFICE IS ONE CHARACTER'S (Patrick, 16 October: "it's character
    based not account based"). A Discord role is on the account, and
    Discord has no characters, so the role says which account may hold the
    office and the law register says which one of its characters does
    (law.held: office and hold, then account, to { pid, name, at }). Only
    that character acts in the office; every other character on the
    account is ordinary. The character is set in the game, never typed:
      - the Jarl names a character on the Office page (officeCmd), and the
        site sets the role on that character's account;
      - a role given anywhere else (the bot's office panel, staff) names
        only an account, and its holder presses Hold it on the character
        that is to hold it (/office hold); pressing it on another of the
        account's characters moves the office there.
    The role and the character cannot disagree in silence: the office needs
    both, so a role taken away ends it at once, and when the roles are read
    again (rolesRead) a record whose account no longer holds the role is
    deleted and said in the log, so a role given back later is chosen again.
    A Jarl role two accounts hold is left alone while they clash.

    NOBODY IS AN OFFICER BY BEING STAFF. An admin without the role holds no
    office: the role decides who is Jarl. Patrick's rule of 21 September,
    "admins only overlook the RP and not get involved on their admin
    characters", now holds for every office.

    A STEWARD IS NOT AN ADMIN and carries no admin power. The only thing a
    steward can do that nobody else can is end a claim, which is the city
    taking a house back. They cannot make one, cannot lock one, and cannot see
    anybody's pack.

    The ten holds are the ledgers' (HOLD_TOWN below), Raven Rock's with them
    (Patrick, 16 October: Raven Rock gets its Jarl, Court, Steward and Guard
    roles like the nine).
  */
  var OFFICE_KINDS = ['jarl', 'court', 'steward', 'guard'];
  // The three a Jarl gives and takes, and what each is called on the page.
  var OFFICE_GIVEN = { court: 'Court', steward: 'Steward', guard: 'Guard' };

  /*
    The office roles this profile's account holds, as the door read them:
    { jarl, court, steward, guard }, each a list of holds. Only for a profile
    the pass has proved, unless onRecord: a record the server already holds
    (who held a jail claim, whose record is still good), never a press.
  */
  function rolesOfProfile(profileId, onRecord) {
    var out = { jarl: [], court: [], steward: [], guard: [] };
    var fn = g[onRecord ? '__thornswoodOfficesOnRecord' : '__thornswoodOffices'];
    var got = null;
    try { got = (typeof fn === 'function') ? fn(Number(profileId) || 0) : null; } catch (e) { got = null; }
    for (var i = 0; got && i < OFFICE_KINDS.length; i++) {
      var list = Array.isArray(got[OFFICE_KINDS[i]]) ? got[OFFICE_KINDS[i]] : [];
      for (var j = 0; j < list.length; j++) {
        var h = String(list[j]);
        if (Object.prototype.hasOwnProperty.call(HOLD_TOWN, h) && out[OFFICE_KINDS[i]].indexOf(h) === -1) {
          out[OFFICE_KINDS[i]].push(h);
        }
      }
    }
    return out;
  }

  /* The Discord account a profile is on; a profile the list ties to no account is an account of its own. */
  function officeAccountOf(profileId) {
    var fn = g['__thornswoodAccountOf'];
    var a = '';
    try { a = (typeof fn === 'function') ? String(fn(Number(profileId) || 0) || '') : ''; } catch (e) { a = ''; }
    return a || ('p:' + (Number(profileId) || 0));
  }

  /* Which character of this account holds this office of this hold: { pid, name, at }, or null. */
  function officeHeldBy(office, hold, account) {
    var row = law.held[office + ':' + hold];
    return (row && Object.prototype.hasOwnProperty.call(row, account)) ? row[account] : null;
  }

  /*
    Every office this character holds: the roles of its account, and of
    those only the ones the register says this character holds.
  */
  function officesOfProfile(profileId, onRecord) {
    var pid = Number(profileId) || 0;
    var out = { jarl: [], court: [], steward: [], guard: [] };
    if (!pid) { return out; }
    var roles = rolesOfProfile(pid, onRecord);
    var acct = officeAccountOf(pid);
    for (var i = 0; i < OFFICE_KINDS.length; i++) {
      var k = OFFICE_KINDS[i];
      for (var j = 0; j < roles[k].length; j++) {
        var rec = officeHeldBy(k, roles[k][j], acct);
        if (rec && rec.pid === pid) { out[k].push(roles[k][j]); }
      }
    }
    return out;
  }

  /* The offices this character's account holds that this character does not: the ones it may hold here. */
  function officesToHold(profileId) {
    var pid = Number(profileId) || 0;
    var out = [];
    if (!pid) { return out; }
    var roles = rolesOfProfile(pid);
    var acct = officeAccountOf(pid);
    for (var i = 0; i < OFFICE_KINDS.length; i++) {
      var k = OFFICE_KINDS[i];
      for (var j = 0; j < roles[k].length; j++) {
        var rec = officeHeldBy(k, roles[k][j], acct);
        if (!rec || rec.pid !== pid) { out.push({ office: k, hold: roles[k][j], by: rec }); }
      }
    }
    return out;
  }

  /* Whether this character holds this office of this hold. */
  function holdsOffice(profileId, office, hold) {
    var pid = Number(profileId) || 0;
    if (!pid || !hold) { return false; }
    var o = officesOfProfile(pid);
    return Array.isArray(o[office]) && o[office].indexOf(String(hold)) !== -1;
  }

  /** The Jarl of exactly this hold, by the "Jarl of <Hold>" role. */
  function isJarlOf(profileId, hold) { return holdsOffice(profileId, 'jarl', hold); }

  /** The holds this profile is Jarl of. */
  function jarlHoldsOf(profileId) { return officesOfProfile(profileId).jarl; }

  /** Jarl of any hold. */
  function isJarl(profileId) { return jarlHoldsOf(profileId).length > 0; }

  /** On the Court of exactly this hold. */
  function isCourtOf(profileId, hold) { return holdsOffice(profileId, 'court', hold); }

  /** The Steward of exactly this hold, or its Jarl, who keeps the hold too. */
  function isStewardOf(profileId, hold) {
    return holdsOffice(profileId, 'steward', hold) || isJarlOf(profileId, hold);
  }

  /** The holds this profile keeps as a steward: those it is Steward of, and those it is Jarl of. */
  function stewardHoldsOf(profileId) {
    var o = officesOfProfile(profileId);
    var out = o.steward.slice();
    for (var i = 0; i < o.jarl.length; i++) { if (out.indexOf(o.jarl[i]) === -1) { out.push(o.jarl[i]); } }
    return out;
  }

  /** A steward of any hold, or a Jarl. */
  function isSteward(profileId) { return stewardHoldsOf(profileId).length > 0; }

  /*
    ------------------------------------------------------- guards and cells

    #502. Patrick, 11 October: "jail cells should be usable by guards and
    guards should have jail cell access and the ability to remove posts from
    a notice board for all of these only wiithin their own hold tho", and
    "guards will be players no NPC guards". So a guard is a person in a
    guard's office, of one hold, and every power below is checked against
    that hold.

    A HOLD is the town key the boards and the ledgers use (LEDGER_HOLDS):
    whiterun, solitude, riften, markarth, windhelm, falkreath, morthal,
    dawnstar, winterhold, ravenrock. A jail's hold comes from the world: the
    hold's crime faction names its jail marker, and the jail is the room
    holding the door that leads to it (scripts\dev\Build-JailTable.py, which
    writes JAIL_CELLS below and game\data\jails.json).

    THE REGISTER is law.json beside property.json, in the private folder:
    every cell door a guard has turned, locked or not. Kept apart from
    property.json because none of it is property: a cell is the hold's,
    whoever claims the building it is in.

    WHO IS A GUARD. Patrick, 15 October (#2551): a guard holds that hold's
    "Guard of <Hold>" Discord role, which the hold's Jarl gives and takes,
    from the bot's office panel or the Office page of K (officeCmd). The role
    is the one truth, so the register keeps no guards (it did from #502 to
    #2551); isGuard reads the role through officesOfProfile.

    A CELL IS THE ONE LOCK THAT SHUTS PEOPLE IN. Every other lock here keeps
    people out and never shuts them in (shutFor, WAY_OUT); a cell door is a
    way out of the jail building, so a claim's lock never turns on one. A
    jail is for shutting somebody in, which is what Patrick asked for, so
    the cells have their own lock, and only a guard of the hold turns it.
    The two halves are the house lock's: the doors shut to a person are
    pushed to their game, which locks them there and keeps lockpicking, and
    a press on a shut cell that reaches the server anyway is refused
    (mayPassCell, in onActivate). A guard of the hold always has every cell
    of their hold open in their own game. A cell no guard has turned is as
    the game ships it, and the server pushes nothing for it.
  */
  // Written by scripts\dev\Build-JailTable.py from the load order into
  // their table files. JAIL_DOOR: every door inside a hold's jail, to the hold.
  // JAIL_NAME: each hold's jail, by name. JAIL_SHUT: the doors the game
  // ships locked, which is what a cell is until a guard turns it.
  // JAIL_BUILDING: each jail building, to its hold. JAIL_KEY: every key
  // the game made for a cell door, to the hold of its jail.
  var JAIL_DOOR = table('JAIL_DOOR');
  var JAIL_NAME = table('JAIL_NAME');
  var JAIL_SHUT = table('JAIL_SHUT');
  var JAIL_BUILDING = table('JAIL_BUILDING');
  var JAIL_KEY = table('JAIL_KEY');

  function lawPath() {
    var path = require('path');
    return path.join(path.dirname(registerPath()), 'law.json');
  }

  /*
    The register off disk, rebuilt field by field the way load() rebuilds a
    claim: a cell is a door in JAIL_DOOR with a yes or a no, and a held
    office (#2551) is one of the four offices of one of the ten holds, by
    account, naming a profile above 0. Anything else is dropped and counted,
    never trusted. A register written before #2551 also carries the guards
    and each hold's Jarl seat; nothing reads them, the roles and the held
    offices say who holds an office, and they are not written back.
  */
  function loadLaw() {
    var out = { cells: {}, held: {} };
    var raw = null;
    try { raw = JSON.parse(require('fs').readFileSync(lawPath(), 'utf8')); }
    catch (e) { return out; }
    var dropped = 0;
    var cs = (raw && raw.cells && typeof raw.cells === 'object') ? raw.cells : {};
    for (var d in cs) {
      if (!Object.prototype.hasOwnProperty.call(cs, d)) { continue; }
      if (Object.prototype.hasOwnProperty.call(JAIL_DOOR, d)) { out.cells[d] = cs[d] === true; }
      else { dropped++; }
    }
    // Which character of an account holds each office (#2551). The ten
    // holds are JAIL_NAME's here: HOLD_TOWN is set further down the block.
    var hs = (raw && raw.held && typeof raw.held === 'object') ? raw.held : {};
    var heldRows = 0;
    for (var key in hs) {
      if (!Object.prototype.hasOwnProperty.call(hs, key)) { continue; }
      var bits = String(key).split(':');
      var accounts = hs[key];
      if (bits.length !== 2 || ['jarl', 'court', 'steward', 'guard'].indexOf(bits[0]) === -1 ||
          !Object.prototype.hasOwnProperty.call(JAIL_NAME, bits[1]) || !accounts || typeof accounts !== 'object') {
        dropped++;
        continue;
      }
      for (var acct in accounts) {
        if (!Object.prototype.hasOwnProperty.call(accounts, acct) || acct === '__proto__') { continue; }
        var r = accounts[acct];
        var rpid = r ? Number(r.pid) || 0 : 0;
        if (!(rpid > 0)) { dropped++; continue; }
        if (!out.held[key]) { out.held[key] = {}; }
        out.held[key][acct] = { pid: rpid, name: String(r.name || 'somebody').slice(0, 60), at: Number(r.at) || 0 };
        heldRows++;
      }
    }
    if (dropped) { plog('law: dropped', dropped, 'row(s) that were not a cell door or a held office'); }
    plog('law: read', Object.keys(out.cells).length, 'cell door(s) a guard has turned, and', heldRows,
         'office(s) held by a character');
    return out;
  }

  function saveLaw() {
    try {
      var fs = require('fs');
      try { fs.mkdirSync(require('path').dirname(lawPath()), { recursive: true }); } catch (e) { }
      fs.writeFileSync(lawPath(), JSON.stringify({ cells: law.cells, held: law.held }, null, 1));
      return true;
    } catch (e) {
      plog('law: could not write the register:', e);
      return false;
    }
  }

  var law = loadLaw();

  /** A guard of exactly this hold, by the "Guard of <Hold>" role (#2551). */
  function isGuard(profileId, hold) { return holdsOffice(profileId, 'guard', hold); }

  /** The holds this profile guards. */
  function guardHoldsOf(profileId) { return officesOfProfile(profileId).guard; }

  /*
    The ten holds, as the ledgers, the boards, the jails and the office roles
    name them (Build-Discord.py names the role by the town).
  */
  var HOLD_TOWN = {
    whiterun: 'Whiterun', solitude: 'Solitude', riften: 'Riften', markarth: 'Markarth',
    windhelm: 'Windhelm', falkreath: 'Falkreath', morthal: 'Morthal', dawnstar: 'Dawnstar',
    winterhold: 'Winterhold', ravenrock: 'Raven Rock'
  };

  /* The holds whose Jarl role this profile's account holds with another account (#2551). */
  function jarlClashOf(profileId, onRecord) {
    var fn = g['__thornswoodJarlClash'];
    var got = [];
    try { got = (typeof fn === 'function') ? (fn(Number(profileId) || 0, !!onRecord) || []) : []; } catch (e) { got = []; }
    var out = [];
    for (var i = 0; i < got.length; i++) {
      var h = String(got[i]);
      if (Object.prototype.hasOwnProperty.call(HOLD_TOWN, h) && out.indexOf(h) === -1) { out.push(h); }
    }
    return out;
  }

  /*
    EVERY OFFICE A CHARACTER HOLDS, READ IN ONE PLACE. Since #2551 every
    office is a Discord role on the account, which the door reads from the
    site, held by the one character of the account the register names.
    Anything outside this block that asks who holds what (the drop box, the
    jails, the board) asks this, through g.__thornswoodProperty.officeOf, and
    the readers above are the same rule inside the block, so a rule about
    who holds an office is written once.

      jarlOf     the holds this character is Jarl of: its account holds the
                 role, alone, and this is the character that holds it
      courtOf    the holds whose Court this character sits on
      stewardOf  the holds it keeps as a steward: Steward of, and Jarl of
      guardOf    the holds it guards
      toHold     the offices its account holds that another of its
                 characters, or none yet, holds: { office, hold, by }
      clash      the holds whose Jarl role its account holds with another
                 account, so it does not act as their Jarl (Patrick, 15 Oct)
      jarl, steward   whether jarlOf, stewardOf hold anything
  */
  function officeOf(profileId) {
    var o = officesOfProfile(profileId);
    var stewardOf = stewardHoldsOf(profileId);
    return { jarl: o.jarl.length > 0, jarlOf: o.jarl, courtOf: o.court, stewardOf: stewardOf,
             steward: stewardOf.length > 0, guardOf: o.guard, toHold: officesToHold(profileId),
             clash: jarlClashOf(profileId) };
  }

  /*
    THE ROLES WERE READ AGAIN (#2551). The door calls this each time it has
    written a new list from the site, and the block calls it once as it
    loads. A held office whose account no longer holds the role, in Discord,
    ends here: its record goes, the server log says whose and which, the
    character is told if they are in the world, and the cells and pages
    follow. So a role taken away in Discord, by the bot's panel or by hand,
    takes the office from the character at the next read, and a role given
    back later is held again only when somebody chooses the character. A
    Jarl role two accounts hold is left as it is while they clash: neither
    acts, and the one staff leave it with keeps their character.

    It is not a timer and repairs nothing: it is the register reading the
    one truth it hangs off, when that truth arrives.
  */
  function rolesRead() {
    // Only against a list the door has: with none (no door.json, a file that
    // will not read) nothing is known about the roles, and nothing ends.
    var known = g['__thornswoodRolesKnown'];
    var have = false;
    try { have = typeof known === 'function' && !!known(); } catch (e) { have = false; }
    if (!have) { return 0; }
    var ended = [];
    for (var key in law.held) {
      if (!Object.prototype.hasOwnProperty.call(law.held, key)) { continue; }
      var bits = key.split(':');
      var row = law.held[key];
      for (var acct in row) {
        if (!Object.prototype.hasOwnProperty.call(row, acct)) { continue; }
        var rec = row[acct];
        var roles = rolesOfProfile(rec.pid, true);
        var holds = roles[bits[0]].indexOf(bits[1]) !== -1 && officeAccountOf(rec.pid) === acct;
        var clashed = bits[0] === 'jarl' && jarlClashOf(rec.pid, true).indexOf(bits[1]) !== -1;
        if (holds || clashed) { continue; }
        delete row[acct];
        ended.push({ office: bits[0], hold: bits[1], pid: rec.pid, name: rec.name });
      }
      if (!Object.keys(row).length) { delete law.held[key]; }
    }
    if (!ended.length) { return 0; }
    saveLaw();
    pushAll();
    for (var i = 0; i < ended.length; i++) {
      var e = ended[i];
      plog('law: the', officeRole(e.office, e.hold), 'role is no longer on the account of', e.name,
           '(profile ' + e.pid + ') in Discord, so that character holds the office no more');
      var them = onlineActorOf(e.pid);
      var tell = g.__thornswoodToProfile;
      if (them && typeof tell === 'function') {
        tell(e.pid, 'Your account no longer holds the ' + officeRole(e.office, e.hold) +
                     ' role in Discord, so this character is no longer ' + officeRole(e.office, e.hold) + '.');
        redrawPanel(them);
      }
    }
    return ended.length;
  }
  g.__thornswoodRolesRead = function () { rolesRead(); };

  /** The hold whose jail this door is in, or null. */
  function jailHoldOf(doorDesc) {
    var d = String(doorDesc || '');
    return Object.prototype.hasOwnProperty.call(JAIL_DOOR, d) ? JAIL_DOOR[d] : null;
  }

  /*
    THE REST OF THE JAIL RULES (#502). Patrick, 12 October: jails can be
    claimed by the Jarl only, and the rest as written on the issue: no timer,
    release by that hold's guards, lockpicking allowed, the game's jail keys
    open nothing, /stuck does not move someone out of a locked cell, and
    dying in a cell wakes at a temple.

    THE JARL ONLY. A jail building (JAIL_BUILDING, read out of the world with
    the cells) is the Jarl of its hold's to claim, and nobody else's: claim()
    refuses anybody else, the line under the crosshair offers nobody else the
    claim, and a deed presented at its door by anybody else is paper. Read as
    the Jarl of that jail's hold, because the office is of one hold.

    THE GAME'S JAIL KEYS. Each cell door's lock names a key the game made
    (JAIL_KEY), and a key in somebody's pack opens that lock in their own
    game, guard or no guard, because the server never sees a press on a
    locked door. So the keys are not handed out: measured on 12 October, the
    load order has them on the cut guards and jailors, on two quests that do
    not run, in two containers in the editor's test cell, and lying on the
    floor in four places, three of them inside the Morthal, Dawnstar and
    Riften jails. The spoils block leaves a jail key where it lies and takes
    it out of a container, the way it does a sword.

    /STUCK. The server knows the room somebody is in and not which side of a
    cell door they stand, so the rule is kept at the room: in a jail where a
    guard has a cell locked, /stuck does not move anybody but that hold's
    guards (lockedJailHere, asked by the stuck block). Everybody else there
    walks out, or a guard lets them out, or /helpme reaches staff.

    No timer, release by the hold's guards, lockpicking and the temple on
    death are what the cells and the respawn already do; tests/test-502-jail-rules.js
    holds each of them.
  */

  /** The hold whose jail this building is, or null. */
  function jailOfBuilding(building) {
    var b = String(building || '');
    return Object.prototype.hasOwnProperty.call(JAIL_BUILDING, b) ? JAIL_BUILDING[b] : null;
  }

  /** May this person hold this building: anybody, but a jail is its hold's Jarl's alone. */
  function mayHold(actorId, profileId, building) {
    var jh = jailOfBuilding(building);
    return !jh || isJarlOf(profileId, jh);
  }

  /** The hold whose cell door a key the game made opens, or null, by the key's descriptor. */
  function jailKeyHold(keyDesc) {
    var k = String(keyDesc || '');
    return Object.prototype.hasOwnProperty.call(JAIL_KEY, k) ? JAIL_KEY[k] : null;
  }

  /**
   * The jail this person stands in, by name, while a guard has one of its
   * cells locked and they are not a guard of that hold; otherwise null.
   */
  function lockedJailHere(actorId, profileId) {
    var cell = '';
    try { cell = String(mp.get(actorId, 'worldOrCellDesc') || ''); } catch (e) { cell = ''; }
    var hold = jailOfBuilding(cell);
    if (!hold || isGuard(profileId, hold)) { return null; }
    for (var d in law.cells) {
      if (Object.prototype.hasOwnProperty.call(law.cells, d) && law.cells[d] === true && JAIL_DOOR[d] === hold) {
        return JAIL_NAME[hold];
      }
    }
    return null;
  }

  /** Whether a cell door is locked: as a guard last left it, or as the game ships it. */
  function cellLocked(doorDesc) {
    var d = String(doorDesc || '');
    if (Object.prototype.hasOwnProperty.call(law.cells, d)) { return law.cells[d] === true; }
    return Object.prototype.hasOwnProperty.call(JAIL_SHUT, d);
  }

  /*
    May this person go through this cell door. A guard of its hold always
    may. A cell no guard has turned is the game's, and the server does not
    refuse what it never locked. Otherwise it is whatever a guard left it.
  */
  function mayPassCell(actorId, profileId, doorDesc) {
    var hold = jailHoldOf(doorDesc);
    if (!hold) { return true; }
    if (isGuard(profileId, hold)) { return true; }
    var d = String(doorDesc);
    if (!Object.prototype.hasOwnProperty.call(law.cells, d)) { return true; }
    return law.cells[d] !== true;
  }

  /*
    The cells, onto one person's shut and open lists. A guard of the hold
    gets every cell of it open. Anybody else gets the cells a guard has
    turned, as they were left; the rest stay as the game ships them.
  */
  function cellLists(profileId, shut, open) {
    for (var d in JAIL_DOOR) {
      if (!Object.prototype.hasOwnProperty.call(JAIL_DOOR, d)) { continue; }
      var id = idOf(d);
      if (!id) { continue; }
      if (isGuard(profileId, JAIL_DOOR[d])) { open.push(id); continue; }
      if (!Object.prototype.hasOwnProperty.call(law.cells, d)) { continue; }
      (law.cells[d] === true ? shut : open).push(id);
    }
  }

  /** The cell door a key press names, by the form id the crosshair gives, or null. */
  function cellOfId(raw) {
    raw = String(raw || '');
    if (!/^[0-9a-f]{1,8}$/i.test(raw)) { return null; }
    var desc = '';
    try { desc = String(mp.getDescFromId(parseInt(raw, 16)) || ''); } catch (e) { desc = ''; }
    return (desc && jailHoldOf(desc)) ? desc : null;
  }

  /*
    A guard locks or unlocks a cell (#502). The lock key at a cell door,
    while the cell door is the door they just opened, the way a house is
    locked at its door: /lock or /unlock with the door's id, which nobody is
    told to type. Only a guard of the jail's hold.
  */
  function lockCell(actorId, profileId, toProfile, on, doorDesc) {
    var hold = jailHoldOf(doorDesc);
    var v = null;
    try { v = mp.get(actorId, DOOR_PROPERTY); } catch (e) { v = null; }
    if (!hold || !v || typeof v !== 'object' || String(v.door || '') !== doorDesc ||
        (Date.now() - (Number(v.at) || 0)) > DOOR_MEMORY_MS) {
      toProfile(profileId, 'Open the cell door you mean first.');
      return true;
    }
    if (!isGuard(profileId, hold)) {
      var mine = guardHoldsOf(profileId).length > 0;
      toProfile(profileId, mine
        ? 'That cell is in ' + JAIL_NAME[hold] + '. A guard keeps the cells of their own hold.'
        : 'A cell is a guard\'s to lock.');
      return true;
    }
    if (cellLocked(doorDesc) === !!on) {
      toProfile(profileId, 'The cell is already ' + (on ? 'locked' : 'unlocked') + '.');
      return true;
    }
    law.cells[doorDesc] = !!on;
    saveLaw();
    pushAll();
    var who = personName(actorId);
    plog('law: a guard of', hold, '(' + who + ', profile ' + profileId + ')', on ? 'locked' : 'unlocked',
         'cell door', doorDesc, 'in', JAIL_NAME[hold]);
    toProfile(profileId, on
      ? 'You lock the cell. Only a guard of this hold opens it now; anybody else has to pick the lock.'
      : 'You unlock the cell. It opens for anybody now.');
    var said = on ? 'The cell door is locked.' : 'The cell door is unlocked.';
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e2) { online = []; }
    for (var i = 0; i < online.length; i++) {
      var oid = online[i];
      if (oid === actorId) { continue; }
      var far = distanceTo(actorId, oid);
      if (far < 0 || far > LOCK_HEARD) { continue; }
      var opid = 0;
      try { opid = Number(mp.get(oid, 'profileId')) || 0; } catch (e3) { opid = 0; }
      if (!opid || opid === Number(profileId)) { continue; }
      toProfile(opid, said);
    }
    return true;
  }

  /*
    Who holds this building, or null.

    THE LAPSE IS ANSWERED HERE rather than by a timer, which is the same choice
    the farming block made: there is no tick that would notice sooner, and
    nothing in the world changes when a claim lapses except the answer to this
    question. Reading it is what drops it.

    Two weeks is counted from the last time the holder opened one of its doors,
    not from the day they claimed it. Patrick: "if they don't enter the house for
    so long it gets taken". Somebody who lives somewhere keeps it.
  */
  function holderOf(building) {
    if (!Object.prototype.hasOwnProperty.call(claims, building)) { return null; }
    var c = claims[building];
    var days = lapseDays();
    if (days > 0 && (Date.now() - c.touched) > days * 86400000) {
      // What the holder owed, counted up to the lapse and no further, stays theirs (#3950).
      keepOwed(building, c, c.touched + days * 86400000);
      delete claims[building];
      save();
      /*
        AND PUSH IT, WHICH THIS WAS THE ONLY CLAIM CHANGE NOT DOING.

        Every other mutation in this block pushes: claiming, the deed
        transfer, locking and eviction. A lapse did not, so a locked house
        that lapsed stayed locked on every client until something else
        happened to trigger a push. And it could not be the door itself that
        fixed it, because a locked reference is never announced to this
        server at all, on purpose, so pressing the very door that is wrongly
        shut is the one action that cannot put it right.
      */
      pushAll();
      plog('the claim on', nameOf(building), 'held by', c.name, 'lapsed after', days,
           'days with nobody going in');
      return null;
    }
    return c;
  }

  /** What a building is called, for a sentence and for a deed. */
  function nameOf(building) {
    return Object.prototype.hasOwnProperty.call(BUILDING_NAME, building)
      ? BUILDING_NAME[building] : building;
  }

  /** The building a door belongs to, or null when it is not a door we know. */
  function buildingOf(doorDesc) {
    return Object.prototype.hasOwnProperty.call(BUILDING_BY_DOOR, doorDesc)
      ? BUILDING_BY_DOOR[doorDesc] : null;
  }

  /*
    WHOSE HOLD A BUILDING IS IN (#2551). Patrick, 16 October, answer C: a
    Steward evicts and sets rent only in their own hold, by a table giving
    every claimable building the hold its door opens onto.
    scripts\dev\Build-BuildingHolds.py measures it out of the plugins: the
    places the building's doors open onto, and the hold whose location record
    those places' locations reach. A building none of that gives a hold is
    left out, and holdOfBuilding answers null for it: no Steward settles it.
  */
  // Written by scripts\dev\Build-BuildingHolds.py from the load order into
  // its table file. Each claimable building, to the hold its doors open onto, in the
  // town keys the offices use. A building the plugins give no hold is not here;
  // game\data\building-holds.json says how each was measured and why each
  // building left out was.
  var BUILDING_HOLD = table('BUILDING_HOLD');

  /** The hold a building is in, in the offices' town keys, or null. */
  function holdOfBuilding(building) {
    return Object.prototype.hasOwnProperty.call(BUILDING_HOLD, building) ? BUILDING_HOLD[building] : null;
  }

  /*
    A steward ends a claim and sets rent only in their own hold (#2551): the
    Steward of the building's hold, or its Jarl, who keeps the hold too. Null
    when they may; otherwise what to tell them. Asked again at every press.
  */
  function notStewardHere(profileId, building) {
    var hold = holdOfBuilding(building);
    if (!hold) {
      return nameOf(building) + ' answers to no hold the server knows, so no steward ends a claim or sets rent there.';
    }
    if (isStewardOf(profileId, hold)) { return null; }
    var town = HOLD_TOWN[hold] || hold;
    return nameOf(building) + ' answers to ' + town + '. Only the Steward of ' + town + ' or its Jarl ends a claim ' +
      'or sets rent there.';
  }

  /*
    STAFF AT ANY DOOR (#2551). Patrick, 17 October, decision 1, answer B:
    staff end claims and set rent at any building, the ones no hold covers
    included, and every such press is logged for staff. Staff hold no office
    by being staff (offices.md), so this is a power of its own and not an
    office: a staff member is never a Steward or a Jarl here, and a Steward
    or a Jarl is still of their own hold only.

    WHO IS STAFF is the test every staff command uses, asked of the chat
    block (__thornswoodIsStaff, which is isStaff there): the site's staff
    roles (Owner, Dev, Gamemaster, Moderator, Loremaster, by devProfiles in
    allowed.json), the admins and the written thornswoodDevs list. And for a
    press, the staff block's own proof (unproven): a chat connection the
    voice service proved, and the launcher's pass on hand, whatever
    thornswoodRequirePass says.

    THE LOG is the staff log, the staff block's record: one line in
    thornswood.log and one in for-bot/moderation.log, which the Discord bot
    says in the staff channel (did evict, rent or norent). It names who
    pressed, whose claim, the building and its hold, what was set, and when
    (at). The press is refused when that log cannot be reached, so no staff
    press goes unlogged.

    Somebody who keeps the building's hold acts as its steward, as anybody
    who keeps it does; the staff power is for every other door.
  */
  function isStaffHere(profileId) {
    var f = g['__thornswoodIsStaff'];
    try { return typeof f === 'function' && !!f(Number(profileId) || 0); } catch (e) { return false; }
  }

  /*
    How this press at this building is allowed: { as: 'steward' } for a
    steward of its hold, { as: 'staff' } for staff, or { why } to tell them.
    cmd is the queued line, for the staff block's proof.
  */
  function settleAs(profileId, building, cmd) {
    var notHere = notStewardHere(profileId, building);
    if (!notHere) { return { as: 'steward' }; }
    if (!isStaffHere(profileId)) { return { why: notHere }; }
    var st = g['__thornswoodStaff'];
    if (!st || typeof st.unproven !== 'function' || typeof st.record !== 'function') {
      return { why: 'The staff log is not loaded on this server, so no staff press is taken. Say so in the dev channel.' };
    }
    var unproven = st.unproven(cmd, profileId);
    if (unproven) { return { why: unproven }; }
    return { as: 'staff' };
  }

  /* The building and its hold, as the staff log and the staff member read them. */
  function settleWhere(building) {
    var hold = holdOfBuilding(building);
    return nameOf(building) + (hold ? ', in ' + (HOLD_TOWN[hold] || hold) : ', which answers to no hold');
  }

  /* One staff press in the staff log (the staff block's record): who, what, whose claim, where, and when. */
  function staffRecord(did, actorId, profileId, building, held, why) {
    g['__thornswoodStaff'].record(did, Number(profileId) || 0, personName(actorId),
      Number(held.by) || 0, String(held.name || 'somebody'), why, 0,
      { building: building, buildingName: nameOf(building), hold: holdOfBuilding(building), as: 'staff' });
  }

  // ------------------------------------------------------------ the doors --

  /*
    The door somebody just opened, written on them.

    Called from onActivate for every door in the table, which is 4,891 of them,
    and it does two things: it is what /claim reads back, and it is what keeps a
    claim alive, because opening your own front door is what 'entering the house'
    means. The second one is why this writes the register at all.

    And then the line at the door (#1637), after the deed below may have moved
    the place, so the lock key offers what is true once the door is open.
  */
  function touched(actorId, doorDesc) {
    openedDoor(actorId, doorDesc);
    if (!buildingOf(doorDesc)) { return; }
    var mine = 0;
    try { mine = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { mine = 0; }
    doorLine(actorId, mine);
  }

  function openedDoor(actorId, doorDesc) {
    var building = buildingOf(doorDesc);
    if (!building) { return; }
    /*
      The ground the door stands on goes down with the door, because a home and
      its farm are ONE claim and the farm is the ground outside the front door.
      Patrick: "home and farm are the same property claim remember".

      It is read at the moment the door is opened rather than at the moment
      /claim is said, because by then the person may have walked inside and the
      position would be the hallway. groundOf is the farming block's own, so the
      two halves of one claim are measured the same way.
    */
    var ground = null;
    var F = g.__thornswoodFarming;
    if (F && F.groundOf) {
      try { ground = F.groundOf(refrIdOfDoor(doorDesc)); } catch (e) { ground = null; }
    }
    try {
      mp.set(actorId, DOOR_PROPERTY, { door: doorDesc, at: Date.now(), ground: ground });
    } catch (e) {
      plog('could not write the door for', actorId.toString(16) + ':', e);
    }
    /*
      AND TELL THEM WHICH DOORS ARE SHUT TO THEM, here and not on a tick.

      A door is the only place a lock matters and this runs at every one of
      them, so somebody always has the current answer by the time they are
      standing in front of the next door. The alternative is a timer that runs
      for everybody all the time to catch a thing that changes a few times a day.

      It is a small write, and it is the same write pushAll does when a lock is
      turned. Between the two, a person is never more than one doorway behind.
    */
    var mine = 0;
    try { mine = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { mine = 0; }
    push(actorId, mine);

    // The embassy is held by its office, not by a claim, so a deed presented
    // at its door is paper (#1390, see the embassy and remnant block).
    var accordHeld = globalThis.__thornswoodEmbassy;
    if (accordHeld && accordHeld.holds(building)) { return; }

    var held = holderOf(building);
    try { mine = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { mine = 0; }

    /*
      THE DEED IS THE TITLE, AND UNTIL NOW THAT WAS ONLY A PROMISE.

      /claim already tells the person "Whoever carries it holds the place, so
      keep it somewhere a thief will not look", and nothing in the file did
      that: holderOf read the register and the register only, so a stolen deed
      was a piece of paper. Patrick asked for a thief who lifts the deed to
      take the house, and for the transfer to be an act at a door between two
      people rather than something an item does in a pocket.

      THIS IS THAT ACT. Carrying the deed and opening the door is the act. It
      cannot happen in a pocket, because it needs the door; it cannot be done
      from across the hold; and handing somebody the deed is the same gesture
      whether it is a sale, a gift or a theft, which is the point. The server
      does not need to tell those apart and should not try.

      WHY THE DOOR IS SAFE TO HANG IT ON, measured rather than assumed: a
      LOCKED door is never announced to this server at all, on purpose, so
      that Skyrim's own lockpicking keeps working. So every press that reaches
      here is a door that was already open to whoever pressed it. They own it,
      they were let in, they hold a key, or they picked it. A thief with the
      deed still has to get through the door, which is exactly the story
      Patrick described rather than a hole in it.

      THE OLD HOLDER IS TOLD, LATE AND IN THE WORLD (#2680). Until Patrick's
      decision 6B on #507 they were not told at all: they found out by trying
      their own door, with the deed gone from their pack because that is how
      it left, since a notice at the moment would turn a theft into an alarm
      system. It is still not one. A runner from the steward's office brings
      word deed.delayMinutes later, or when they are next in the world, and
      names nobody. See word to the holder.
    */
    /*
      A JAIL'S DEED IS PAPER IN ANY HAND BUT ITS JARL'S (#502): the jail is
      claimed by the Jarl of its hold alone, and presenting its deed is a
      claim like any other. The deed still opens the door it names, as a
      deed does (mayPass).
    */
    if (mine && holdsDeed(actorId, building) && (!held || held.by !== mine) &&
        mayHold(actorId, mine, building)) {
      var was = held ? held.name : null;
      var now2 = Date.now();
      var who2 = 'somebody';
      try {
        var ap = mp.get(actorId, 'appearance');
        if (ap && ap.name) { who2 = String(ap.name); }
      } catch (e2) { }
      // The ground goes with the house, because a home and its farm are one
      // claim. Kept from the old record when there is one, so a transfer does
      // not quietly drop the field behind the house.
      var keepGround = held ? held.ground : groundHere(actorId);
      /*
        THE RENT STAYS ON THE BUILDING, AND WHAT WAS OWED STAYS OWED (#3893,
        Patrick, 27 Oct). This record used to be written with no rent on it,
        so handing the deed to another of your characters at the door ended
        both the rent a steward set and the debt. The rent goes on at the
        same amount and the same clock, so the next rent falls due the day it
        would have; the new holder starts at nothing owed, and what the old
        holder owed, counted up to now first, stays theirs in arrears.
      */
      var keepRent = null;
      if (held && held.rent) {
        keepOwed(building, held, now2);
        keepRent = { amount: Number(held.rent.amount) || 0, everyDays: Number(held.rent.everyDays) || 7,
                     owed: 0, since: Number(held.rent.since) || now2 };
      }
      claims[building] = { by: mine, name: who2, at: now2, touched: now2,
                           locked: held ? !!held.locked : false,
                           ground: keepGround };
      if (keepRent) { claims[building].rent = keepRent; }
      save();
      pushAll();
      /*
        A NEW HOLDER, A NEW MASTER KEY (#2254). The claim above is a new
        record with no master on it, so the old holder's master key stopped
        opening anything the moment it was written: a master key works only
        while the person it was cut for holds the building. The one who holds
        it now is handed their own, the way a claim hands one with the deed.
      */
      var master2 = issueMaster(actorId, building, claims[building]);
      plog(who2, 'presented the deed at', nameOf(building), 'and now holds it',
           was ? '(it was ' + was + '\'s)' : '(it was nobody\'s)',
           master2 ? 'with master key no. ' + master2 : '');
      // The old holder is sent word of it (#2680). A lapsed claim is no
      // claim, so its holder had already lost the place and is not.
      if (held && held.by && held.by !== mine) {
        var wordSaid = recordWord('deed', building, held.by, actorId, mine, now2);
        plog('word: the deed to', nameOf(building), 'presented by', who2, '(profile ' + mine + '), for',
             was, '(profile ' + held.by + '):', WORD_SAID[wordSaid] || wordSaid);
      }
      var told = 'You present the deed at ' + nameOf(building) +
                 '. It is yours now' + (was ? ', and no longer ' + was + '\'s' : '') + '.' +
                 (master2 ? ' ' + masterHandedLine(building) : '');
      notify(actorId, told);
      say(actorId, told);
      return;
    }

    if (!held) { return; }
    /*
      A HOLDING FROM BEFORE MASTER KEYS (#2254). A claim made before they
      existed was never handed one, so its holder is handed it at their own
      door, once: after that the claim names a master key and a lost one is
      cut again at a forge from the mold.
    */
    if (mine && held.by === mine && !held.master) {
      var late = issueMaster(actorId, building, held);
      if (late) {
        plog(held.name, 'was handed master key no.', late, 'to', nameOf(building),
             'at its door, a holding from before master keys');
        var lateLine = masterHandedLine(building);
        notify(actorId, lateLine);
        say(actorId, lateLine);
      }
    }
    if (mine && held.by === mine && (Date.now() - held.touched) > 3600000) {
      // Once an hour at most. A door is opened a great many times and the
      // register does not need writing on every one of them.
      held.touched = Date.now();
      save();
    }
  }

  /** The form id of a placed door, or 0. */
  function refrIdOfDoor(doorDesc) {
    return idOf(doorDesc);
  }

  /** The ground written down beside the door they last opened, or null. */
  function groundHere(actorId) {
    var v = null;
    try { v = mp.get(actorId, DOOR_PROPERTY); } catch (e) { v = null; }
    if (!v || typeof v !== 'object') { return null; }
    if ((Date.now() - (Number(v.at) || 0)) > DOOR_MEMORY_MS) { return null; }
    return v.ground || null;
  }

  /** The building whose door has this form id, in hex the way the keys send it, or null. */
  function doorOfId(raw) {
    raw = String(raw || '');
    if (!/^[0-9a-f]{1,8}$/i.test(raw)) { return null; }
    var desc = '';
    try { desc = String(mp.getDescFromId(parseInt(raw, 16)) || ''); } catch (e) { desc = ''; }
    return desc ? buildingOf(desc) : null;
  }

  /** The building of the door they last opened, or null with the reason. */
  function here(actorId) {
    var v = null;
    try { v = mp.get(actorId, DOOR_PROPERTY); } catch (e) { v = null; }
    if (!v || typeof v !== 'object' || !v.door) { return null; }
    if ((Date.now() - (Number(v.at) || 0)) > DOOR_MEMORY_MS) { return null; }
    return buildingOf(String(v.door));
  }

  /*
    WHAT THE LOCK KEY DOES AT THE DOOR THEY LAST OPENED, written to them
    (#1637). The key is X unless it was rebound (LockKey), and it does what
    the line under the crosshair says and nothing else:

      x     'claim' when nobody holds the building; 'lock' or 'unlock' when
            they hold it or carry its deed, which is who setLock lets turn
            it; '' for anybody else, which draws no line
      n     the building's name, for the line
      d     every door of the building as the form id the crosshair hands
            back, in hex, so the line is up at either half of a front door
      left  what is left of DOOR_MEMORY_MS, so the line goes when here()
            would stop taking that door as the one just opened

    The rules stay in claim() and setLock(), which the key's lines reach:
    this only says which of them the key will ask for. Written on every door
    of a building they open and after every press of the key, so the word on
    the line is the answer to the last thing that happened.

    A stamp rather than the clock alone, so two writes in one millisecond
    are still two changes to the script on the other end.
  */
  var doorLineStamp = 0;

  function doorLine(actorId, profileId) {
    var v = null;
    try { v = mp.get(actorId, DOOR_PROPERTY); } catch (e) { v = null; }
    var since = (v && typeof v === 'object') ? Date.now() - (Number(v.at) || 0) : DOOR_MEMORY_MS;
    var building = (since < DOOR_MEMORY_MS && v.door) ? buildingOf(String(v.door)) : null;
    doorLineStamp = Math.max(doorLineStamp + 1, Date.now());
    var line = { at: doorLineStamp, x: '', n: '', d: [], left: 0 };
    /*
      A CELL DOOR, FOR A GUARD OF ITS HOLD (#502): the key locks or unlocks
      that one cell, and only it is under the line. Anybody else at a cell
      door is at a door of the jail building, as before.
    */
    var cellDoor = (since < DOOR_MEMORY_MS && v.door) ? String(v.door) : '';
    var cellHold = cellDoor ? jailHoldOf(cellDoor) : null;
    if (cellHold && isGuard(profileId, cellHold)) {
      line.x = cellLocked(cellDoor) ? 'unlock' : 'lock';
      line.n = 'the cell';
      line.left = DOOR_MEMORY_MS - since;
      var cid = idOf(cellDoor);
      if (cid) { line.d.push((cid >>> 0).toString(16)); }
    } else if (building) {
      var held = holderOf(building);
      // The embassy is held by its office, not by a claim, so its doors offer
      // nothing to claim (#1390); claim() refuses the line if it comes anyway.
      var accordLine = globalThis.__thornswoodEmbassy;
      if (!held) {
        // A jail offers the claim to the Jarl of its hold alone (#502).
        if (!(accordLine && accordLine.holds(building)) && mayHold(actorId, profileId, building)) {
          line.x = 'claim';
        }
      } else if ((profileId && held.by === profileId) || holdsDeed(actorId, building) ||
                 holdsMasterKey(actorId, building)) {
        line.x = held.locked ? 'unlock' : 'lock';
      }
      if (line.x) {
        line.n = nameOf(building);
        line.left = DOOR_MEMORY_MS - since;
        var doors = doorsOf(building);
        for (var i = 0; i < doors.length; i++) {
          var id = idOf(doors[i]);
          if (id) { line.d.push((id >>> 0).toString(16)); }
        }
      }
    }
    try {
      mp.set(actorId, DOOR_LINE_PROPERTY, line);
    } catch (e) {
      plog('could not write the door line for', actorId.toString(16) + ':', e);
    }
  }

  /*
    The client half: the line, put where the front plugin reads it
    (lockKeyNow there). Its own clock starts when a new stamp
    arrives, because the server's clock and the client's are two clocks.
  */
  function doorLineScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || typeof v !== "object") { return; }',
      '    var was = globalThis.thornswoodDoorLine;',
      '    if (was && was.stamp === v.at) { return; }',
      '    globalThis.thornswoodDoorLine = { stamp: v.at, seen: Date.now(),',
      '      left: Number(v.left) || 0, x: String(v.x || ""), n: String(v.n || ""),',
      '      d: Array.isArray(v.d) ? v.d.map(String) : [] };',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  // ------------------------------------------------------------ the claim --

  /*
    The deed into the pack, named for the property.

    The name is the whole mechanism: one record, and the entry carries which
    building it is. addItem in the outer file does not write a name, so this
    writes the inventory itself, and it appends rather than stacking: two deeds
    to two houses are two entries and must never be one entry with a count of
    two, because then neither of them says which house it is.
  */
  function giveDeed(actorId, building) {
    var baseId = idOf(DEED);
    if (!baseId) {
      plog('no deed record in this load order, so nothing was handed over');
      return false;
    }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { inv = null; }
    var entries = (inv && inv.entries) || [];
    entries.push({ baseId: baseId, count: 1, name: deedLabel(building) });
    try {
      mp.set(actorId, 'inventory', { entries: entries });
    } catch (e) {
      plog('could not hand over the deed:', e);
      return false;
    }
    return true;
  }

  /*
    /claim WHEN THEY ARE NOT AT A DOOR THE SERVER KNOWS (#2250).

    Everything that was not a door just opened used to go to farming, and
    farming's first question is the farmer gate. So /claim at a door the table
    does not know, or at a known door more than a minute after opening it,
    answered "Only a farmer can bring a crop in" to anybody who is not a
    farmer. Farming keeps every /claim that is about a field: one naming a crop
    plot, or a bare one with a plot in reach. The rest is answered here, about
    doors, and claims nothing.
  */
  function claimAway(parts, actorId, profileId, toProfile) {
    var F = g.__thornswoodFarming;
    var raw = (parts && parts[1]) ? String(parts[1]) : '';
    if (!F || typeof F.isPlotId !== 'function' || typeof F.plotNear !== 'function') { return false; }
    if (raw ? F.isPlotId(raw) : F.plotNear(actorId)) { return false; }
    var building = raw ? doorOfId(raw) : null;
    if (building) {
      toProfile(profileId, 'Open the door of ' + nameOf(building) + ' again and press the key ' +
                           'straight away. The server only takes the door you have just opened.');
    } else if (raw) {
      toProfile(profileId, 'That door does not belong to a building anybody can hold, so there ' +
                           'is nothing to claim at it.');
    } else {
      toProfile(profileId, 'Open the door of the building you mean first. That is how ' +
                           'the server knows which one it is.');
    }
    return true;
  }

  function claim(actorId, profileId, toProfile) {
    var building = here(actorId);
    if (!building) {
      toProfile(profileId, 'Open the door of the building you mean first. That is how ' +
                           'the server knows which one it is.');
      return true;
    }
    // embassy.md: the embassy doors start held, so a claim is refused (#1390).
    var accordClaim = globalThis.__thornswoodEmbassy;
    if (accordClaim && accordClaim.holds(building)) {
      toProfile(profileId, accordClaim.CLAIM_REFUSED);
      return true;
    }
    // A jail is the Jarl of its hold's alone (#502). See jailOfBuilding.
    if (!mayHold(actorId, profileId, building)) {
      var jailTown = HOLD_TOWN[jailOfBuilding(building)];
      toProfile(profileId, nameOf(building) + ' is ' + jailTown + '\'s jail. Only the Jarl of ' +
                           jailTown + ' claims it.');
      return true;
    }
    var held = holderOf(building);
    if (held && held.by === profileId) {
      toProfile(profileId, 'You already hold ' + nameOf(building) + '.');
      return true;
    }
    if (held) {
      toProfile(profileId, nameOf(building) + ' is held by ' + held.name +
                           '. Take it up with them, or with the court.');
      return true;
    }
    var who = 'somebody';
    try {
      var a = mp.get(actorId, 'appearance');
      if (a && a.name) { who = String(a.name); }
    } catch (e) { }

    var now = Date.now();
    /*
      ONE RECORD FOR THE HOUSE AND THE GROUND IT STANDS ON. Patrick asked for
      the farm and the property to be one thing in the code and not only one
      thing in the rules, and this is that: the claim carries where the door is,
      and the farming block asks this block whether a plot is inside somebody's
      property before it looks at its own claims at all.

      A building whose door stands indoors, a cellar hatch or an inn's upstairs,
      records no ground. That is right rather than a gap: there is no farm
      outside an inn's landing.
    */
    var ground = groundHere(actorId);
    claims[building] = { by: profileId, name: who, at: now, touched: now,
                         locked: false, ground: ground };
    save();
    // A new claim is not locked, so nothing anybody sees changes yet. The push
    // is here anyway because the claim is the moment the building stops being
    // nobody's, and a view that is right from the first second costs one write.
    pushAll();
    var handed = giveDeed(actorId, building);
    // The master key comes with the deed (#2254). See MASTER KEYS.
    var master = handed ? issueMaster(actorId, building, claims[building]) : 0;
    plog(who, 'claimed', nameOf(building), handed ? 'and took the deed' : 'and got no deed',
         master ? 'and master key no. ' + master : '');
    toProfile(profileId, 'You claim ' + nameOf(building) + '. ' +
              (handed ? 'The deed is in your pack. Whoever carries it holds the place, ' +
                        'so keep it somewhere a thief will not look. '
                      : 'The deed could not be handed over, so say so in the dev channel. ') +
              (master ? masterHandedLine(building) + ' ' : '') +
              'Go in at least once every ' + lapseDays() + ' days or it goes back.');
    return true;
  }

  /** What this person holds, said plainly. */
  function deeds(actorId, profileId, toProfile) {
    var mine = [];
    for (var b in claims) {
      if (!Object.prototype.hasOwnProperty.call(claims, b)) { continue; }
      if (holderOf(b) && claims[b].by === profileId) { mine.push(placeOf(b)); }
    }
    if (!mine.length) {
      toProfile(profileId, 'You hold nothing. Open the door of a building nobody holds and ' +
                           'press the key the line under the crosshair names: it costs nothing.');
      return true;
    }
    mine.sort();
    toProfile(profileId, 'You hold ' + mine.join(', ') + '. Go in at least once every ' +
                         lapseDays() + ' days or it goes back.');
    return true;
  }

  // ------------------------------------------------------- locks and keys --
  /*
    THE TWO RECORDS, both named per instance the way the deed is. A key to
    Breezehome and a key to Honeyside are the same record wearing two names.
  */
  var KEY = '15494:Thornswood-Content.esp';
  var MOLD = '15495:Thornswood-Content.esp';

  /* Where the bench somebody just pressed is written, the same way a door is,
     because cutting a key happens at a forge and the engine has already said
     which bench they touched. CraftingSmithingForge is the keyword every one of
     our tool recipes stands on. */
  var BENCH_PROPERTY = 'thornswoodBench';
  var FORGE = '88105:Skyrim.esm';

  /*
    HOW A LOCK ACTUALLY WORKS HERE, because it is not what anybody would guess.

    MEASURED IN THE FORK, 21 September, in activationService.ts: the client does
    not tell the server about a press on a LOCKED reference at all. The Thornswood
    patch there returns before it sends, on purpose, so that Skyrim keeps the
    reference and runs its own lockpicking game. That is exactly what Patrick
    asked for: "They should be able to pick the door still".

    So a lock cannot be a thing the server does when somebody presses a door. The
    door has to already be locked on their client before they touch it, and each
    client has its own copy of the world, so a door can be locked for one person
    and open for another without either of them seeing the other's version.

    THAT MAKES IT TWO HALVES AND BOTH ARE HERE.

    The first is the push below: the server writes, to each person, the doors
    they should find locked, and an updateOwner script runs on their machine and
    calls lock() on each one. That is what makes the lockpicking game appear.

    The second is the refusal in onActivate. If the client half never runs, which
    is a plugin that failed to load or a client that has been changed on purpose,
    then the door is NOT locked there, the press DOES reach the server, and the
    server refuses it. So the honest client gets a lock it can pick and the
    dishonest one gets a door that does not open. Neither half is trusted to be
    the only one.
  */
  var LOCK_PROPERTY = 'thornswoodLocks';

  /*
    HOW OFTEN THE DOORS ARE RE-LOCKED, and why it is a heartbeat rather than
    once.

    updateOwner runs EVERY FRAME in skymp5-client, not on change; the reading
    is written out in full over mp.makeProperty(SWING_PROPERTY). Three scripts
    ride that channel. The swing and the skills panel were both given a state
    guard on 22 September and this one was deliberately left alone, because it
    looked load bearing and nobody had checked.

    CHECKED, 23 September: IT IS. The comment inside the script says "a door in
    a cell nobody has loaded does not resolve... the tick below comes back to
    it", and there is no tick below. pushAll says so itself: "Done on a change
    rather than on a tick: a lock is changed a handful of times a day and there
    is nothing to poll for." So the ONLY thing that ever catches a door whose
    cell streams in afterwards is this script being run again, and a plain edge
    trigger would leave those doors unlocked with nothing anywhere to notice.

    SO IT KEEPS RUNNING AGAIN, four seconds apart instead of sixty times a
    second. That is the same behaviour a hundred and forty times cheaper: a
    door that loads a moment later is locked within four seconds, a cell that
    unloads and comes back is caught the same way, and a person standing in
    Whiterun stops paying a resolve and a lock call per door per frame.

    AND A CHANGE IS STILL INSTANT. The stamp is compared first, so locking a
    door reaches everybody on the next frame rather than up to four seconds
    later. The heartbeat is only for the doors that were not there yet.
  */
  var LOCK_EVERY_MS = 4000;

  function lockScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || !v.shut) { return; }',
      '    var st = ctx.state;',
      '    if (st) {',
      '      var now = Date.now();',
      // The list changed: do it now. Otherwise only on the heartbeat.
      '      if (st.thornswoodLockStamp === v.at &&',
      '          (now - (st.thornswoodLockAt || 0)) < ' + LOCK_EVERY_MS + ') { return; }',
      '      st.thornswoodLockStamp = v.at;',
      '      st.thornswoodLockAt = now;',
      '    }',
      // No state at all is the old behaviour, every frame, which is correct
      // and expensive. Failing that way round is the right one: a door that
      // is not locked is a house anybody can walk into.
      '    var sp = ctx.sp;',
      // Remember which form ids property wants shut (#615), published for
      // anything on the client that asks whether a door is property's to hold.
      '    var shutMap = {};',
      '    for (var i = 0; i < v.shut.length; i++) {',
      '      try {',
      '        var r = sp.ObjectReference.from(sp.Game.getFormEx(v.shut[i]));',
      // A door in a cell nobody has loaded does not resolve, and there is
      // nothing to lock until it does. The tick below comes back to it.
      // ONLY A DOOR IN THE WRONG STATE IS TOUCHED (#963). lock() fires the
      // game's lockChanged event even when nothing changes, and the front
      // plugin answers every one with a log line and a blockActivation: the
      // dev log of 28 September has the same open door "opened" twice every
      // four seconds, 16 events costing 408 ms in 30 s, worst 229 ms, which
      // is a stutter on each heartbeat. If isLocked cannot be read the door
      // is locked anyway, so this fails shut.
      '        if (r) { var was = null; try { was = r.isLocked(); } catch (e2) { }',
      '          if (was !== true) { r.lock(true, false); } }',
      '        shutMap[v.shut[i]] = true;',
      '      } catch (e) { }',
      '    }',
      '    for (var j = 0; j < (v.open || []).length; j++) {',
      '      try {',
      '        var o = sp.ObjectReference.from(sp.Game.getFormEx(v.open[j]));',
      // OFF THE PUBLISHED LIST BEFORE IT OPENS (#2680). The front plugin
      // reads a door on __thornswoodPropertyShut that opens as a pick, so
      // a door this script opens is taken off the list first.
      '        try { var pub = globalThis.__thornswoodPropertyShut; if (pub) { delete pub[v.open[j]]; } } catch (e3) { }',
      '        if (o) { var shut = true; try { shut = o.isLocked(); } catch (e2) { }',
      '          if (shut !== false) { o.lock(false, false); } }',
      '        delete shutMap[v.open[j]];',
      '      } catch (e) { }',
      '    }',
      '    try { globalThis.__thornswoodPropertyShut = shutMap; } catch (e) { }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  /*
    Everything in this person's pack of one base with one exact name.

    A key IS its name. There is no register of keys and there is deliberately
    none: Patrick settled that a key can be given away, pickpocketed or taken out
    of an unlocked chest, and every one of those is the item moving with nobody
    telling the server. So the only honest question is what is in the pack now.
  */
  function holdsNamed(actorId, baseDesc, label) {
    var baseId = idOf(baseDesc);
    if (!baseId) { return false; }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return false; }
    var entries = (inv && inv.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e && e.count > 0 && e.baseId === baseId && String(e.name || '') === label) {
        return true;
      }
    }
    return false;
  }

  /*
    WHAT A KEY, A MOLD AND A DEED CALL A BUILDING (#3899).

    A key IS its name (holdsNamed), so the name has to be one building and no
    other. The display name is not: BUILDING_NAME has 22 names that more than
    one building carries, six Halls of the Dead among them, so a key cut for
    one opened all six and a deed to one, presented at another's door, handed
    that other one over. Patrick, 27 Oct, answer A: the hold goes on the name,
    "Key to Hall of the Dead, Whiterun", and where name and hold still clash a
    short number goes after it, the way the master key carries one.

    LABEL_NO is those numbers. They are written down here rather than worked
    out from the order of the table, because a key already in a pack names a
    number and the door table is regenerated: a new building sorting in
    front of an old one would hand the old one's number, and so its keys, to
    the new one. So a number is never moved: a building that joins a clash
    gets the next number of its group, and one that leaves the table has its
    row taken out. tests/test-3899-key-labels.js fails the build whenever
    two buildings that can be held come out with the same label, and names
    them.
  */
  var LABEL_NO = {
    // Apocrypha
    '142f3:Dragonborn.esm': 1,
    '142f4:Dragonborn.esm': 2,
    '1ede2:Dragonborn.esm': 3,
    '3109d:Dragonborn.esm': 4,
    '3b065:Dragonborn.esm': 5,
    // Bloodskal Barrow, Raven Rock
    '1e8cc:Dragonborn.esm': 1,
    '24cad:Dragonborn.esm': 2,
    // Broken Tower Redoubt, Markarth
    '152af:Skyrim.esm': 1,
    '7284e:Skyrim.esm': 2,
    // Creation Club Cell
    '2fd1:Update.esm': 1,
    '2fd2:Update.esm': 2,
    '2fd3:Update.esm': 3,
    '30e2:Update.esm': 4,
    '30eb:Update.esm': 5,
    '30ec:Update.esm': 6,
    // Creation Club Cell, Raven Rock
    '30e7:Update.esm': 1,
    '30e8:Update.esm': 2,
    // Guard Barracks, Whiterun
    '36ed6:Skyrim.esm': 1,
    '580a2:Skyrim.esm': 2,
    // Miner's Barracks, Markarth
    '13979:Skyrim.esm': 1,
    '198df:Skyrim.esm': 2,
    // Palace of the Kings, Upstairs, Windhelm
    '97298:Skyrim.esm': 1,
    '97299:Skyrim.esm': 2,
    // Quick Test Cell
    '2f99:Update.esm': 1,
    '2f9b:Update.esm': 2,
    // Quick Test Cell, Solitude
    '2f9c:Update.esm': 1,
    'b1783:Skyrim.esm': 2,
    // Ruins of Old Haafingar, Solitude
    '186c2:SkyrimSewers.esp': 1,
    '64fc2:SkyrimSewers.esp': 2,
    // Skuldafn Temple, Windhelm
    'a0877:Skyrim.esm': 1,
    'a73f4:Skyrim.esm': 2,
    // Storm's Tale Dormitory, Falkreath
    '37a28:AnotherOakwood.esp': 1,
    '37a29:AnotherOakwood.esp': 2,
    // Warehouse, Windhelm
    '90232:WindhelmSSE.esp': 1,
    '965b3:Skyrim.esm': 2
  };

  /** The building as a key, a mold and a deed name it: unique, see above. */
  function placeOf(building) {
    var hold = holdOfBuilding(building);
    var place = nameOf(building);
    if (hold && Object.prototype.hasOwnProperty.call(HOLD_TOWN, hold)) { place += ', ' + HOLD_TOWN[hold]; }
    if (Object.prototype.hasOwnProperty.call(LABEL_NO, building)) { place += ', no. ' + LABEL_NO[building]; }
    return place;
  }

  function keyLabel(building) { return 'Key to ' + placeOf(building); }
  function moldLabel(building) { return 'Key mold for ' + placeOf(building); }
  function deedLabel(building) { return 'Deed to ' + placeOf(building); }

  function holdsKey(actorId, building) { return holdsNamed(actorId, KEY, keyLabel(building)); }
  function holdsMold(actorId, building) { return holdsNamed(actorId, MOLD, moldLabel(building)); }
  function holdsDeed(actorId, building) { return holdsNamed(actorId, DEED, deedLabel(building)); }

  /** A named item into the pack, never stacked. See giveDeed for why. */
  function giveNamed(actorId, baseDesc, label) {
    var baseId = idOf(baseDesc);
    if (!baseId) {
      plog('no', baseDesc, 'in this load order, so nothing was handed over');
      return false;
    }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { inv = null; }
    var entries = (inv && inv.entries) || [];
    entries.push({ baseId: baseId, count: 1, name: label });
    try {
      mp.set(actorId, 'inventory', { entries: entries });
    } catch (e) {
      plog('could not hand over', label + ':', e);
      return false;
    }
    return true;
  }

  /*
    May this person walk through that building's doors.

    The holder always may, and a key always does. Nothing else: a building nobody
    has claimed is open, and a claimed building that has not been locked is open,
    because Patrick settled that "the door is only locked if the person locked
    the door".

    THE DEED IS NOT A KEY and that is deliberate. A deed in the pack is checked
    here as well, because somebody who has just stolen one and has not yet had
    the claim moved to them is holding the thing that says the place is theirs.
    A stolen key gets you in; a stolen deed gets you in and eventually gets you
    the house, and the second half of that is its own piece of work.
  */
  function mayPass(actorId, profileId, building) {
    var held = holderOf(building);
    if (!held) { return true; }
    if (!held.locked) { return true; }
    if (profileId && held.by === profileId) { return true; }
    if (holdsKey(actorId, building)) { return true; }
    if (holdsDeed(actorId, building)) { return true; }
    // A master key while the person it was cut for holds it (#2254).
    if (holdsMasterKey(actorId, building)) { return true; }
    return false;
  }

  /*
    A door that is a way out of where it stands rather than a way in. See
    WAY_OUT: the inside half of a front door, a room's own doors, and the door
    up out of a cellar whose only road to open ground is through the house.
  */
  function wayOut(doorDesc) {
    return Object.prototype.hasOwnProperty.call(WAY_OUT, doorDesc);
  }

  /*
    Every door of every building this person should find locked.

    A LOCK KEEPS PEOPLE OUT AND NEVER SHUTS THEM IN. Both halves of a front
    door answer with the house, so this used to lock the inside half too, and
    a guest or a burglar inside when the holder locked up found every way out
    locked. Measured on 24 September: 3,326 of the 4,891 doors in the table
    stand inside their own building, in 812 of the 852 buildings, and 124 more
    stand in a room, a cellar or a lodging, whose only road to open ground is
    through the building. So a way out
    is on the open list for everybody, which is what the holder already had,
    and only the doors that let somebody in are shut.
  */
  function shutFor(actorId, profileId) {
    var shut = [], open = [];
    for (var b in claims) {
      if (!Object.prototype.hasOwnProperty.call(claims, b)) { continue; }
      var doors = doorsOf(b);
      var pass = mayPass(actorId, profileId, b);
      for (var i = 0; i < doors.length; i++) {
        var id = idOf(doors[i]);
        // A cell door stands in the jail building and is a way out of it, so
        // a claim on the jail would open it for everybody. It is the cell
        // lock's, below (#502).
        if (!id || jailHoldOf(doors[i])) { continue; }
        (pass || wayOut(doors[i]) ? open : shut).push(id);
      }
    }
    cellLists(profileId, shut, open);
    return { shut: shut, open: open };
  }

  /*
    Every door of a building, worked out once and kept.

    BUILDING_BY_DOOR is 4,891 rows and the question here is the other way round,
    so walking it per push would be 4,891 comparisons per person per change. It
    is turned round the first time it is asked for.
  */
  var doorIndex = null;
  function doorsOf(building) {
    if (!doorIndex) {
      doorIndex = {};
      for (var d in BUILDING_BY_DOOR) {
        if (!Object.prototype.hasOwnProperty.call(BUILDING_BY_DOOR, d)) { continue; }
        var b = BUILDING_BY_DOOR[d];
        if (!Object.prototype.hasOwnProperty.call(doorIndex, b)) { doorIndex[b] = []; }
        doorIndex[b].push(d);
      }
    }
    return Object.prototype.hasOwnProperty.call(doorIndex, building) ? doorIndex[building] : [];
  }

  /** Tell one person which doors are shut to them. */
  function push(actorId, profileId) {
    try {
      /*
        STAMPED, because the script on the other end now asks whether the list
        has changed. Without it every push looks identical to the last one and
        a door somebody just locked would wait for the heartbeat.
      */
      var v = shutFor(actorId, profileId);
      v.at = Date.now();
      mp.set(actorId, LOCK_PROPERTY, v);
    } catch (e) {
      plog('could not push the locks to', actorId.toString(16) + ':', e);
    }
  }

  /*
    Tell everybody, because one person locking a door changes what every other
    person in the world sees. Done on a change rather than on a tick: a lock is
    changed a handful of times a day and there is nothing to poll for.
  */
  function pushAll() {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    for (var i = 0; i < online.length; i++) {
      var id = online[i];
      var pid = 0;
      try { pid = Number(mp.get(id, 'profileId')) || 0; } catch (e) { pid = 0; }
      push(id, pid);
    }
  }

  function setLock(actorId, profileId, toProfile, on) {
    var building = here(actorId);
    if (!building) {
      toProfile(profileId, 'Open the door of the building you mean first.');
      return true;
    }
    var held = holderOf(building);
    if (!held) {
      toProfile(profileId, 'Nobody holds ' + nameOf(building) + ', so there is nothing to ' +
                           (on ? 'lock' : 'unlock') + '. It can be claimed at its door for nothing.');
      return true;
    }
    // The holder, the deed, or its master key (#2254) turns the lock.
    if (held.by !== profileId && !holdsDeed(actorId, building) &&
        !holdsMasterKey(actorId, building)) {
      toProfile(profileId, nameOf(building) + ' is held by ' + held.name +
                           '. A lock is the holder\'s to turn.');
      return true;
    }
    if (!!held.locked === !!on) {
      toProfile(profileId, nameOf(building) + ' is already ' + (on ? 'locked' : 'unlocked') + '.');
      return true;
    }
    held.locked = !!on;
    save();
    pushAll();
    plog(nameOf(building), on ? 'locked' : 'unlocked', 'by', held.name);
    toProfile(profileId, lockLine(building, on, true));
    /*
      #615 and #2256: after locking, say so plainly, for you and everyone, so
      nobody wonders whether it is locked only for them. It is: the lock is the
      building's, not the holder's view of it. pushAll already sends the shut
      list; this is the spoken line.

      To the people standing near enough to see the door (LOCK_HEARD), not to
      the whole server: before #2256 every lock in Skyrim was announced to
      every player online.
    */
    var said = lockLine(building, on, false);
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    for (var oi = 0; oi < online.length; oi++) {
      var oid = online[oi];
      if (oid === actorId) { continue; }
      var far = distanceTo(actorId, oid);
      if (far < 0 || far > LOCK_HEARD) { continue; }
      var opid = 0;
      try { opid = Number(mp.get(oid, 'profileId')) || 0; } catch (e) { opid = 0; }
      if (!opid || opid === profileId) { continue; }
      toProfile(opid, said);
    }
    return true;
  }

  /* About thirty metres at seventy units to the metre: the street in front of the door. */
  var LOCK_HEARD = 2000;

  /** What a lock or an unlock says, to whoever turned it (mine) or to the people near it (#2256). */
  function lockLine(building, on, mine) {
    var name = nameOf(building);
    if (on) {
      return (mine ? 'You lock ' + name + '. ' : '') + name + ' is locked for everyone now. ' +
             'Only a key to it, its master key or its deed opens it; anybody else has to pick the lock.';
    }
    return (mine ? 'You unlock ' + name + '. ' : '') + name + ' is open to everyone now.';
  }

  /*
    A KEY MOLD, AND THE BALANCE PATRICK ASKED FOR.

    His words: "I don't want people to make new molds when somone is offline but
    don't wan to be unrealistic so help me implement that sytem plus find a
    balance."

    THE BALANCE: the mold is made at the door, by a smith, and the person who
    holds the place has to be STANDING THERE. That is what stops a mold being cut
    while somebody is offline, and it is not a rule anybody has to remember,
    because it is just the locksmith wanting the householder present.

    AND THE MOLD GOES TO THE HOLDER, not to the smith. "you have a smith make you
    a key mold for your door" is his sentence and the mold is yours. It matters
    for more than tidiness: a smith who kept the mold could cut himself a key to
    that house for ever afterwards, and nobody would know. The holder keeps it
    and brings it back when they want another key cut, which is two people
    trading and needs nothing built.
  */
  function mold(actorId, profileId, toProfile) {
    var building = here(actorId);
    if (!building) {
      toProfile(profileId, 'Open the door you mean first.');
      return true;
    }
    if (!isSmith(actorId)) {
      toProfile(profileId, 'A key mold is a smith\'s work. Find one and bring them here.');
      return true;
    }
    var held = holderOf(building);
    if (!held) {
      toProfile(profileId, 'Nobody holds ' + nameOf(building) + ', so there is no lock to ' +
                           'cut a mold for. It can be claimed for nothing.');
      return true;
    }
    var owner = holderNearby(actorId, building, held);
    if (!owner) {
      toProfile(profileId, 'Whoever holds ' + nameOf(building) + ' has to be standing here ' +
                           'for this. A locksmith does not cut a mold for a door on somebody ' +
                           'else\'s say so.');
      return true;
    }
    if (holdsMold(owner.actorId, building)) {
      toProfile(profileId, 'There is already a mold for ' + nameOf(building) + ' and it is ' +
                           'in their hands. Cut the key from that.');
      return true;
    }
    /*
      THE BLANK IS SPENT HERE, AND IT IS WHAT MAKES THE CHAIN MAKE SENSE.

      Patrick, 23 September: "Wait how tf does someone use a mold if you can't
      make a key to own the building make this shit make sense make a fucking
      mold item craftable dude this would solve alot", and then the whole
      shape of it: "you make a mold, mold gets used on door to assign mold to
      the door, than key uses that mold during crafting to make a key to
      specifically that house and it can be reused".

      Until now this conjured a mold out of nothing, which is why the chain
      could never start: the only mold in the world came from the ceremony, so
      the ceremony had to happen before the object existed.

      A smith forges a blank at a forge now, out of one iron ingot, and this
      is the stamping: the blank comes out of the smith's pack and a mold for
      this door goes into the holder's. That is the same trade it always was,
      with the smith supplying the metal, which is the part that was missing.
    */
    /*
      UNTIL THE PLUGIN REACHES EVERYBODY, THE DOOR STILL MAKES THE MOLD.

      The blank is a record in Thornswood-Content.esp, and that file reaches
      clients only through the Nexus collection: it is listed in
      Profile\OwnGame\files.txt, so Publish-Update never puts it in a pack.
      And the launcher compares every plugin's name and size with the server's
      and refuses Play on any difference, so the new plugin cannot go on a
      server before it is on the collection without locking out everybody who
      has the old one.

      So there is a stretch, of unknown length, where this gamemode is running
      against a plugin with no blank mold in it. Demanding a blank there would
      refuse every /mold in the world, because nobody could make one. While the
      record is absent the door conjures the mold exactly as it did before; the
      day the plugin carries it, the blank is spent. Nothing has to be switched
      over by hand, which is the point: the switch is the plugin.
    */
    if (blankMoldsExist()) {
      if (!takeBlankMold(actorId)) {
        toProfile(profileId, 'You are carrying no blank key mold. Forge one at a forge, one iron ' +
                             'ingot, then bring it back to this door.');
        return true;
      }
    }
    if (!giveNamed(owner.actorId, MOLD, moldLabel(building))) {
      toProfile(profileId, 'The mold could not be handed over. Say so in the dev channel.');
      return true;
    }
    plog('a mold for', nameOf(building), 'was cut for', held.name);
    toProfile(profileId, 'You cut a mold for ' + placeOf(building) + ' and hand it to ' +
                         held.name + '. Keys come off the mold at a forge.');
    if (owner.profileId !== profileId) {
      toProfile(owner.profileId, 'The mold for ' + placeOf(building) + ' is yours. Bring it to ' +
                                 'a smith at a forge for as many keys as you want.');
    }
    return true;
  }

  /*
    A BLANK PRESSED INTO THE LOCK, ON A KEY, AT THE DOOR ITSELF.

    Patrick, 24 September, in order: "you should press e on a un molded door
    to fill the mold", then "not type" /mold, then "actually can we make it a
    different key that is unused in tis scenario and include a prompt when
    loooking at a door to press that key to set a mold". So the plugin draws a
    line while somebody carrying a Key Mold looks at a door, and the mold key
    (U unless it was rebound) sends /moldhere and that door's form id in hex.

    THE CLIENT'S WORD ABOUT WHICH DOOR IS A HINT. Anybody can type /moldhere
    with any number after it. So the number has to be a door of a building
    this block knows, and the person has to be standing at that very door by
    the server's own reckoning of where the two of them are, in the same cell
    or world. The prompt and the key are conveniences; this is the gate.

    MOLD_REACH IS 400 UNITS. Skyrim's default reach for pressing something is
    180 (fActivatePickLength), measured from the camera, which in third person
    sits behind the character; a door's position is its own origin, which on
    a wide or double door is off to one side; and the position the server holds
    is a moment behind the client's. 400 covers all three and is still under
    six metres at the seventy units to a metre the party strip uses, which is
    standing at the door and not across the street from it. It is also the
    number the plugin's door rescue uses for "still within reach of the door".

    THE RULES ARE /mold's, LESS THE SMITH. The blank has to exist in this
    build and be in the pack, the building has to be held, its holder has to
    be the one pressing or be standing there, which is Patrick's own balance
    for molds, "I don't want people to make new molds when somone is
    offline", and there must not already be a mold for it in either pack.
    Pressing is not a smith's work: the smith's part is forging the blank and
    cutting the keys. The typed /mold stays exactly as it was.
  */
  var MOLD_REACH = 400;

  /** Is there a BLANK mold in this pack: a Key Mold with no name on it. */
  function carriesBlankMold(actorId) {
    var baseId = idOf(MOLD);
    if (!baseId) { return false; }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return false; }
    var entries = (inv && inv.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e && e.count > 0 && e.baseId === baseId && !e.name) { return true; }
    }
    return false;
  }

  /*
    How far this person stands from a placed reference, or -1 when the server
    cannot say: either position unreadable, or the two in different cells or
    worlds, where one position means nothing against the other.
  */
  function distanceTo(actorId, refrId) {
    var mine = '', its = '', a = null, b = null;
    try {
      mine = String(mp.get(actorId, 'worldOrCellDesc') || '');
      its = String(mp.get(refrId, 'worldOrCellDesc') || '');
      a = mp.get(actorId, 'pos');
      b = mp.get(refrId, 'pos');
    } catch (e) { return -1; }
    if (!mine || mine !== its || !a || !b) { return -1; }
    var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function moldHere(parts, actorId, profileId, toProfile) {
    // A form id in hex and nothing else, the way the plugin writes it.
    var raw = String((parts && parts[1]) || '');
    var refrId = /^[0-9a-f]{1,8}$/i.test(raw) ? parseInt(raw, 16) : 0;
    var desc = '';
    if (refrId) {
      try { desc = String(mp.getDescFromId(refrId) || ''); } catch (e) { desc = ''; }
    }
    var building = desc ? buildingOf(desc) : null;
    if (!building) {
      toProfile(profileId, 'That door does not belong to a building anybody can hold, so ' +
                           'there is no lock on it to take a mold of.');
      return true;
    }
    var far = distanceTo(actorId, refrId);
    if (far < 0 || far > MOLD_REACH) {
      toProfile(profileId, 'You are too far from the door of ' + nameOf(building) + '. Stand ' +
                           'at it, look at it and press the key again.');
      return true;
    }
    if (!blankMoldsExist()) {
      toProfile(profileId, 'There are no blank key molds on this server yet, so there is ' +
                           'nothing to press into the lock.');
      return true;
    }
    if (!carriesBlankMold(actorId)) {
      toProfile(profileId, 'You are carrying no blank key mold. A smith forges one at a forge ' +
                           'out of one iron ingot.');
      return true;
    }
    var held = holderOf(building);
    if (!held) {
      toProfile(profileId, 'Nobody holds ' + nameOf(building) + ', so there is no lock to take ' +
                           'a mold of. It can be claimed for nothing.');
      return true;
    }
    var owner = holderNearby(actorId, building, held);
    if (!owner) {
      toProfile(profileId, 'Whoever holds ' + nameOf(building) + ' has to be here for its lock ' +
                           'to be taken. A mold is not pressed on somebody else\'s say so.');
      return true;
    }
    if (holdsMold(owner.actorId, building) || holdsMold(actorId, building)) {
      toProfile(profileId, 'There is already a mold for ' + nameOf(building) + '. Cut the keys ' +
                           'from that one.');
      return true;
    }
    if (!takeBlankMold(actorId)) {
      toProfile(profileId, 'You are carrying no blank key mold. A smith forges one at a forge ' +
                           'out of one iron ingot.');
      return true;
    }
    if (!giveNamed(owner.actorId, MOLD, moldLabel(building))) {
      toProfile(profileId, 'The mold could not be handed over. Say so in the dev channel.');
      return true;
    }
    plog('a mold for', nameOf(building), 'was pressed at the door for', held.name);
    var yours = owner.actorId === actorId;
    toProfile(profileId, 'You press the blank into the lock of ' + placeOf(building) + '. It is ' +
                         'the mold for it now' + (yours ? ' and it is in your pack' :
                         ', and it goes to the holder standing with you') +
                         '. Keys come off it at a forge, as many as you want.');
    if (!yours && owner.profileId && owner.profileId !== profileId) {
      toProfile(owner.profileId, 'The mold for ' + placeOf(building) + ' is yours. Bring it to ' +
                                 'a smith at a forge for as many keys as you want.');
    }
    return true;
  }

  /*
    A key off the mold, at a forge, by a smith.

    Whoever is holding the mold is who the key is for, which is the same shape as
    the mold itself: the smith does the work and the other person walks away with
    the thing. A smith cutting a key for their own house holds both and it lands
    in their own pack, which is the same rule and not a special case.
  */
  /** Every building this profile holds, in the order the claims were made. */
  function heldBy(profileId) {
    var mine = [];
    if (!profileId) { return mine; }
    for (var b in claims) {
      if (!Object.prototype.hasOwnProperty.call(claims, b)) { continue; }
      if (claims[b] && claims[b].by === profileId) { mine.push(b); }
    }
    return mine;
  }

  function cutKey(actorId, profileId, toProfile, parts) {
    // The mold key at a forge asks for the master key instead (#2254).
    if (parts && String(parts[2] || '') === 'master') {
      return cutMasterKey(actorId, profileId, toProfile, parts);
    }
    if (!isSmith(actorId)) {
      toProfile(profileId, 'Cutting a key is a smith\'s work. Hand the mold to a smith.');
      return true;
    }
    var forge = forgeHere(parts, actorId);
    if (!forge) {
      toProfile(profileId, 'Stand at a forge and look at it, then press the key the line ' +
                           'under the crosshair names.');
      return true;
    }
    // Too sick, too hurt or too tired to cut it: the gate every way of making
    // something asks (unfitToMake, #1733), at this forge.
    var unfit = unfitToMake(actorId, forge);
    if (unfit) {
      toProfile(profileId, unfit);
      return true;
    }
    // And a smith's work wants a smith's hammer, worn once the key is cut (#3162).
    var noHammer = toolGate(actorId, 'smith');
    if (noHammer) {
      toProfile(profileId, noHammer);
      return true;
    }
    var building = moldInHand(actorId);
    /*
      YOUR OWN DOOR NEEDS NO MOLD, AND WITHOUT THIS NOBODY COULD MAKE A KEY.

      Patrick, 23 September: "Smith's are supposed to be able to make a key",
      and before that, "A smith can't craft a key it seems so I can't test the
      property system line properly", and then plainly: "I littarrly said you
      can't make a fucking key but you're supposed to be able too".

      He was right and the shape of the rule was the reason. Every key in the
      game came off a mold; a mold is only cut at the door of a building
      somebody already holds, with that holder standing there. So a smith
      alone, holding their own house, had no way to a key at all, and neither
      did anybody else: the ceremony needed two people before it would produce
      the first one.

      THIS DOES NOT SPEND THE BALANCE HE ASKED FOR. His words when the mold
      was designed: "I don't want people to make new molds when somone is
      offline". The mold exists to stop a smith cutting keys to OTHER people's
      houses behind their backs, and that is untouched: a mold is still the
      only way to a key for a door you do not hold. A holder cutting a key to
      their own door is not somebody being robbed while they are offline. They
      are standing at the forge, and they can already walk through that door
      without any key at all.

      WHICH DOOR, when they hold more than one: the one they last opened, if
      it is theirs, because standing at a door is the plainest way to say
      which you mean. Failing that, one held building is unambiguous. More
      than one and nothing to choose between them is the only case that still
      asks for the mold, and it names them rather than refusing blankly.
    */
    if (!building) {
      var mine = heldBy(profileId);
      var at = here(actorId);
      if (at && mine.indexOf(at) !== -1) {
        building = at;
      } else if (mine.length === 1) {
        building = mine[0];
      } else if (mine.length > 1) {
        var names = [];
        for (var i = 0; i < mine.length; i++) { names.push(placeOf(mine[i])); }
        toProfile(profileId, 'You hold ' + names.join(', ') + '. A key comes off the mold of ' +
                             'the one you mean, so press a blank key mold into its door first.');
        return true;
      }
    }
    if (!building) {
      toProfile(profileId, 'A key comes off a key mold that has been pressed into a door, and ' +
                           'you are carrying none. Press a blank one into the lock you mean, ' +
                           'with whoever holds the place standing there.');
      return true;
    }
    /*
      ONE IRON INGOT, THE KEY'S PRICE AT THE FORGE (#1637). The Key in the
      forge's own list costs one (docs/systems/lists/smith-edgewright.md), and
      the lock key at a forge is the same cut, so it costs the same. A key out
      of nothing beside a row that charges an ingot would make that row one
      nobody uses. Asked on #1637. Taken before the key is handed over and put
      back if it cannot be, so nobody pays for a key they did not get.
    */
    if (!takeItem(actorId, KEY_INGOT, 1)) {
      toProfile(profileId, 'A key is cut from one iron ingot, and you are carrying none.');
      return true;
    }
    if (!giveNamed(actorId, KEY, keyLabel(building))) {
      addItem(actorId, KEY_INGOT, 1);
      toProfile(profileId, 'The key could not be handed over. Say so in the dev channel.');
      return true;
    }
    plog('a key to', nameOf(building), 'was cut');
    toProfile(profileId, 'You cut a key to ' + placeOf(building) + '. It opens the door for ' +
                         'whoever is carrying it, so hand it over yourself.');
    var wornHammer = wearTool(actorId, 'smith');
    if (wornHammer) { toProfile(profileId, wornHammer); }
    return true;
  }

  /*
    MASTER KEYS (#2254).

    Patrick, 12 Oct 2026, on #2254: a "Master key to" one building, handed
    with the deed when the building is claimed, which opens it and turns its
    lock, works only while the person it was cut for holds the building, and
    is re-cut from the mold for 2 iron ingots, the new one replacing the old.

    What it is for: the deed is the title and the one thing a thief can take
    the house with, so it can sit in a chest. The master key does the daily
    work of the deed without being it: whoever carries it, the holder or a
    partner they hand it to, gets through the locked door and turns the lock.
    An ordinary key still only opens.

    WHY A NUMBER IS ON IT. A key here is its name, because the name is the one
    thing the fork keeps per item in a pack (Inventory::Entry's name; nothing
    else on an entry is ours to write). A master key has to stop working twice
    over: when the holding changes hands, and when a new one is cut for a lost
    one. Both mean the server has to tell the master key in the pack from an
    older one with the same building on it, and the only place that can be
    told is the name. So each one is cut with the next number of a counter
    that only ever goes up and is kept in the register (masters in
    property.json): "Master key to Breezehome, no. 12". The claim names the
    number and the profile it was cut for (claim.master), and a master key
    opens only while its name is that number and that profile still holds
    the building. A lapse or an eviction drops the claim, and a deed
    presented at the door writes a new one, so the old number names nothing.
    The counter never goes back, so a number is never handed out twice, and
    a key from a lapsed holding cannot match the next holder's.

    THE RECORD is ThornswoodMiscMasterKey in Thornswood-Content.esp (scripts/
    mods/Add-ContentRecords.py), a MISC on the key's mesh, with no recipe. The
    gamemode and the plugin reach the server by different roads, so until the
    server's plugin carries the record (mastersExist) none is handed or cut,
    and everything else about property is as it was.
  */
  var MASTER_KEY = '154e0:Thornswood-Content.esp';
  var MASTER_INGOTS = 2;   // Patrick, #2254: re-cut from the mold for 2 iron ingots

  function masterLabel(building, no) { return 'Master key to ' + nameOf(building) + ', no. ' + no; }

  /* Is the master key's record in the plugins this server loaded. See blankMoldsExist. */
  var mastersKnown = false;
  function mastersExist() {
    if (mastersKnown) { return true; }
    var id = idOf(MASTER_KEY);
    if (!id) { return false; }
    var found = null;
    try { found = mp.lookupEspmRecordById(id); } catch (e) { found = null; }
    if (found && found.record) { mastersKnown = true; }
    return mastersKnown;
  }

  /* The building's master key, while the person it was cut for holds it, or null. */
  function liveMaster(building) {
    var held = holderOf(building);
    if (!held || !held.master || !(held.master.no > 0)) { return null; }
    if (held.master.for !== held.by) { return null; }
    return held.master;
  }

  /* Does this person carry that building's master key, the one that works. */
  function holdsMasterKey(actorId, building) {
    var m = liveMaster(building);
    return !!m && holdsNamed(actorId, MASTER_KEY, masterLabel(building, m.no));
  }

  /* Every building whose working master key is in this pack, for the K panel. */
  function masterKeysOf(actorId) {
    var out = [];
    var baseId = idOf(MASTER_KEY);
    if (!baseId) { return out; }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return out; }
    var entries = (inv && inv.entries) || [];
    for (var b in claims) {
      if (!Object.prototype.hasOwnProperty.call(claims, b)) { continue; }
      var m = liveMaster(b);
      if (!m) { continue; }
      var want = masterLabel(b, m.no);
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e && e.count > 0 && e.baseId === baseId && String(e.name || '') === want) { out.push(b); break; }
      }
    }
    return out;
  }

  /*
    Cut a master key for the holding and put it in toActorId's pack: the
    next number, and the claim names it, so any master key cut before stops
    opening anything. Answers the number, or 0 when none was cut: the record
    is not on this server, or the pack could not take it, and then the claim
    and the counter are left as they were, so the old one still works.
  */
  function issueMaster(toActorId, building, held) {
    if (!held || !mastersExist()) { return 0; }
    var no = masterCut + 1;
    if (!giveNamed(toActorId, MASTER_KEY, masterLabel(building, no))) { return 0; }
    masterCut = no;
    held.master = { for: held.by, no: no };
    save();
    pushAll();
    return no;
  }

  function masterHandedLine(building) {
    return 'Its master key is in your pack: it opens ' + nameOf(building) + ' and turns its lock ' +
           'for whoever carries it, for as long as you hold the place.';
  }

  /* The holder themselves, standing here: not a deed carrier. See holderNearby. */
  function holderHere(actorId, held) {
    var near = [];
    try {
      var cell = String(mp.get(actorId, 'worldOrCellDesc') || '');
      var pos = mp.get(actorId, 'pos');
      if (cell && pos) { near = mp.getNeighborsByPosition(cell, pos) || []; }
    } catch (e) { near = []; }
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    var all = [actorId];
    for (var n = 0; n < near.length; n++) {
      if (near[n] !== actorId && online.indexOf(near[n]) !== -1) { all.push(near[n]); }
    }
    for (var i = 0; i < all.length; i++) {
      var pid = 0;
      try { pid = Number(mp.get(all[i], 'profileId')) || 0; } catch (e) { pid = 0; }
      if (pid && pid === held.by) { return { actorId: all[i], profileId: pid }; }
    }
    return null;
  }

  /*
    A MASTER KEY CUT AGAIN, at a forge, by a smith, from the building's mold,
    with the holder standing there, for two iron ingots (#2254). The mold key
    at a forge sends it (/key, the forge's id, and master), beside the lock
    key's ordinary key; nobody types it. The smith pays the ingots, as for a
    key, and the master key goes to the holder, because it is cut for them,
    the way a mold goes to the holder and not to the smith. The holder has to
    be there for the same reason a mold needs them: nothing is cut for a
    house while its holder is offline. The new one replaces the old.
  */
  function cutMasterKey(actorId, profileId, toProfile, parts) {
    if (!isSmith(actorId)) {
      toProfile(profileId, 'Cutting a master key is a smith\'s work. Hand the mold to a smith.');
      return true;
    }
    var forge = forgeHere(parts, actorId);
    if (!forge) {
      toProfile(profileId, 'Stand at a forge and look at it, then press the key the line ' +
                           'under the crosshair names.');
      return true;
    }
    var unfit = unfitToMake(actorId, forge);
    if (unfit) {
      toProfile(profileId, unfit);
      return true;
    }
    var noHammer = toolGate(actorId, 'smith');
    if (noHammer) {
      toProfile(profileId, noHammer);
      return true;
    }
    if (!mastersExist()) {
      toProfile(profileId, 'There are no master keys on this server yet, so there is none to cut.');
      return true;
    }
    var building = moldInHand(actorId);
    if (!building) {
      toProfile(profileId, 'A master key comes off the key mold of the place it opens, and you ' +
                           'are carrying none.');
      return true;
    }
    var held = holderOf(building);
    if (!held) {
      toProfile(profileId, 'Nobody holds ' + nameOf(building) + ', so there is nobody to cut its ' +
                           'master key for. It can be claimed for nothing.');
      return true;
    }
    var owner = holderHere(actorId, held);
    if (!owner) {
      toProfile(profileId, held.name + ' holds ' + nameOf(building) + ' and has to be standing ' +
                           'here. A master key is cut for the holder, with the holder there.');
      return true;
    }
    if (!takeItem(actorId, KEY_INGOT, MASTER_INGOTS)) {
      toProfile(profileId, 'A master key is cut from ' + MASTER_INGOTS + ' iron ingots, and you are ' +
                           'carrying fewer.');
      return true;
    }
    var had = !!(held.master && held.master.for === held.by);
    var no = issueMaster(owner.actorId, building, held);
    if (!no) {
      addItem(actorId, KEY_INGOT, MASTER_INGOTS);
      toProfile(profileId, 'The master key could not be handed over. Say so in the dev channel.');
      return true;
    }
    plog('master key no.', no, 'to', nameOf(building), 'was cut at a forge for', held.name);
    var mine = owner.actorId === actorId;
    toProfile(profileId, 'You cut a master key to ' + nameOf(building) +
                         (mine ? ' and it is in your pack.' : ' and hand it to ' + held.name + '.') +
                         (had ? ' The master key cut before it no longer opens anything.' : ''));
    var wornHammer = wearTool(actorId, 'smith');
    if (wornHammer) { toProfile(profileId, wornHammer); }
    if (!mine && owner.profileId !== profileId) {
      toProfile(owner.profileId, 'The new master key to ' + nameOf(building) + ' is in your pack.' +
                                 (had ? ' The one cut before it no longer opens anything.' : ''));
    }
    return true;
  }

  /*
    Is the blank key mold's recipe in the plugins this server loaded.

    Asked of the engine rather than assumed from the gamemode, because the
    gamemode and the plugin ship by different roads: this file goes up with
    Deploy-DevGamemode, the plugin only with -LoadOrder and only once the Nexus
    collection carries it. mp.getIdFromDesc is arithmetic on the load order and
    answers a number for a record that is not there, so the lookup is what
    says whether it exists.

    Remembered once it is true. A plugin does not lose a record while the
    server is running, and asking the engine on every /mold is not free.
  */
  var BLANK_MOLD_RECIPE = '15496:Thornswood-Content.esp';
  var blankMoldsKnown = false;
  function blankMoldsExist() {
    if (blankMoldsKnown) { return true; }
    var id = idOf(BLANK_MOLD_RECIPE);
    if (!id) { return false; }
    var found = null;
    try { found = mp.lookupEspmRecordById(id); } catch (e) { found = null; }
    if (found && found.record) { blankMoldsKnown = true; }
    return blankMoldsKnown;
  }

  /*
    Take one BLANK mold out of this pack. A blank is a mold with no name on it:
    a stamped one says which door it is for and is somebody's property, so this
    steps over those and never spends one.

    Answers whether it found one.
  */
  function takeBlankMold(actorId) {
    var baseId = idOf(MOLD);
    if (!baseId) { return false; }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return false; }
    var entries = (inv && inv.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !(e.count > 0) || e.baseId !== baseId) { continue; }
      if (e.name) { continue; }
      if (e.count > 1) { e.count = e.count - 1; }
      else { entries.splice(i, 1); }
      try { mp.set(actorId, 'inventory', { entries: entries }); } catch (e2) { return false; }
      return true;
    }
    return false;
  }

  /** The building whose mold is in this pack, or null. One at a time is enough. */
  function moldInHand(actorId) {
    var baseId = idOf(MOLD);
    if (!baseId) { return null; }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return null; }
    var entries = (inv && inv.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !(e.count > 0) || e.baseId !== baseId) { continue; }
      var label = String(e.name || '');
      for (var b in BUILDING_NAME) {
        if (!Object.prototype.hasOwnProperty.call(BUILDING_NAME, b)) { continue; }
        if (label === moldLabel(b)) { return b; }
      }
    }
    return null;
  }

  /** Is this a smith. Both halves, because both of them work a forge. */
  function isSmith(actorId) {
    var C = g.__thornswoodCharacter;
    if (!C || !C.stateOf) { return true; }
    try {
      var s = C.stateOf(actorId);
      return !!s && String(s.prof || '').toLowerCase() === 'smith';
    } catch (e) {
      return true;
    }
  }

  /*
    THE FORGE UNDER THE CROSSHAIR (#1637). At a forge, with a key mold that
    has been pressed into a door in the pack, the lock key sends /key and the
    forge's form id in hex, the way the mold key sends a door's. The id is a
    hint and this is the gate: a forge the bench table knows, and the person
    standing at it by the server's own reckoning, MOLD_REACH, for the reasons
    given over it. With no id, the forge they last pressed, as before.
    Answers that forge's reference, or 0: the craft gate reads which bench
    it is (unfitToMake, #1733).
  */
  var KEY_INGOT = '5ace4:Skyrim.esm';   // Iron Ingot, the Key's input at a forge

  function forgeHere(parts, actorId) {
    var raw = String((parts && parts[1]) || '');
    if (!raw) { return atForge(actorId); }
    if (!/^[0-9a-f]{1,8}$/i.test(raw)) { return 0; }
    var refrId = parseInt(raw, 16);
    var base = '';
    try { base = String(mp.get(refrId, 'baseDesc') || ''); } catch (e) { return 0; }
    if (!Object.prototype.hasOwnProperty.call(BENCH_BY_BASE, base) ||
        BENCH_BY_BASE[base] !== FORGE) { return 0; }
    var far = distanceTo(actorId, refrId);
    return (far >= 0 && far <= MOLD_REACH) ? refrId : 0;
  }

  /** The forge they just pressed, or 0. The bench tables already know which is one. */
  function atForge(actorId) {
    var v = null;
    try { v = mp.get(actorId, DOOR_PROPERTY); } catch (e) { v = null; }
    // The forge is remembered the same way a door is; see touchedBench.
    var w = null;
    try { w = mp.get(actorId, BENCH_PROPERTY); } catch (e) { w = null; }
    if (!w || typeof w !== 'object') { return 0; }
    if ((Date.now() - (Number(w.at) || 0)) > DOOR_MEMORY_MS) { return 0; }
    return String(w.bench || '') === FORGE ? (Number(w.ref) || 0) : 0;
  }

  /** The bench they just pressed, which and what kind, written down the way a door is. */
  function touchedBench(actorId, baseDesc, refrId) {
    if (!Object.prototype.hasOwnProperty.call(BENCH_BY_BASE, baseDesc)) { return; }
    try {
      mp.set(actorId, BENCH_PROPERTY, { bench: BENCH_BY_BASE[baseDesc], ref: Number(refrId) || 0, at: Date.now() });
    } catch (e) { }
    nameBenchStock(actorId, Number(refrId) || 0);
  }

  /*
    THE OWNER'S CHESTS FEED THE BENCH (#3159). Patrick, 22 Oct: a bench draws
    materials from chests you own in the same building.

    THE GAME CANNOT DO IT ALONE. Its crafting menu lists only what the pack
    holds, and the server took every input out of the pack and refused one the
    pack lacked, so a chest beside the bench was no use. The engine now has a
    bench's stock (craftStock, fork #116): the containers named here when the
    bench is pressed open as the person takes that bench and close when they
    leave it. While open, the pack the client is sent has the chests' plain
    items in it as well, so the menu lists them, and a craft takes from the
    pack first and from the chests for the rest. onCraft is told which part
    came out of which chest (its eighth argument), and benchStock below is
    asked again there, because the building may have changed hands since.

    "Chests you own in the same building" is read the way the property rules
    read storage: every container standing in the bench's cell, when the cell
    is a building and the person pressing holds it (holderOf, so a lapsed
    claim is no claim). A partner with the master key or a guest is not the
    holder, and a bench outdoors is in no building, so both get the pack
    alone. Furniture chests the holder set down are containers in the cell
    like the rest. The nearest chest to the bench is drawn from first.

    A press on anything that is not a bench leaves the last one named, and
    that does no harm: a stock opens only at its own bench, and the engine
    drops it when another bench is taken or this one is left.
  */
  var STOCK_PROPERTY = 'craftStock';
  var stockWarned = false;

  /* The containers this person's bench may draw from: theirs, in its building, nearest first. */
  function stockFor(actorId, benchId) {
    if (!benchId) { return []; }
    var cell = '', pos = null;
    try {
      cell = String(mp.get(benchId, 'worldOrCellDesc') || '');
      pos = mp.get(benchId, 'pos');
    } catch (e) { return []; }
    if (!cell || !pos) { return []; }
    var held = holderOf(cell);
    var pid = 0;
    try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
    if (!held || !pid || held.by !== pid) { return []; }
    var near = [];
    try { near = mp.getNeighborsByPosition(cell, pos) || []; } catch (e) { return []; }
    var found = [];
    for (var i = 0; i < near.length; i++) {
      var id = near[i];
      if (!id || id === actorId || id === benchId) { continue; }
      var its = '', base = '', at = null;
      try {
        its = String(mp.get(id, 'worldOrCellDesc') || '');
        base = String(mp.get(id, 'baseDesc') || '');
        at = mp.get(id, 'pos');
      } catch (e) { continue; }
      if (its !== cell || !at || !kindIsContainer(base)) { continue; }
      var dx = at[0] - pos[0], dy = at[1] - pos[1], dz = at[2] - pos[2];
      found.push({ id: id, d: dx * dx + dy * dy + dz * dz });
    }
    found.sort(function (a, b) { return a.d - b.d || a.id - b.id; });
    return found.map(function (f) { return f.id; });
  }

  /*
    Named on the press, before the engine opens the bench. A container in a
    held building loses what its days have taken when it is opened (the
    durability block's dull clock), so each chest is brought up to date the
    same way before its contents are shown at the bench.
  */
  function nameBenchStock(actorId, benchId) {
    var from = stockFor(actorId, benchId);
    var wear = g.__thornswoodDurability;
    for (var i = 0; i < from.length; i++) {
      if (wear && wear.opened) {
        try { wear.opened(from[i]); } catch (e) { plog('the dull clock threw on', from[i].toString(16), 'at a bench:', e); }
      }
    }
    try {
      mp.set(actorId, STOCK_PROPERTY, from.length ? { bench: benchId, from: from } : null);
    } catch (e) {
      // An engine before fork #116 has no such property, and says so on
      // every press; once is enough to know which engine this is.
      if (!stockWarned) {
        stockWarned = true;
        plog('a bench could not be given its chests (craftStock):', e);
      }
    }
  }

  /*
    At the craft: the chests open at this bench, and a refusal when the craft
    draws on them and they are no longer this person's. draws is onCraft's
    eighth argument, what the engine is about to take from them; the engine
    takes nothing from either the pack or the chests when this refuses.
    Somebody who lost the building while standing at its bench has the
    stock taken away there and then, so the next pack they are sent is
    their own.
  */
  function benchStock(actorId, benchId, draws) {
    var s = null;
    try { s = mp.get(actorId, STOCK_PROPERTY); } catch (e) { s = null; }
    if (!s || !s.open || Number(s.bench) !== Number(benchId) || !Array.isArray(s.from)) {
      return { from: [], refusal: '' };
    }
    var cell = '';
    try { cell = String(mp.get(benchId, 'worldOrCellDesc') || ''); } catch (e) { cell = ''; }
    var held = cell ? holderOf(cell) : null;
    var pid = 0;
    try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
    if (held && pid && held.by === pid) { return { from: s.from.slice(), refusal: '' }; }
    try { mp.set(actorId, STOCK_PROPERTY, null); } catch (e) { }
    if (Array.isArray(draws) && draws.length) {
      return { from: [], refusal: 'The chests here are not yours any more, so the bench has only what you carry.' };
    }
    return { from: [], refusal: '' };
  }

  /*
    The holder of this building, if they are standing near this person.

    'Near' is the engine's own answer: getNeighborsByPosition is what the server
    uses everywhere else to mean 'people who can see each other'. Somebody who is
    not online is not in it, which is the whole point.

    IT WAS NEVER ASKED PROPERLY, so until 24 September nobody but the person
    pressing could ever count as the holder standing there. Read in the fork:
    ScampServer::GetNeighborsByPosition takes a cell or world descriptor and a
    position, and NapiHelper::ExtractString throws on anything that is not a
    string. This passed the actor's form id alone, so every call threw into
    its own catch and the list was always empty, so a smith cutting a mold for
    somebody else was told the holder was not there with the holder standing
    beside them: test-mold-key.js runs the old body against an engine that
    answers the way the fork does, and that is what it says. The farming
    block's nearestPlot asks it the right way, and so does this now.

    PEOPLE ONLY. The engine hands back everything in the squares around a
    position, chests and NPCs with it, and a chest with the deed in it is not
    a householder at the door. So only the people online are looked at. The
    same filter steps over the empty slots a server built before #529 puts at
    the front of the list (the fork made the array at its full length and then
    appended); the fork now hands back the ids alone.

    THE HOLDER BEFORE ANY DEED, AND THE PRESSER BEFORE ANYBODY NEARBY (#529).
    It used to take the first person it came to who was either, neighbours
    first, so somebody standing there with a stolen deed was handed the mold
    ahead of the holder beside them. Now the holder counts first, wherever
    they stand in the list, and a deed carrier only when the holder is not
    there; within each, the person pressing is asked before anybody else.
  */
  function holderNearby(actorId, building, held) {
    var near = [];
    try {
      var cell = String(mp.get(actorId, 'worldOrCellDesc') || '');
      var pos = mp.get(actorId, 'pos');
      if (cell && pos) { near = mp.getNeighborsByPosition(cell, pos) || []; }
    } catch (e) { near = []; }
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    var all = [actorId];
    for (var n = 0; n < near.length; n++) {
      if (near[n] !== actorId && online.indexOf(near[n]) !== -1) { all.push(near[n]); }
    }
    var pids = [];
    for (var i = 0; i < all.length; i++) {
      var pid = 0;
      try { pid = Number(mp.get(all[i], 'profileId')) || 0; } catch (e) { pid = 0; }
      pids.push(pid);
      if (pid && pid === held.by) { return { actorId: all[i], profileId: pid }; }
    }
    for (var j = 0; j < all.length; j++) {
      if (holdsDeed(all[j], building)) { return { actorId: all[j], profileId: pids[j] }; }
    }
    return null;
  }

  /*
    The claim whose ground covers this plot, or null.

    This is the half of 'a home and its farm are one claim' that the farming
    block reads. It is asked BEFORE farming looks at its own claims, so ground
    outside somebody's front door belongs to the house rather than to whoever
    said /claim in the field next to it.

    The radius is the farming block's own, because two different radii would be
    two different sizes of farm depending on which half of the code you asked.
  */
  function coversGround(ground) {
    if (!ground || !ground.cell || !ground.pos) { return null; }
    var radius = 1200;
    var P = g.__thornswoodProgression;
    try {
      var n = P.TABLE.tuning.farming.claimRadius;
      if (typeof n === 'number' && n > 0) { radius = n; }
    } catch (e) { }
    var within = radius * radius;
    for (var b in claims) {
      if (!Object.prototype.hasOwnProperty.call(claims, b)) { continue; }
      var c = claims[b];
      if (!c.ground || c.ground.cell !== ground.cell) { continue; }
      var dx = c.ground.pos[0] - ground.pos[0];
      var dy = c.ground.pos[1] - ground.pos[1];
      if ((dx * dx + dy * dy) > within) { continue; }
      if (!holderOf(b)) { continue; }
      return { by: c.by, name: c.name, building: b, property: nameOf(b) };
    }
    return null;
  }


  /*
    ------------------------------------------- the hold's ledger and its board

    Patrick's design, 21 September: a notice's fee goes to the hold, and
    rent, Merchant's Guild price lists and Free Skyrim Trading Company
    payment are the hold's business too. funds is each hold's ledger of what
    has been paid in, a record on the server; notices are what hang on its
    board.

    THE HOLD'S BOX IS THE ONE ON ITS BOARD (#2298). Patrick, 15 October,
    decision 3 A: the container a steward used to mark as a hold's box from
    the Office page is retired, and the drop box on the board's post is the
    only box. Its rules are the drop box block below. A chest that was
    marked is an ordinary container again, and Skyrim decides what goes in
    it, as for any other.

    Standing at a hold's board is standing at the hold (boardHere): within
    reach of the board's spot. A steward who moves the board moves its box
    with it.
  */
  var funds = loadPart('funds', {});
  var notices = loadPart('notices', {});
  var GOLD_ID = 0x0000000F;
  var NOTICE_FEE = 20;
  var JOB_FEE = 30;
  /*
    A POST HAS A TITLE AND A BODY (#2554). Patrick, 15 Oct: "the Jobs and
    Notices need a title and a body", the title up to 60 characters and the
    body up to 600, both required. The server checks both, not only the
    page, and refuses before any gold is taken.
  */
  var POST_TITLE_CHARS = 60;
  var POST_BODY_CHARS = 600;
  /*
    A LETTER, #1374. 35 gold up front, the same for everybody. LETTER_FEE is
    the board's and stays on the hold's ledger like a notice's. LETTER_PAY is
    the courier's: it is counted on the same ledger while the letter is up and
    paid back out of it, to the courier on delivery or to the sender on an
    /unpin. It is the sender's gold moved, never new gold. There is no
    courier cooldown; the sender's gold is the limit.

    LETTER_REACH is the trade's 700 units, about 10 metres, which is the reach
    the page gives a delivery. deliver reads the trade block's own number when
    that block is loaded, so the two cannot drift apart.
  */
  var LETTER_FEE = 20;
  var LETTER_PAY = 15;
  var LETTER_CHARS = 300;
  var LETTER_REACH = 700;

  function loadPart(key, fallback) {
    try {
      var o = JSON.parse(require('fs').readFileSync(registerPath(), 'utf8'));
      var v = o && o[key];
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) {
      return fallback;
    }
  }

  /** The hold whose notice board this character is standing at, or ''. */
  function holdStanding(actorId) {
    return boardHere(actorId) || '';
  }

  /*
    COIN ONTO A HOLD'S LEDGER, FROM WHATEVER TOOK IT (#1394).

    The notice and job fees count themselves where they are taken, in post
    below. A carriage or ferry fare is taken by the carriages block, and the
    company's haul (#1393) will be another, so the counting is one function
    with a reason rather than each of them reaching into funds. The coin has
    already left a pack when this is called: this counts it, the way a
    notice fee is counted, and creates nothing.

    The ten holds are the ten every ledger in this file uses. Any other name
    is refused rather than opened, so a slip in a caller cannot start a
    treasury nobody can find. So is anything but a whole number above 0:
    taking coin back off a ledger is a payout, and that is its own word.
  */
  var LEDGER_HOLDS = ['whiterun', 'solitude', 'riften', 'markarth', 'windhelm',
                      'falkreath', 'morthal', 'dawnstar', 'winterhold', 'ravenrock'];

  function deposit(hold, amount, reason) {
    var key = String(hold || '').toLowerCase();
    var n = Number(amount);
    if (LEDGER_HOLDS.indexOf(key) < 0) { return false; }
    if (!Number.isInteger(n) || n <= 0) { return false; }
    funds[key] = (Number(funds[key]) || 0) + n;
    save();
    plog(n, 'gold onto', key + '\'s ledger:', String(reason || 'no reason given'));
    return true;
  }

  /*
    COIN OFF A HOLD'S LEDGER (#1393), deposit's other half.

    Only the payouts docs/systems/trading-company.md names take coin off a
    ledger: a haul's pay to its hauler, and a haul's pay back to its poster.
    A letter's 15 is the other, and payHeld pays that. The caller puts the
    same count back into a pack in the same step (payOut), so the coin was
    already in the world: this counts it off, and creates nothing.

    HELD PAY STAYS ON THE LEDGER. An open letter's 15 (#1374: letter, not
    down, pay above 0), an open haul's pay and an open job's reward (#2554)
    are counted here until they are paid or handed back, and so is gold owed
    to somebody who was away when it came down (owed, see handHaul). A withdrawal never takes
    them: what is left after it is never less than what is still held, so a
    courier or a hauler is never refused because the ledger was spent.
    `releasing` is the one letter, haul or job on this hold's board whose own held
    gold this is, so paying a haul out of its own pay is not refused for
    being held, and never more than it holds.

    mayWithdraw answers why not, or '' when it may. withdraw takes it off
    and answers true, or false with nothing changed.
  */
  /** What one post holds on its ledger: an open letter's or haul's pay, a job's reward, or gold owed. */
  function noticeHolds(x) {
    // Letters and hauls are jobs too (job: true), so this is every one of them.
    if (!x || !x.job) { return 0; }
    // Owed: a haul's gold, or a letter's 15 a guard sent back (#502), held
    // for somebody who was away.
    var owed = Math.floor(Number(x.owed)) || 0;
    if (owed > 0) { return owed; }
    if (x.down) { return 0; }
    var pay = Math.floor(Number(x.pay)) || 0;
    return pay > 0 ? pay : 0;
  }

  function heldOn(hold, releasing) {
    var list = notices[hold] || [];
    var held = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] !== releasing) { held += noticeHolds(list[i]); }
    }
    return held;
  }

  function mayWithdraw(hold, amount, releasing) {
    var key = String(hold || '').toLowerCase();
    var n = Number(amount);
    if (LEDGER_HOLDS.indexOf(key) < 0) { return 'that is not one of the ten ledgers.'; }
    if (!Number.isInteger(n) || n <= 0) { return 'that is not a whole number of gold.'; }
    if (releasing) {
      if ((notices[key] || []).indexOf(releasing) < 0 || !noticeHolds(releasing)) { return 'that is not held on ' + key + '\'s ledger.'; }
      if (n > noticeHolds(releasing)) { return 'that is more than it holds.'; }
    }
    var have = Number(funds[key]) || 0;
    var held = heldOn(key, releasing || null);
    if (have - n < held) {
      return key + '\'s ledger has ' + have + ' gold, and ' + held + ' of it is held for letters, hauls and jobs.';
    }
    return '';
  }

  function withdraw(hold, amount, reason, releasing) {
    if (mayWithdraw(hold, amount, releasing)) { return false; }
    var key = String(hold).toLowerCase();
    var n = Number(amount);
    funds[key] = (Number(funds[key]) || 0) - n;
    save();
    plog(n, 'gold off', key + '\'s ledger:', String(reason || 'no reason given'));
    return true;
  }

  /*
    ------------------------------------- THE DROP BOX ON THE BOARD (#2298)

    Patrick, 12 October, every rule below is his:
      - The box sits on a shelf on the board's right post, and E on it does
        only the box; E on the board does only the board.
      - What goes in: gold (rent among it), and the Free Skyrim Trading
        Company's drop offs, left for somebody who was not there to take
        them, which a steward hands out. Carriage and ferry fares go in by
        themselves, as real gold, each time a fare is paid.
      - Notice and job fees never go in. They leave the world and stay a
        record (funds, above), so the Court never has money it does not.
      - Anybody may take back what they put in, rent included: then the rent
        simply is not paid any more. That hold's officers may take anything.
      - Every deposit and every take is recorded with the character's name,
        what, how much and when.
      - A person sees only what they put in, gold too: only the gold they
        added, never the box's total. Only the officers see everything, and
        only they get the Records button: what is in it now, what has left,
        who added and who took what, and when.

    WHY THE SERVER'S RECORD IS THE BOX, AND NOT A CONTAINER. A Skyrim
    container shows whoever opens it everything in it, and the server sends a
    container's whole inventory to every client that has it in view
    (MpObjectReference::VisitProperties in the fork). So the box is an
    activator (ThornswoodDropBox) the server stands beside its board
    (standBoard, #2516), E on it is answered here with the box's own panel
    (boardActivated), and what is in the box is this record, one copy, never
    a count beside a chest that can drift from it. The box is at the board:
    standing at the board's spot is standing at the box (boardHere), as it
    always was.

    WHO IS AN OFFICER OF A HOLD (Patrick, 15 October, #2298 and #2551): that
    hold's Court, its Guards, its Jarl and its Steward, each a Discord role of
    that hold ("Whiterun Court", "Guard of Whiterun", "Jarl of Whiterun",
    "Steward of Whiterun"), read through officeOf. An officer of one hold is
    anybody at another hold's box (boxOfficer).

    Every line here comes from the box's own panel (game/ui/thornswood-box.js)
    and is never typed (Patrick, 4 Oct: no chat commands for what people do).
  */
  var dropbox = loadPart('dropbox', {});
  var BOX_LOG_KEEP = 500;
  var BOX_RECORDS_SHOWN = 150;
  var BOX_FOR_CHARS = 60;
  var BOX_VIEW_PROPERTY = 'thornswoodBoxView';
  var boxViewScript = [
    '(function(){',
    '  try {',
    '    var v = ctx.value;',
    '    if (!v || typeof v !== "object") { return; }',
    '    var st = ctx.state;',
    '    if (!st) { return; }',
    '    if (st.thornswoodBoxAt === v.at) { return; }',
    '    st.thornswoodBoxAt = v.at;',
    '    var body = JSON.stringify(v);',
    '    var src = "(function(){try{" +',
    '      "var d=" + body + ";window.thornswoodBoxView=d;" +',
    '      "if(window.thornswoodBox&&window.thornswoodBox.setData){window.thornswoodBox.setData(d);}" +',
    '      "}catch(e){}})();";',
    '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
    '  } catch (e) { }',
    '})();'
  ].join('\n');
  try {
    mp.makeProperty(BOX_VIEW_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: boxViewScript, updateNeighbor: ''
    });
  } catch (e) { /* made by an earlier load. harmless. */ }

  function dropboxOf(hold) {
    var d = dropbox[hold];
    if (!d || typeof d !== 'object') { d = dropbox[hold] = {}; }
    if (!Array.isArray(d.items)) { d.items = []; }
    if (!Array.isArray(d.log)) { d.log = []; }
    if (!(Number(d.next) > 0)) { d.next = 1; }
    return d;
  }

  function characterName(actorId) {
    try {
      var ap = mp.get(actorId, 'appearance');
      if (ap && ap.name) { return String(ap.name); }
    } catch (e) { }
    return 'somebody';
  }

  /*
    An item's name for the panel and the record. A stack with a name of its
    own (a key, a deed) keeps it; gold is gold; anything else is named out of
    the two generated name tables /give reads, when this file has them.
  */
  var boxNames = null;
  function itemName(entry) {
    if (entry && typeof entry.name === 'string' && entry.name) { return entry.name; }
    var base = Number(entry && entry.baseId) || 0;
    if (base === GOLD_ID) { return 'Gold'; }
    if (!boxNames) {
      boxNames = {};
      var tables = [];
      if (typeof ITEM_NAMES !== 'undefined') { tables.push(ITEM_NAMES); }
      if (typeof ADMIN_ITEMS !== 'undefined') { tables.push(ADMIN_ITEMS); }
      for (var t = 0; t < tables.length; t++) {
        for (var k in tables[t]) {
          if (!Object.prototype.hasOwnProperty.call(tables[t], k)) { continue; }
          var row = tables[t][k];
          var at = String((row && row[1]) || '').toLowerCase();
          if (at && !Object.prototype.hasOwnProperty.call(boxNames, at)) { boxNames[at] = row[0]; }
        }
      }
    }
    var desc = '';
    try { desc = String(mp.getDescFromId(base) || '').toLowerCase(); } catch (e) { desc = ''; }
    if (desc && Object.prototype.hasOwnProperty.call(boxNames, desc)) { return boxNames[desc]; }
    return desc ? 'something (' + desc + ')' : 'something';
  }

  /*
    May this person take anything out of this hold's box: its officers.
    Patrick, 15 October (#2298, #2551): that hold's Court, Guards, Jarl and
    Steward, each by their Discord role, and only at that hold's box. A
    Steward is an officer only at their own hold's box.
  */
  function boxOfficer(hold, profileId) {
    var pid = Number(profileId) || 0;
    if (!pid || !hold) { return false; }
    return isGuard(pid, hold) || isCourtOf(pid, hold) || isStewardOf(pid, hold);
  }

  function boxLog(hold, row) {
    var d = dropboxOf(hold);
    row.at = Date.now();
    d.log.push(row);
    if (d.log.length > BOX_LOG_KEEP) { d.log.splice(0, d.log.length - BOX_LOG_KEEP); }
  }

  /*
    What the box's panel shows this person. Filtered here, never in the page:
    somebody who is not an officer is sent their own rows and nothing else,
    and never the box's total.
  */
  function boxView(actorId, profileId, hold, said, withRecords) {
    var d = dropboxOf(hold);
    var officer = boxOfficer(hold, profileId);
    var rows = [];
    var mineGold = 0;
    var allGold = 0;
    for (var i = 0; i < d.items.length; i++) {
      var it = d.items[i];
      var gold = Number(it.baseId) === GOLD_ID ? (Number(it.count) || 0) : 0;
      allGold += gold;
      var mine = Number(it.by) === Number(profileId) && Number(it.by) > 0;
      if (mine) { mineGold += gold; }
      if (!mine && !officer) { continue; }
      rows.push({ n: it.n, who: it.name || 'somebody', what: it.what || 'something',
                  count: Number(it.count) || 0, at: Number(it.at) || 0, forName: it.forName || '',
                  kind: it.kind || '', mine: mine, gold: !!gold });
    }
    var pack = [];
    var packGold = 0;
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { inv = null; }
    var entries = (inv && inv.entries) || [];
    for (var p = 0; p < entries.length; p++) {
      var e = entries[p];
      if (!e) { continue; }
      if (Number(e.baseId) === GOLD_ID) { packGold += Number(e.count) || 0; continue; }
      if (e.worn || e.wornLeft) { continue; }
      pack.push({ slot: p, what: itemName(e), count: Number(e.count) || 0 });
    }
    var view = {
      open: true, hold: hold, where: (boards[hold] && boards[hold].where) || HOLD_TOWN[hold] || hold,
      officer: officer, rows: rows, mineGold: mineGold, packGold: packGold, pack: pack,
      said: said || ''
    };
    if (officer) {
      view.allGold = allGold;
      if (withRecords) {
        var recs = [];
        for (var r = d.log.length - 1; r >= 0 && recs.length < BOX_RECORDS_SHOWN; r--) {
          var l = d.log[r];
          recs.push({ at: l.at, act: l.act, who: l.whoName || 'somebody', by: l.byName || '',
                      what: l.what || '', count: l.count, forName: l.forName || '', note: l.note || '' });
        }
        view.records = recs;
      }
    }
    return view;
  }

  var boxShownAt = 0;
  function showBox(actorId, view) {
    var payload = JSON.parse(JSON.stringify(view));
    boxShownAt = Math.max(Date.now(), boxShownAt + 1);
    payload.at = boxShownAt;
    try { mp.set(actorId, BOX_VIEW_PROPERTY, payload); } catch (e) {
      plog('could not send the drop box panel to', Number(actorId).toString(16) + ':', e);
    }
  }

  /*
    Gold in. Rent first, as putting gold in the box always did: what the
    payer owes on their places is paid down, and the entry remembers how much
    went to which place, so taking that gold back makes it owed again.
    What the payer still owes on a place they no longer hold (#3893) is paid
    first, then the places they hold.

    PAYING NEVER MOVES THE RENT CLOCK (#3891). Paying off everything owed
    used to start the clock again from the payment, which threw away the
    part of the period already gone: taking the gold back left the debt owed
    again on a clock that had moved, so it never grew, and paying just
    before each charge put the next one a whole period later. rentDue keeps
    since at the start of the period the place is in, and only rentDue
    moves it.
  */
  function boxPutGold(hold, actorId, profileId, amount) {
    var n = Math.floor(Number(amount));
    if (!(n > 0) || String(n) !== String(amount).trim()) { return 'Say how much gold, as a whole number.'; }
    if (!takeGold(actorId, n)) { return 'You do not have ' + n + ' gold in one purse.'; }
    var owed = rentOwedBy(profileId);
    var left = n;
    var rent = [];
    for (var i = 0; i < owed.length && left > 0; i++) {
      var take = 0;
      if (owed[i].before) {
        take = arrearsPay(owed[i].building, profileId, left);
      } else {
        var c = claims[owed[i].building];
        if (!c || !c.rent) { continue; }
        var due = Number(c.rent.owed) || 0;
        take = left >= due ? due : left;
        c.rent.owed = due - take;
      }
      if (take <= 0) { continue; }
      left -= take;
      rent.push(owed[i].before ? { building: owed[i].building, amount: take, before: true }
                               : { building: owed[i].building, amount: take });
    }
    var d = dropboxOf(hold);
    var who = characterName(actorId);
    var item = { n: d.next++, by: profileId, name: who, kind: 'gold', baseId: GOLD_ID, count: n,
                 what: 'Gold', at: Date.now() };
    if (rent.length) { item.rent = rent; }
    d.items.push(item);
    var paid = n - left;
    boxLog(hold, { act: 'in', n: item.n, who: profileId, whoName: who, by: profileId, byName: who,
                   what: 'Gold', count: n, note: paid ? paid + ' of it rent' : '' });
    save();
    plog(who, '(profile ' + profileId + ') put', n, 'gold in', hold + '\'s drop box', paid ? '(' + paid + ' of it rent)' : '');
    return 'You put ' + n + ' gold in the box.' + (paid ? ' ' + paid + ' of it pays your rent.' : '');
  }

  /*
    Something left for somebody: a Trading Company drop off for a person who
    was not there when it came. Only with a name on it, so the steward who
    hands it out knows whose it is. Worn things are not offered.
  */
  function boxLeave(hold, actorId, profileId, slot, count, forName) {
    var to = String(forName || '').trim().replace(/\s+/g, ' ');
    if (!to) { return 'Say who it is for.'; }
    if (to.length > BOX_FOR_CHARS) { return 'That name is too long.'; }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return 'Your pack could not be read.'; }
    var entries = (inv && inv.entries) || [];
    var at = Math.floor(Number(slot));
    var e = (at >= 0 && at < entries.length) ? entries[at] : null;
    if (!e || Number(e.baseId) === GOLD_ID) { return 'That is not in your pack.'; }
    if (e.worn || e.wornLeft) { return 'Take it off first.'; }
    var n = Math.floor(Number(count));
    if (!(n > 0) || n > (Number(e.count) || 0)) { return 'You do not have that many.'; }
    var kept = JSON.parse(JSON.stringify(e));
    delete kept.count; delete kept.worn; delete kept.wornLeft;
    e.count = (Number(e.count) || 0) - n;
    if (e.count <= 0) { entries.splice(at, 1); }
    try { mp.set(actorId, 'inventory', { entries: entries }); } catch (e2) { return 'Your pack could not be written.'; }
    var d = dropboxOf(hold);
    var who = characterName(actorId);
    var what = itemName(kept);
    var item = { n: d.next++, by: profileId, name: who, kind: 'left', baseId: Number(kept.baseId),
                 count: n, what: what, entry: kept, forName: to, at: Date.now() };
    d.items.push(item);
    boxLog(hold, { act: 'in', n: item.n, who: profileId, whoName: who, by: profileId, byName: who,
                   what: what, count: n, forName: to });
    save();
    plog(who, '(profile ' + profileId + ') left', n, what, 'for', to, 'in', hold + '\'s drop box');
    return 'You left ' + (n > 1 ? n + ' ' : '') + what + ' in the box for ' + to + '.';
  }

  /*
    What was on a market stall whose keeping ended (#3160), put in by the
    market stalls block rather than out of a pack. For its keeper, as if they
    had put it in themselves, so they take it back here like anything of
    theirs; with no keeper (their character was deleted) it is the hold's
    officers' to hand out. The receipt is kept on the row, so the same piece
    is never put in twice. Answers whether it is in the box and written.
  */
  function boxKeep(hold, entry, count, receipt, keeper, why) {
    var key = String(hold || '').toLowerCase();
    var n = Math.floor(Number(count));
    if (LEDGER_HOLDS.indexOf(key) < 0 || !(n > 0) || !entry || typeof receipt !== 'string' || !receipt) { return false; }
    var d = dropboxOf(key);
    for (var i = 0; i < d.items.length; i++) {
      if (d.items[i].receipt === receipt) { return true; }
    }
    var kept = JSON.parse(JSON.stringify(entry));
    delete kept.count; delete kept.worn; delete kept.wornLeft;
    var what = itemName(kept);
    var by = keeper ? (Number(keeper.profile) || 0) : 0;
    var name = keeper ? String(keeper.name || 'the stall\'s keeper') : 'A market stall';
    var item = { n: d.next++, by: by, name: name, kind: 'stall', baseId: Number(kept.baseId),
                 count: n, what: what, entry: kept, at: Date.now(), receipt: receipt };
    d.items.push(item);
    boxLog(key, { act: 'in', n: item.n, who: by, whoName: name, by: by, byName: name,
                  what: what, count: n, note: 'off a market stall: ' + String(why || '') });
    if (!save()) {
      d.items.pop();
      return false;
    }
    plog(n, what, 'off a market stall into', key + '\'s drop box:', String(why || ''));
    return true;
  }

  /*
    Something out. What you put in yourself, or anything if you are one of
    this hold's officers. Your own gold back undoes the rent it paid; an
    officer taking it leaves the rent paid.
  */
  function boxTake(hold, actorId, profileId, num, count) {
    var d = dropboxOf(hold);
    var at = -1;
    for (var i = 0; i < d.items.length; i++) {
      if (Number(d.items[i].n) === Math.floor(Number(num))) { at = i; break; }
    }
    if (at < 0) { return 'That is not in the box.'; }
    var it = d.items[at];
    var own = Number(it.by) > 0 && Number(it.by) === Number(profileId);
    if (!own && !boxOfficer(hold, profileId)) {
      return 'That is not yours to take. Only what you put in, unless you are one of this hold\'s officers.';
    }
    var have = Number(it.count) || 0;
    var n = (count === undefined || count === null || count === '') ? have : Math.floor(Number(count));
    if (!(n > 0) || n > have) { return 'There are not that many.'; }
    if (Number(it.baseId) === GOLD_ID) {
      if (!payOut(actorId, n)) { return 'Your pack could not be written.'; }
    } else {
      var inv = null;
      try { inv = mp.get(actorId, 'inventory'); } catch (e) { return 'Your pack could not be read.'; }
      var entries = (inv && inv.entries) || [];
      var give = JSON.parse(JSON.stringify(it.entry || { baseId: it.baseId }));
      give.count = n;
      entries.push(give);
      try { mp.set(actorId, 'inventory', { entries: entries }); } catch (e2) { return 'Your pack could not be written.'; }
    }
    var back = 0;
    if (own && Array.isArray(it.rent)) {
      /*
        The rent this gold paid, owed again, newest place first, never more
        than was taken, by whoever put it in. On the place itself while they
        still hold it with rent on it; on what they owe from before (#3893)
        when it paid that, or when the place has gone to somebody else since,
        so taking it back never lands it on the new holder. A place whose
        steward took the rent off while they held it owes nothing again.
      */
      var left = n;
      var payer = Number(it.by) || 0;
      for (var r = it.rent.length - 1; r >= 0 && left > 0; r--) {
        var row = it.rent[r];
        var amt = Math.min(left, Number(row.amount) || 0);
        var c = claims[row.building];
        var stillHolds = !!c && c.by === payer;
        if (amt > 0 && !row.before && stillHolds && c.rent) {
          c.rent.owed = (Number(c.rent.owed) || 0) + amt;
          back += amt;
        } else if (amt > 0 && (row.before || !stillHolds)) {
          arrearsAdd(row.building, payer, it.name, amt);
          back += amt;
        }
        row.amount = (Number(row.amount) || 0) - amt;
        left -= amt;
      }
      it.rent = it.rent.filter(function (x) { return (Number(x.amount) || 0) > 0; });
    }
    it.count = have - n;
    if (it.count <= 0) { d.items.splice(at, 1); }
    var who = characterName(actorId);
    boxLog(hold, { act: 'out', n: it.n, who: profileId, whoName: who, by: it.by, byName: it.name || '',
                   what: it.what || '', count: n, forName: it.forName || '',
                   note: back ? back + ' of it rent, owed again' : '' });
    save();
    plog(who, '(profile ' + profileId + ') took', n, it.what, 'out of', hold + '\'s drop box, put in by', it.name,
         back ? '(' + back + ' rent owed again)' : '');
    return 'You took ' + (n > 1 ? n + ' ' : '') + (it.what || 'it') + ' out of the box.' +
           (back ? ' ' + back + ' gold of rent is owed again.' : '');
  }

  /*
    A carriage or ferry fare, into the box of the hold the ride left from,
    as real gold, by itself (Patrick, 12 Oct). One running row per hold, put
    in by the hold rather than by a person, so nobody but its officers sees
    it; each fare is its own line in the record.
  */
  function boxFare(hold, amount, reason) {
    var key = String(hold || '').toLowerCase();
    var n = Number(amount);
    if (LEDGER_HOLDS.indexOf(key) < 0) { return false; }
    if (!Number.isInteger(n) || n <= 0) { return false; }
    var d = dropboxOf(key);
    var row = null;
    for (var i = 0; i < d.items.length; i++) {
      if (d.items[i].kind === 'fare') { row = d.items[i]; break; }
    }
    if (!row) {
      row = { n: d.next++, by: 0, name: 'Carriage and ferry fares', kind: 'fare', baseId: GOLD_ID,
              count: 0, what: 'Gold', at: Date.now() };
      d.items.push(row);
    }
    row.count = (Number(row.count) || 0) + n;
    boxLog(key, { act: 'in', n: row.n, who: 0, whoName: 'A fare', by: 0, byName: 'Carriage and ferry fares',
                  what: 'Gold', count: n, note: String(reason || '') });
    save();
    plog(n, 'gold of fare into', key + '\'s drop box:', String(reason || ''));
    return true;
  }

  /*
    Trade ship cargo nobody collected (#511, Patrick 22 Oct 2026: B). After
    the staff list's days at the dock it comes off the ship into this hold's
    box under the recipient's name, put in by the ship rather than a person,
    so the steward or another of the hold's officers hands it out, as with
    anything left for somebody. Answers the box row's number, or 0 when it
    is not in the box (and then nothing in the box changed).
  */
  function boxShipped(hold, entry, forName, fromName) {
    var key = String(hold || '').toLowerCase();
    var to = String(forName || '').trim().replace(/\s+/g, ' ');
    var n = Number(entry && entry.count);
    if (LEDGER_HOLDS.indexOf(key) < 0 || !to || to.length > BOX_FOR_CHARS) { return 0; }
    if (!Number.isInteger(n) || n <= 0 || Number(entry.baseId) === GOLD_ID) { return 0; }
    var kept = JSON.parse(JSON.stringify(entry));
    delete kept.count; delete kept.worn; delete kept.wornLeft;
    var d = dropboxOf(key);
    var name = String(fromName || 'A trade ship');
    var what = itemName(kept);
    var item = { n: d.next++, by: 0, name: name, kind: 'shipped', baseId: Number(kept.baseId),
                 count: n, what: what, entry: kept, forName: to, at: Date.now() };
    var logWas = d.log.slice();
    d.items.push(item);
    boxLog(key, { act: 'in', n: item.n, who: 0, whoName: name, by: 0, byName: name,
                  what: what, count: n, forName: to, note: 'Not collected from the ship' });
    if (!save()) {
      d.items.splice(d.items.indexOf(item), 1);
      d.log = logWas;
      d.next = item.n;
      return 0;
    }
    plog(n, what, 'nobody collected from a trade ship went into', key + '\'s drop box');
    return item.n;
  }

  /*
    /dropbox open                         what E on the box sends
    /dropbox gold <amount>                Put in
    /dropbox leave <slot> <count> <name>  Leave it for somebody
    /dropbox take <n> [count]             Take out
    /dropbox records                      an officer's Records
    Every one answers by drawing the panel again, with what happened in it.
  */
  function dropboxCmd(parts, actorId, profileId, toProfile) {
    var hold = boardHere(actorId);
    if (!hold) {
      toProfile(profileId, 'Stand at a hold\'s notice board to use its drop box.');
      return true;
    }
    var sub = (parts && parts.length > 1) ? String(parts[1]).trim().toLowerCase() : 'open';
    var said = '';
    var records = false;
    if (sub === 'gold') {
      said = boxPutGold(hold, actorId, profileId, parts[2]);
    } else if (sub === 'leave') {
      said = boxLeave(hold, actorId, profileId, parts[2], parts[3], (parts.slice(4) || []).join(' '));
    } else if (sub === 'take') {
      said = boxTake(hold, actorId, profileId, parts[2], parts[3]);
    } else if (sub === 'records') {
      records = boxOfficer(hold, profileId);
      if (!records) { said = 'Only this hold\'s officers keep the records.'; }
    } else if (sub !== 'open') {
      said = 'The box does not know that.';
    }
    showBox(actorId, boxView(actorId, profileId, hold, said, records));
    return true;
  }

  /*
    ------------------------------------------------------------------- rent

    A rented property is the same claim with an amount and a clock. The server
    owns everybody's pack, so it could take the rent by force; it does not, and
    that is deliberate. Patrick: rent is handed to a steward in person or put
    in the box. Both are acts by a person. What the server does is COUNT, and
    let the ordinary lapse do the rest.
  */
  function rentDue() {
    var out = [];
    for (var b in claims) {
      if (!Object.prototype.hasOwnProperty.call(claims, b)) { continue; }
      if (countRent(claims[b], Date.now())) { out.push(b); }
    }
    if (out.length) { save(); }
    return out;
  }

  /*
    The rent on one claim, counted in whole periods up to a time, and never
    past the moment it lapses (#3950): a claim nobody has gone into for the
    lapse days is no longer held, so a week after that is owed by nobody,
    even before anything reads the claim and drops it. Says whether it
    counted a period.
  */
  function countRent(c, upTo) {
    if (!c || !c.rent) { return false; }
    var days = lapseDays();
    var end = Number(upTo) || Date.now();
    if (days > 0) { end = Math.min(end, (Number(c.touched) || 0) + days * 86400000); }
    var every = Number(c.rent.everyDays) || 7;
    var since = Number(c.rent.since) || Number(c.at) || Date.now();
    var periods = Math.floor((end - since) / (every * 86400000));
    if (periods <= 0) { return false; }
    c.rent.owed = (Number(c.rent.owed) || 0) + periods * (Number(c.rent.amount) || 0);
    c.rent.since = since + periods * every * 86400000;
    return true;
  }

  /*
    A CLAIM ENDING DOES NOT END A DEBT. Whatever its holder owed, counted up
    to the moment it ends, stays theirs in arrears: when the deed goes to
    somebody else (#3893, Patrick, 27 Oct), and when a steward evicts or the
    claim lapses (#3950, Patrick, 27 Oct, A). The steward sees it at that
    door, the holder on their property page, and the box or Rent paid pays it.
  */
  function keepOwed(building, c, upTo) {
    if (!c || !c.rent) { return; }
    countRent(c, upTo);
    if ((Number(c.rent.owed) || 0) > 0) { arrearsAdd(building, c.by, c.name, c.rent.owed); }
  }

  // What this person owes, place by place: from before (#3893) first, then what they hold.
  function rentOwedBy(profileId) {
    rentDue();
    var out = [];
    for (var a in arrears) {
      if (Object.prototype.hasOwnProperty.call(arrears, a) && arrearsRow(a, profileId)) {
        out.push({ building: a, before: true });
      }
    }
    for (var b in claims) {
      if (!Object.prototype.hasOwnProperty.call(claims, b)) { continue; }
      var c = claims[b];
      if (c && c.by === profileId && c.rent && (Number(c.rent.owed) || 0) > 0) {
        out.push({ building: b, before: false });
      }
    }
    return out;
  }

  /*
    Who owes rent on this building, one row a person, for the steward at its
    door: the holder for what is owed now, and anybody who held it before
    for what they still owe from then (#3893). A holder who also owes from
    an earlier time here is one row with both together.
  */
  function rentOwing(building) {
    rentDue();
    var out = [];
    var held = holderOf(building);
    if (held && held.rent && (Number(held.rent.owed) || 0) > 0) {
      out.push({ pid: held.by, name: held.name, owed: Number(held.rent.owed) || 0, holds: true });
    }
    var list = Object.prototype.hasOwnProperty.call(arrears, building) ? arrears[building] : [];
    for (var i = 0; i < list.length; i++) {
      var mineToo = out.filter(function (x) { return x.pid === list[i].by; })[0];
      if (mineToo) { mineToo.owed += list[i].owed; continue; }
      out.push({ pid: list[i].by, name: list[i].name, owed: list[i].owed, holds: !!held && held.by === list[i].by });
    }
    return out;
  }

  /*
    RENT HANDED TO A STEWARD IN PERSON (#3895, Patrick, 27 Oct: A, a Rent
    paid button). The gold changes hands between two people, as the rent
    comment above says it does; the steward then presses Rent paid beside
    the tenant on the Office page, and this counts it. What they owe from
    before goes first, then what is owed now. It never moves the rent clock
    (#3891): the next rent falls due when it would have. It goes in the
    building's hold's drop box record beside the box's own payments, and a
    press by staff goes in the staff log as well.
  */
  function rentPaid(parts, actorId, profileId, toProfile, building, held, asStaff) {
    var pid = Math.floor(Number(parts[2])) || 0;
    var n = Number(parts[3]);
    if (!(pid > 0)) {
      toProfile(profileId, 'Say who paid.');
      return true;
    }
    if (!(n > 0) || Math.floor(n) !== n) {
      toProfile(profileId, 'Say how much gold was paid, as a whole number above 0.');
      return true;
    }
    var row = rentOwing(building).filter(function (x) { return x.pid === pid; })[0];
    if (!row) {
      toProfile(profileId, 'Nobody by that name owes rent on ' + nameOf(building) + '.');
      return true;
    }
    if (n > row.owed) {
      toProfile(profileId, row.name + ' owes ' + row.owed + ' gold on ' + nameOf(building) + ', not ' + n + '.');
      return true;
    }
    var left = n - arrearsPay(building, pid, n);
    if (left > 0 && held && held.by === pid && held.rent) {
      held.rent.owed = Math.max(0, (Number(held.rent.owed) || 0) - left);
    }
    var steward = personName(actorId);
    var hold = holdOfBuilding(building);
    if (hold && LEDGER_HOLDS.indexOf(hold) !== -1) {
      boxLog(hold, { act: 'rent', who: profileId, whoName: steward, by: pid, byName: row.name,
                     what: 'Gold', count: n, note: 'rent on ' + nameOf(building) + ', handed over in person' });
    }
    save();
    if (asStaff) {
      staffRecord('rentpaid', actorId, profileId, building, { by: pid, name: row.name },
                  n + ' gold of rent handed over in person, on ' + settleWhere(building));
    } else {
      plog(steward, '(profile ' + profileId + ') marked', n, 'gold of rent paid by', row.name,
           '(profile ' + pid + ') on', nameOf(building));
    }
    var still = row.owed - n;
    toProfile(profileId, (asStaff ? 'As staff: ' : '') + row.name + ' paid ' + n + ' gold of rent on ' +
              nameOf(building) + '. ' + (still > 0 ? still + ' is still owed.' : 'Nothing is owed now.') +
              (asStaff ? ' It is in the staff log.' : ''));
    redrawPanel(actorId);
    return true;
  }

  /*
    /rent                 what this place costs, and what is owed on it
    /rent 50              a steward sets it, per week
    /rent -               a steward waives it
    /rent paid <pid> <n>  a steward was handed n gold of it in person (#3895)

    Sent by Set rent, No rent and Rent paid on the Office page of the K panel (#1638),
    never typed; the page shows a steward what is owed at the door they just
    opened. See officeView. Only a steward of the building's hold sets or
    waives it (#2551, notStewardHere), or staff at any building, logged for
    staff (settleAs); anybody at the door reads it.
  */
  var OFFICE_AT_DOOR = 'Open the door of the building, then press the button on the Office page of K within a minute.';

  function rentCmd(parts, actorId, profileId, toProfile, cmd) {
    var building = here(actorId);
    if (!building) {
      toProfile(profileId, OFFICE_AT_DOOR);
      return true;
    }
    var held = holderOf(building);
    var arg = (parts && parts.length > 1) ? String(parts[1]).trim() : '';

    if (!arg) {
      rentDue();
      // And what the one asking still owes here from when they held it (#3893).
      var mineBefore = arrearsRow(building, profileId);
      var beforeLine = mineBefore ? ' You still owe ' + mineBefore.owed + ' gold of rent here from when you held it.' : '';
      if (!held || !held.rent) {
        toProfile(profileId, nameOf(building) + ' has no rent on it.' + beforeLine);
        return true;
      }
      toProfile(profileId, nameOf(building) + ': ' + held.rent.amount + ' gold every ' +
                (held.rent.everyDays || 7) + ' days, ' +
                (Number(held.rent.owed) || 0) + ' owed.' + beforeLine);
      return true;
    }

    // A steward, or staff at any door (#2551, settleAs).
    if (!isSteward(profileId) && !isStaffHere(profileId)) {
      toProfile(profileId, 'Only a steward sets rent.');
      return true;
    }
    var how = settleAs(profileId, building, cmd);
    if (!how.as) {
      toProfile(profileId, how.why);
      return true;
    }
    var asStaff = how.as === 'staff';
    // Somebody who held it before may still owe on it while nobody holds it (#3893).
    if (arg.toLowerCase() === 'paid') {
      return rentPaid(parts, actorId, profileId, toProfile, building, held, asStaff);
    }
    if (!held) {
      toProfile(profileId, 'Nobody holds ' + nameOf(building) + ', so there is nobody to pay.');
      return true;
    }
    if (arg === '-') {
      delete held.rent;
      save();
      if (asStaff) {
        staffRecord('norent', actorId, profileId, building, held, settleWhere(building));
      } else {
        plog('a steward waived the rent on', nameOf(building));
      }
      toProfile(profileId, (asStaff ? 'As staff: no' : 'No') + ' rent on ' + nameOf(building) + ' now.' +
                (asStaff ? ' It is in the staff log.' : ''));
      redrawPanel(actorId);
      return true;
    }
    var amount = Number(arg) || 0;
    if (amount <= 0) {
      toProfile(profileId, 'The rent is a number of gold above 0.');
      return true;
    }
    /*
      A new amount on a place that already pays rent changes what the next
      periods cost and nothing else: what is owed, counted up to now at the
      old amount, stays owed, and the clock goes on (#3895). Setting it again
      used to write owed 0 and a new clock, which was the only way a steward
      could clear rent handed to them in person; that is Rent paid now.
    */
    if (held.rent) {
      rentDue();
      held.rent.amount = amount;
      held.rent.everyDays = 7;
    } else {
      held.rent = { amount: amount, everyDays: 7, owed: 0, since: Date.now() };
    }
    save();
    if (asStaff) {
      staffRecord('rent', actorId, profileId, building, held, amount + ' gold every 7 days on ' + settleWhere(building));
    } else {
      plog('a steward set the rent on', nameOf(building), 'to', amount);
    }
    toProfile(profileId, (asStaff ? 'As staff: ' : '') + nameOf(building) + ' pays ' + amount + ' gold every 7 days now.' +
              (asStaff ? ' It is in the staff log.' : ''));
    redrawPanel(actorId);
    return true;
  }

  /*
    ------------------------------------------------------------------- beds

    WHOSE BED IT IS DECIDES THE REST, AND A BED IS ONE THE SERVER SAW
    (#1392, #1603).

    Patrick's answers on #1603, 4 Oct. The holder names who may sleep there,
    with buttons and not commands. A night is 8 hours. Nobody sells a night
    through the server: "they pay from a regular trade and then the owner can
    grant bed access". And the rest goes by common sense, up to your own bed:

      what you are resting on                            an hour   kind
      a seat                                               20      sit
      a bed or bedroll nobody can lend you                 25      rough
      a seat with a fire in reach                          35      campfire
      a bed or bedroll nobody can lend you, by a fire      45      camp
      an inn or temple bed nobody holds (#2246)            40      common
      the same, by a fire                                  45      commonfire
      a bed you are allowed in: a guest, a key, a deed     50      inn
      your own bed                                         80      bed

    The numbers live in NEEDS.recover in the needs block, and this hands it
    the kind. docs/systems/exhaustion.md has the same table.

    WHO IS ALLOWED. The holder sleeps in their own bed. A guest is somebody
    the holder looked at inside the building and let sleep there with the
    look prompt's key (sleepHere, below), for one night. Anybody carrying the
    building's key or its deed is allowed too, the two things that already
    open its locked door (mayPass). A bed in a building somebody else holds,
    who has let you do none of those, is refused. A bed in a building nobody
    holds, or out of doors, is nobody's to lend, and that is the 25, or the
    45 by a fire. A bedroll is a bed here: whose it is decides the rate, not
    what it is made of.

    A GUEST IS ONE NIGHT, NIGHT_MS from when the holder pressed the key, in
    every bed of that building. One night rather than until taken back,
    because a night is what was paid for in the trade, and the holder does
    not have to remember to end it. Somebody who lives there carries a key.
    The holder can end a night sooner, from the look prompt or from the
    property page in the K panel. A guest names the holder who let them in,
    so a building that changes hands does not keep the last holder's guests.

    HOW THE SERVER KNOWS A BED OR A SEAT. mp.onActivate is handed the
    furniture when somebody presses it, the same way it is handed a door, and
    the base's own record says what it is: a FURN whose editor id names a
    bed, a bedroll, or a chair, bench, stool or throne, read once per base
    through mp.lookupEspmRecordById and remembered. Any other FURN is
    furniture and nothing more: a forge, a chopping block, a lean. /rest then
    asks what this person last pressed and whether they are still within
    BED_REACH of it in the same cell. The word after /rest is not asked, and
    neither is the client's own guess at furniture: the plugin says /rest bed
    when somebody lies down and /rest sit when they sit, and the server
    answers by what was pressed. The building is the bed's own cell, the same
    way the take limit finds whose a chest is, because a building here is its
    interior cell.

    A FIRE IN REACH is the distance the client already reports for warmth,
    the needs block's own n.fire (docs/systems/temperature.md): a fire close
    enough to warm you is close enough to rest by.

    SIT ON THE EMOTE WHEEL IS A SEAT ON THE GROUND (#1631). Nothing is
    pressed and no line is sent for it, so the server reads what it can see:
    the engine's lastAnimEvent, the last animation the client sent for its
    own character, which the engine clears the moment they move. While that
    is the wheel's Sit, they are sitting, at the seat's 20, or the campfire's
    35 with a fire in reach, the same as a chair. Standing up, walking off or
    playing another emote ends it on the next measure, without a word, the
    way getting off a chair says nothing.

    WHILE THE PLACE IS TRUE. Every BED_EVERY_MS the places people are resting
    in are measured again: walk away, lose the key, let the night run out,
    move off from the fire, and the rest stops or changes rate. Somebody who
    comes into the world already resting in a place the server did not see
    them take stops too, and sits or lies down again.

    THE PLACE ENDS WITH THE SESSION (#1734). Nobody comes back into the world
    sitting or lying down, so the beds let go of where somebody sat or lay on
    the first tick that finds them gone, with who was seen and what they
    pressed. Coming back is then the same first sight as after a restart: up,
    once the needs block has counted a night in a bed (#1606, settle's
    arrival). Measured in the fork (engine/skymp at a247ef2): the
    only thing that puts a client's own character into furniture is the
    server's answer to a press (MpObjectReference::ProcessActivateNormal,
    FURN, SendOpenContainer, and the client's onOpenContainerMessage
    activating it). Who occupies a piece of furniture is held in memory and
    is not saved. PartOne::SetUserActor, which hands a reconnecting client its
    character, clears the last animation as well. On the client,
    thornswood-front.js's restSent starts false. Until #1734 the beds kept
    the record for 48 hours offline (LYING_FORGET_MS) and the first sight
    passed over anybody still in it. So somebody who logged out on a seat
    and came back without a restart was counted resting at the seat's rate
    while standing beside it, and was told they had left it when they walked
    off.

    NO GOLD MOVES FOR A NIGHT. It is paid in a trade between two people, and
    the server keeps no price. The book is beds.json beside the register
    rather than a field on a claim, so the register's own reader and writer
    are untouched. The book is guests and takings and nothing else: the
    prices and paid nights #1392's book held are not read (#3265). Kept gold
    is handed to its holder once, the next time they are in the world, and
    leaves the book then. Nothing adds to it any more.
  */
  // INVENTED: far enough to stand beside a double bed and press it, near
  // enough that the next room's bed is not this one.
  var BED_REACH = 200;
  // Patrick, #1603: a night is 8 hours, the time the Rest clock takes to empty.
  var NIGHT_MS = 8 * 3600000;
  var BED_EVERY_MS = 5000;
  var GUEST_NAME_MAX = 64;
  /* A bed by its editor id. Bedrolls first, since they say bed too. The
     others are words that hold the letters and are not beds. */
  var BEDROLL_EDID = /bedroll/i;
  var BED_EDID = /bed/i;
  var NOT_BED_EDID = /bedside|embed|riverbed|flowerbed/i;
  /* A seat by its editor id, the same way. A workbench is a bench to the
     letters and a crafting station to everybody else. */
  var SEAT_EDID = /chair|bench|stool|throne/i;
  var NOT_SEAT_EDID = /workbench|crafting/i;
  /* The emote wheel's Sit, by its event (thornswood-emotes.js), lowercased
     the way the engine's is compared. See the block. */
  var GROUND_SIT = 'idlesitcrossleggedenter';
  /* Every kind of rest this hands the needs block, and 'bedroll', the kind
     #1392 handed out, so somebody still resting at it is got up the same way. */
  var REST_KINDS = { sit: true, rough: true, campfire: true, camp: true, inn: true, bed: true,
                     common: true, commonfire: true, bedroll: true };

  /*
    AN INN OR A TEMPLE NOBODY HOLDS (#2246).

    Djinn, #dev-test-results, 26 Sep: survival starts too harsh, and where
    somebody rests or logs out should decide how much comes back: an inn or a
    temple the most, out in the wild the least. Until this, a bed in an inn
    nobody holds was "a bed nobody can lend you", the same 25 an hour as a
    bedroll on the road, and no logout fill. Every new character used to
    arrive in one of nine inns (CHARGEN), and arrives a short walk from one
    since #2622; none of those is held unless a person claimed it, so it is
    most new characters' first night.

    So the beds now know an inn or a temple when they see one, and hand the
    needs block two kinds of their own: common, a bed there, and commonfire,
    the same bed with a fire in reach. What each is worth, awake and at a
    logout, is NEEDS.recover and NEEDS.away in the needs block, the one table
    of the balance. Patrick's numbers, 12 Oct 2026 on #2246: 40 an hour
    awake, 45 by a fire, nothing drains while logged out there, and a night
    away gives full rest and 15 on hunger and thirst.

    WHAT AN INN OR A TEMPLE IS, read off the game's own records the way a
    bed is (bedKind): the room's CELL names its location (XLCN), and the
    location carries LocTypeInn or LocTypeTemple. Asked once per room through
    mp.lookupEspmRecordById and kept. Measured against the load order on
    11 Oct (Build-WakeTable.js's reader over every plugin switched on): 33
    rooms are inns and 17 are temples, every one of the nine arrival inns
    among them. A house the game sells as a home is not an inn, whatever
    else it carries: Riften's Honeyside has LocTypeInn as well as
    LocTypePlayerHouse. A held building is never this: its holder decides
    who sleeps there, as before.
  */
  var REST_PLACE_KEYWORDS = { LocTypeInn: 'inn', LocTypeTemple: 'temple' };
  var NOT_REST_PLACE_KEYWORDS = { LocTypePlayerHouse: true };
  var restPlaces = {};

  function u32At(b, at) {
    if (!b || b.length < at + 4) { return 0; }
    return ((b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000) || 0;
  }

  function recordField(rec, type) {
    var fields = (rec && rec.fields) || [];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i] && String(fields[i].type) === type) { return fields[i].data || null; }
    }
    return null;
  }

  function editorIdOf(rec) {
    var edid = rec ? textOf(rec.editorId) : '';
    return (edid || textOf(recordField(rec, 'EDID'))).replace(/\0+$/, '');
  }

  function globalFrom(res, local) {
    if (!local) { return 0; }
    if (!res || typeof res.toGlobalRecordId !== 'function') { return 0; }
    try { return Number(res.toGlobalRecordId(local)) || 0; } catch (e) { return 0; }
  }

  /* 'inn', 'temple', or '' for any other room or a worldspace, by the room's
     own records. An answer the engine could not give is '', the road. */
  function restPlaceOf(cellDesc) {
    cellDesc = String(cellDesc || '');
    if (!cellDesc) { return ''; }
    if (bedHas(restPlaces, cellDesc)) { return restPlaces[cellDesc]; }
    var place = '';
    try {
      var cres = mp.lookupEspmRecordById(idOf(cellDesc));
      var cell = cres && cres.record;
      if (cell && String(cell.type) === 'CELL') {
        var loc = globalFrom(cres, u32At(recordField(cell, 'XLCN'), 0));
        var lres = loc ? mp.lookupEspmRecordById(loc) : null;
        var kw = (lres && lres.record) ? recordField(lres.record, 'KWDA') : null;
        var found = '';
        for (var k = 0; kw && k + 4 <= kw.length; k += 4) {
          var kres = mp.lookupEspmRecordById(globalFrom(lres, u32At(kw, k)));
          var word = editorIdOf(kres && kres.record);
          if (bedHas(NOT_REST_PLACE_KEYWORDS, word)) { found = ''; break; }
          if (!found && bedHas(REST_PLACE_KEYWORDS, word)) { found = REST_PLACE_KEYWORDS[word]; }
        }
        place = found;
      }
    } catch (e) { place = ''; }
    restPlaces[cellDesc] = place;
    if (place) { plog('rest place:', cellDesc, 'is', place === 'inn' ? 'an inn' : 'a temple'); }
    return place;
  }

  function bedHas(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  /* Who pressed which furniture, who is resting on what, and who has been
     seen since coming in. On globalThis, so a hot reload keeps them. */
  if (!g.__thornswoodBedState) {
    g.__thornswoodBedState = { pressed: {}, lying: {}, seen: {} };
  }
  var bedState = g.__thornswoodBedState;

  // ------------------------------------------------------------ the book --

  function bedBookPath() {
    var path = require('path');
    return path.join(path.dirname(registerPath()), 'beds.json');
  }

  /* Rebuilt field by field, the same discipline as the register: a guest is
     a holder, a time and a name, and kept takings are gold. */
  function loadBedBook() {
    var out = { guests: {}, takings: {} };
    var raw = null;
    try { raw = JSON.parse(require('fs').readFileSync(bedBookPath(), 'utf8')); }
    catch (e) { return out; }
    if (!raw || typeof raw !== 'object') { return out; }
    var now = Date.now();
    function add(b, who, by, at, name) {
      if (!b || b === '__proto__' || who === '__proto__') { return false; }
      if (!((Number(who) || 0) > 0) || !(by > 0) || !(at > 0) || (now - at) >= NIGHT_MS) { return false; }
      if (!bedHas(out.guests, b)) { out.guests[b] = {}; }
      if (bedHas(out.guests[b], who)) { return false; }
      out.guests[b][who] = { by: by, at: at, name: String(name || '').slice(0, GUEST_NAME_MAX) };
      return true;
    }
    var guests = (raw.guests && typeof raw.guests === 'object') ? raw.guests : {};
    for (var b in guests) {
      if (!bedHas(guests, b) || !guests[b] || typeof guests[b] !== 'object') { continue; }
      for (var who in guests[b]) {
        var gst = bedHas(guests[b], who) ? guests[b][who] : null;
        if (!gst || typeof gst !== 'object') { continue; }
        add(b, who, Number(gst.by) || 0, Number(gst.at) || 0, gst.name);
      }
    }
    var takings = (raw.takings && typeof raw.takings === 'object') ? raw.takings : {};
    for (var tp in takings) {
      if (!bedHas(takings, tp) || tp === '__proto__') { continue; }
      var gold = Number(takings[tp]) || 0;
      if ((Number(tp) || 0) > 0 && gold > 0 && Math.floor(gold) === gold) {
        out.takings[tp] = gold;
      }
    }
    return out;
  }

  /* Nights that have run out leave the book. Answers the holders whose
     guests changed, so their property page can be drawn again. */
  function pruneGuests() {
    var now = Date.now();
    var gone = {};
    for (var b in bedBook.guests) {
      if (!bedHas(bedBook.guests, b)) { continue; }
      var row = bedBook.guests[b];
      for (var who in row) {
        if (bedHas(row, who) && (now - row[who].at) >= NIGHT_MS) {
          gone[row[who].by] = true;
          delete row[who];
        }
      }
      if (!Object.keys(row).length) { delete bedBook.guests[b]; }
    }
    return gone;
  }

  function saveBedBook() {
    try {
      var fs = require('fs');
      var file = bedBookPath();
      try { fs.mkdirSync(require('path').dirname(file), { recursive: true }); } catch (e) { }
      fs.writeFileSync(file, JSON.stringify({ guests: bedBook.guests, takings: bedBook.takings }, null, 1));
      return true;
    } catch (e) {
      plog('could not write the bed book:', e);
      return false;
    }
  }

  var bedBook = loadBedBook();

  // ------------------------------------------------------------ the beds --

  function textOf(v) {
    if (typeof v === 'string') { return v; }
    var out = '';
    if (v && typeof v.length === 'number') {
      for (var i = 0; i < v.length && v[i]; i++) { out += String.fromCharCode(v[i]); }
    }
    return out;
  }

  /* 'bed', 'roll', 'seat', 'furn' for any other furniture, or '' for
     anything that is not furniture, asked of the engine once per base and
     kept. An answer the engine could not give is '', not a bed. */
  var bedKinds = {};
  function bedKind(baseDesc) {
    baseDesc = String(baseDesc || '');
    if (!baseDesc) { return ''; }
    if (bedHas(bedKinds, baseDesc)) { return bedKinds[baseDesc]; }
    var kind = '';
    try {
      var res = mp.lookupEspmRecordById(idOf(baseDesc));
      var rec = res && res.record;
      if (rec && String(rec.type) === 'FURN') {
        var edid = textOf(rec.editorId);
        var fields = rec.fields || [];
        for (var i = 0; !edid && i < fields.length; i++) {
          if (fields[i] && String(fields[i].type) === 'EDID') { edid = textOf(fields[i].data); }
        }
        kind = 'furn';
        if (BEDROLL_EDID.test(edid)) { kind = 'roll'; }
        else if (BED_EDID.test(edid) && !NOT_BED_EDID.test(edid)) { kind = 'bed'; }
        else if (SEAT_EDID.test(edid) && !NOT_SEAT_EDID.test(edid)) { kind = 'seat'; }
      }
    } catch (e) { kind = ''; }
    bedKinds[baseDesc] = kind;
    return kind;
  }

  /* Called from onActivate for every press. Writes only for furniture. */
  function bedTouched(actorId, refrId, baseDesc) {
    var kind = bedKind(baseDesc);
    if (!kind || !actorId || !refrId) { return; }
    bedState.pressed[actorId] = { ref: refrId, roll: kind === 'roll', what: kind, at: Date.now() };
  }

  function stillAt(actorId, refrId) {
    var d = distanceTo(actorId, refrId);
    return d >= 0 && d <= BED_REACH;
  }

  function isBuilding(cell) {
    return !!cell && (bedHas(BUILDING_NAME, cell) || bedHas(claims, cell));
  }

  /* The room or worldspace a bed stands in. */
  function bedCell(refrId) {
    try { return String(mp.get(refrId, 'worldOrCellDesc') || ''); } catch (e) { return ''; }
  }

  /* The building a bed stands in, which is its cell when that is one. */
  function bedBuilding(refrId) {
    var cell = bedCell(refrId);
    return isBuilding(cell) ? cell : '';
  }

  /* This person's night at this building, or null. See the block. */
  function guestOf(building, held, profileId) {
    if (!held || !profileId || !bedHas(bedBook.guests, building)) { return null; }
    var row = bedBook.guests[building];
    var gst = bedHas(row, profileId) ? row[profileId] : null;
    if (!gst || gst.by !== held.by || (Date.now() - gst.at) >= NIGHT_MS) { return null; }
    return gst;
  }

  /* The holder, a guest tonight, or somebody carrying its key or its deed. */
  function allowedIn(actorId, profileId, building, held) {
    if (!held) { return false; }
    if (profileId && held.by === profileId) { return true; }
    if (guestOf(building, held, profileId)) { return true; }
    if (holdsKey(actorId, building)) { return true; }
    if (holdsDeed(actorId, building)) { return true; }
    // Its master key counts as a key for the beds (#2254).
    if (holdsMasterKey(actorId, building)) { return true; }
    return false;
  }

  /* A fire close enough to warm this person, by the distance their client
     reports for warmth. See the block. */
  function fireNear(actorId) {
    var needs = g.__thornswoodNeeds;
    if (!needs || !needs.settle) { return false; }
    var n = null;
    try { n = needs.settle(actorId); } catch (e) { return false; }
    return !!n && typeof n.fire === 'number' && n.fire >= 0;
  }

  /* Sitting on the ground with the wheel's Sit, by the engine's last
     animation for them. See the block. */
  function sitsOnGround(actorId) {
    var ev = '';
    try { ev = String(mp.get(actorId, 'lastAnimEvent') || '').toLowerCase(); } catch (e) { return false; }
    return ev === GROUND_SIT;
  }

  /*
    What this bed is to this person: a kind of rest, or a refusal. Asked
    when they lie down and again on every tick. See the table in the block.
  */
  function bedVerdict(actorId, profileId, ref) {
    var building = bedBuilding(ref);
    var held = building ? holderOf(building) : null;
    var out = { building: building, held: held, kind: '', line: '', guest: null, place: '' };
    if (!held) {
      // An inn or a temple nobody holds is its own kind (#2246); see
      // restPlaceOf. Anywhere else nobody holds is the road.
      out.place = restPlaceOf(bedCell(ref));
      var fire = fireNear(actorId);
      out.kind = out.place ? (fire ? 'commonfire' : 'common') : (fire ? 'camp' : 'rough');
      return out;
    }
    if (profileId && held.by === profileId) {
      out.kind = 'bed';
      return out;
    }
    if (allowedIn(actorId, profileId, building, held)) {
      out.kind = 'inn';
      out.guest = guestOf(building, held, profileId);
      return out;
    }
    out.line = nameOf(building) + ' is ' + held.name + '\'s, and they have not let you ' +
               'sleep there. A night there is theirs to give.';
    return out;
  }

  function personName(actorId) {
    try {
      var a = mp.get(actorId, 'appearance');
      if (a && a.name) { return String(a.name); }
    } catch (e) { }
    return 'somebody';
  }

  function profileOf(actorId) {
    try { return Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { return 0; }
  }

  function onlineActorOf(profileId) {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return 0; }
    for (var i = 0; i < online.length; i++) {
      if (profileOf(online[i]) === profileId) { return online[i]; }
    }
    return 0;
  }

  function tellBed(actorId, line) {
    try { notify(actorId, line); } catch (e) { }
    try { say(actorId, line); } catch (e) { }
  }

  /*
    /rest, whatever word follows it. Answers the line to say, or '' for
    nothing. The plugin says /rest bed when somebody lies down and /rest sit
    when they sit on any other furniture, and this answers by what they
    pressed: a bed or a bedroll is the bed's verdict, a seat is a seat, and
    other furniture (a forge, a chopping block) is not a rest and is answered
    with nothing, because the plugin says sit at every piece of furniture that
    is not a bed and the server is what tells them apart.
  */
  function bedRest(actorId, profileId) {
    var needs = g.__thornswoodNeeds;
    if (!needs || !needs.resting) { return 'That is not running on this server.'; }
    if (!actorId || !profileId) {
      return 'The server cannot find your character right now. Give it a moment and try again.';
    }
    var p = bedHas(bedState.pressed, actorId) ? bedState.pressed[actorId] : null;
    if (!p || !stillAt(actorId, p.ref)) {
      return 'There is nothing here to rest on. Sit down or lie down and it counts; saying the word does not.';
    }
    if (p.what === 'furn') { return ''; }
    var e = { ref: p.ref, roll: !!p.roll, seat: p.what === 'seat', kind: '', guestAt: 0,
              at: Date.now() };
    if (e.seat) {
      e.kind = fireNear(actorId) ? 'campfire' : 'sit';
    } else {
      var v = bedVerdict(actorId, profileId, p.ref);
      if (v.line) { return v.line; }
      e.kind = v.kind;
      e.guestAt = v.guest ? v.guest.at : 0;
    }
    bedState.lying[actorId] = e;
    var line = needs.resting(actorId, e.kind);
    // Sitting down says nothing: people sit at every table in every inn, and
    // the Rest bar is what shows it counting.
    if (e.seat) { return ''; }
    return line || 'You are resting.';
  }

  /* They got up, or rest somewhere else now. Answers 'seat' when it was a
     seat they got off, so getting up from one is not said either. */
  function bedOff(actorId) {
    var e = bedHas(bedState.lying, actorId) ? bedState.lying[actorId] : null;
    delete bedState.lying[actorId];
    return (e && e.seat) ? 'seat' : '';
  }

  /* Off a place the server no longer counts, without touching any other
     kind of rest they may have started since. */
  function getUp(actorId, needs) {
    delete bedState.lying[actorId];
    if (!needs || !needs.settle || !needs.resting) { return false; }
    var n = null;
    try { n = needs.settle(actorId); } catch (e) { return false; }
    if (!n || !REST_KINDS[n.resting]) { return false; }
    try { needs.resting(actorId, ''); } catch (e) { return false; }
    return true;
  }

  /* '' while the place still counts, at whatever rate it counts now,
     otherwise the line to say. */
  function stillLying(actorId, e, needs) {
    if (!e.ground && !stillAt(actorId, e.ref)) {
      return e.seat ? 'You have left the seat, so you are not resting on it now.'
                    : 'You have left the bed, so you are not resting in it now.';
    }
    var v = null;
    var kind = '';
    if (e.seat) {
      kind = fireNear(actorId) ? 'campfire' : 'sit';
    } else {
      v = bedVerdict(actorId, profileOf(actorId), e.ref);
      kind = v.kind;
    }
    if (kind) {
      if (v) { e.guestAt = v.guest ? v.guest.at : 0; }
      if (kind === e.kind) { return ''; }
      // Still a place they may rest, at another rate: a key handed over in the
      // night, a key lost with the night still given, a fire reached or left.
      e.kind = kind;
      try { needs.resting(actorId, kind); } catch (err) { }
      return '';
    }
    if (e.guestAt && v.building && v.held) {
      return (Date.now() - e.guestAt) >= NIGHT_MS
        ? ('Your night at ' + nameOf(v.building) + ' is over.')
        : (v.held.name + ' has stopped letting you sleep at ' + nameOf(v.building) + '.');
    }
    return v.line || 'That bed does not count for you now.';
  }

  /*
    Gold #1392 kept for a holder who was away, into their pack now they are
    here. Once: it leaves the book as it is handed over, and nothing adds to
    the book any more.
  */
  function payTakings(online) {
    var owed = false;
    for (var k in bedBook.takings) { if (bedHas(bedBook.takings, k)) { owed = true; break; } }
    if (!owed) { return; }
    var changed = false;
    for (var i = 0; i < online.length; i++) {
      var pid = profileOf(online[i]);
      if (!pid || !bedHas(bedBook.takings, pid)) { continue; }
      var gold = Number(bedBook.takings[pid]) || 0;
      if (gold > 0 && !payOut(online[i], gold)) { continue; }
      delete bedBook.takings[pid];
      changed = true;
      if (gold > 0) {
        plog('handed', gold, 'gold of nights to', personName(online[i]));
        tellBed(online[i], 'While you were away, ' + gold + ' gold was paid for nights in your beds. ' +
                           'It is in your pack.');
      }
    }
    if (changed) { saveBedBook(); }
  }

  /* The holder's K panel again, so its property page shows tonight's guests. */
  function redrawPanel(actorId) {
    var c = g.__thornswoodCharacter;
    if (!actorId || !c || !c.stateOf || !c.writeState) { return; }
    var s = c.stateOf(actorId);
    if (s) { c.writeState(actorId, s); }
  }

  function bedTick() {
    var needs = g.__thornswoodNeeds;
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    var on = {};
    for (var i = 0; i < online.length; i++) { on[online[i]] = true; }
    // Gone from the world, and off whatever they pressed or rested on with
    // it (#1734): THE PLACE ENDS WITH THE SESSION, in the block.
    for (var s in bedState.seen) {
      if (bedHas(bedState.seen, s) && !on[s]) { delete bedState.seen[s]; }
    }
    for (var p in bedState.pressed) {
      if (bedHas(bedState.pressed, p) && !on[p]) { delete bedState.pressed[p]; }
    }
    for (var l in bedState.lying) {
      if (bedHas(bedState.lying, l) && !on[l]) { delete bedState.lying[l]; }
    }
    // Come into the world resting in a place nobody saw them take: after a
    // restart, or back from a logout. A place they took this session, before
    // this first sight of them, stays.
    for (var j = 0; j < online.length; j++) {
      var id = online[j];
      if (bedState.seen[id]) { continue; }
      bedState.seen[id] = true;
      if (bedHas(bedState.lying, id)) { continue; }
      if (getUp(id, needs)) {
        plog(personName(id), 'came in resting in a place the server did not see, so they are up');
      }
    }
    var now = Date.now();
    // Sitting down on the ground with the wheel's Sit (#1631). See the block.
    for (var gi = 0; gi < online.length; gi++) {
      var sat = online[gi];
      if (bedHas(bedState.lying, sat) || !needs || !needs.resting || !sitsOnGround(sat)) { continue; }
      var gk = fireNear(sat) ? 'campfire' : 'sit';
      bedState.lying[sat] = { ref: 0, roll: false, seat: true, ground: true, kind: gk, guestAt: 0, at: now };
      needs.resting(sat, gk);
    }
    for (var k in bedState.lying) {
      if (!bedHas(bedState.lying, k)) { continue; }
      var e = bedState.lying[k];
      var who = Number(k);
      // Up off the ground, which is no news, the way getting off a chair is not.
      if (e.ground && !sitsOnGround(who)) { getUp(who, needs); continue; }
      var why = stillLying(who, e, needs);
      if (why) {
        getUp(who, needs);
        tellBed(who, why);
      }
    }
    payTakings(online);
    // A night that ran out leaves the book and the holder's property page.
    var ended = pruneGuests();
    var changed = false;
    for (var h in ended) {
      if (bedHas(ended, h)) { changed = true; redrawPanel(onlineActorOf(Number(h))); }
    }
    if (changed) { saveBedBook(); }
  }

  // ---------------------------------------------------------- the guests --

  /* The guests of a building tonight, by name, for the property page. */
  function guestsOf(building) {
    var held = holderOf(building);
    var out = [];
    if (!held || !bedHas(bedBook.guests, building)) { return out; }
    var row = bedBook.guests[building];
    for (var who in row) {
      if (!bedHas(row, who) || !guestOf(building, held, Number(who))) { continue; }
      out.push({ pid: Number(who), name: row[who].name || 'somebody who paid for the night' });
    }
    out.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    return out;
  }

  /*
    For the look prompt, asked by the social block's near list for each two
    people in the same cell: 0 when the first cannot let the second sleep
    there, 1 when they can, 2 when they already have.
  */
  function sleepMark(holderPid, guestPid, cell) {
    if (!holderPid || !guestPid || holderPid === guestPid || !bedHas(claims, cell)) { return 0; }
    var held = holderOf(cell);
    if (!held || held.by !== holderPid) { return 0; }
    return guestOf(cell, held, guestPid) ? 2 : 1;
  }

  /* The night ends now. The guest is told, and got up if they are lying in
     one of its beds and nothing else lets them stay. */
  function endGuest(building, pid, line) {
    if (bedHas(bedBook.guests, building)) { delete bedBook.guests[building][pid]; }
    saveBedBook();
    var guest = onlineActorOf(pid);
    if (!guest) { return; }
    var needs = g.__thornswoodNeeds;
    var e = bedHas(bedState.lying, guest) ? bedState.lying[guest] : null;
    var why = (e && !e.seat && bedBuilding(e.ref) === building) ? stillLying(guest, e, needs) : '';
    if (why) { getUp(guest, needs); }
    tellBed(guest, why || line);
  }

  /*
    THE HOLDER LETS SOMEBODY SLEEP THERE, OR STOPS (#1603).

    Patrick: the holder names who may sleep there, "with buttons and GUI, not
    commands". The look prompt draws "Let sleep here" while a holder looks at
    somebody inside a building they hold, and its key sends /sleephere with
    that person's form id, the way the trade key sends /trade. Pressed on a
    guest, it ends their night. The property page in the K panel sends
    /sleephere stop <profile> <building> beside each guest's name. Nobody
    types either, and help never names them.

    Everything is measured here: the building is the cell the holder stands
    in, the holder is the register's, and the guest is in that same cell.
  */
  function sleepHere(parts, actorId, profileId, toProfile) {
    var raw = String((parts && parts[1]) || '');
    if (raw === 'stop') { return stopGuest(parts, actorId, profileId, toProfile); }
    var them = /^[0-9a-f]{1,8}$/i.test(raw) ? parseInt(raw, 16) : 0;
    var cell = '';
    try { cell = String(mp.get(actorId, 'worldOrCellDesc') || ''); } catch (e) { cell = ''; }
    var building = isBuilding(cell) ? cell : '';
    var held = building ? holderOf(building) : null;
    if (!held || !profileId || held.by !== profileId) {
      toProfile(profileId, building
        ? ('Only whoever holds ' + nameOf(building) + ' lets people sleep there.')
        : 'Stand inside a building you hold to let somebody sleep there.');
      return true;
    }
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    var theirs = '';
    if (them && them !== actorId && online.indexOf(them) !== -1) {
      try { theirs = String(mp.get(them, 'worldOrCellDesc') || ''); } catch (e) { theirs = ''; }
    }
    var pid = (theirs === cell) ? profileOf(them) : 0;
    var name = nameOf(building);
    if (!pid || pid === profileId) {
      toProfile(profileId, 'Look at somebody inside ' + name + ' with you, then press the key.');
      return true;
    }
    var who = personName(them);
    if (guestOf(building, held, pid)) {
      endGuest(building, pid, held.name + ' has stopped letting you sleep at ' + name + '.');
      plog(held.name, 'stopped letting', who, 'sleep at', name);
      toProfile(profileId, who + ' may no longer sleep at ' + name + '.');
      redrawPanel(actorId);
      return true;
    }
    if (!bedHas(bedBook.guests, building)) { bedBook.guests[building] = {}; }
    bedBook.guests[building][pid] = { by: held.by, at: Date.now(), name: who.slice(0, GUEST_NAME_MAX) };
    saveBedBook();
    plog(held.name, 'let', who, 'sleep at', name, 'for a night');
    toProfile(profileId, who + ' may sleep at ' + name + ' for one night, 8 hours from now. ' +
                         'Look at them and press the same key to end it sooner.');
    tellBed(them, held.name + ' lets you sleep at ' + name + ' tonight. Lie down in any of its beds.');
    redrawPanel(actorId);
    return true;
  }

  /* /sleephere stop <profile> <building>, from the property page. */
  function stopGuest(parts, actorId, profileId, toProfile) {
    var pid = Number((parts && parts[2]) || 0) || 0;
    var building = (parts && parts.length > 3) ? parts.slice(3).join(' ') : '';
    var held = building ? holderOf(building) : null;
    if (!held || !profileId || held.by !== profileId) {
      toProfile(profileId, building && isBuilding(building)
        ? ('Only whoever holds ' + nameOf(building) + ' lets people sleep there.')
        : 'That is not a building you hold.');
      return true;
    }
    var name = nameOf(building);
    var gst = guestOf(building, held, pid);
    if (!gst) {
      toProfile(profileId, 'Nobody by that name is sleeping at ' + name + ' tonight.');
      redrawPanel(actorId);
      return true;
    }
    var who = gst.name || 'Your guest';
    endGuest(building, pid, held.name + ' has stopped letting you sleep at ' + name + '.');
    plog(held.name, 'stopped letting', who, 'sleep at', name);
    toProfile(profileId, who + ' may no longer sleep at ' + name + '.');
    redrawPanel(actorId);
    return true;
  }

  if (g.__thornswoodBedTimer) { try { clearInterval(g.__thornswoodBedTimer); } catch (e) { } }
  g.__thornswoodBedTimer = setInterval(
    (typeof guard === 'function') ? guard('bedTick', bedTick) : bedTick, BED_EVERY_MS);

  g.__thornswoodBeds = {
    touched: bedTouched, rest: bedRest, off: bedOff, tick: bedTick,
    sleepHere: sleepHere, mark: sleepMark, guestsOf: guestsOf,
    kindOf: bedKind, verdict: bedVerdict, book: function () { return bedBook; },
    // An inn or a temple, by the room's records (#2246).
    placeOf: restPlaceOf,
    state: bedState, BED_REACH: BED_REACH, NIGHT_MS: NIGHT_MS, BED_EVERY_MS: BED_EVERY_MS
  };


  /*
    ------------------------------------------------------- where a board is

    Patrick asked for the physical boards with guessed coordinates, to be
    adjusted later. THESE COORDINATES ARE NOT GUESSED, and that is better than
    what was asked for: they are the nine arrival points out of the chargen
    table, one inn per hold, which are real positions that people are already
    teleported to and stood up at every time a character is made. A number I
    invented for the ground outside a keep would be a number nobody had ever
    stood on, and the first thing anybody would find is that the board is
    inside a rock.

    So the board in each hold starts at that hold's inn, which is where a
    notice board belongs anyway, and a steward moves it with /board here the
    moment somebody decides it should be by the keep instead. That is the
    adjustment Patrick asked for, done by walking to the spot rather than by
    editing a file and shipping a release.

    NO NEW RECORD AND NO PLACED REFERENCE. A board is a PLACE: a cell and a
    point in it. Adding an activator to Thornswood-Content.esp and placing nine
    references would need the plugin rebuilt, sent to the server and packed to
    every client, and a corrupt plugin takes the whole server down for
    everybody. A place needs none of that and reads the same from the chair:
    stand by the board, say /notice, and it goes up.
  */
  var BOARD_REACH = 400;

  /*
    ============================ THE NINE SITES, AND WHERE THEY CAME FROM =====

    Djinn, 22 September, in "Borad location coords", nine towns with a facing
    each, and his own next step written under them: "Suggest allocation then
    verification and orientation". This is the allocation. The verification is
    somebody standing on each one, and it is not done.

    THEY ARE OUTSIDE NOW, WHICH IS THE POINT OF THEM. The boards were seeded
    at each hold's INN, out of the chargen arrival table, because those were
    the only positions this server had ever stood anybody on and a number
    invented for the ground outside a keep would have put a board inside a
    rock. That reasoning was right and it is what these replace: a coordinate
    somebody walked to and read off beats one nobody has ever stood on, and
    beats an inn, because a notice board belongs in the open where people pass
    it.

    WHAT WAS CHECKED HERE, because none of it was taken on trust. DATA.capitals
    is this file's own table of the nine towns, and every one of Djinn's falls
    a short walk from its capital: Winterhold 478 units, Dawnstar 760, Morthal
    1031, Falkreath 1057, Windhelm 2898, Riften 3242, Markarth 3366, Whiterun
    4526. That is the spread you get between a map marker and a spot by a gate,
    and it puts all eight in the same worldspace the capitals are in, which is
    Tamriel.

    SOLITUDE IS 51,950 UNITS FROM ITS CAPITAL and is the one that does not fit.
    The capitals table has Solitude at -58079.7, 110488.4; this coordinate is
    at -6486.7, 104407.2, which is most of a hold away. So it is either a
    different worldspace or a slip, and it is left in with the others
    DELIBERATELY RATHER THAN DROPPED OR CORRECTED: correcting it would be me
    inventing a number, which is the thing the inn seeding existed to avoid,
    and dropping it would leave Solitude on its inn with nothing saying why.
    It is on the To Do List to walk to. If it is wrong, /board move solitude
    fixes it from the chair in one line.

    THE Z AND THE FACING ARE THE SAME KIND OF UNVERIFIED. BOARD_REACH is 400,
    so a height that is out by more than that leaves a board nobody can reach
    while standing under it, and that is the first thing verification should
    check. The facing turns the board object, which the server stands at
    every board and turns to this facing (standBoard, #2516).
  */
  /*
    EVERY SPOT CARRIES ITS OWN CELL OR WORLDSPACE (#2516). Until 15 Oct all
    nine were sent as Tamriel, 3c:Skyrim.esm. Patrick on dev, 12 Oct, saw no
    board inside Whiterun, and Whiterun's appeared only once he walked out of
    the gate: Solitude, Whiterun, Windhelm, Riften and Markarth are walled
    cities, each its own worldspace inside the walls, and their numbers were
    read inside them. Measured 15 Oct:
      - the game's own NPCs placed near each point (docs/NPC-SPAWNS.csv)
        stand in WhiterunWorld 1a26f, RiftenWorld 16bb4, WindhelmWorld 1691d
        and MarkarthWorld 16d71;
      - Solitude has no NPC within 3,000, so the cell its point falls in was
        read out of Skyrim.esm: cell -16, 25 holds 252 references in
        SolitudeWorld 37edf and 20 in Tamriel, the same shape as Whiterun's
        (243 in WhiterunWorld, 14 in Tamriel), so the city is SolitudeWorld;
      - Falkreath, Morthal and Winterhold have NPCs in Tamriel, and Dawnstar
        is an open town, so those four stay Tamriel.
    A steward standing where a board should be and pressing Move it here on
    the Office page still moves it anywhere in one press: moveBoard records
    the cell or worldspace, the point and the facing where they stand.

    EACH SPOT OUTSIDE TAMRIEL CARRIES AN ANCHOR (#2516, 15 Oct). The server
    stands a board with the fork's ObjectReference.MoveTo, which can only take
    a reference into another worldspace or cell next to a reference that is
    already there. Until now that was a person who happened to be in the city,
    so a city board appeared only once somebody walked in. The anchor is a
    vanilla reference near the spot that never moves, so every board stands at
    server start. It has to be a kind of reference the server loads at all:
    the fork's WorldState::AttachEspmRecord loads only NPCs, furniture,
    activators, doors, containers, items and harvestables, and skips every
    STAT, so an XMarker cannot be one. Each anchor below is a persistent,
    enabled door, container or furniture reference, read out of the plugins
    on One and checked against every plugin in game/data/last-plugin.json's
    load order (only JKs Skyrim.esp touches one, moving Windhelm's wood pile
    25 units). standBoard reads where the server has the anchor and moves the
    board by the difference, so a mod moving an anchor moves no board.
    FACING IS THE WAY A READER LOOKS. Djinn's nine numbers are the direction
    somebody reading the board faces, so the board itself is turned the other
    way, facing + 180 (boardAngle; Patrick, 15 Oct, A on #2516). Raven Rock's
    inn has no number, so 0, and its board faces south.
  */
  var BOARD_SITES = {
    /*
      SOLITUDE'S X WAS MISSING A DIGIT, corrected 23 September, and it is a
      correction rather than a number somebody made up.

      Djinn walked to all nine and wrote them down. Eight fall between 478 and
      4,526 units of their own capital in DATA.capitals. Solitude was 51,950
      away, which is most of a hold, and this entry has said since then that
      correcting it would be inventing a number.

      IT IS NOT AN INVENTION, because the same person wrote down a second
      Solitude coordinate on a different day for a different reason. His
      Solitude CHOPPING BLOCK, in entry 17, is -64263, 106003.5, -8377.8. Set
      that beside what was here:

        board          -6486.7   104407.2   -8405.9
        chopping block -64263.0  106003.5   -8377.8

      The Z agrees to 28 units and the Y to 1,596. Only the X disagrees, by
      57,776. That is not two different places, it is one place with a decimal
      point in the wrong column: -6486.7 is the digits 64867 read as a number a
      tenth the size. Put the point where the other two axes say it belongs and
      the board is 1,707 units from his own chopping block in the same city,
      which is the same short walk the other eight are from their capitals.

      Still worth standing at: -64867 is where those digits point, and only
      somebody in the world can say whether it is a wall. /board move solitude
      settles it for good and a deploy will never touch it again.
    */
    solitude:   { cell: '37edf:Skyrim.esm', pos: [-64867, 104407.2, -8405.9], facing: 9.9, where: 'Solitude',
                  anchor: '101d9d:Skyrim.esm' },   // SDoorFrontGate, the enabled city gate, 639 away
    whiterun:   { cell: '1a26f:Skyrim.esm', pos: [23139.4, -7891.7, -3494.4], facing: 188.4, where: 'Whiterun',
                  anchor: 'cdd7a:Skyrim.esm' },    // WoodChoppingBlock, 550 away
    riften:     { cell: '16bb4:Skyrim.esm', pos: [174559.5, -94337, 11130.2], facing: 38, where: 'Riften',
                  anchor: '4227f:Skyrim.esm' },    // RiftenDoorLoad01, 550 away
    windhelm:   { cell: '1691d:Skyrim.esm', pos: [134265.1, 35842.3, -12397.5], facing: 85.8, where: 'Windhelm',
                  anchor: '23592:Skyrim.esm' },    // WoodPile, 876 away (JKs Skyrim.esp moves it 25)
    markarth:   { cell: '16d71:Skyrim.esm', pos: [-173494.7, 5049.1, -3447.6], facing: 72, where: 'Markarth',
                  anchor: '1c38b:Skyrim.esm' },    // DweDoorLarge01Load, 472 away
    falkreath:  { cell: '3c:Skyrim.esm', pos: [-30342.2, -87022.7, -3119.1], facing: 56.6, where: 'Falkreath' },
    morthal:    { cell: '3c:Skyrim.esm', pos: [-38766.1, 64411.9, -13920.9], facing: 251.2, where: 'Morthal' },
    dawnstar:   { cell: '3c:Skyrim.esm', pos: [32216.4, 102314, -13263], facing: 110, where: 'Dawnstar' },
    winterhold: { cell: '3c:Skyrim.esm', pos: [109969.6, 100594.4, -9033], facing: 241.4, where: 'Winterhold' }
  };

  /*
    RAVEN ROCK, THE TENTH BOARD, #1374. The page: "Raven Rock's board starts
    at that town's inn until a steward walks it somewhere better."

    Vanilla Skyrim has one inn in Raven Rock, The Retching Netch, in
    Dragonborn.esm. Its interior cell is 17ec0:Dragonborn.esm
    (DLC2RRTheRetchingNetch in game/data/doors.json). The point is where its
    innkeeper, Geldis Sadri, is placed (ref 18291:Dragonborn.esm in
    game/data/merchant-traders.json), which is the spot
    game/data/guild-sites.json already gives Raven Rock's guild site and
    docs/systems/merchants-guild.md calls where that town's board starts.

    Raven Rock is not in the chargen table, so the inn fallback in
    seededBoards never found it and only nine boards were ever seeded. A town
    in here is seeded only when that table did not already give it a board.
    A steward's /board move takes it over for good, the same as any other
    board, because seedBoards keeps a placed board whatever the seeding says.
  */
  var BOARD_INNS = {
    ravenrock: { cell: '17ec0:Dragonborn.esm', pos: [-39, -178.2, 0], where: 'Raven Rock',
                 anchor: '25029:Dragonborn.esm' }   // DLC2RRGeldisVendorChest, 226 away
  };

  /*
    WHICH SEEDING A BOARD IS STANDING ON, AND WHY A NUMBER RATHER THAN A FLAG.

    boards is SAVED, in the register beside the claims and the notices, and it
    is written every time anything in that register is. So on any server that
    has been played on, loadPart('boards') answers and seededBoards() is never
    reached again: changing the table above would move the boards on a fresh
    server and on no other, which is the failure where the fix reads perfectly
    and nothing in the world changes.

    So a seeded board carries the seed it came from and is replaced when that
    number moves. 1 is the inn seeding and is what every board written before
    today has, by not carrying the field at all. A board a STEWARD placed with
    /board move carries no seed and is never touched again, because that is
    somebody's decision about their own hold and a deploy must not walk over
    it. The next time these coordinates change, this number goes up and the
    boards follow, except the ones people have moved on purpose.
  */
  // 5: each board turned to face its readers, facing + 180, 15 October (#2516).
  // 4: the five walled cities in their own worldspaces, 15 October (#2516).
  var BOARD_SEED = 5;   // 3: Solitude's X, 23 September. See BOARD_SITES above.

  var boards = seedBoards(loadPart('boards', null));

  /*
    The saved boards, brought up to the current seeding. A null saved copy is a
    server that has never written its register, which takes the whole table.
  */
  function seedBoards(saved) {
    var out = {};
    var hold;
    if (saved && typeof saved === 'object') {
      for (hold in saved) {
        if (!Object.prototype.hasOwnProperty.call(saved, hold)) { continue; }
        var b = saved[hold];
        if (!b || typeof b !== 'object') { continue; }
        // No seed field at all is a board a steward placed, OR one written by
        // the inn seeding before this field existed. Those two are told apart
        // by `placed`, which moveBoard writes and nothing else ever did.
        if (b.placed) { out[hold] = b; continue; }
        if (b.seed === BOARD_SEED) { out[hold] = b; continue; }
        // Anything else is an older seeding and is replaced below.
      }
    }
    var fresh = seededBoards();
    var moved = 0;
    for (hold in fresh) {
      if (!Object.prototype.hasOwnProperty.call(fresh, hold)) { continue; }
      if (out[hold]) { continue; }
      out[hold] = fresh[hold];
      // The board and box the server already stood for it (#2516) are moved
      // to the new spot by standBoard, not left behind beside a new pair.
      var had = saved && typeof saved === 'object' ? saved[hold] : null;
      if (had && had.ref) { out[hold].ref = had.ref; }
      if (had && had.boxRef) { out[hold].boxRef = had.boxRef; }
      moved++;
    }
    if (moved) {
      plog('boards: seeding', moved, 'of', Object.keys(fresh).length,
           'to sites ' + BOARD_SEED + '; the rest were placed by a steward');
    }
    return out;
  }

  function seededBoards() {
    var out = {};
    /*
      Djinn's nine first, which are outdoor sites in Tamriel. Any town the
      table above does not name falls back to that hold's INN, out of PASSAGES,
      which is the chargen table and is top level in this file: each town's
      arrival carries the interior cell descriptor and the exact point somebody
      is stood up at when they pick that home. Those are positions the server
      has already put people on, over and over, so a town with no site is on a
      real spot rather than on nothing.
    */
    try {
      for (var desc in PASSAGES) {
        if (!Object.prototype.hasOwnProperty.call(PASSAGES, desc)) { continue; }
        var t = PASSAGES[desc];
        if (!t || !t.key) { continue; }
        var site = Object.prototype.hasOwnProperty.call(BOARD_SITES, t.key)
          ? BOARD_SITES[t.key] : null;
        if (site) {
          out[t.key] = { cell: site.cell,
                         pos: [site.pos[0], site.pos[1], site.pos[2]],
                         facing: site.facing,
                         where: site.where || t.town || t.key,
                         seed: BOARD_SEED };
          continue;
        }
        if (t.arrival && t.arrival.desc && t.arrival.pos) {
          out[t.key] = { cell: t.arrival.desc,
                         pos: [t.arrival.pos[0], t.arrival.pos[1], t.arrival.pos[2]],
                         where: t.town || t.key,
                         seed: BOARD_SEED };
        }
      }
    } catch (e) {
      plog('could not seed the boards from the town table:', e);
    }
    for (var inn in BOARD_INNS) {
      if (!Object.prototype.hasOwnProperty.call(BOARD_INNS, inn) || out[inn]) { continue; }
      var at = BOARD_INNS[inn];
      out[inn] = { cell: at.cell, pos: [at.pos[0], at.pos[1], at.pos[2]],
                   where: at.where || inn, seed: BOARD_SEED };
    }
    return out;
  }

  /** The hold whose board somebody is standing at, or null. */
  function boardHere(actorId) {
    var cell = null, pos = null;
    try { cell = mp.get(actorId, 'worldOrCellDesc'); } catch (e) { return null; }
    try { pos = mp.get(actorId, 'pos'); } catch (e) { return null; }
    if (!cell || !pos) { return null; }
    for (var hold in boards) {
      if (!Object.prototype.hasOwnProperty.call(boards, hold)) { continue; }
      var b = boards[hold];
      if (!b || b.cell !== cell || !b.pos) { continue; }
      var dx = pos[0] - b.pos[0], dy = pos[1] - b.pos[1], dz = pos[2] - b.pos[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= BOARD_REACH) { return hold; }
    }
    return null;
  }

  /** The nearest board within reach of a click, or null. */
  function nearestBoard(actorId, within) {
    var cell = null, pos = null;
    try { cell = mp.get(actorId, 'worldOrCellDesc'); } catch (e) { return null; }
    try { pos = mp.get(actorId, 'pos'); } catch (e) { return null; }
    if (!cell || !pos) { return null; }
    var best = null;
    var bestD = within;
    for (var hold in boards) {
      if (!Object.prototype.hasOwnProperty.call(boards, hold)) { continue; }
      var b = boards[hold];
      if (!b || b.cell !== cell || !b.pos) { continue; }
      var dx = pos[0] - b.pos[0], dy = pos[1] - b.pos[1], dz = pos[2] - b.pos[2];
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= bestD) { bestD = d; best = { hold: hold, board: b, dist: d }; }
    }
    return best;
  }

  function refreshPanel(actorId) {
    try {
      var soc = g.__thornswoodSocial;
      if (soc && soc.push) { soc.push(actorId, true); }
    } catch (e) { }
  }

  /*
    THE NEWEST TEN, NUMBERED BY WHERE THEY REALLY ARE. What a board shows, on
    its own panel and under Boards on J (#1627).

    The typed reader this replaced had two faults in one loop. It showed the
    OLDEST ten, so the eleventh paid posting in a hold was invisible for ever
    and the fee was taken first. And it numbered the lines 1..10 by their
    position in the listing while take indexes the real array, so the moment
    anything was hidden the numbers a person could read stopped being the
    numbers they could take.

    A notice somebody took down stays in the list marked down, so it is
    skipped here and leaves a gap in the numbers rather than moving every
    newer one. See unpin below. `older` counts what is still up and not among
    the ten: noticeboards.md, "The line under the ten says how many are older."
  */
  function wallOf(hold, profileId) {
    var list = notices[hold] || [];
    var rows = [];
    var up = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      var n = list[i];
      if (n.down) { continue; }
      up++;
      if (rows.length >= 10) { continue; }
      /*
        A notice or a job (#2554) has a title, which is what the list shows,
        and its body in text, which the panel shows when it is opened. A
        job's reward is held on the ledger until its poster says it is done.
        A letter and a haul keep their one line.
      */
      var plain = !n.letter && !n.haul;
      rows.push({
        n: i + 1,
        job: !!n.job,
        letter: !!n.letter,
        name: n.name || 'somebody',
        title: plain ? String(n.title || '') : '',
        reward: (plain && n.job) ? (Math.floor(Number(n.pay)) || 0) : 0,
        at: Number(n.at) || 0,
        text: n.letter ? sealed(n) : (n.haul ? haulText(n) : (n.text || '')),
        taken: n.taken ? (n.takenName || 'somebody') : '',
        mine: Number(n.by) === Number(profileId),
        held: !!(n.job && Number(n.taken) === Number(profileId)),
        haul: !!n.haul
      });
    }
    return { rows: rows, older: up - rows.length };
  }

  /** What the board panel draws. Null until they are near one. */
  function boardPanel(actorId, profileId) {
    var near = nearestBoard(actorId, 1500);
    if (!near) { return null; }
    var hold = near.hold;
    var b = near.board;
    var here = near.dist <= BOARD_REACH;
    var wall = [];
    var older = 0;
    var mine = [];
    if (here) {
      var seen = wallOf(hold, profileId);
      wall = seen.rows;
      older = seen.older;
      mine = jobsOf(profileId);
    }
    /*
      THE HAUL'S TWO BUTTONS (#1393). Send a haul needs the towns it can go
      to, every board but this one. Confirm needs the hauls that came here:
      taken, not down, and for the person who posted it or a steward, the
      two confirmHaul lets through. A steward also takes a haul down from
      the wall, which unpin lets them do.
    */
    // A steward of this board's hold (#2551): Steward of it, or its Jarl.
    var steward = here && isStewardOf(profileId, hold);
    // A guard of this board's hold takes down any post on it (#502), and so
    // does its Jarl (#2551, Patrick, 15 Oct: that hold's Guard or Jarl).
    var guard = here && (isGuard(profileId, hold) || isJarlOf(profileId, hold));
    var dests = [];
    var arrivals = [];
    if (here) {
      for (var d = 0; d < LEDGER_HOLDS.length; d++) {
        var to = LEDGER_HOLDS[d];
        if (to === hold || !Object.prototype.hasOwnProperty.call(boards, to)) { continue; }
        dests.push({ hold: to, where: (boards[to] && boards[to].where) || to });
      }
      for (var f = 0; f < LEDGER_HOLDS.length; f++) {
        var from = LEDGER_HOLDS[f];
        var sent = notices[from] || [];
        for (var a = 0; a < sent.length; a++) {
          var hl = sent[a];
          if (!hl || !hl.haul || hl.down || hl.dest !== hold || !hl.taken) { continue; }
          if (Number(hl.by) !== Number(profileId) && !steward) { continue; }
          if (Number(hl.taken) === Number(profileId)) { continue; }
          var hp = Math.floor(Number(hl.pay)) || 0;
          arrivals.push({ from: from, where: (boards[from] && boards[from].where) || from,
                          n: a + 1, name: hl.name || 'somebody', text: hl.text || '',
                          hauler: hl.takenName || 'somebody', pay: hp, kept: haulTenth(hp, hl) || 0 });
        }
      }
    }
    var submit = [];
    if (here) {
      try {
        var books = g.__thornswoodBooks;
        var view = books && books.view ? books.view(profileId, {}) : null;
        var rows2 = (view && view.books) || [];
        for (var s = 0; s < rows2.length; s++) {
          if (rows2[s].canPrices) { submit.push({ id: rows2[s].id, name: rows2[s].name }); }
        }
      } catch (e2) { }
    }
    return {
      hold: hold,
      where: b.where || hold,
      x: b.pos[0], y: b.pos[1], z: b.pos[2],
      here: here,
      paid: Number(funds[hold]) || 0,
      wall: wall,
      older: older,
      jobs: mine,
      submit: submit,
      steward: steward,
      guard: guard,
      dests: dests,
      arrivals: arrivals
    };
  }

  /*
    EVERY TOWN'S BOARD, ON J (#1627). noticeboards.md: "Reading another
    hold's board by name does not require standing there." That was
    /board <hold>, typed. Patrick, 4 Oct: nothing people do is a chat
    command. J has a Boards tab with the ten towns, and picking one sends
    /board <hold>, which nobody is told to type. The server keeps which board
    that character is reading, and the social view carries that one wall,
    read only, with their jobs under it. Only the one they picked is sent,
    so ten walls are not pushed to everybody on every tick.

    boardReads is not saved. After a restart J shows the towns with none
    picked, which is true: nobody has asked this server for one yet.
  */
  var boardReads = {};

  /*
    WHERE EACH BOARD IS, FOR THE OBJECT (#1597). Every client puts the message
    board object down at every board, so each row also carries the board's
    cell or worldspace and point. A board keeps its own facing; one a steward
    walked has none, and keeps its town's from BOARD_SITES, the facing its
    object had before (0 where neither has one).
  */
  function boardsView(profileId) {
    var list = [];
    for (var i = 0; i < LEDGER_HOLDS.length; i++) {
      var h = LEDGER_HOLDS[i];
      if (!Object.prototype.hasOwnProperty.call(boards, h)) { continue; }
      var bh = boards[h];
      var row = { hold: h, where: (bh && bh.where) || h };
      if (bh && typeof bh.cell === 'string' && bh.pos && bh.pos.length === 3) {
        var site = Object.prototype.hasOwnProperty.call(BOARD_SITES, h) ? BOARD_SITES[h] : null;
        var face = Number(bh.facing);
        if (!isFinite(face)) { face = site ? Number(site.facing) : 0; }
        row.cell = bh.cell;
        row.x = bh.pos[0]; row.y = bh.pos[1]; row.z = bh.pos[2];
        row.face = isFinite(face) ? face : 0;
      }
      list.push(row);
    }
    var hold = Object.prototype.hasOwnProperty.call(boardReads, profileId) ? boardReads[profileId] : '';
    if (!hold || !Object.prototype.hasOwnProperty.call(boards, hold)) {
      return { list: list, read: null, jobs: null };
    }
    var seen = wallOf(hold, profileId);
    return {
      list: list,
      read: { hold: hold, where: (boards[hold] && boards[hold].where) || hold,
              wall: seen.rows, older: seen.older },
      jobs: jobsOf(profileId)
    };
  }

  /*
    A steward moves a hold's board to where they stand. Move it here, beside
    each board on the Office page of the K panel, sends /board move <hold>
    (#1638); nobody types it. Only that hold's board (#2551): a steward is the
    Steward of one hold, so they move its board and no other, and its Jarl
    keeps the hold too.
  */
  function moveBoard(hold, actorId, profileId, toProfile) {
    if (!isSteward(profileId)) {
      toProfile(profileId, 'Only a steward moves a board.');
      return true;
    }
    /*
      ONLY A BOARD THAT IS THERE, #1374. One board a town, ten towns. This
      took any word, so '/board move whiterum' saved an eleventh board that no
      hold's ledger knows about.
    */
    if (!Object.prototype.hasOwnProperty.call(boards, hold)) {
      toProfile(profileId, 'No board in ' + hold + '. The boards are ' +
                Object.keys(boards).join(', ') + '.');
      return true;
    }
    if (!isStewardOf(profileId, hold)) {
      toProfile(profileId, 'That is ' + ((boards[hold] && boards[hold].where) || hold) +
                '\'s board. Its Steward or its Jarl moves it.');
      return true;
    }
    var cell = null, pos = null;
    try { cell = mp.get(actorId, 'worldOrCellDesc'); } catch (e) { cell = null; }
    try { pos = mp.get(actorId, 'pos'); } catch (e) { pos = null; }
    if (!cell || !pos) {
      toProfile(profileId, 'The server cannot tell where you are standing.');
      return true;
    }
    /*
      `placed` is what stops a later deploy moving this back. seedBoards reads
      it: a board somebody walked to and put down is theirs, and a new seeding
      replaces only boards that are still sitting where this file put them.
      Keep the name the board already had rather than the hold key, so a board
      moved twice does not lose 'Whiterun' and become 'whiterun'.
    */
    var was = boards[hold];
    // The facing too (#2516): the way the steward looks is the way a reader
    // looks, so the board is turned to face them (boardAngle, facing + 180).
    var face = null;
    try { var ang = mp.get(actorId, 'angle'); face = ang ? Number(ang[2]) : null; } catch (e) { face = null; }
    boards[hold] = { cell: cell, pos: [pos[0], pos[1], pos[2]],
                     where: (was && was.where) || hold, placed: Date.now() };
    if (face !== null && isFinite(face)) { boards[hold].facing = ((face % 360) + 360) % 360; }
    if (was && was.ref) { boards[hold].ref = was.ref; }
    if (was && was.boxRef) { boards[hold].boxRef = was.boxRef; }
    save();
    plog('a steward put', hold + '\'s board where they stood, at',
         cell, pos[0] + ',' + pos[1] + ',' + pos[2], 'facing', boards[hold].facing);
    standBoard(hold, actorId);
    toProfile(profileId, hold + '\'s board is here now.');
    return true;
  }

  /*
    ---------------------- THE BOARDS AND THEIR BOXES ARE THE SERVER'S (#2516)

    Each client used to put every board down itself: placeAtMe made the copy
    where the person stood, setPosition sent it to the town's spot, and the
    next check, two seconds later, looked for it with Game.getFormEx. A
    reference moved into a cell that is not loaded is unloaded, so the check
    missed it and put another down at the person, for every far town, every
    two seconds: Patrick on dev, 12 Oct, "it keeps adding the notice board on
    top of me as I walk", 1,073 such lines in his front log.

    So the server stands one board and one drop box per hold, as references of
    its own that every game is sent, and the client places nothing. mp.place
    makes the reference (at the middle of Tamriel), and the fork's own Papyrus
    ObjectReference.MoveTo, called through mp.callPapyrusFunction, puts it in
    its cell or worldspace at its point (PapyrusObjectReference::MoveTo: for
    an object it sets the cell, the angle and the point, and the point is
    saved). mp.set cannot: it refuses 'locationalData' for anything but an
    actor. MoveTo moves a reference next to another one, by an offset from
    where that other one is, and into its cell or worldspace. So each board
    moves next to an anchor that is already where it should go:
      - the steward who moved it, when one did;
      - else its spot's anchor (BOARD_SITES, BOARD_INNS), a vanilla door,
        container or bench that never moves, for the five walled cities and
        Raven Rock's inn;
      - else, in Tamriel or a board already in its own cell, the board itself.
    The offset is always the spot less where the server has the anchor NOW.
    It used to be the spot's own numbers for a board moved next to itself,
    which is right only for a reference still at Tamriel's 0, 0, 0, where
    mp.place makes it: a board already standing moved again went to twice
    its point. The box moves next to its board, at BOX_AT turned with the
    board (scripts/mods/Build-NoticeBoard.py prints it).

    THE ANGLE IS SET BEFORE THE MOVE. The fork's MpObjectReference::SetAngle
    only writes the change form and tells nobody: a client is sent an object's
    angle in the message that streams it to them, which a move into their
    area sends, and never again while it stays in their area. Turning after
    the move left everybody already near it seeing the reference at its old
    angle, 0 for a new one. That is what Patrick saw on dev on 15 Oct: the
    city boards, stood once he walked in, drawn at 0 instead of their facing,
    each wrong by a different amount, and the box, placed by the turned
    offset, off its shelf. MoveTo keeps the reference's own angle (no
    matchRotation), so turning first puts the right angle in that message.

    All of them stand when the server starts (standBoards). Nothing checks
    them again on a timer: a reference the server placed is kept with the
    world, and one that is not there at start is stood then.

    E on either is the server's to answer (boardActivated, from onActivate):
    the board opens only the board, the box only the box (Patrick, 12 Oct).
    The ids are kept on boards[hold] (ref, boxRef), saved with the register.
  */
  var BOARD_BASE_DESC = '593b:Thornswood-Content.esp';
  var BOX_BASE_DESC = '154d0:Thornswood-Content.esp';
  var BOX_AT = [-134.52, 4.0, 80.0];
  var TAMRIEL_DESC = '3c:Skyrim.esm';

  function refSelf(id) { return { type: 'form', desc: mp.getDescFromId(id) }; }
  function refCall(fn, id, args) {
    return mp.callPapyrusFunction('method', 'ObjectReference', fn, refSelf(id), args || []);
  }

  /* The reference is there and of this base, and in this cell when one is given. */
  function refStands(id, baseDesc, cell) {
    if (!id) { return false; }
    try {
      if (String(mp.get(id, 'baseDesc') || '').toLowerCase() !== baseDesc.toLowerCase()) { return false; }
      return !cell || String(mp.get(id, 'worldOrCellDesc') || '') === cell;
    } catch (e) { return false; }
  }

  /* The reference stands in this cell, within a unit of this point, turned to this angle. */
  function refAt(id, baseDesc, cell, pos, turn) {
    if (!refStands(id, baseDesc, cell)) { return false; }
    try {
      var p = mp.get(id, 'pos'), a = mp.get(id, 'angle');
      if (!p || !a) { return false; }
      for (var i = 0; i < 3; i++) { if (Math.abs(p[i] - pos[i]) > 1) { return false; } }
      var d = Math.abs((((Number(a[2]) - turn) % 360) + 540) % 360 - 180);
      return Number(a[0]) === 0 && Number(a[1]) === 0 && d < 0.5;
    } catch (e) { return false; }
  }

  /* Which way a reader of this board looks: its own facing, else its town's, else 0. */
  function boardFacing(hold) {
    var b = boards[hold];
    var f = Number(b && b.facing);
    if (b && b.facing !== undefined && b.facing !== null && isFinite(f)) { return f; }
    var site = Object.prototype.hasOwnProperty.call(BOARD_SITES, hold) ? BOARD_SITES[hold] : null;
    f = site ? Number(site.facing) : 0;
    return isFinite(f) ? f : 0;
  }

  /* The board's own angle: it faces its reader, so the other way from where they look. */
  function boardAngle(hold) {
    return (((boardFacing(hold) + 180) % 360) + 360) % 360;
  }

  /* Where the box stands from its board's point: BOX_AT turned by the board's angle. */
  function boxOffset(face) {
    var h = face * Math.PI / 180;
    var c = Math.cos(h), s = Math.sin(h);
    return [BOX_AT[0] * c + BOX_AT[1] * s, -BOX_AT[0] * s + BOX_AT[1] * c, BOX_AT[2]];
  }

  /* The spot's anchor, when the board is still in that spot's cell or worldspace. 0 otherwise. */
  function siteAnchor(hold, cell) {
    var site = Object.prototype.hasOwnProperty.call(BOARD_SITES, hold) ? BOARD_SITES[hold]
      : (Object.prototype.hasOwnProperty.call(BOARD_INNS, hold) ? BOARD_INNS[hold] : null);
    if (!site || !site.anchor || site.cell !== cell) { return 0; }
    var id = 0;
    try { id = mp.getIdFromDesc(site.anchor) >>> 0; } catch (e) { id = 0; }
    if (!id) { return 0; }
    try { if (String(mp.get(id, 'worldOrCellDesc') || '') !== cell) { return 0; } } catch (e2) { return 0; }
    return id;
  }

  function placedBase(desc) {
    var id = 0;
    try { id = mp.getIdFromDesc(desc) >>> 0; } catch (e) { id = 0; }
    if (!id) { return 0; }
    // getIdFromDesc is arithmetic on the load order and answers for a record that is not there.
    try { if (!(mp.lookupEspmRecordById(id) || {}).record) { return 0; } } catch (e2) { return 0; }
    return id;
  }

  /* Move a reference next to anchor so that it lands on pos: the offset is from where the anchor is now. */
  function moveOnto(id, anchor, pos) {
    var at = mp.get(anchor, 'pos');
    refCall('MoveTo', id, [refSelf(anchor), pos[0] - at[0], pos[1] - at[1], pos[2] - at[2], false]);
  }

  /*
    Stand this hold's board and box where boards[hold] says, or move them
    there. anchor is the steward who just moved it, standing where it goes,
    when there is one. Answers whether the board stands.
  */
  function standBoard(hold, anchor) {
    var b = boards[hold];
    if (!b || typeof b.cell !== 'string' || !b.pos || b.pos.length !== 3) { return false; }
    var turn = boardAngle(hold);
    var changed = false;
    if (anchor || !refAt(b.ref, BOARD_BASE_DESC, b.cell, b.pos, turn)) {
      var id = refStands(b.ref, BOARD_BASE_DESC, '') ? b.ref : 0;
      // A new reference is made in Tamriel (mp.place), so in Tamriel it can
      // be its own anchor, the same as one already standing in its cell.
      var nextTo = anchor || siteAnchor(hold, b.cell) ||
        ((id ? refStands(id, BOARD_BASE_DESC, b.cell) : b.cell === TAMRIEL_DESC) ? -1 : 0);
      if (!nextTo) {
        // Only a board a steward put down in a cell with no anchor, whose
        // reference the server no longer has. Said, not guessed at.
        plog('boards: nothing to stand', hold + '\'s board next to in', b.cell + ';',
             'its reference', Number(b.ref || 0).toString(16), 'is not there');
        return false;
      }
      try {
        if (!id) {
          var base = placedBase(BOARD_BASE_DESC);
          if (!base) { plog('boards: the message board record is not in the load order'); return false; }
          id = mp.place(base);
        }
        if (nextTo === -1) { nextTo = id; }
        refCall('SetAngle', id, [0, 0, turn]);
        moveOnto(id, nextTo, b.pos);
      } catch (e) {
        plog('boards: could not stand', hold + '\'s board:', e);
        return false;
      }
      b.ref = id;
      changed = true;
      plog('boards: stood', hold + '\'s board', Number(id).toString(16), 'in', b.cell, 'at',
           b.pos.join(','), 'turned', turn, 'for a reader facing', boardFacing(hold));
    }
    var off = boxOffset(turn);
    var boxPos = [b.pos[0] + off[0], b.pos[1] + off[1], b.pos[2] + off[2]];
    if (changed || !refAt(b.boxRef, BOX_BASE_DESC, b.cell, boxPos, turn)) {
      var bid = refStands(b.boxRef, BOX_BASE_DESC, '') ? b.boxRef : 0;
      try {
        if (!bid) {
          var boxBase = placedBase(BOX_BASE_DESC);
          if (!boxBase) { plog('boards: the drop box record is not in the load order'); }
          else { bid = mp.place(boxBase); }
        }
        if (bid) {
          refCall('SetAngle', bid, [0, 0, turn]);
          moveOnto(bid, b.ref, boxPos);
          b.boxRef = bid;
          changed = true;
        }
      } catch (e3) {
        plog('boards: could not stand', hold + '\'s drop box:', e3);
      }
    }
    if (changed) { save(); }
    return true;
  }

  /* Every board and box stood where it should be, once, when the server starts. */
  function standBoards() {
    for (var hold in boards) {
      if (!Object.prototype.hasOwnProperty.call(boards, hold)) { continue; }
      standBoard(hold, 0);
    }
  }

  /*
    ------------------------------------------------- the woodworking benches

    #516. Bows, arrows, bolts, our three fishing poles and the fish trap are
    made at Thornswood-Content.esp's woodworking bench since #2529, not at
    the forge. No plugin places that bench anywhere, so the server stands
    one beside the public forge of each town in WOODWORKING_BENCHES, the way
    the notice boards stand (#2516): once, at start, with no timer.

    Each row names a FORGE, a vanilla or mod reference read out of the
    plugins, and the point and angle the bench stands at beside it. The
    builder (scripts\dev\Build-WoodworkingBenches.py) reads each forge's
    winning record over the whole load order in game\data\last-plugin.json,
    refuses one that is disabled, deleted or has an enable parent, and holds
    each spot clear: the bench and the place its user stands lie on the
    town's navmesh, on ground flat to a few units, and touch no furniture,
    container, door, the place somebody stands at any other bench, or any
    smaller static. game\data\woodworking-benches.json says what it measured
    at each spot. tests\test-516-woodworking-benches.js holds this block to
    that file and, on a machine with the game, the file to the plugins.

    The forge is the anchor because the server loads it (a FURN), and
    MoveTo takes a reference into another worldspace only next to a
    reference already there. The offset is the spot less where the server
    has the forge now, so a mod moving a forge moves no bench. The angle is
    set before the move: the fork's SetAngle on an object tells nobody, and
    the move is what streams the bench, with its angle, to people near it.
    The bench ids are kept in benches.json beside the register.
  */
  // Written by scripts\dev\Build-WoodworkingBenches.py from the load order into their
  // table files. game\data\woodworking-benches.json says what was measured at each spot.
  var WOODWORKING_BENCH_BASE = table('WOODWORKING_BENCH_BASE');
  var WOODWORKING_BENCHES = table('WOODWORKING_BENCHES');

  function benchBookPath() {
    var path = require('path');
    return path.join(path.dirname(registerPath()), 'benches.json');
  }

  function loadBenchRefs() {
    var out = {};
    var raw = null;
    try { raw = JSON.parse(require('fs').readFileSync(benchBookPath(), 'utf8')); } catch (e) { return out; }
    if (!raw || typeof raw !== 'object') { return out; }
    for (var site in WOODWORKING_BENCHES) {
      if (!Object.prototype.hasOwnProperty.call(WOODWORKING_BENCHES, site)) { continue; }
      var id = Number(raw[site]) >>> 0;
      if (id) { out[site] = id; }
    }
    return out;
  }

  function saveBenchRefs() {
    try {
      var dir = require('path').dirname(benchBookPath());
      try { require('fs').mkdirSync(dir, { recursive: true }); } catch (e) { }
      require('fs').writeFileSync(benchBookPath(), JSON.stringify(benchRefs, null, 1));
    } catch (e) {
      plog('benches: could not write', benchBookPath() + ':', e);
    }
  }

  var benchRefs = loadBenchRefs();

  /* Stand this site's bench where WOODWORKING_BENCHES says. Answers whether it stands. */
  function standBench(site) {
    var s = WOODWORKING_BENCHES[site];
    if (!s) { return false; }
    var forge = 0;
    try { forge = mp.getIdFromDesc(s.forge) >>> 0; } catch (e) { forge = 0; }
    var at = '';
    try { at = forge ? String(mp.get(forge, 'worldOrCellDesc') || '') : ''; } catch (e2) { at = ''; }
    if (!forge || at !== s.cell) {
      plog('benches: nothing to stand', site + '\'s woodworking bench next to:', 'the forge', s.forge,
           'is not in', s.cell, '(the server has it in', (at || 'no cell') + ')');
      return false;
    }
    var id = benchRefs[site] || 0;
    if (refAt(id, WOODWORKING_BENCH_BASE, s.cell, s.pos, s.angle)) { return true; }
    try {
      if (!refStands(id, WOODWORKING_BENCH_BASE, '')) {
        var base = placedBase(WOODWORKING_BENCH_BASE);
        if (!base) { plog('benches: the woodworking bench record is not in the load order'); return false; }
        id = mp.place(base);
      }
      refCall('SetAngle', id, [0, 0, s.angle]);
      moveOnto(id, forge, s.pos);
    } catch (e3) {
      plog('benches: could not stand', site + '\'s woodworking bench:', e3);
      return false;
    }
    benchRefs[site] = id;
    saveBenchRefs();
    plog('benches: stood', site + '\'s woodworking bench', Number(id).toString(16), 'in', s.cell, 'at',
         s.pos.join(','), 'turned', s.angle, 'beside the forge', s.forge);
    return true;
  }

  /* Every woodworking bench stood where it should be, once, when the server starts. */
  function standBenches() {
    for (var site in WOODWORKING_BENCHES) {
      if (!Object.prototype.hasOwnProperty.call(WOODWORKING_BENCHES, site)) { continue; }
      standBench(site);
    }
  }

  /*
    E ON A BOARD OR ITS BOX, answered by the server (#2516, #2298). The board
    opens the board's panel for the one who pressed it, and the box the box's;
    never the other. Answers 'board', 'box' or '' for anything else.
  */
  var BOARD_OPEN_PROPERTY = 'thornswoodBoardOpen';
  try {
    mp.makeProperty(BOARD_OPEN_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: [
        '(function(){',
        '  try {',
        '    var v = ctx.value;',
        '    if (!v || typeof v !== "object") { return; }',
        '    var st = ctx.state;',
        '    if (!st || st.thornswoodBoardOpenAt === v.at) { return; }',
        '    st.thornswoodBoardOpenAt = v.at;',
        '    ctx.sp.browser.executeJavaScript("(function(){try{if(window.thornswoodBoard){window.thornswoodBoard.open();}}catch(e){}})();");',
        '  } catch (e) { }',
        '})();'
      ].join('\n'),
      updateNeighbor: ''
    });
  } catch (e) { /* made by an earlier load. harmless. */ }
  var boardOpenedAt = 0;

  function boardActivated(refrId, actorId) {
    var id = Number(refrId) >>> 0;
    if (!id) { return ''; }
    var pid = 0;
    try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
    for (var hold in boards) {
      if (!Object.prototype.hasOwnProperty.call(boards, hold)) { continue; }
      var b = boards[hold];
      if ((Number(b.ref) >>> 0) === id) {
        refreshPanel(actorId);
        boardOpenedAt = Math.max(Date.now(), boardOpenedAt + 1);
        try { mp.set(actorId, BOARD_OPEN_PROPERTY, { at: boardOpenedAt }); } catch (e2) { }
        return 'board';
      }
      if ((Number(b.boxRef) >>> 0) === id) {
        dropboxCmd(['/dropbox', 'open'], actorId, pid, function () { });
        return 'box';
      }
    }
    return '';
  }

  /*
    ---------------------------------------------------------- the boards

    Twenty gold to post a notice, which is read only; thirty for a job, which
    goes on the taker's list. The fee is counted on the hold's ledger, and
    never goes in the drop box (#2298).

    THE BOARD IS NOT A PLACE YET AND THAT IS SAID OUT LOUD. The design puts one
    outside each keep, at our own records at our own coordinates, and neither
    the records nor the coordinates exist. So the words work wherever the hold
    has a ledger, and the board becomes the place to say them the day it is
    placed. The alternative was a placeholder coordinate nobody could stand at.
  */
  function takeGold(actorId, amount) {
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return false; }
    var entries = (inv && inv.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e && e.baseId === GOLD_ID && (Number(e.count) || 0) >= amount) {
        e.count -= amount;
        if (e.count <= 0) { entries.splice(i, 1); }
        try { mp.set(actorId, 'inventory', { entries: entries }); } catch (e2) { return false; }
        return true;
      }
    }
    return false;
  }

  /*
    THE LEDGER PAYING OUT, and only a letter's held courier pay, #1374.

    takeGold destroys a fee from a pack and the fee is counted on the hold's
    ledger. This is the other half docs/systems/gold.md describes: it creates
    the same count back into a pack, and payHeld takes it off that ledger in
    the same step, so the coin was already in the world and packs plus ledger
    add up to the same after. payHeld pays a letter's own `pay`, which
    postLetter took from the sender, never more than the ledger holds. Its
    other caller is payTakings in the beds, which hands a holder the gold
    #1392 kept for them while they were away, once (#1603).
  */
  function payOut(actorId, amount) {
    var count = Math.floor(Number(amount) || 0);
    if (!(count > 0)) { return false; }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return false; }
    var entries = (inv && inv.entries) || [];
    var put = false;
    for (var i = 0; i < entries.length && !put; i++) {
      var e = entries[i];
      if (e && e.baseId === GOLD_ID) { e.count = (Number(e.count) || 0) + count; put = true; }
    }
    if (!put) { entries.push({ baseId: GOLD_ID, count: count }); }
    try { mp.set(actorId, 'inventory', { entries: entries }); } catch (e2) { return false; }
    return true;
  }

  /*
    A letter's held pay, or a job's reward (#2554), out of its hold's ledger
    into one pack. A haul's is handHaul's. Answers what was paid, 0 when
    nothing is held, or -1 when it could not be paid and nothing changed.
    n.pay goes to 0 once paid, so it is paid once.
  */
  function payHeld(hold, n, actorId) {
    var amount = (n && n.job && !n.haul) ? (Math.floor(Number(n.pay)) || 0) : 0;
    if (!(amount > 0)) { return 0; }
    if ((Number(funds[hold]) || 0) < amount) {
      plog('a letter in', hold, 'holds', amount, 'and the ledger has only', funds[hold], '; nothing paid');
      return -1;
    }
    if (!payOut(actorId, amount)) { return -1; }
    funds[hold] = (Number(funds[hold]) || 0) - amount;
    n.pay = 0;
    return amount;
  }

  /* What anybody but the person it is for reads of a letter: who it is for. */
  function sealed(n) {
    return 'A sealed letter for ' + (n.to || 'somebody');
  }

  /*
    The letter's name against a character's. The whole name, or its first
    words, so 'Lydia' reaches Lydia Stormblade and 'Ly' reaches nobody.
  */
  function nameIs(to, name) {
    var a = String(to || '').trim().toLowerCase().replace(/\s+/g, ' ');
    var b = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!a || !b) { return false; }
    return b === a || b.indexOf(a + ' ') === 0;
  }

  /*
    THE LINE A POST ARRIVES ON (#2554). The board panel's Make a post sends

        /notice <title> :: <body>
        /job <reward> <title> :: <body>

    with the separator the journal's pages use. The chat socket carries one
    line, so the page sends a newline in the body as a backslash and n, a
    backslash as two, and a colon in the title as a backslash and a colon.
    So the first :: on the line is always the separator, and every character
    somebody wrote comes back here as they wrote it, apart from runs of
    spaces, which every line loses on the way (dispatch splits on them).
    Answers { title, body }, trimmed; the title is one line.
  */
  function postWords(line) {
    function unslash(s) {
      var out = '';
      for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        var d = s.charAt(i + 1);
        if (c === '\\' && (d === 'n' || d === '\\' || d === ':')) {
          out += d === 'n' ? '\n' : d;
          i++;
          continue;
        }
        out += c;
      }
      return out;
    }
    var all = String(line || '');
    var cut = all.indexOf('::');
    var head = cut < 0 ? all : all.slice(0, cut);
    return {
      title: unslash(head).replace(/\s+/g, ' ').trim(),
      body: cut < 0 ? '' : unslash(all.slice(cut + 2)).trim()
    };
  }

  function post(parts, actorId, profileId, toProfile, isJob) {
    /*
      AT THE BOARD, because that is what makes it a board rather than a
      command. It is the same rule as claiming at a door: the place is the
      thing that makes it real, and a notice posted from the other side of
      Skyrim is a text message.
    */
    var hold = boardHere(actorId);
    if (!hold) {
      toProfile(profileId, 'Stand at a hold\'s notice board to put something on it.');
      return true;
    }
    /*
      A JOB HAS A REWARD (#2554). Patrick, 15 Oct: posting a job takes the
      reward and the board fee together; the reward is held for whoever does
      the job, the way a haul's pay is held, and the fee is the board's. So
      the reward is a whole number of gold above nothing, read before
      anything is taken.
    */
    var reward = 0;
    var from = 1;
    if (isJob) {
      var first = String((parts && parts[1]) || '').trim();
      reward = /^\d+$/.test(first) ? Number(first) : 0;
      if (!(reward > 0) || !Number.isSafeInteger(reward)) {
        toProfile(profileId, 'A job\'s reward is a whole number of gold, above nothing. Nothing was taken.');
        return true;
      }
      from = 2;
    }
    var words = postWords((parts && parts.length > from) ? parts.slice(from).join(' ') : '');
    var what = isJob ? 'the job' : 'the notice';
    if (!words.title) {
      toProfile(profileId, 'Give ' + what + ' a title. Nothing was taken.');
      return true;
    }
    if (words.title.length > POST_TITLE_CHARS) {
      toProfile(profileId, 'A title is up to ' + POST_TITLE_CHARS + ' characters. That one is ' +
                words.title.length + '. Nothing was taken.');
      return true;
    }
    if (!words.body) {
      toProfile(profileId, isJob ? 'Say what the job is. Nothing was taken.'
                                 : 'Say what the notice says. Nothing was taken.');
      return true;
    }
    if (words.body.length > POST_BODY_CHARS) {
      toProfile(profileId, 'What ' + what + ' says is up to ' + POST_BODY_CHARS + ' characters. That is ' +
                words.body.length + '. Nothing was taken.');
      return true;
    }
    var fee = isJob ? JOB_FEE : NOTICE_FEE;
    var cost = fee + reward;
    if (!Number.isSafeInteger(cost) || !takeGold(actorId, cost)) {
      toProfile(profileId, isJob
        ? 'That costs ' + cost + ' gold, ' + fee + ' for the board and the ' + reward +
          ' reward, and you do not have it. Nothing was taken.'
        : 'That costs ' + fee + ' gold and you do not have it.');
      return true;
    }
    var who = 'somebody';
    try {
      var ap = mp.get(actorId, 'appearance');
      if (ap && ap.name) { who = String(ap.name); }
    } catch (e) { }

    if (!notices[hold]) { notices[hold] = []; }
    var made = { by: profileId, name: who, title: words.title, text: words.body, at: Date.now(),
                 job: !!isJob, taken: 0 };
    // The reward is held on the ledger in pay, the way a letter's 15 and a
    // haul's pay are (noticeHolds), until the poster says it is done.
    if (isJob) { made.pay = reward; }
    notices[hold].push(made);
    funds[hold] = (Number(funds[hold]) || 0) + cost;
    save();
    plog(who, isJob ? 'posted a job in' : 'posted a notice in', hold, 'for', cost, 'gold:', words.title);
    toProfile(profileId, isJob
      ? 'Your job is on the board in ' + hold + '. That cost ' + cost + ' gold: ' + fee +
        ' for the board, and the ' + reward + ' reward, held until you say the job is done. ' +
        'Then it goes to whoever took it.'
      : 'Your notice is on the board in ' + hold + '. That cost ' + fee + ' gold.');
    refreshPanel(actorId);
    return true;
  }

  /*
    A NOTICE IN AN OFFICE'S NAME (#513). The world stage block's proclaim is
    the only caller, and nothing calls that in play yet.

    An office's notice is the office's word, not somebody's purchase: no fee
    is taken, nothing goes onto any hold's ledger and nothing is held there,
    so funds and heldOn are as they were. It is otherwise a notice like a
    person's, on the wall and under Boards on J, with the same 60 and 600
    limits. It is put up by nobody: by is 0, which is no profile, so no
    person sees it as their own and only that hold's Guard or Jarl takes it
    down, the same as any post on their board (#502, #2551). name is the
    office, which is what the wall shows, and office marks it as one.

    Every hold named has to have a board, and the words have to fit, or the
    whole call is refused and nothing is written. 'all' is every hold that
    has a board. A hold named twice gets one notice.
  */
  function officePost(holdList, office, title, body) {
    var named = holdList === 'all'
      ? LEDGER_HOLDS.filter(function (h) { return Object.prototype.hasOwnProperty.call(boards, h); })
      : (typeof holdList === 'string' ? [holdList] : holdList);
    if (!Array.isArray(named) || !named.length) { return { ok: false, why: 'Name a hold. Nothing was put up.' }; }
    var keys = [];
    for (var i = 0; i < named.length; i++) {
      var k = String(named[i] || '').trim().toLowerCase();
      if (LEDGER_HOLDS.indexOf(k) < 0 || !Object.prototype.hasOwnProperty.call(boards, k)) {
        return { ok: false, why: 'No board in ' + String(named[i]) + '. Nothing was put up.' };
      }
      if (keys.indexOf(k) < 0) { keys.push(k); }
    }
    var who = String(office || '').replace(/\s+/g, ' ').trim();
    if (!who) { return { ok: false, why: 'Name the office it is from. Nothing was put up.' }; }
    if (who.length > POST_TITLE_CHARS) {
      return { ok: false, why: 'An office is up to ' + POST_TITLE_CHARS + ' characters. Nothing was put up.' };
    }
    var head = String(title || '').replace(/\s+/g, ' ').trim();
    if (!head) { return { ok: false, why: 'Give the notice a title. Nothing was put up.' }; }
    if (head.length > POST_TITLE_CHARS) {
      return { ok: false, why: 'A title is up to ' + POST_TITLE_CHARS + ' characters. That one is ' +
               head.length + '. Nothing was put up.' };
    }
    var text = String(body || '').trim();
    if (!text) { return { ok: false, why: 'Say what the notice says. Nothing was put up.' }; }
    if (text.length > POST_BODY_CHARS) {
      return { ok: false, why: 'What the notice says is up to ' + POST_BODY_CHARS + ' characters. That is ' +
               text.length + '. Nothing was put up.' };
    }
    var at = Date.now();
    for (var j = 0; j < keys.length; j++) {
      if (!notices[keys[j]]) { notices[keys[j]] = []; }
      notices[keys[j]].push({ by: 0, office: true, name: who, title: head, text: text, at: at,
                              job: false, taken: 0 });
    }
    save();
    plog(who, 'put a notice up in', keys.join(', '), 'with no fee:', head);
    return { ok: true, holds: keys, office: who, title: head };
  }

  function board(parts, actorId, profileId, toProfile) {
    var arg = (parts && parts.length > 1) ? String(parts[1]).trim().toLowerCase() : '';
    var standing = boardHere(actorId);

    // /board here moves it, and only a steward may.
    if (arg === 'here') {
      if (!standing) {
        toProfile(profileId, 'Stand at the board you are moving.');
        return true;
      }
      return moveBoard(standing, actorId, profileId, toProfile);
    }
    /*
      MOVING NEEDS THE WORD 'move', AND READING IS THE DEFAULT.

      This used to move a hold's board whenever a STEWARD named that hold. So a
      steward standing in Riften who said '/board whiterun' to see what was on
      Whiterun's board picked it up and put it down in Riften, was told only
      "whiterun's board is here now", and it was saved. There was no
      confirmation, no way back but walking to the right spot, and no way for a
      steward to read another hold's board at all. The destructive reading of
      the word was the default one, and only for the people trusted with it.

      Found by the audit of 21 September. Placing a board is rare and reading
      one is constant, so the rare thing is the one that has to be spelled out.
    */
    if (arg === 'move') {
      var which = (parts && parts.length > 2)
        ? String(parts[2]).trim().toLowerCase() : standing;
      if (!which) {
        toProfile(profileId, 'Pick the board to move on the Office page of K, standing where you want it.');
        return true;
      }
      return moveBoard(which, actorId, profileId, toProfile);
    }

    /*
      READING A BOARD IS A PANEL, NOT A LINE IN THE CHAT (#1627). Clicking
      the board opens its panel there, and J's Boards tab sends
      /board <hold> for any town's, from anywhere. That line puts the board
      on J (boardsView) and answers nothing in the chat. With no town, it
      says where the boards are.
    */
    if (!arg) {
      toProfile(profileId, 'Click a notice board to read it. Every town\'s board is on J, under Boards.');
      return true;
    }
    if (!Object.prototype.hasOwnProperty.call(boards, arg)) {
      toProfile(profileId, 'No board in ' + arg + '.');
      return true;
    }
    boardReads[profileId] = arg;
    refreshPanel(actorId);
    return true;
  }

  /*
    ------------------------------------------------------ the taker's list

    Patrick: thirty gold for a job, "which goes on the taker's list". So a job
    is the one thing on a board that has a second half: somebody takes it, and
    from then on it is theirs.

    WHAT THE SERVER DOES AND DOES NOT DO. It records who took what and when,
    and it takes the job off the open board so two people do not both go and
    do it. It does not judge whether a job was done: a server that did would
    be a server refereeing roleplay, which is the one thing Patrick has been
    clear it should not do. Since #2554 a job carries a reward, held on the
    ledger from the moment it is posted, and the poster says it is done with
    Pay the reward (jobDone, below), the way the poster of a haul confirms
    it. Then the reward goes to the taker.

    A taker can hand it back with /drop, because somebody who takes a job and
    then cannot do it should not leave it dead on the board for ever.
  */
  function take(parts, actorId, profileId, toProfile) {
    var hold = boardHere(actorId);
    if (!hold) {
      toProfile(profileId, 'Stand at a board to take a job off it.');
      return true;
    }
    var list = notices[hold] || [];
    var at = Number((parts && parts[1]) || 0) - 1;
    if (!(at >= 0 && at < list.length)) {
      toProfile(profileId, 'That one is not on the board.');
      return true;
    }
    var n = list[at];
    if (n.down) {
      toProfile(profileId, 'That one has been taken down.');
      return true;
    }
    if (!n.job) {
      toProfile(profileId, 'That is a notice, not a job. There is nothing to take.');
      return true;
    }
    if (n.taken) {
      toProfile(profileId, n.takenName + ' has that one.');
      return true;
    }
    if (n.by === profileId) {
      toProfile(profileId, 'That is your own job.');
      return true;
    }
    var who = 'somebody';
    try {
      var ap = mp.get(actorId, 'appearance');
      if (ap && ap.name) { who = String(ap.name); }
    } catch (e) { }
    n.taken = profileId;
    n.takenName = who;
    n.takenAt = Date.now();
    save();
    if (n.letter) {
      plog(who, 'took a letter for', n.to, 'in', hold);
      toProfile(profileId, 'You take the letter for ' + n.to + ', from ' + n.name + '. It is sealed. ' +
                'Find ' + n.to + ', look at them within about 10 metres, and hand it over with the key ' +
                'the prompt shows. The ' + (Number(n.pay) || 0) + ' gold is yours.');
      refreshPanel(actorId);
      return true;
    }
    if (n.haul) {
      var tenth = haulTenth(n.pay, n) || 0;
      plog(who, 'took a haul in', hold, 'to', n.dest + ':', n.text);
      toProfile(profileId, 'You take the haul to ' + n.dest + ': ' + n.text + '. At ' + n.dest + '\'s board, ' +
                n.name + ' or a steward confirms it on the board, and ' +
                (n.pay - tenth) + ' gold is yours. The company keeps ' + tenth + '.');
      refreshPanel(actorId);
      return true;
    }
    plog(who, 'took a job in', hold + ':', n.title);
    toProfile(profileId, 'You take it: ' + n.title + '. Go and see ' + n.name + ' about it. The ' +
              (Math.floor(Number(n.pay)) || 0) + ' gold reward is held until ' + n.name + ' says it is done.');
    refreshPanel(actorId);
    return true;
  }

  /*
    A JOB DONE, AND ITS REWARD PAID (#2554).

        /job done 4      Pay the reward, on the poster's own taken job, at its board

    NOBODY TYPES THIS. The board panel's Pay the reward sends it, on a job
    of yours that somebody has taken, at the board it is on. Patrick, 15
    Oct: the reward "is held for whoever does the job, as today's job pay
    is", which is a haul's pay, and a haul is confirmed by the person who
    posted it. So the poster says when it is done, and nobody else: the
    server does not judge it. The taker is handed the whole reward out of the
    ledger it was held on (handHaul), or, while they are away, it is held as
    owed to them and haulTick hands it over when they are back. The job comes
    down the way a take down does, keeping its number. The fee stays with
    the hold.
  */
  function jobDone(parts, actorId, profileId, toProfile) {
    var hold = boardHere(actorId);
    if (!hold) {
      toProfile(profileId, 'Stand at the board you put the job on.');
      return true;
    }
    var list = notices[hold] || [];
    var at = Number((parts && parts[2]) || 0) - 1;
    if (!(Number.isInteger(at) && at >= 0 && at < list.length)) {
      toProfile(profileId, 'That one is not on the board.');
      return true;
    }
    var n = list[at];
    if (n.down) {
      toProfile(profileId, 'That one has been taken down.');
      return true;
    }
    if (!n.job || n.letter || n.haul) {
      toProfile(profileId, 'That is not a job with a reward.');
      return true;
    }
    if (Number(n.by) !== Number(profileId)) {
      toProfile(profileId, 'Only the person who posted a job says it is done.');
      return true;
    }
    if (!n.taken) {
      toProfile(profileId, 'Nobody has taken that job yet.');
      return true;
    }
    var reward = Math.floor(Number(n.pay)) || 0;
    var taker = n.takenName || 'Whoever took it';
    var r = handHaul(hold, n, Number(n.taken), reward,
                     'job ' + (at + 1) + ' done, the reward to ' + taker, 'reward');
    if (r.why) {
      plog('the reward of job', at + 1, 'in', hold, 'could not be paid:', r.why);
      toProfile(profileId, 'That did not work: ' + r.why + ' Nothing was paid.');
      return true;
    }
    n.paid = reward;
    n.done = Date.now();
    n.doneBy = profileId;
    takedown(hold, at, profileId);
    if (r.owed) {
      plog(taker, 'is owed', reward, 'for job', at + 1, 'in', hold + ':', n.title);
      toProfile(profileId, 'Done: ' + n.title + '. ' + taker + ' is away, so the ' + reward +
                ' gold reward is held for them until they are next in the world.');
    } else {
      plog(taker, 'was paid', reward, 'for job', at + 1, 'in', hold + ':', n.title);
      toProfile(profileId, 'Done: ' + n.title + '. ' + taker + ' is paid the ' + reward + ' gold reward.');
      toProfile(n.taken, n.name + ' says your job is done: ' + n.title + '. The ' + reward +
                ' gold reward is in your pack.');
    }
    refreshPanel(actorId);
    if (r.to) { refreshPanel(r.to); }
    return true;
  }

  /*
    What somebody is carrying off the boards, anywhere in Skyrim: Your jobs,
    on the board panel and under Boards on J (#1627). It was /jobs, typed.
    A job is handed back only at the board it came from (dropJob), so the
    panel puts Put it back on the rows of the board you stand at, and J,
    which is read only, has none.
  */
  function jobsOf(profileId) {
    var out = [];
    for (var hold in notices) {
      if (!Object.prototype.hasOwnProperty.call(notices, hold)) { continue; }
      var list = notices[hold];
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (n.job && Number(n.taken) === Number(profileId) && !n.down) {
          // A job's title, reward and body (#2554); a letter and a haul keep their one line.
          var plain = !n.letter && !n.haul;
          out.push({ hold: hold, where: (boards[hold] && boards[hold].where) || hold, n: i + 1,
                     name: n.name || 'somebody',
                     title: plain ? String(n.title || '') : '',
                     reward: plain ? (Math.floor(Number(n.pay)) || 0) : 0,
                     text: n.letter ? sealed(n) : (n.haul ? haulText(n) : (n.text || '')),
                     letter: !!n.letter, haul: !!n.haul });
        }
      }
    }
    return out;
  }

  /** Hand one back, so it does not sit dead on the board. */
  function dropJob(parts, actorId, profileId, toProfile) {
    var hold = boardHere(actorId);
    if (!hold) {
      toProfile(profileId, 'Stand at the board you took it from.');
      return true;
    }
    var list = notices[hold] || [];
    var at = Number((parts && parts[1]) || 0) - 1;
    if (!(at >= 0 && at < list.length)) {
      toProfile(profileId, 'That one is not on the board.');
      return true;
    }
    var n = list[at];
    if (!n.job || n.taken !== profileId || n.down) {
      toProfile(profileId, 'That is not one of yours.');
      return true;
    }
    /*
      A HAUL DROPPED IS A HAUL ENDED, #1393. docs/systems/trading-company.md:
      on a drop the pay returns to the poster's pack and the ledger goes down
      by that pay, and the fee stays. A haul with its pay gone cannot sit on
      the board for somebody else, so it comes down.
    */
    if (n.haul) { return cancelHaul(hold, at, n, 'drop', actorId, profileId, toProfile); }
    n.taken = 0;
    n.takenName = null;
    save();
    plog(profileId, 'gave a job back in', hold);
    toProfile(profileId, 'You put it back on the board.');
    refreshPanel(actorId);
    return true;
  }

  /*
    ------------------------------------------------------- taking one down

        /unpin 3      take down notice 3 on the board you are standing at

    Until this, nothing took a notice down: a notice paid for was up for ever,
    and so was a job its poster no longer needed doing. A poster can take down
    their own notice or their own untaken job, and nobody else's.

    A JOB SOMEBODY HAS TAKEN STAYS UP. It is on the taker's list, and pulling
    it out from under them would take it off their Your jobs with no word to
    either of them. It can come down once they hand it back.

    NO REFUND. The fee went onto the hold's ledger the moment the notice was
    posted, and the ledger is the hold's money.

    THE NUMBERS DO NOT MOVE. The panel's Take, Put it back and Take down send
    a notice's place in the list, drawn on the wall a moment before. Cutting a
    notice out would shift every newer one down by one, so somebody who
    pressed Take on 4 would take the job that had been 5. So a notice that
    comes down stays in the list marked down, and the wall and take step over
    it.

    takedown is the store half, with no rule in it about who may. It is on
    g.__thornswoodProperty so the guards (entries 209 and 208) can tear
    notices down on their own rule when they exist; until then the only
    caller is a poster's own /unpin.
  */
  function takedown(hold, at, byWhom) {
    var list = notices[hold] || [];
    var n = list[at];
    if (!n || n.down) { return null; }
    n.down = Date.now();
    n.downBy = byWhom;
    save();
    return n;
  }

  function unpin(parts, actorId, profileId, toProfile) {
    var hold = boardHere(actorId);
    if (!hold) {
      toProfile(profileId, 'Stand at the board you put it on.');
      return true;
    }
    var list = notices[hold] || [];
    var at = Number((parts && parts[1]) || 0) - 1;
    if (!(at >= 0 && at < list.length)) {
      toProfile(profileId, 'That one is not on the board.');
      return true;
    }
    var n = list[at];
    if (n.down) {
      toProfile(profileId, 'That one is already down.');
      return true;
    }
    /*
      A STEWARD CANCELS A HAUL, #1393, open or taken, at the board it was
      posted on. The pay goes back to the poster and the fee stays, the same
      as the poster's own /unpin before anybody has taken it.
    */
    // A steward of this board's hold (#2551).
    var stewardHaul = !!n.haul && isStewardOf(profileId, hold);
    // That hold's Guard or Jarl takes down any post on its board (#502,
    // #2551), and on no other hold's.
    if (n.by !== profileId && !stewardHaul && (isGuard(profileId, hold) || isJarlOf(profileId, hold))) {
      return guardTakedown(hold, at, n, actorId, profileId, toProfile);
    }
    if (n.by !== profileId && !stewardHaul) {
      toProfile(profileId, 'That is not yours to take down.');
      return true;
    }
    if (n.job && n.taken && !stewardHaul) {
      toProfile(profileId, n.takenName + ' has taken that job. It can come down once they hand it back.');
      return true;
    }
    if (n.haul) {
      return cancelHaul(hold, at, n, Number(n.by) === Number(profileId) ? 'own' : 'steward',
                        actorId, profileId, toProfile);
    }
    /*
      A LETTER'S PAY COMES BACK, #1374, and so does a job's reward, #2554.
      The board fee stays, like any notice's. The courier's 15 and the
      reward were only held, and with nobody to carry the letter or do the
      job they are the poster's again. Paid before it comes down, so a pack
      that cannot be written leaves it up and the gold still held. A job
      somebody has taken was refused above, so its taker never loses it.
    */
    var back = n.job ? payHeld(hold, n, actorId) : 0;
    if (back < 0) {
      toProfile(profileId, 'That did not work. The ' + (n.letter ? 'letter' : 'job') + ' is still up.');
      return true;
    }
    takedown(hold, at, profileId);
    if (n.letter) {
      plog(n.name, 'took down a letter for', n.to, 'in', hold, 'and had', back, 'back');
      toProfile(profileId, 'You take the letter down. The ' + back + ' gold for the courier comes back ' +
                'to you. The fee stays with ' + hold + '.');
      refreshPanel(actorId);
      return true;
    }
    plog(n.name, 'took down', n.job ? 'a job' : 'a notice', 'in', hold + ':', n.title,
         n.job ? 'and had the ' + back + ' reward back' : '');
    toProfile(profileId, 'You take it down. ' + (n.job ? 'The ' + back + ' gold reward comes back to you. ' : '') +
              'The fee stays with ' + hold + '.');
    refreshPanel(actorId);
    return true;
  }

  /*
    A GUARD TAKES A POST DOWN (#502). Patrick, 11 October: guards have "the
    ability to remove posts from a notice board ... only within their own
    hold". And 15 October (#2551): taking down a post needs that hold's Guard
    or Jarl. unpin sends a guard or the Jarl of the board's hold here for any
    post on it that is not their own; a guard or Jarl of another hold, at
    this board, is anybody. The fee stays with the hold, as it does when a poster takes
    their own down. Gold the post holds goes back to its poster, the way a
    steward's take down of a haul sends the pay back: a haul through
    cancelHaul, a letter's 15 through handHaul, held for them while they are
    away. Whoever had taken it is told it is off their list.
  */
  function guardTakedown(hold, at, n, actorId, profileId, toProfile) {
    var how = isGuard(profileId, hold) ? 'guard' : 'jarl';
    var byWhom = how === 'guard' ? 'a guard' : 'the Jarl';
    if (n.haul) {
      return cancelHaul(hold, at, n, how, actorId, profileId, toProfile);
    }
    var back = 0, owed = false;
    // A letter's 15, or a job's reward (#2554): what the post holds goes back to its poster.
    if (n.job) {
      var pay = Math.floor(Number(n.pay)) || 0;
      if (pay > 0) {
        var r = handHaul(hold, n, Number(n.by), pay,
                         (n.letter ? 'a letter for ' + (n.to || 'somebody') : 'job ' + (at + 1)) +
                         ' taken down by ' + byWhom + ', the pay back to ' + (n.name || 'its poster'),
                         n.letter ? 'letter' : 'job');
        if (r.why) {
          toProfile(profileId, 'That did not work: ' + r.why + ' The ' + (n.letter ? 'letter' : 'job') +
                    ' is still up.');
          return true;
        }
        back = pay;
        owed = r.owed;
      }
    }
    takedown(hold, at, profileId);
    var kind = n.letter ? 'letter' : (n.job ? 'job' : 'notice');
    var fee = 'The fee stays with ' + hold + '.';
    var held = n.letter ? 'gold for the courier' : 'gold reward';
    // A letter's words are sealed, and the log does not record them either.
    plog('law:', how === 'guard' ? 'a guard of' : 'the Jarl of', hold, '(' + personName(actorId) + ', profile ' + profileId + ') took down',
         (n.name || 'somebody') + '\'s', kind, at + 1, 'in',
         hold + (n.letter ? '' : ': ' + (n.title || '') + ': ' + (n.text || '')));
    toProfile(profileId, 'You take ' + (n.name || 'somebody') + '\'s ' + kind + ' down.' +
              (back ? ' The ' + back + ' ' + held + ' goes back to them' +
                      (owed ? ' when they are next in the world' : '') + '.' : '') + ' ' + fee);
    if (onlineActorOf(Number(n.by))) {
      toProfile(n.by, byWhom.charAt(0).toUpperCase() + byWhom.slice(1) + ' took your ' + kind + ' in ' + hold + ' down.' +
                (back && !owed ? ' The ' + back + ' ' + held + ' is back in your pack.' : '') + ' ' + fee);
    }
    if (n.taken && Number(n.taken) !== Number(profileId) && onlineActorOf(Number(n.taken))) {
      toProfile(n.taken, 'The ' + kind + ' in ' + hold + ' you took was taken down by ' + byWhom + '. It is off your list.');
    }
    refreshPanel(actorId);
    return true;
  }

  /*
    ------------------------------------------------------------- a letter

        /letter Lydia Meet me at the Drunken Huntsman at dusk.
        /letter "Lydia Stormblade" Meet me at the Drunken Huntsman at dusk.

    NOBODY TYPES THESE (#1595). Patrick, 4 Oct: nothing people do is a chat
    command. The board panel's Write a letter sends the second form, the name
    always in double quotes, and nothing a person reads names /letter.

    #1374, as docs/systems/noticeboards.md has it. A letter is a job with a
    named person at the other end, written standing at the board. The words
    are up to 300 characters, the same cap as /ooc; a longer one is refused
    before any gold is taken rather than cut, because the sender paid for the
    whole letter. The name is one word, or several in double quotes.

    THE WORDS ARE SEALED. Only deliver hands them to anybody. The wall, the
    panels, Your jobs and the taking line say who it is for and from whom, and
    the log does not record them either.
  */
  function postLetter(parts, actorId, profileId, toProfile) {
    var hold = boardHere(actorId);
    if (!hold) {
      toProfile(profileId, 'Stand at a hold\'s notice board to write a letter there.');
      return true;
    }
    var rest = (parts && parts.length > 1) ? parts.slice(1).join(' ').trim() : '';
    var to = '', words = '';
    if (rest.charAt(0) === '"') {
      var shut = rest.indexOf('"', 1);
      if (shut > 1) { to = rest.slice(1, shut).trim(); words = rest.slice(shut + 1).trim(); }
    } else {
      var gap = rest.indexOf(' ');
      to = gap < 0 ? rest : rest.slice(0, gap);
      words = gap < 0 ? '' : rest.slice(gap + 1).trim();
    }
    if (!to) {
      toProfile(profileId, 'Say who the letter is for.');
      return true;
    }
    if (!words) {
      toProfile(profileId, 'Say what the letter says.');
      return true;
    }
    if (words.length > LETTER_CHARS) {
      toProfile(profileId, 'A letter is up to ' + LETTER_CHARS + ' characters. That one is ' +
                words.length + '. Nothing was taken.');
      return true;
    }
    var cost = LETTER_FEE + LETTER_PAY;
    if (!takeGold(actorId, cost)) {
      toProfile(profileId, 'A letter costs ' + cost + ' gold and you do not have it.');
      return true;
    }
    var who = 'somebody';
    try {
      var ap = mp.get(actorId, 'appearance');
      if (ap && ap.name) { who = String(ap.name); }
    } catch (e) { }
    if (!notices[hold]) { notices[hold] = []; }
    notices[hold].push({ by: profileId, name: who, text: words, at: Date.now(),
                         job: true, letter: true, to: to, pay: LETTER_PAY, taken: 0 });
    funds[hold] = (Number(funds[hold]) || 0) + cost;
    save();
    plog(who, 'posted a letter for', to, 'in', hold, 'for', cost, 'gold');
    toProfile(profileId, 'Your letter for ' + to + ' is on the board in ' + hold + '. That cost ' + cost +
              ' gold: ' + LETTER_FEE + ' for the board, and ' + LETTER_PAY +
              ' held for whoever carries it.');
    refreshPanel(actorId);
    return true;
  }

  /*
        /deliver ff000103    the form id the crosshair gives, as /trade takes

    NOBODY TYPES THIS (#1595). The look prompt shows Hand over the letter
    while you carry one for the person under the crosshair (lettersCarried,
    below, through the near list's `d`), and its key sends this line with
    their form id. A name still finds them, the way findPerson always has,
    but nothing a person reads names /deliver.

    Every letter the courier carries for that person goes over at once,
    within the trade reach. The name is what is checked and nothing else: the
    server does not judge what a letter says, and a wrong person is refused
    with the letter still in the courier's hands. The person it is for is told
    the words, who wrote them and who brought them. The courier is paid each
    letter's held 15 out of the ledger it was counted on, and the letter comes
    off the wall the way a take down does, keeping its number.
  */
  function deliver(parts, actorId, profileId, toProfile) {
    var carried = [];
    for (var h in notices) {
      if (!Object.prototype.hasOwnProperty.call(notices, h)) { continue; }
      var list = notices[h] || [];
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (n && n.letter && !n.down && Number(n.taken) === Number(profileId)) {
          carried.push({ hold: h, at: i, n: n });
        }
      }
    }
    if (!carried.length) {
      toProfile(profileId, 'You are not carrying a letter. Take one off a board first.');
      return true;
    }
    var want = (parts && parts.length > 1) ? parts.slice(1).join(' ').trim() : '';
    if (!want) {
      toProfile(profileId, 'Look at the person the letter is for, and use the key the prompt shows.');
      return true;
    }
    var soc = g.__thornswoodSocial;
    if (!soc || !soc.findPerson || !soc.nameOfPerson || !soc.profileOf) {
      toProfile(profileId, 'That is not running on this server.');
      return true;
    }
    var found = soc.findPerson(want);
    if (!found || !found.actorId) {
      toProfile(profileId, (found && found.why) || 'Nobody here by that name.');
      return true;
    }
    var them = found.actorId;
    if (them === actorId) { toProfile(profileId, 'That is you.'); return true; }
    if (!letterReach(actorId, them)) {
      toProfile(profileId, 'Stand closer. A letter is handed over within about 10 metres.');
      return true;
    }
    var theirName = soc.nameOfPerson(them);
    var theirPid = Number(soc.profileOf(them)) || 0;
    if (!theirPid) {
      // Nobody to hand the words to, so nothing is paid and nothing comes down.
      toProfile(profileId, 'The server cannot tell who that is right now. Try again in a moment.');
      return true;
    }
    var mine = [];
    var fors = [];
    for (var k = 0; k < carried.length; k++) {
      if (nameIs(carried[k].n.to, theirName)) { mine.push(carried[k]); }
      else if (fors.indexOf(carried[k].n.to) === -1) { fors.push(carried[k].n.to); }
    }
    if (!mine.length) {
      toProfile(profileId, 'That is ' + theirName + '. What you carry is for ' + fors.join(', ') + '.');
      return true;
    }
    var courier = soc.nameOfPerson(actorId);
    var paid = 0;
    var handed = 0;
    for (var m = 0; m < mine.length; m++) {
      var c = mine[m];
      var got = payHeld(c.hold, c.n, actorId);
      if (got < 0) {
        toProfile(profileId, 'That did not work. You still have the letter for ' + c.n.to + '.');
        continue;
      }
      paid += got;
      c.n.delivered = Date.now();
      c.n.deliveredTo = theirPid;
      takedown(c.hold, c.at, profileId);
      handed++;
      plog(courier, 'handed', theirName, 'a letter from', c.n.name, 'off the board in', c.hold,
           'and was paid', got);
      toProfile(theirPid, 'A letter from ' + c.n.name + ', handed to you by ' + courier + ':\n' + c.n.text);
    }
    if (handed) {
      toProfile(profileId, 'You hand ' + theirName + (handed === 1 ? ' the letter. ' : ' ' + handed +
                ' letters. ') + paid + ' gold is yours.');
      refreshPanel(actorId);
      refreshPanel(them);
    }
    return true;
  }

  /* Within the trade's reach of each other, in the same cell. */
  function letterReach(a, b) {
    var reach = LETTER_REACH;
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

  /*
    WHO CARRIES A LETTER FOR WHOM, for the look prompt (#1595). The prompt
    shows Hand over the letter only while you carry a letter for the person
    under the crosshair, and only the server knows what anybody carries, so
    the social block's near list marks that person with `d`. deliver checks
    everything again when the line arrives: this decides what is drawn, never
    what is paid.

    One pass over every board, so the near list asks once a tick rather than
    once for every two people standing together. carries matches the names
    the way deliver does, with nameIs.
  */
  function lettersCarried() {
    var byCourier = {};
    for (var h in notices) {
      if (!Object.prototype.hasOwnProperty.call(notices, h)) { continue; }
      var list = notices[h] || [];
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (!n || !n.letter || n.down || !n.taken) { continue; }
        var who = String(Number(n.taken));
        (byCourier[who] = byCourier[who] || []).push(n.to);
      }
    }
    return {
      carries: function (courierPid, name) {
        var key = String(Number(courierPid));
        var tos = Object.prototype.hasOwnProperty.call(byCourier, key) ? byCourier[key] : null;
        if (!tos) { return false; }
        for (var k = 0; k < tos.length; k++) { if (nameIs(tos[k], name)) { return true; } }
        return false;
      }
    };
  }

  /*
    ------------------------------------------------------------- a haul

    NOBODY TYPES THESE. Patrick, 4 Oct: no chat commands for anything people
    do, only buttons and GUI. The board panel (game/ui/thornswood-board.js)
    sends them, the way it sends /job and /take:

        /haul 80 riften a crate of iron ingots    Send a haul, at the board it leaves from
        /haul done whiterun 4                     Confirm, at the board it went to

    so /haul is in WORDS and kept out of PLAYER_WORDS, and nothing a person
    reads names it.

    #1393, as docs/systems/trading-company.md has it. A haul is a job on a
    board with a pay and a destination hold. Posting it takes the job fee,
    30, and the pay in full, never halved, and both go onto the posting
    hold's ledger. The pay is held there the way a letter's 15 is, until the
    haul is confirmed or taken down.

    take and Your jobs treat it as any job. It comes down before it is delivered
    three ways, and each hands the pay back out of the ledger to the poster
    and keeps the fee (cancelHaul): the hauler's /dropjob, the poster's /unpin
    before anybody has taken it, and a steward's /unpin at the posting board,
    open or taken. Nothing was delivered, so the company keeps no tenth.

    On a confirm, by the poster or a steward, standing at the board the haul
    named, the company keeps its cut of the pay: the cut the haul was posted
    under, from the company's terms (#512, #2695; a tenth, rounded down, and
    nothing under 10 gold as they ship). The haul fee is the company's too,
    and apart from the board's job fee. The hauler is handed the rest out of the ledger, so the
    ledger drops by what the hauler received and keeps the fee and the tenth.
    It is the poster's gold moving, never new gold.

    AN ORDINARY JOB IS NOT A HAUL. A confirm answers only a job posted as a
    haul. An ordinary job's reward (#2554) is paid by its poster's Pay the
    reward, at the board it is on (jobDone), and no company tenth is kept.

    SOMEBODY AWAY IS PAID WHEN THEY ARE BACK. The server hands gold to a pack,
    and a pack is written only while its owner is in the world. When the
    hauler on a confirm, or the poster on a drop or a steward's cancel, is
    away, the haul still comes down, and what is theirs stays held on the
    ledger as owed to them (handHaul). haulTick hands it over the next time
    they are in the world, the way a bed's takings wait for a holder who is
    away (#1392). Nothing else can spend it in the meantime.
  */
  var HAUL_EVERY_MS = 5000;

  /*
    The company's cut of a haul's pay (#512, #2695): the cut haul n was
    posted under, read by the company terms block (a tenth, rounded down, and
    nothing under 10 gold, as the terms ship). null when the terms are not
    loaded, and then nothing is paid. The name is the one it had when the cut
    was a fixed tenth.
  */
  function haulTenth(pay, n) {
    var c = g.__thornswoodCompany;
    if (!c || typeof c.haulCut !== 'function') { return null; }
    return c.haulCut({ pay: Math.floor(Number(pay)) || 0, cut: n && n.cut });
  }

  /** A haul's line on the wall and in Your jobs: where it goes and the pay. */
  function haulText(n) {
    return 'haul to ' + n.dest + ' for ' + (Math.floor(Number(n.pay)) || 0) + ' gold: ' + (n.text || '');
  }

  /* What a person is told when the panel's line is short of something. */
  var HAUL_HOW = 'A haul is sent from the notice board: click the board, and fill in Send a haul. ' +
                 'It is confirmed on the board of the hold it went to.';

  function haulCmd(parts, actorId, profileId, toProfile) {
    var first = (parts && parts.length > 1) ? String(parts[1]).trim().toLowerCase() : '';
    if (first === 'done') { return confirmHaul(parts, actorId, profileId, toProfile); }
    if (!first) {
      toProfile(profileId, HAUL_HOW);
      return true;
    }
    return postHaul(parts, actorId, profileId, toProfile);
  }

  function postHaul(parts, actorId, profileId, toProfile) {
    var hold = boardHere(actorId);
    if (!hold) {
      toProfile(profileId, 'Stand at the board of the hold you are sending from to post a haul.');
      return true;
    }
    var word = String(parts[1] || '').trim();
    var pay = /^\d+$/.test(word) ? Number(word) : 0;
    if (!(pay > 0) || !Number.isSafeInteger(pay)) {
      toProfile(profileId, 'The pay is a whole number of gold, above nothing. ' + HAUL_HOW);
      return true;
    }
    var dest = String(parts[2] || '').trim().toLowerCase();
    if (LEDGER_HOLDS.indexOf(dest) < 0 || !Object.prototype.hasOwnProperty.call(boards, dest)) {
      toProfile(profileId, 'A haul goes to one of the ten towns: ' + LEDGER_HOLDS.join(', ') + '.');
      return true;
    }
    if (dest === hold) {
      toProfile(profileId, 'A haul goes from one hold to another, and this is ' + hold + '\'s board.');
      return true;
    }
    var text = parts.slice(3).join(' ').trim();
    if (!text) {
      toProfile(profileId, 'Say what it carries. ' + HAUL_HOW);
      return true;
    }
    // The haul fee and the cut are the company's terms (#512, #2695), apart from the board's job fee.
    var co = g.__thornswoodCompany;
    if (!co || typeof co.haulFee !== 'function' || typeof co.stampHaul !== 'function') {
      toProfile(profileId, 'The company\'s terms are not loaded on this server, so no haul is posted. Say so in the dev channel.');
      return true;
    }
    var fee = co.haulFee();
    var cost = fee + pay;
    if (!Number.isSafeInteger(cost) || !takeGold(actorId, cost)) {
      toProfile(profileId, 'That costs ' + cost + ' gold, ' + fee + ' for the board and the ' + pay +
                ' pay, and you do not have it. Nothing was taken.');
      return true;
    }
    var who = 'somebody';
    try {
      var ap = mp.get(actorId, 'appearance');
      if (ap && ap.name) { who = String(ap.name); }
    } catch (e) { }
    if (!notices[hold]) { notices[hold] = []; }
    // The haul carries the cut it was posted under, so a change of terms never re-prices it.
    notices[hold].push(co.stampHaul({ by: profileId, name: who, text: text, at: Date.now(),
                                      job: true, haul: true, dest: dest, pay: pay, taken: 0 }));
    // deposit saves the notice with the coin, so the two cannot part.
    if (!deposit(hold, cost, 'a haul to ' + dest + ': the ' + fee + ' fee, and ' + pay + ' pay held')) {
      notices[hold].pop();
      payOut(actorId, cost);
      toProfile(profileId, 'That did not work. Nothing was taken.');
      return true;
    }
    plog(who, 'posted a haul in', hold, 'to', dest, 'for', pay, 'gold and the', fee, 'fee');
    toProfile(profileId, 'Your haul to ' + dest + ' is on the board in ' + hold + ', number ' +
              notices[hold].length + '. That cost ' + cost + ' gold: ' + fee + ' for the board, and the ' +
              pay + ' pay, held until it is confirmed at ' + dest + '.');
    refreshPanel(actorId);
    return true;
  }

  function confirmHaul(parts, actorId, profileId, toProfile) {
    var standing = boardHere(actorId);
    if (!standing) {
      toProfile(profileId, 'Stand at the board of the hold the haul went to.');
      return true;
    }
    var from = String(parts[2] || '').trim().toLowerCase();
    var num = Number(parts[3] || 0);
    if (LEDGER_HOLDS.indexOf(from) < 0 || !Number.isInteger(num) || num < 1) {
      toProfile(profileId, 'That haul is not on any board. ' + HAUL_HOW);
      return true;
    }
    var at = num - 1;
    var n = (notices[from] || [])[at];
    if (!n) {
      toProfile(profileId, 'There is no number ' + num + ' on ' + from + '\'s board.');
      return true;
    }
    if (!n.haul) {
      toProfile(profileId, 'That is not a haul. A job\'s reward is paid by whoever posted it, ' +
                'with Pay the reward on the job at its own board.');
      return true;
    }
    if (n.down) {
      toProfile(profileId, 'That haul is already paid or taken down.');
      return true;
    }
    if (standing !== n.dest) {
      toProfile(profileId, 'That haul goes to ' + n.dest + '. It is confirmed at ' + n.dest + '\'s board.');
      return true;
    }
    // A steward of the hold it came to (#2551): the board it is confirmed at is theirs.
    if (Number(n.by) !== Number(profileId) && !isStewardOf(profileId, n.dest)) {
      toProfile(profileId, 'Only the person who posted it, or a steward of ' +
                ((boards[n.dest] && boards[n.dest].where) || n.dest) +
                ', confirms a haul.');
      return true;
    }
    if (!n.taken) {
      toProfile(profileId, 'Nobody has taken that haul.');
      return true;
    }
    if (Number(n.taken) === Number(profileId)) {
      toProfile(profileId, 'The hauler does not confirm their own haul. The person who posted it, or a steward, does.');
      return true;
    }
    var pay = Math.floor(Number(n.pay)) || 0;
    var tenth = haulTenth(pay, n);
    if (tenth === null) {
      toProfile(profileId, 'The company\'s terms are not loaded on this server, so nothing was paid. Say so in the dev channel.');
      return true;
    }
    var got = pay - tenth;
    var r = handHaul(from, n, Number(n.taken), got,
                     'haul ' + num + ' to ' + n.dest + ' delivered, ' + tenth + ' kept for the company', 'hauled');
    if (r.why) {
      plog('a haul in', from, 'could not be paid:', r.why);
      toProfile(profileId, 'That did not work: ' + r.why + ' Nothing was paid.');
      return true;
    }
    n.paid = got;
    n.kept = tenth;
    n.done = Date.now();
    n.doneBy = profileId;
    takedown(from, at, profileId);
    // One haul between two holds, for staff's hold economy page (#3164).
    var economy = g.__thornswoodEconomy;
    if (economy && typeof economy.hauled === 'function') {
      try { economy.hauled(from, n.dest); } catch (e) { plog('the hold economy could not count a haul:', e); }
    }
    var hauled = n.takenName || 'The hauler';
    var kept = tenth ? ', and the company keeps ' + tenth + '.' : '. Under 10 gold, the company keeps nothing.';
    if (r.owed) {
      plog(hauled, 'is owed', got, 'for a haul from', from, 'to', n.dest, 'and the company kept', tenth);
      toProfile(profileId, 'The haul from ' + from + ' is in: ' + n.text + '. ' + hauled + ' is away, so the ' + got +
                ' gold is held on ' + from + '\'s ledger for them until they are next in the world' + kept);
    } else {
      plog(hauled, 'was paid', got, 'for a haul from', from, 'to', n.dest, 'and the company kept', tenth);
      toProfile(profileId, 'The haul from ' + from + ' is in: ' + n.text + '. ' + hauled + ' is paid ' + got +
                ' gold out of ' + from + '\'s ledger' + kept);
      toProfile(n.taken, 'Your haul to ' + n.dest + ' is confirmed. ' + got + ' gold is in your pack.' +
                (tenth ? ' The company kept ' + tenth + '.' : ''));
    }
    if (Number(n.by) !== Number(profileId)) {
      toProfile(n.by, 'Your haul to ' + n.dest + ' was confirmed by a steward. ' + hauled + ' ' +
                (r.owed ? 'is owed ' : 'was paid ') + got + '.');
    }
    refreshPanel(actorId);
    if (r.to) { refreshPanel(r.to); }
    return true;
  }

  /*
    A haul's held gold to one person: `amount` of what n holds on `hold`'s
    ledger, to the profile `toPid`. In the world, it goes into their pack now
    and the same comes off the ledger. Away, nothing leaves the ledger: n holds
    it as owed to them, and haulTick hands it over when they are next in the
    world. Either way n.pay is 0 after, so the haul is paid once. `owedFor` is
    'hauled' or 'back', for the line they read then.

    Answers { why } with nothing changed when it cannot, otherwise { owed } and
    the actor it was paid to, { to }.
  */
  function handHaul(hold, n, toPid, amount, reason, owedFor) {
    var why = mayWithdraw(hold, amount, n);
    if (why) { return { why: why }; }
    var to = onlineActorOf(toPid);
    if (!to) {
      n.pay = 0;
      n.owed = amount;
      n.owedTo = toPid;
      n.owedFor = owedFor;
      save();
      plog(amount, 'gold held on', hold + '\'s ledger for', toPid, 'until they are in the world:', reason);
      return { owed: true, to: 0 };
    }
    if (!payOut(to, amount)) { return { why: 'their pack could not be written.' }; }
    withdraw(hold, amount, reason, n);
    n.pay = 0;
    return { owed: false, to: to };
  }

  /*
    What a haul, a letter or a job (#2554) owes somebody who was away, into
    their pack now they are in the world, and off the ledger it was held on. A ledger that cannot pay it
    is written to the log once a boot, and the gold stays held.
  */
  var haulShort = {};
  function haulTick() {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    if (!online.length) { return; }
    var here = {};
    for (var i = 0; i < online.length; i++) {
      var pid = profileOf(online[i]);
      if (pid) { here[pid] = online[i]; }
    }
    for (var h = 0; h < LEDGER_HOLDS.length; h++) {
      var hold = LEDGER_HOLDS[h];
      var list = notices[hold] || [];
      for (var j = 0; j < list.length; j++) {
        var n = list[j];
        // Letters and hauls are jobs, and so is a job with a reward (#2554).
        var owed = (n && n.job) ? (Math.floor(Number(n.owed)) || 0) : 0;
        if (!(owed > 0) || !here[Number(n.owedTo)]) { continue; }
        var to = here[Number(n.owedTo)];
        var why = mayWithdraw(hold, owed, n);
        if (why) {
          if (!haulShort[hold + ':' + j]) {
            haulShort[hold + ':' + j] = true;
            plog(n.letter ? 'letter' : (n.haul ? 'haul' : 'job'), j + 1, 'in', hold, 'owes', owed,
                 'and cannot pay it:', why);
          }
          continue;
        }
        if (!payOut(to, owed)) { continue; }
        withdraw(hold, owed, (n.letter ? 'letter ' + (j + 1) + ' for ' + (n.to || 'somebody')
                              : n.haul ? 'haul ' + (j + 1) + ' to ' + n.dest
                              : 'job ' + (j + 1)) + ', held for somebody who was away', n);
        n.owed = 0;
        save();
        var line = n.owedFor === 'letter'
          ? 'While you were away, a guard took your letter for ' + (n.to || 'somebody') + ' in ' + hold +
            ' down. The ' + owed + ' gold for the courier is back in your pack. The fee stays with ' + hold + '.'
          : n.owedFor === 'job'
          ? 'While you were away, a guard took your job in ' + hold + ' down: ' + (n.title || '') + '. The ' +
            owed + ' gold reward is back in your pack. The fee stays with ' + hold + '.'
          : n.owedFor === 'reward'
          ? 'While you were away, ' + (n.name || 'the person who posted it') + ' said the job you took in ' + hold +
            ' is done: ' + (n.title || '') + '. The ' + owed + ' gold reward is in your pack.'
          : n.owedFor === 'hauled'
          ? 'While you were away, your haul to ' + n.dest + ' was confirmed. ' + owed + ' gold is in your pack.' +
            ((Number(n.kept) || 0) ? ' The company kept ' + n.kept + '.' : '')
          : 'While you were away, your haul to ' + n.dest + ' came down. The ' + owed +
            ' gold pay is back in your pack. The fee stays with ' + hold + '.';
        plog('handed', owed, 'gold of a', n.letter ? 'letter' : (n.haul ? 'haul' : 'job'), 'in', hold,
             'to', personName(to));
        try { notify(to, line); } catch (e2) { }
        try { say(to, line); } catch (e3) { }
      }
    }
  }

  if (g.__thornswoodHaulTimer) { try { clearInterval(g.__thornswoodHaulTimer); } catch (e) { } }
  g.__thornswoodHaulTimer = setInterval(
    (typeof guard === 'function') ? guard('haulTick', haulTick) : haulTick, HAUL_EVERY_MS);

  /*
    ------------------------------------------------ word to the holder (#2680)

    Patrick, 17 October, decision 6B on #507: a holder is told, in the world,
    when somebody picks their door's lock or presents their deed, so they can
    answer it through RP. Nothing is typed, and it decides nothing: a dispute
    about who should have the place is the court's.

    WHY NOBODY WAS TOLD BEFORE. A locked reference is never announced to this
    server (activationService.ts in the fork), so that Skyrim's own
    lockpicking runs, and the only thing that ever saw a lock open was the
    front plugin's lockChanged handler, which said nothing. A presented deed
    was kept quiet on purpose (the deed in claim()), because a notice at the
    moment turns a theft into an alarm.

    SO THE WORD IS LATE, AND IT COMES FROM SOMEBODY IN THE WORLD. A runner
    from the steward's office of the building's hold, or a neighbour where no
    hold covers it, finds the holder delayMinutes after the act, or the next
    time they are in the world after that. They learn what happened, where,
    roughly when and, with describe on, what the person looked like: race and
    sex, never a name, a profile or an account. A name is for RP to bring out.
    The log keeps who, for staff and the court, the way every other property
    act is logged.

    THE PICK IS A CLIENT'S REPORT, /tspicked with the door's id, so it is
    checked here before it counts (picked, below): a property door that is
    not a way out or a cell, held and locked, the reporter with no way through
    it, standing at it or already inside, and carrying a lockpick. So a
    changed client can at most report a pick it could have made, and the
    limits below hold even that down. They are staff data,
    game/data/property-word.json; anything missing or wrong there is
    WORD_DEFAULTS, and the log says so.

    THE BOOK is the register's word key (wordBook, read beside the claims), so
    a restart keeps a word that has not gone out and a wipe moves it aside
    with the claims. A word that has gone out stays only as long as the limits
    need to count it.
  */
  var WORD_DEFAULTS = {
    pick: { on: true, delayMinutes: 20, describe: true, samePickerMinutes: 360 },
    deed: { on: true, delayMinutes: 10, describe: true },
    bundle: true, perHolderPerDay: 6, maxPending: 20, keepDays: 14,
    reach: 400, needLockpick: true, everySeconds: 30
  };
  var LOCKPICK_DESC = 'a:Skyrim.esm';

  /* What the log says a report came to. */
  var WORD_SAID = {
    'new': 'word goes to the holder',
    bundled: 'added to the word that has not reached them yet',
    same: 'already counted for that person at that door',
    day: 'the holder has had as much word of picks today as the limit allows',
    full: 'as much word as the limit allows is already waiting for the holder',
    off: 'word of this is turned off',
    nobody: 'there is nobody to tell'
  };

  /* The ten playable races, as a neighbour would put it. */
  var WORD_RACE = {
    nord: 'Nord', imperial: 'Imperial', breton: 'Breton', redguard: 'Redguard',
    highelf: 'High Elf', woodelf: 'Wood Elf', darkelf: 'Dark Elf', orc: 'Orc',
    argonian: 'Argonian', khajiit: 'Khajiit'
  };

  /*
    The limits, read once at start out of game/data/property-word.json and
    checked key by key: a number has to be a number at or above its floor and
    a switch has to be true or false, or that key stays the default.
  */
  var wordRulesRead = null;
  function wordRules() {
    if (wordRulesRead) { return wordRulesRead; }
    var out = JSON.parse(JSON.stringify(WORD_DEFAULTS));
    var doc = null;
    try {
      var fs = require('fs');
      var path = require('path');
      var root = typeof __dirname === 'string' ? __dirname : path.dirname(__filename);
      // #2873: on a server the file is not beside this one; STAFF_DATA carries it.
      doc = typeof STAFF_DATA !== 'undefined' && STAFF_DATA['property-word.json']
        ? JSON.parse(JSON.stringify(STAFF_DATA['property-word.json']))
        : JSON.parse(fs.readFileSync(path.join(root, 'data', 'property-word.json'), 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      plog('word: game/data/property-word.json would not read, so the limits are the defaults:',
           e && e.message ? e.message : e);
      doc = null;
    }
    var bad = [];
    function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
    function num(src, key, dst, floor, where) {
      if (!has(src, key)) { return; }
      if (typeof src[key] !== 'number' || !isFinite(src[key]) || src[key] < floor) { bad.push(where + key); return; }
      dst[key] = src[key];
    }
    function flag(src, key, dst, where) {
      if (!has(src, key)) { return; }
      if (typeof src[key] !== 'boolean') { bad.push(where + key); return; }
      dst[key] = src[key];
    }
    if (doc && typeof doc === 'object') {
      ['pick', 'deed'].forEach(function (k) {
        if (!has(doc, k)) { return; }
        var s = doc[k];
        if (!s || typeof s !== 'object') { bad.push(k); return; }
        flag(s, 'on', out[k], k + '.');
        flag(s, 'describe', out[k], k + '.');
        num(s, 'delayMinutes', out[k], 0, k + '.');
        if (k === 'pick') { num(s, 'samePickerMinutes', out[k], 0, k + '.'); }
      });
      flag(doc, 'bundle', out, '');
      flag(doc, 'needLockpick', out, '');
      num(doc, 'perHolderPerDay', out, 0, '');
      num(doc, 'maxPending', out, 1, '');
      num(doc, 'keepDays', out, 1, '');
      num(doc, 'reach', out, 1, '');
      num(doc, 'everySeconds', out, 5, '');
      if (bad.length) {
        plog('word: property-word.json has', bad.join(', '), 'wrong, so those keep the defaults');
      }
    }
    wordRulesRead = out;
    return out;
  }

  /*
    What a neighbour saw: "a Nord man", "an Orc woman". The race is the
    character's own, read the way the recipes read it (raceOf), and anything
    that is not one of the ten playable races is no description at all
    rather than a guess.
  */
  function lookOf(actorId) {
    var race = '';
    try { race = (typeof raceOf === 'function') ? String(raceOf(actorId) || '') : ''; } catch (e) { race = ''; }
    race = race.toLowerCase().replace(/vampire$/, '').replace(/race$/, '');
    var word = Object.prototype.hasOwnProperty.call(WORD_RACE, race) ? WORD_RACE[race] : '';
    if (!word) { return ''; }
    var female = false;
    try {
      var ap = mp.get(actorId, 'appearance');
      female = !!(ap && ap.isFemale);
    } catch (e2) { female = false; }
    return (/^[AEIOU]/.test(word) ? 'an ' : 'a ') + word + (female ? ' woman' : ' man');
  }

  /*
    One act, written down for the holder. Answers which of WORD_SAID it came
    to. A pick by the same person at the same building inside
    samePickerMinutes is one pick. With bundle on, a second act at a building
    whose word has not gone out yet is added to that word rather than sent as
    another. Picks are held to perHolderPerDay (0 is no limit) and maxPending;
    a deed is never held back, because it is one word for one transfer.
  */
  function recordWord(kind, building, holder, actorId, by, now) {
    var R = wordRules();
    var K = R[kind];
    if (!K || !K.on) { return 'off'; }
    holder = Number(holder) || 0;
    by = Number(by) || 0;
    if (!(holder > 0)) { return 'nobody'; }
    var list = wordBook.list;
    var look = K.describe ? lookOf(actorId) : '';
    var i, w;
    if (kind === 'pick' && R.pick.samePickerMinutes > 0 && by > 0) {
      for (i = 0; i < list.length; i++) {
        w = list[i];
        if (w.kind === 'pick' && w.building === building && w.holder === holder &&
            w.by.indexOf(by) !== -1 && now - w.last < R.pick.samePickerMinutes * 60000) {
          return 'same';
        }
      }
    }
    if (R.bundle) {
      for (i = 0; i < list.length; i++) {
        w = list[i];
        if (!w.sent && w.kind === kind && w.building === building && w.holder === holder) {
          w.count = Math.min(99, w.count + 1);
          w.last = now;
          if (by > 0 && w.by.indexOf(by) === -1 && w.by.length < 10) { w.by.push(by); }
          if (look && w.looks.indexOf(look) === -1 && w.looks.length < 3) { w.looks.push(look); }
          save();
          return 'bundled';
        }
      }
    }
    if (kind === 'pick') {
      var pending = 0, today = 0;
      for (i = 0; i < list.length; i++) {
        w = list[i];
        if (w.holder !== holder) { continue; }
        if (!w.sent) { pending++; }
        if (w.kind === 'pick' && now - w.at < 86400000) { today++; }
      }
      if (R.perHolderPerDay > 0 && today >= R.perHolderPerDay) { return 'day'; }
      if (pending >= R.maxPending) { return 'full'; }
    }
    list.push({ kind: kind, building: building, holder: holder, by: by > 0 ? [by] : [],
                at: now, last: now, count: 1, due: now + K.delayMinutes * 60000,
                looks: look ? [look] : [], sent: 0 });
    save();
    return 'new';
  }

  /* A lockpick in the server's copy of the pack. A pick that opens a lock is not spent. */
  function holdsLockpick(actorId) {
    var baseId = idOf(LOCKPICK_DESC);
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return false; }
    var entries = (inv && inv.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e && e.baseId === baseId && e.count > 0) { return true; }
    }
    return false;
  }

  /*
    At the door or already through it. The report rides the chat socket and
    arrives a second or two late, and a picked load door has usually taken the
    person inside by then, so the building's own cell counts as well as
    standing within reach of the door in its cell.
  */
  function atPickedDoor(actorId, doorId, building, reach) {
    var cell = '';
    try { cell = String(mp.get(actorId, 'worldOrCellDesc') || ''); } catch (e) { return false; }
    if (!cell) { return false; }
    if (cell === building) { return true; }
    try {
      var dc = String(mp.get(doorId, 'worldOrCellDesc') || '');
      if (!dc || dc !== cell) { return false; }
      var pa = mp.get(actorId, 'pos'), pb = mp.get(doorId, 'pos');
      if (!pa || !pb) { return false; }
      var dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
      return (dx * dx + dy * dy + dz * dz) <= reach * reach;
    } catch (e2) { return false; }
  }

  /*
        /tspicked 1a2b3        the door's form id, in hex

    NOBODY TYPES THIS. The front plugin sends it when a door the server shut
    to this person opens on their machine, which is a pick (the lock script
    takes a door off that list before it opens one itself). Every check is
    made again here and a report that fails one is logged and counts for
    nothing. Answers which of WORD_SAID it came to, or why it did not count.
  */
  function picked(actorId, profileId, idText) {
    var now = Date.now();
    var R = wordRules();
    profileId = Number(profileId) || 0;
    var who = personName(actorId);
    function no(why) {
      plog('word: a pick reported by', who, '(profile ' + profileId + ') did not count:', why);
      return why;
    }
    if (!R.pick.on) { return 'off'; }
    var id = parseInt(String(idText || ''), 16);
    if (!(id > 0)) { return no('it named no door'); }
    var desc = '';
    try { desc = String(mp.getDescFromId(id) || ''); } catch (e) { desc = ''; }
    var building = desc ? buildingOf(desc) : null;
    if (!building) { return no('that is not a door of a building'); }
    if (wayOut(desc)) { return no('that door is a way out of ' + nameOf(building)); }
    if (jailHoldOf(desc)) { return no('that is a cell door'); }
    var held = holderOf(building);
    if (!held) { return no(nameOf(building) + ' is held by nobody'); }
    if (!held.locked) { return no(nameOf(building) + ' is not locked'); }
    if (mayPass(actorId, profileId, building)) { return no('they may go through ' + nameOf(building) + '\'s doors anyway'); }
    if (!atPickedDoor(actorId, id, building, R.reach)) { return no('they are not at that door or inside ' + nameOf(building)); }
    if (R.needLockpick && !holdsLockpick(actorId)) { return no('they carry no lockpick'); }
    var r = recordWord('pick', building, held.by, actorId, profileId, now);
    plog('word:', who, '(profile ' + profileId + ') picked the lock of', nameOf(building), 'held by',
         held.name, '(profile ' + held.by + '):', WORD_SAID[r] || r);
    return r;
  }

  /* Roughly when, the way somebody passing it on would say it. */
  function wordWhen(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 15) { return 'only a few minutes ago'; }
    if (m < 60) { return 'within the hour'; }
    var h = Math.round(m / 60);
    if (h < 2) { return 'about an hour ago'; }
    if (h < 24) { return 'about ' + h + ' hours ago'; }
    var d = Math.floor(m / 1440);
    if (d < 2) { return 'yesterday'; }
    return d + ' days ago';
  }

  /* The words the holder is handed. Nobody is named in them. */
  function wordText(w, now) {
    var hold = holdOfBuilding(w.building);
    var town = hold ? (HOLD_TOWN[hold] || hold) : '';
    var from = town ? 'A runner from the steward\'s office of ' + town + ' finds you with word: '
                    : 'A neighbour finds you with word: ';
    var when = (w.count > 1 ? ' more than once, the last time ' : ' ') + wordWhen(now - w.last);
    var body = w.kind === 'pick'
      ? 'somebody was seen working the lock on the door of ' + nameOf(w.building) + when + '.'
      : 'the deed to ' + nameOf(w.building) + ' was presented at its door' + when +
        ', and the register named somebody else as its holder.';
    var looks = '';
    if (w.looks.length === 1) { looks = ' Whoever it was looked like ' + w.looks[0] + '.'; }
    else if (w.looks.length > 1) {
      looks = ' Those seen looked like ' + w.looks.slice(0, -1).join(', ') + ' and ' +
              w.looks[w.looks.length - 1] + '.';
    }
    var tail = town ? ' The office takes no side. A grievance is for the court.'
                    : ' Nobody here takes a side. A grievance is for the court.';
    return from + body + looks + tail;
  }

  /* Who is in the world, by profile. */
  function onlineByProfile() {
    var here = {};
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return here; }
    for (var i = 0; i < online.length; i++) {
      var pid = profileOf(online[i]);
      if (pid) { here[pid] = online[i]; }
    }
    return here;
  }

  /*
    Every word that is due, to a holder who is in the world; the rest wait.
    A word nobody could be handed in keepDays (the lapse) is dropped, and a
    word that has gone out is kept only while the limits still count it: a
    day, or samePickerMinutes when that is longer.
  */
  function wordTick() {
    var now = Date.now();
    var R = wordRules();
    var keepSent = Math.max(86400000, R.pick.samePickerMinutes * 60000);
    var kept = [];
    var changed = false;
    var here = null;
    var list = wordBook.list;
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (w.sent) {
        if (now - w.sent >= keepSent && now - w.last >= keepSent) { changed = true; continue; }
        kept.push(w);
        continue;
      }
      if (now - w.last >= R.keepDays * 86400000) {
        plog('word: the', w.kind, 'word about', nameOf(w.building), 'for profile', w.holder,
             'did not reach them in', R.keepDays, 'days and is dropped');
        changed = true;
        continue;
      }
      kept.push(w);
      if (w.due > now) { continue; }
      if (!here) { here = onlineByProfile(); }
      var to = here[w.holder];
      if (!to) { continue; }
      var line = wordText(w, now);
      w.sent = now;
      changed = true;
      plog('word: the', w.kind, 'word about', nameOf(w.building), 'reached', personName(to),
           '(profile ' + w.holder + ')');
      notify(to, line);
      say(to, line);
    }
    if (changed) {
      wordBook.list = kept;
      save();
    }
  }

  if (g.__thornswoodWordTimer) { try { clearInterval(g.__thornswoodWordTimer); } catch (e) { } }
  g.__thornswoodWordTimer = setInterval(
    (typeof guard === 'function') ? guard('wordTick', wordTick) : wordTick, wordRules().everySeconds * 1000);


  // The boards and boxes stood where they should be (#2516), once, at start.
  // The ten second check that was here is gone: a timer repairing state.
  if (g.__thornswoodBoardTimer) { try { clearInterval(g.__thornswoodBoardTimer); } catch (e) { } }
  g.__thornswoodBoardTimer = null;
  standBoards();
  // The woodworking benches beside the forges (#516), once, at start, the same way.
  standBenches();

  /*
    A haul comes down before it is delivered: the hauler's /dropjob, the
    poster's /unpin before anybody has taken it, or a steward's /unpin at the
    posting board, open or taken. `how` is 'drop', 'own' or 'steward'. The
    pay goes back out of the ledger to the poster, held for them while they
    are away (handHaul), and the fee stays. Nothing was delivered, so the
    company's tenth is not taken. Who may has been settled by the caller.
  */
  function cancelHaul(hold, at, n, how, actorId, profileId, toProfile) {
    var pay = Math.floor(Number(n.pay)) || 0;
    var owed = false;
    if (pay > 0) {
      var r = handHaul(hold, n, Number(n.by), pay,
                       'a haul to ' + n.dest + ' taken down, the pay back to ' + n.name, 'back');
      if (r.why) {
        toProfile(profileId, 'That did not work: ' + r.why + ' The haul is still up' +
                  (how === 'drop' ? ', and still yours.' : '.'));
        return true;
      }
      owed = r.owed;
    }
    n.back = pay;
    takedown(hold, at, profileId);
    var later = owed ? ' when they are next in the world' : '';
    var fee = 'The fee stays with ' + hold + '.';
    var office = how === 'guard' ? 'a guard' : (how === 'jarl' ? 'the Jarl' : 'a steward');
    plog(how === 'drop' ? (n.takenName || 'the hauler') + ' dropped' : (how === 'own' ? n.name : office) + ' took down',
         'a haul to', n.dest, 'in', hold, 'and', pay, owed ? 'is held for' : 'went back to', n.name);
    if (how === 'own') {
      toProfile(profileId, 'You take the haul down. The ' + pay + ' gold pay comes back to you. ' + fee);
    } else if (how === 'drop') {
      toProfile(profileId, 'You hand the haul to ' + n.dest + ' back. It comes down, and the ' + pay +
                ' gold pay goes back to ' + n.name + later + '. ' + fee);
      if (!owed) {
        toProfile(n.by, (n.takenName || 'The hauler') + ' handed your haul to ' + n.dest + ' back. The ' + pay +
                  ' gold pay is back in your pack. ' + fee);
      }
    } else {
      toProfile(profileId, 'You take ' + n.name + '\'s haul to ' + n.dest + ' down. The ' + pay +
                ' gold pay goes back to them' + later + '. ' + fee);
      if (!owed) {
        toProfile(n.by, office.charAt(0).toUpperCase() + office.slice(1) + ' took your haul to ' + n.dest + ' down. The ' + pay +
                  ' gold pay is back in your pack. ' + fee);
      }
    }
    if (how !== 'drop' && n.taken && Number(n.taken) !== Number(profileId)) {
      toProfile(n.taken, 'The haul to ' + n.dest + ' you took was taken down by ' + office + '. It is off your list.');
    }
    refreshPanel(actorId);
    return true;
  }

  /*
    ------------------------------------------- a sale out of Skyrim

    #1393, docs/systems/trading-company.md "Sales that leave the world". At a
    company event somebody sells a thing out of Skyrim. The company buys it
    through the worker who handles the sale, and the thing leaves the world.
    It does not come back into a chest.

    IT IS A TRADE, ON THE TRADE PANEL. Patrick, 4 Oct: no chat commands for
    anything people do. The worker and the seller open an ordinary trade with
    the key on the look prompt, and the worker presses Buy for the company on
    the panel. The trade block moves it (saleSwap there). These two are the
    company's half of it: the cuts, and who may.

    AN ITEM HAS NO GOLD PRICE OF ITS OWN. The price is the gold the worker
    puts up and the two of them agree to on the panel, the way any trade is
    agreed. Any change to either side takes both agreements back.

    THE CUTS are the company's terms (#512, #2695), and as they ship: the
    worker takes 10% of the price, rounded down, and another 10% leaves the
    server. The seller receives the rest. Under 10 gold neither cut
    is taken and the seller receives the whole price. The price comes out of
    the worker's pack, the company's coin in their hands, and the worker's own
    10% is never taken from it, so the worker pays the price less their cut.
    No coin is created and none goes onto a ledger: the 10% that leaves is
    destroyed. Where the price comes from is asked on #1393.

    WHO MAY. A character on an account the company has taken on: the Discord
    role an application in Discord leads to (__thornswoodIsCompany), or an
    admin testing the chain, the same as a Jarl.
  */
  /*
    A price split by the company's terms (#512, #2695): the worker's cut, the
    cut that leaves, and the seller's rest. null when the terms are not
    loaded, and then the trade block refuses the sale.
  */
  function saleCuts(price) {
    var c = g.__thornswoodCompany;
    if (!c || typeof c.saleCuts !== 'function') { return null; }
    return c.saleCuts(price);
  }

  function inCompany(profileId) {
    var adm = g['__thornswoodIsAdmin'];
    try { if (typeof adm === 'function' && adm(profileId)) { return true; } } catch (e) { }
    var fn = g['__thornswoodIsCompany'];
    try { return typeof fn === 'function' && !!fn(profileId); } catch (e2) { return false; }
  }

  function command(word, parts, actorId, profileId, toProfile, cmd) {
    if (word === '/deed' || word === '/deeds') {
      return deeds(actorId, profileId, toProfile);
    }
    /*
      /claim, /lock and /unlock are what the lock key sends at a door (#1637),
      with the door's id after them, and nobody is told to type them. Each
      answer draws the line at the door again, so the key's next word is the
      one that is true now, whatever this one did.
    */
    if (word === '/lock' || word === '/unlock') {
      // At a cell door the key turns the cell's lock (#502), not the jail's.
      var cellAt = cellOfId(parts && parts[1]);
      if (cellAt) {
        lockCell(actorId, profileId, toProfile, word === '/lock', cellAt);
        doorLine(actorId, profileId);
        return true;
      }
      setLock(actorId, profileId, toProfile, word === '/lock');
      doorLine(actorId, profileId);
      return true;
    }
    if (word === '/mold') { return mold(actorId, profileId, toProfile); }
    if (word === '/moldhere') { return moldHere(parts, actorId, profileId, toProfile); }
    // The lock key at a forge, with the forge's id (#1637). See forgeHere.
    if (word === '/key') { return cutKey(actorId, profileId, toProfile, parts); }
    if (word === '/claim') {
      // Only when they are actually at a door. Otherwise this is farming's word
      // and farming answers it, which is what keeps /claim meaning one thing in
      // a field and another on a doorstep without either of them guessing.
      // And the lock key names what it was pressed at (#1636): a plot's id is
      // farming's even a minute after a door, so a farmer who walks out of
      // the house to a field claims the field and not the house.
      if (here(actorId) && !(parts && parts[1] && !doorOfId(parts[1]))) {
        claim(actorId, profileId, toProfile);
        doorLine(actorId, profileId);
        return true;
      }
      return claimAway(parts, actorId, profileId, toProfile);
    }
    // A Jarl gives or takes an office of their hold (#2551): the Office page sends it.
    if (word === '/office') { return officeCmd(parts, actorId, profileId, toProfile); }
    if (word === '/evict') { return evict(actorId, profileId, toProfile, cmd); }
    // The world's card on the Office page, for staff (#513): the world stage block answers it.
    if (word === '/world') {
      var worldStage = g['__thornswoodWorldStage'];
      if (worldStage && typeof worldStage.command === 'function') {
        return worldStage.command(parts, actorId, profileId, toProfile, cmd);
      }
      toProfile(profileId, 'The world stage is not running on this server. Say so in the dev channel.');
      return true;
    }
    if (word === '/dropbox') { return dropboxCmd(parts, actorId, profileId, toProfile); }
    if (word === '/rent') { return rentCmd(parts, actorId, profileId, toProfile, cmd); }
    // The company's terms card on the Office page, for staff (#512, #2695): the company terms block answers it.
    if (word === '/companyterms') {
      var companyTerms = g['__thornswoodCompany'];
      if (companyTerms && typeof companyTerms.command === 'function') {
        return companyTerms.command(parts, actorId, profileId, toProfile, cmd);
      }
      toProfile(profileId, 'The company\'s terms are not running on this server. Say so in the dev channel.');
      return true;
    }
    if (word === '/sleephere') { return sleepHere(parts, actorId, profileId, toProfile); }
    if (word === '/notice') { return post(parts, actorId, profileId, toProfile, false); }
    if (word === '/job') {
      // Pay the reward sends /job done <n> (#2554); a reward is a number, so the two never meet.
      if (String((parts && parts[1]) || '').toLowerCase() === 'done') {
        return jobDone(parts, actorId, profileId, toProfile);
      }
      return post(parts, actorId, profileId, toProfile, true);
    }
    if (word === '/board') { return board(parts, actorId, profileId, toProfile); }
    if (word === '/take') { return take(parts, actorId, profileId, toProfile); }
    if (word === '/dropjob') { return dropJob(parts, actorId, profileId, toProfile); }
    if (word === '/unpin') { return unpin(parts, actorId, profileId, toProfile); }
    if (word === '/letter') { return postLetter(parts, actorId, profileId, toProfile); }
    if (word === '/deliver') { return deliver(parts, actorId, profileId, toProfile); }
    if (word === '/haul') { return haulCmd(parts, actorId, profileId, toProfile); }
    return false;
  }

  /*
    A JARL GIVES OR TAKES AN OFFICE OF THEIR HOLD, AND A CHARACTER HOLDS IT
    (#2551).

        /office <court|steward|guard> <hold> <id>      the Jarl names that character
        /office <court|steward|guard> <hold> -<id>     the Jarl takes the office back
        /office hold <office> <hold>                    this character holds an office
                                                        its account's role gives

    Sent by the Office page of K, never typed (Patrick, 4 Oct: no chat
    commands for what people do): Name beside a person in the world, Remove
    beside a holder, and Hold it here beside an office the account holds.
    Patrick, 15 October: that hold's Jarl gives and takes its Court, Steward
    and Guard, for their own hold only, and in the game "the game asks the
    site, and the bot sets the Discord role, so the role stays the one
    truth". And 16 October: the office is one character's.

    NAMING A CHARACTER. The Jarl picks a character in the world, by its
    profile id, because two characters can carry the same name. When its
    account already holds the role, the office simply moves to that
    character. Otherwise the site checks the Jarl's role again and sets the
    role on the character's account with the bot's account, and once it has,
    this character is the one that holds it. The door reads the roles back
    at once (__thornswoodDoorReadNow), which is when it holds in the world:
    the cells follow (pushAll) and both pages are written again.

    TAKING IT BACK takes the role off the account, and the character with it.

    HOLDING IT HERE. A role given in Discord (the bot's panel, or staff for a
    Jarl) names an account and no character, so its holder chooses: the
    Office page offers it on each of the account's characters, and pressing
    Hold it here makes this one the one that holds it, moving it off another.

    NOTHING IS RETRIED. A change the site or Discord refused is said to the
    Jarl in the site's own words, and pressing again is theirs.
  */
  function officeRole(office, hold) {
    var town = HOLD_TOWN[hold] || hold;
    if (office === 'jarl') { return 'Jarl of ' + town; }
    if (office === 'court') { return town + ' Court'; }
    if (office === 'steward') { return 'Steward of ' + town; }
    return 'Guard of ' + town;
  }

  /* What an office lets its holder do, said to them when it is theirs. */
  function officeDoes(office, hold) {
    var town = HOLD_TOWN[hold] || hold;
    if (office === 'jarl') {
      return 'You name and remove ' + town + '\'s Court, Steward and Guards on the Office page of K, claim its jail, ' +
             'keep it as its steward, and take anything out of its drop box.';
    }
    if (office === 'court') {
      return 'You take anything out of ' + town + '\'s drop box and read its records.';
    }
    if (office === 'steward') {
      return 'You end claims and set rent at a door, move ' + town + '\'s notice board, and take anything out of ' +
             'its drop box.';
    }
    return 'The cells of ' + (JAIL_NAME[hold] || 'the hold\'s jail') + ' are yours to lock, you take down posts on ' +
           town + '\'s notice board, and you take anything out of its drop box.';
  }

  /* This character holds this office for its account, and no other character of the account does. */
  function holdHere(office, hold, pid, name) {
    var key = office + ':' + hold;
    var acct = officeAccountOf(pid);
    var had = officeHeldBy(office, hold, acct);
    if (!law.held[key]) { law.held[key] = {}; }
    law.held[key][acct] = { pid: Number(pid) || 0, name: String(name || 'somebody').slice(0, 60), at: Date.now() };
    saveLaw();
    return had;
  }

  /* /office hold <office> <hold>: this character holds an office its account's role gives. */
  function officeHoldHere(parts, actorId, profileId, toProfile) {
    var office = String((parts && parts[2]) || '').toLowerCase();
    var hold = String((parts && parts[3]) || '').toLowerCase();
    if (OFFICE_KINDS.indexOf(office) === -1 || !Object.prototype.hasOwnProperty.call(HOLD_TOWN, hold)) {
      toProfile(profileId, 'Choose the office on the Office page of K.');
      return true;
    }
    var role = officeRole(office, hold);
    if (rolesOfProfile(profileId)[office].indexOf(hold) === -1) {
      toProfile(profileId, office === 'jarl' && jarlClashOf(profileId).indexOf(hold) !== -1
        ? 'Two Discord accounts hold the ' + role + ' role, so neither acts as Jarl until staff fix it. Staff have been told.'
        : 'Your account does not hold the ' + role + ' role in Discord.');
      return true;
    }
    if (holdsOffice(profileId, office, hold)) {
      toProfile(profileId, 'This character holds ' + role + ' already.');
      return true;
    }
    var name = personName(actorId);
    var had = holdHere(office, hold, profileId, name);
    pushAll();
    officeRedraw(actorId, had ? had.pid : 0);
    // A guard now: their Prisoner's Cuffs, if they have none (#2573).
    var cuffsOffice = g.__thornswoodCuffs;
    if (office === 'guard' && cuffsOffice && cuffsOffice.guardOffice) {
      try { cuffsOffice.guardOffice(actorId); } catch (e) { plog('law: the cuffs issue for', name, 'failed:', e); }
    }
    plog('law:', name, '(profile ' + profileId + ') holds', role, 'for their account' +
         (had ? ', in place of ' + had.name + ' (profile ' + had.pid + ')' : ''));
    toProfile(profileId, 'This character holds ' + role + ' now' + (had ? ', in place of ' + had.name : '') + '. ' +
              officeDoes(office, hold));
    return true;
  }

  function officeCmd(parts, actorId, profileId, toProfile) {
    var office = String((parts && parts[1]) || '').toLowerCase();
    if (office === 'hold') { return officeHoldHere(parts, actorId, profileId, toProfile); }
    var hold = String((parts && parts[2]) || '').toLowerCase();
    var arg = String((parts && parts[3]) || '').trim();
    if (!Object.prototype.hasOwnProperty.call(OFFICE_GIVEN, office) ||
        !Object.prototype.hasOwnProperty.call(HOLD_TOWN, hold)) {
      toProfile(profileId, 'A Jarl gives the Court, a Steward and Guards of their own hold, on the Office page of K.');
      return true;
    }
    var town = HOLD_TOWN[hold];
    if (!isJarlOf(profileId, hold)) {
      toProfile(profileId, jarlClashOf(profileId).indexOf(hold) !== -1
        ? 'Two Discord accounts hold the Jarl of ' + town + ' role, so neither acts as Jarl until staff fix it. ' +
          'Staff have been told.'
        : 'Only the Jarl of ' + town + ' gives its offices.');
      return true;
    }
    var take = arg.charAt(0) === '-';
    var pid = Number(take ? arg.slice(1) : arg) || 0;
    if (!(pid > 0) || Math.floor(pid) !== pid) {
      toProfile(profileId, 'Pick somebody on the Office page of K.');
      return true;
    }
    var role = officeRole(office, hold);
    var them = onlineActorOf(pid);
    var who = them ? personName(them) : 'Profile ' + pid;
    var jarlName = personName(actorId);
    var told = function () {
      pushAll();
      officeRedraw(actorId, pid);
      if (onlineActorOf(pid)) {
        toProfile(pid, take ? 'The Jarl of ' + town + ' takes the ' + role + ' office back from you.'
                            : 'The Jarl of ' + town + ' names this character ' + role + '. ' + officeDoes(office, hold));
      }
    };
    // The account already holds the role: the office moves to this character, and Discord has nothing to change.
    if (!take && rolesOfProfile(pid, true)[office].indexOf(hold) !== -1) {
      if (holdsOffice(pid, office, hold) || (officeHeldBy(office, hold, officeAccountOf(pid)) || {}).pid === pid) {
        toProfile(profileId, who + ' holds ' + role + ' already.');
        return true;
      }
      var had = holdHere(office, hold, pid, who);
      plog('law: the Jarl of', hold, '(' + jarlName + ', profile ' + profileId + ') names', who, '(profile ' + pid + ')',
           role + ', a role their account holds' + (had ? ', in place of ' + had.name + ' (profile ' + had.pid + ')' : ''));
      toProfile(profileId, who + ' holds ' + role + ' now' + (had ? ', in place of ' + had.name : '') + '.');
      if (had && had.pid !== pid) { officeRedraw(actorId, had.pid); }
      told();
      return true;
    }
    var ask = g['__thornswoodAskSite'];
    if (typeof ask !== 'function') {
      toProfile(profileId, 'This server cannot ask the site, so no office changes here.');
      return true;
    }
    plog('law: the Jarl of', hold, '(' + jarlName + ', profile ' + profileId + ') asks the site to',
         take ? 'take ' + role + ' from' : 'give ' + role + ' to', who, '(profile ' + pid + ')');
    ask('/api/office', { by: Number(profileId) || 0, byName: jarlName, who: pid, whoName: who,
                         office: office, hold: hold, give: !take }, function (why, doc) {
      var said = (doc && typeof doc.said === 'string') ? doc.said : '';
      if (why || !doc || doc.ok !== true) {
        plog('law: the site did not change', role, 'for profile', pid + ':', why || said || 'no answer');
        toProfile(profileId, said || ('The office did not change: ' + (why || 'the site did not say why') + '.'));
        return;
      }
      // Who holds it in the game: the character named; and nobody of that account once it is taken back.
      if (take) {
        var row = law.held[office + ':' + hold];
        if (row && row[officeAccountOf(pid)]) { delete row[officeAccountOf(pid)]; saveLaw(); }
      } else {
        holdHere(office, hold, pid, who);
      }
      plog('law: the Jarl of', hold, '(profile ' + profileId + ')', take ? 'took ' + role + ' from' : 'gave ' + role + ' to',
           who, '(profile ' + pid + '); the role is set in Discord');
      toProfile(profileId, said);
      var readNow = g['__thornswoodDoorReadNow'];
      var after = function (read) {
        if (!read) {
          toProfile(profileId, 'The game reads the new role at its next look at the site, within five minutes.');
        }
        told();
      };
      if (typeof readNow === 'function') { readNow(function (ok) { after(!!ok); }); } else { after(false); }
    });
    return true;
  }

  /*
    The Office page again (#1638): the K panel of whoever pressed, and of the
    person an office was given or taken from, when they are in the world, so
    the page in front of each of them says what is true now.
  */
  function officeRedraw(actorId, pid) {
    redrawPanel(actorId);
    var them = pid ? onlineActorOf(pid) : 0;
    if (them && them !== actorId) { redrawPanel(them); }
  }

  /*
    The city takes a house back.

    THE ONLY THING A STEWARD CAN DO THAT NOBODY ELSE IN THE WORLD CAN (staff
    can too, at any building, and every time is in the staff log: #2551,
    settleAs), and it ends a CLAIM and nothing else. It does not touch what is in the house, because the
    alternative is a server that deletes people's possessions on somebody's
    say so, and the next holder inherits the containers as they stand. It does
    not take back a key either: nothing in the engine can change which key a
    door wants, so an evicted tenant who kept theirs can still walk in at
    night, and the city's only answer is to deal with them like a person. That
    is the squatter story Patrick asked for, and it falls out of the constraint
    rather than being written.
  */
  function evict(actorId, profileId, toProfile, cmd) {
    // A steward, or staff at any door (#2551, settleAs).
    if (!isSteward(profileId) && !isStaffHere(profileId)) {
      toProfile(profileId, 'Only a steward ends a claim.');
      return true;
    }
    var building = here(actorId);
    if (!building) {
      toProfile(profileId, OFFICE_AT_DOOR);
      return true;
    }
    var how = settleAs(profileId, building, cmd);
    if (!how.as) {
      toProfile(profileId, how.why);
      return true;
    }
    var held = holderOf(building);
    if (!held) {
      /*
        embassy.md: "A steward of Haafingar does not evict the Accord" (#1390).
        A claim somebody made before the embassy held this door is still that
        person's claim, and ending it below is still the steward's to do.
      */
      var accordEvict = globalThis.__thornswoodEmbassy;
      if (accordEvict && accordEvict.holds(building)) {
        toProfile(profileId, accordEvict.EVICT_REFUSED);
        return true;
      }
      toProfile(profileId, 'Nobody holds ' + nameOf(building) + '.');
      return true;
    }
    var was = held.name;
    // An eviction ends the claim and not the debt (#3950): what they owe stays theirs.
    keepOwed(building, held, Date.now());
    delete claims[building];
    save();
    pushAll();
    if (how.as === 'staff') {
      staffRecord('evict', actorId, profileId, building, held, settleWhere(building));
      toProfile(profileId, 'As staff, you end ' + was + '\'s claim on ' + nameOf(building) +
                '. What is inside is untouched, and any key they hold still works. It is in the staff log.');
    } else {
      plog('a steward ended', was + '\'s claim on', nameOf(building));
      toProfile(profileId, 'You end ' + was + '\'s claim on ' + nameOf(building) +
                '. What is inside is untouched, and any key they hold still works.');
    }
    redrawPanel(actorId);
    return true;
  }

  /*
    THE OFFICE PAGE ON K (#1638).

    Patrick, 4 Oct: no commands for things people do, and a Jarl and a
    steward are people in the world (offices.md: "A steward is not staff").
    So the offices' powers are buttons on a page of the K panel, for anybody
    who holds an office: name and remove a hold's Court, Steward and Guards
    (the Jarl), evict and set or clear the rent at the door the steward just
    opened, and move their hold's board to where they stand. Each button
    sends the server's own line (/office, /evict, /rent, /board move), and
    every rule is checked again when it arrives. This only says what is
    true, so the page can draw it. A steward no longer marks a container as a hold's box: the drop box
    on the board is the only one (#2298, Patrick, 15 Oct).

    THE OFFICES ARE THE DISCORD ROLES (#2551), read through officesOfProfile:
    nobody takes an office or picks a hold here. The Jarl of a hold sees, for
    each of its three offices, who holds it (by a character of theirs in the
    world, or by profile when none is) with Remove, and the people in the
    world who do not, with Name. Somebody whose Jarl role another account
    holds too sees why they do not act as Jarl.

    "Just opened" is the same minute the lines have always used (here):
    the door is read when the panel is written, and K
    asks for that the moment it opens.

    THE STATE IS HANDED IN, NEVER READ. This is called from the character
    block's writeState, and that block's stateOf writes a character it has
    not seen through writeState, so reading it from here would ask for
    itself. Nothing on the page comes from the character since #2551, so s
    is not read at all.

    STAFF SEE IT TOO (#2551, Patrick, 17 Oct): staff end claims and set rent
    at any building, so for staff the page carries the door card at every
    door, with door.staff true where they act as staff and not as a steward
    of its hold. The boards stay a steward's.

    Null for anybody who holds no office and is not staff, and then the page
    is not drawn.
  */
  var OFFICE_PEOPLE_MAX = 40;

  /*
    Who holds one office of one hold, for the Jarl's page: one row an
    account whose role gives it, by the character that holds it (#2551),
    named when it is in the world and by the name it had when it took the
    office when not; an account none of whose characters holds it yet is
    shown by a character of it in the world, or its first profile, with
    chosen false.
  */
  function officeHolders(office, hold, names) {
    var fn = g['__thornswoodOfficeHolders'];
    var rows = [];
    try { rows = (typeof fn === 'function') ? (fn(office, hold) || []) : []; } catch (e) { rows = []; }
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var ps = Array.isArray(rows[i] && rows[i].profiles) ? rows[i].profiles.map(Number) : [];
      if (!ps.length) { continue; }
      var rec = officeHeldBy(office, hold, String(rows[i].account));
      if (rec && ps.indexOf(rec.pid) !== -1) {
        out.push({ pid: rec.pid, name: Object.prototype.hasOwnProperty.call(names, rec.pid) ? names[rec.pid] : '',
                   was: rec.name, chosen: true, profiles: ps });
        continue;
      }
      var shown = ps[0], name = '';
      for (var j = 0; j < ps.length; j++) {
        if (Object.prototype.hasOwnProperty.call(names, ps[j])) { shown = ps[j]; name = names[ps[j]]; break; }
      }
      out.push({ pid: shown, name: name, was: '', chosen: false, profiles: ps });
    }
    return out;
  }

  function officeView(actorId, profileId) {
    var pid = Number(profileId) || 0;
    if (!pid || !actorId) { return null; }
    var o = officesOfProfile(pid);
    var clash = jarlClashOf(pid);
    var keeps = stewardHoldsOf(pid);
    var toHold = officesToHold(pid);
    // Staff, who hold no office, see the page for the door card (#2551, settleAs).
    var staff = isStaffHere(pid);
    if (!o.jarl.length && !o.court.length && !keeps.length && !o.guard.length && !clash.length && !toHold.length &&
        !staff) {
      return null;
    }

    // Who is in the world, by profile, named the way a guest is named.
    var names = {};
    var order = [];
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e3) { online = []; }
    for (var i = 0; i < online.length; i++) {
      var op = profileOf(online[i]);
      var nm = '';
      try {
        var ap = mp.get(online[i], 'appearance');
        if (ap && ap.name) { nm = String(ap.name); }
      } catch (e4) { nm = ''; }
      if (!op || !nm || Object.prototype.hasOwnProperty.call(names, op)) { continue; }
      names[op] = nm;
      order.push(op);
    }
    var byName = function (a, b) {
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : a.pid - b.pid);
    };
    var where = function (h) { return { hold: h, where: HOLD_TOWN[h] }; };

    var view = { jarls: [], clash: clash.map(where), courtOf: o.court.map(where),
                 stewardOf: o.steward.map(where),
                 guardOf: o.guard.map(function (h) { return { hold: h, where: HOLD_TOWN[h], jail: JAIL_NAME[h] || null }; }),
                 // The offices this character's account holds that another of
                 // its characters, or none yet, holds (#2551): Hold it here.
                 toHold: toHold.map(function (t) {
                   return { office: t.office, hold: t.hold, where: HOLD_TOWN[t.hold], role: officeRole(t.office, t.hold),
                            by: t.by ? t.by.name : null };
                 }),
                 steward: keeps.length > 0, staff: staff, door: null, boards: [],
                 // The trade ships' ports and routes (#2700), for staff while the ships are on.
                 ships: staff && !!(g.__thornswoodTradeShips && g.__thornswoodTradeShips.command),
                 // The trade carts' stops and roads (#3158), for staff while the carts are on.
                 carts: staff && !!(g.__thornswoodTradeCarts && g.__thornswoodTradeCarts.command) };
    // Where the world is, for staff only (#513): the world stage block's staff card.
    var worldStageApi = g['__thornswoodWorldStage'];
    try { view.world = (staff && worldStageApi && worldStageApi.staffView) ? worldStageApi.staffView(pid) : null; }
    catch (eWorld) { view.world = null; }
    for (var j = 0; j < o.jarl.length; j++) {
      var hold = o.jarl[j];
      var row = { hold: hold, where: HOLD_TOWN[hold], offices: {} };
      for (var office in OFFICE_GIVEN) {
        if (!Object.prototype.hasOwnProperty.call(OFFICE_GIVEN, office)) { continue; }
        var holders = officeHolders(office, hold, names);
        var holding = {};
        // The characters that hold it are not offered; any other character
        // may be named, which for an account holding the role moves it there.
        for (var hh = 0; hh < holders.length; hh++) {
          if (holders[hh].chosen) { holding[holders[hh].pid] = true; }
        }
        var people = [];
        for (var q = 0; q < order.length; q++) {
          if (holding[order[q]]) { continue; }
          people.push({ pid: order[q], name: names[order[q]] });
        }
        people.sort(byName);
        row.offices[office] = {
          role: officeRole(office, hold), label: OFFICE_GIVEN[office],
          holders: holders.map(function (x) { return { pid: x.pid, name: x.name, was: x.was, chosen: x.chosen }; })
                          .sort(byName),
          people: people.slice(0, OFFICE_PEOPLE_MAX)
        };
      }
      view.jarls.push(row);
    }
    if (!view.steward && !staff) { return view; }
    // The company's terms, for staff only (#512, #2695): the company terms block's card.
    var companyApi = g['__thornswoodCompany'];
    try { view.company = (staff && companyApi && companyApi.staffView) ? companyApi.staffView(pid) : null; }
    catch (eCompany) { view.company = null; }
    // The crafting tools, for staff only (#3167): the staff crafting block's card.
    var craftApi = g['__thornswoodStaffCraft'];
    try { view.craft = (staff && craftApi && craftApi.staffView) ? craftApi.staffView(pid) : null; }
    catch (eCraft) { view.craft = null; }

    var building = here(actorId);
    if (building) {
      var held = holderOf(building);
      if (held && held.rent) { rentDue(); }
      // The building's hold (#2551): the page offers Evict and the rent to a
      // steward of it, and to staff at any building, saying they act as
      // staff there; it says whose it is to anybody else.
      var bhold = holdOfBuilding(building);
      var ours = !!bhold && keeps.indexOf(bhold) !== -1;
      view.door = { name: nameOf(building), by: held ? held.name : null,
                    hold: bhold, where: bhold ? (HOLD_TOWN[bhold] || bhold) : null,
                    ours: ours, staff: staff && !ours,
                    rent: (held && held.rent) ? { amount: Number(held.rent.amount) || 0,
                                                  every: Number(held.rent.everyDays) || 7,
                                                  owed: Number(held.rent.owed) || 0 } : null,
                    // Who owes rent here, the holder and anybody before them (#3893),
                    // each with Rent paid beside them (#3895).
                    owing: rentOwing(building) };
    }
    // The boards are a steward's own hold's; staff are no steward.
    if (!view.steward) { return view; }
    // The boards of the holds this person keeps, and no other (#2551).
    for (var h = 0; h < LEDGER_HOLDS.length; h++) {
      var bh = LEDGER_HOLDS[h];
      if (!Object.prototype.hasOwnProperty.call(boards, bh) || keeps.indexOf(bh) === -1) { continue; }
      view.boards.push({ hold: bh, where: (boards[bh] && boards[bh].where) || bh });
    }
    return view;
  }

  /*
    THE JAIL RULE, APPLIED TO THE CLAIMS MADE BEFORE IT, ONCE (#502).

    Patrick, 12 October evening: jail claims made before the jail rule end
    once, and then the rule holds. Before #2497 anybody could claim a jail
    building; since, only the Jarl of its hold may, and since #2551 the Jarl
    is whoever holds that hold's Jarl role. So at the first server start with
    the rule, every claim on a jail building whose holder is not that hold's
    Jarl ends, each logged by building, holder and profile, and
    steps.jailRule records that it ran, in the same save. With no such claim
    nothing ends and the mark is still written. It runs here, after every
    part of the register is read, because save() writes all of them, and it
    never runs again: a claim after this is made under the rule.

    The holder is read on record (__thornswoodOfficesOnRecord): at server
    start nobody has sent a pass, and this is about a claim the server
    already holds, not a press arriving now.
  */
  function endPreRuleJailClaims() {
    if (steps.jailRule) { return 0; }
    var ended = 0;
    for (var b in claims) {
      if (!Object.prototype.hasOwnProperty.call(claims, b)) { continue; }
      var hold = jailOfBuilding(b);
      if (!hold) { continue; }
      // The character that holds the hold's Jarl office (#2551), read on record.
      if (officesOfProfile(claims[b].by, true).jarl.indexOf(hold) !== -1) { continue; }
      plog('law: the jail rule ends', claims[b].name + '\'s claim (profile ' + claims[b].by + ') on',
           nameOf(b) + ', made before only the Jarl of', hold, 'could hold it');
      keepOwed(b, claims[b], Date.now());
      delete claims[b];
      ended++;
    }
    steps.jailRule = Date.now();
    save();
    plog('law: the jail rule was applied to the claims made before it once:', ended, 'claim(s) ended');
    return ended;
  }

  /*
    WHAT A DELETED CHARACTER HELD, LET GO (#2351, Patrick's A of 16 October:
    "Delete-Person.ps1 writes a list, and the gamemode releases those entries
    at its next start"). Asked once, as this block loads and before
    rolesRead, through __thornswoodRelease (the release of deleted
    characters, before the farming block), with `who` answering whether a
    profile id is on the list. rolesRead would end an office whose role the
    account no longer holds, and say the character's name and profile in the
    log as it did; let go first, there is nothing of theirs left to say.
    Every register this block keeps is walked, and each entry goes the way its
    own rule already sends it when the person is simply gone:

      claims      a building they held is free, as a steward's evict leaves
                  it; a master key record cut for them on somebody else's
                  claim is dropped (it already opens nothing, liveMaster)
      arrears     rent they still owed on a place they no longer held goes,
                  as a debt does when the person who owed it is gone (#3893)
      offices     law.held: the office their character held is let go, so the
                  account's role, if it is still held, is chosen again
      the boards  a post of theirs comes down, keeping its number, with its
                  name and words taken off; a job, letter or haul of somebody
                  else's that they had taken goes back on the board untaken,
                  as a job handed back does; gold owed to them stops being
                  held for them
      drop box    what they put in stays in the box with their name off it, so
                  the hold's officers may take it; the box's record keeps every
                  line with their name off it
      beds        a night they were let sleep, and every guest of a building
                  they held, ends; the takings #1392 kept for them go

    THE BOOKS STAY BALANCED BECAUSE NO COIN MOVES. Not a hold's ledger
    (funds), not the box, not a pack. A release only changes who a coin is
    held for: gold a post held for them (a letter's 15, a job's reward, a
    haul's pay, gold owed to them) stays on the hold's ledger and becomes the
    hold's, as the fee always was, so funds is unchanged and never smaller
    than what is still held (mayWithdraw). The box keeps every coin it had.
    Lines are anonymised, never cut, so every count in the box's record and
    every number on a board still adds up. The one thing that goes is the
    bed takings kept for them: no ledger counts that gold, it was theirs
    alone, and it goes with them like the gold in their pack.

    The three files are written only when something in them changed, and
    the answer says whether every write that was needed took, so the list
    waits for the next start when one did not. Counts only; the log never
    names them.
  */
  function release(who) {
    var mine = function (pid) { var n = Number(pid) || 0; return n > 0 && who.profile(n); };
    var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    var c = { claims: 0, masterKeys: 0, offices: 0, posts: 0, handedBack: 0, owed: 0, lines: 0,
              box: 0, boxRecord: 0, guests: 0, takings: 0, arrears: 0 };
    var reg = false, lawChanged = false, beds = false;
    var b;
    for (b in claims) {
      if (!has(claims, b)) { continue; }
      if (mine(claims[b].by)) { delete claims[b]; c.claims++; reg = true; continue; }
      if (claims[b].master && mine(claims[b].master.for)) { delete claims[b].master; c.masterKeys++; reg = true; }
    }
    // Rent they still owed on a place they no longer held (#3893) goes with them.
    for (var ab in arrears) {
      if (!has(arrears, ab)) { continue; }
      var debts = arrears[ab].filter(function (x) { return !mine(x.by); });
      if (debts.length === arrears[ab].length) { continue; }
      c.arrears += arrears[ab].length - debts.length;
      reg = true;
      if (debts.length) { arrears[ab] = debts; } else { delete arrears[ab]; }
    }
    for (var key in law.held) {
      if (!has(law.held, key)) { continue; }
      var accts = law.held[key];
      for (var acct in accts) {
        if (has(accts, acct) && accts[acct] && mine(accts[acct].pid)) { delete accts[acct]; c.offices++; lawChanged = true; }
      }
      if (!Object.keys(accts).length) { delete law.held[key]; }
    }
    var at = Date.now();
    for (var h in notices) {
      if (!has(notices, h) || !Array.isArray(notices[h])) { continue; }
      var list = notices[h];
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (!n || typeof n !== 'object') { continue; }
        var touched = false;
        if (mine(n.by)) {
          if (!n.down) { n.down = at; n.downBy = 0; c.posts++; }
          n.by = 0;
          n.name = 'somebody';
          delete n.title; delete n.text; delete n.to;
          touched = true;
        }
        if (mine(n.taken)) {
          if (!n.down) { n.takenName = null; c.handedBack++; }
          else { n.takenName = 'somebody'; }
          n.taken = 0;
          touched = true;
        }
        if (mine(n.owedTo)) {
          if ((Math.floor(Number(n.owed)) || 0) > 0) { c.owed++; }
          n.owed = 0;
          n.owedTo = 0;
          touched = true;
        }
        if (mine(n.deliveredTo)) { n.deliveredTo = 0; touched = true; }
        if (mine(n.downBy)) { n.downBy = 0; touched = true; }
        if (mine(n.doneBy)) { n.doneBy = 0; touched = true; }
        if (touched) { c.lines++; reg = true; }
      }
    }
    for (var bh in dropbox) {
      if (!has(dropbox, bh) || !dropbox[bh] || typeof dropbox[bh] !== 'object') { continue; }
      var d = dropbox[bh];
      var items = Array.isArray(d.items) ? d.items : [];
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (it && mine(it.by)) { it.by = 0; it.name = 'somebody'; delete it.rent; c.box++; reg = true; }
      }
      var record = Array.isArray(d.log) ? d.log : [];
      for (var k = 0; k < record.length; k++) {
        var l = record[k];
        if (!l) { continue; }
        var named = false;
        if (mine(l.who)) { l.who = 0; l.whoName = 'somebody'; named = true; }
        if (mine(l.by)) { l.by = 0; l.byName = 'somebody'; named = true; }
        if (named) { c.boxRecord++; reg = true; }
      }
    }
    for (var bb in bedBook.guests) {
      if (!bedHas(bedBook.guests, bb)) { continue; }
      var row = bedBook.guests[bb];
      for (var gp in row) {
        if (bedHas(row, gp) && (mine(gp) || mine(row[gp] && row[gp].by))) { delete row[gp]; c.guests++; beds = true; }
      }
      if (!Object.keys(row).length) { delete bedBook.guests[bb]; }
    }
    for (var tp in bedBook.takings) {
      if (bedHas(bedBook.takings, tp) && mine(tp)) { delete bedBook.takings[tp]; c.takings++; beds = true; }
    }
    var saved = true;
    if (reg && !save()) { saved = false; }
    if (lawChanged && !saveLaw()) { saved = false; }
    if (beds && !saveBedBook()) { saved = false; }
    if (c.claims) { pushAll(); }
    return { counts: c, saved: saved };
  }

  if (typeof g.__thornswoodRelease === 'function') { g.__thornswoodRelease('property', release); }
  rolesRead();
  endPreRuleJailClaims();

  ready();
  g.__thornswoodProperty = {
    command: command, touched: touched, here: here, claim: claim, deeds: deeds,
    doorLine: doorLine, DOOR_LINE_PROPERTY: DOOR_LINE_PROPERTY,
    holderOf: holderOf, buildingOf: buildingOf, nameOf: nameOf, giveDeed: giveDeed,
    setLock: setLock, mold: mold, cutKey: cutKey, mayPass: mayPass,
    holdsKey: holdsKey, holdsMold: holdsMold, holdsDeed: holdsDeed,
    // The master key (#2254). See MASTER KEYS in locks and keys.
    holdsMasterKey: holdsMasterKey, masterLabel: masterLabel, liveMaster: liveMaster,
    masterKeysOf: masterKeysOf, MASTER_KEY: MASTER_KEY,
    giveNamed: giveNamed, doorsOf: doorsOf, shutFor: shutFor, push: push,
    wayOut: wayOut,
    // Word to the holder (#2680): a picked lock and a presented deed.
    picked: picked, recordWord: recordWord, wordTick: wordTick, wordText: wordText,
    wordWhen: wordWhen, wordRules: wordRules, lookOf: lookOf, WORD_DEFAULTS: WORD_DEFAULTS,
    wordBook: function () { return wordBook; },
    pushAll: pushAll, touchedBench: touchedBench, moldInHand: moldInHand,
    // A bench's chests (#3159). See THE OWNER'S CHESTS FEED THE BENCH.
    benchStock: benchStock, stockFor: stockFor, STOCK_PROPERTY: STOCK_PROPERTY,
    takeBlankMold: takeBlankMold, blankMoldsExist: blankMoldsExist,
    keyLabel: keyLabel, moldLabel: moldLabel, deedLabel: deedLabel, placeOf: placeOf,
    LABEL_NO: LABEL_NO,
    KEY: KEY, MOLD: MOLD, LOCK_PROPERTY: LOCK_PROPERTY,
    BENCH_PROPERTY: BENCH_PROPERTY, FORGE: FORGE,
    lapseDays: lapseDays, DEED: DEED, DOOR_MEMORY_MS: DOOR_MEMORY_MS,
    coversGround: coversGround, groundHere: groundHere,
    DOOR_PROPERTY: DOOR_PROPERTY,
    claims: function () { return claims; },
    // The hold offices (#2551), every one a Discord role: officeOf is the one place.
    officeOf: officeOf, officeView: officeView, officeCmd: officeCmd, HOLD_TOWN: HOLD_TOWN,
    isJarl: isJarl, isJarlOf: isJarlOf, jarlHoldsOf: jarlHoldsOf, isCourtOf: isCourtOf,
    rolesRead: rolesRead, held: function () { return JSON.parse(JSON.stringify(law.held)); },
    isSteward: isSteward, isStewardOf: isStewardOf, stewardHoldsOf: stewardHoldsOf,
    endPreRuleJailClaims: endPreRuleJailClaims, steps: function () { return Object.assign({}, steps); },
    // What a deleted character held, let go at server start (#2351).
    release: release,
    isGuard: isGuard, guardHoldsOf: guardHoldsOf, jailHoldOf: jailHoldOf, cellLocked: cellLocked,
    mayPassCell: mayPassCell, lockCell: lockCell,
    jailOfBuilding: jailOfBuilding, mayHold: mayHold, jailKeyHold: jailKeyHold, lockedJailHere: lockedJailHere,
    JAIL_KEY: JAIL_KEY,
    dropboxCmd: dropboxCmd, boxView: boxView, boxFare: boxFare, boxShipped: boxShipped, boxOfficer: boxOfficer, boxKeep: boxKeep,
    dropbox: function () { return dropbox; },
    deposit: deposit, takeGold: takeGold, LEDGER_HOLDS: LEDGER_HOLDS,
    withdraw: withdraw, mayWithdraw: mayWithdraw, heldOn: heldOn,
    haulTenth: haulTenth, haulTick: haulTick, saleCuts: saleCuts, inCompany: inCompany,
    holdStanding: holdStanding,
    rentDue: rentDue, funds: function () { return funds; },
    // Rent still owed on a place by somebody who no longer holds it (#3893).
    arrears: function () { return arrears; },
    notices: function () { return notices; }, takedown: takedown,
    // A notice in an office's name, with no fee (#513). See the world stage block.
    officePost: officePost,
    boards: function () { return boards; }, boardHere: boardHere, boardPanel: boardPanel,
    standBoard: standBoard, standBoards: standBoards, boardActivated: boardActivated,
    boxOffset: boxOffset, boardAngle: boardAngle,
    standBench: standBench, standBenches: standBenches,
    benchRefs: function () { return Object.assign({}, benchRefs); },
    WOODWORKING_BENCHES: WOODWORKING_BENCHES,
    boardsView: boardsView, lettersCarried: lettersCarried,
    // An item's name the way the box names it, for the trade ships' dock (#2700).
    itemName: itemName
  };
  plog('ready,', Object.keys(BUILDING_BY_DOOR).length, 'doors across',
       Object.keys(BUILDING_NAME).length, 'buildings,',
       Object.keys(WAY_OUT).length, 'of the doors a way out, and',
       Object.keys(claims).length, 'claim(s)');
})();
// ==== end thornswood property ====

