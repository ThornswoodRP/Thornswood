// ==== thornswood staff spells ====
/*
  THE STAFF SPELLS: WHAT A STAFF BINDS, AND WHO HAS UNLOCKED IT.

  160 of the Bladebinder's 161 staff recipes carry a HasSpell condition naming
  the staff's own spell. A staff is made only when its spell is unlocked for
  staves: recorded in staffSpells on the character (the thornswoodCharacter
  property, so it survives a restart), which craftAnswer asks through
  refusal() below once rank and half have said yes.

  HOW A SPELL IS UNLOCKED, since 29 September (#1128). Patrick: "Enchanters
  also get their own spell point and spell unlocking system like the Mages
  have ... like Mages, they do not need the tomes; their Enchanter rank
  decides which ranks they can unlock", and "they must also have at least one
  spell of the level below".
    - An Enchanter (either half) unlocks it on K, under Staff spells, which
      sends '/pick staffspell <desc>' (unlock below, P.pickStaffSpell in the
      rules). Three things, the Mage's three: a staff spell point (two to
      start, one with every Bladebinder rank, two at Master), Bladebinder rank
      at or above the spell's rank, and a staff spell of the rank below
      already unlocked (Novice needs none). No tome.
    - Somebody a Master Enchanter taught the Bladebinder half learns it only
      from its tome, under the non-mage rules (learn below,
      P.learnStaffFromTome): a place under LIMITS.outsiderSpells, and Novice
      only, since a taught half never leaves Novice. The spell tomes block
      calls learn when they read one, and spends the tome when the engine
      would not.
    - Reading a tome is otherwise the Mage rules for the spell itself, for an
      Enchanter as for anybody (THE SPELL TOMES block above), and records
      nothing for an Enchanter's staves: the K page is their way in.
  What was recorded under #967 and #1026, when a tome was the only way in,
  stays unlocked.

  WHAT RANK A STAFF SPELL IS. rankOf below: the rulebook's SPELLS when it
  lists the spell, otherwise the rank Build-RecipeTable read out of the game's
  records and wrote beside it in STAFF_SPELLS (the half cost perk's editor
  id, then the effects, the same reading the tomes block does at runtime).

  A SPELL NO TOME TEACHES. Some Apocalypse staves name the copy of a spell only
  a creature casts. Build-RecipeTable prints every one and STAFF_SPELLS lists
  them with no tomes: an Enchanter can still unlock one, and nobody else can.
*/
(function () {
  'use strict';
  var g = globalThis;

  /* Written by scripts\dev\Build-RecipeTable.ps1 out of the game's own records into its
     table file (#5191): every spell a staff recipe binds.
     Spell desc -> its name, its school and rank read out of the records (#1128; null when they cannot be),
     and every BOOK record whose teaches spell flag names it. */
  var STAFF_SPELLS = table('STAFF_SPELLS');

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  // Tome desc -> the spell desc it teaches, built once out of STAFF_SPELLS.
  var byTome = null;
  function spellForTome(tomeDesc) {
    if (!byTome) {
      byTome = {};
      for (var sp in STAFF_SPELLS) {
        if (!own(STAFF_SPELLS, sp)) { continue; }
        var tomes = STAFF_SPELLS[sp].tomes || [];
        for (var i = 0; i < tomes.length; i++) { byTome[tomes[i]] = sp; }
      }
    }
    return own(byTome, tomeDesc) ? byTome[tomeDesc] : null;
  }

  function spellName(spellDesc) {
    return (own(STAFF_SPELLS, spellDesc) && STAFF_SPELLS[spellDesc].name) || 'its spell';
  }

  function taught(spellDesc) {
    return own(STAFF_SPELLS, spellDesc) && (STAFF_SPELLS[spellDesc].tomes || []).length > 0;
  }

  function isStaffSpell(spellDesc) { return own(STAFF_SPELLS, spellDesc); }

  /*
    THE RANK OF A STAFF SPELL (#1128). A spell the rulebook's SPELLS lists is
    the book's, rank and all, the same rule the tomes block keeps; any other
    takes the rank Build-RecipeTable read out of the game's records (the half
    cost perk, then the effects), written beside it in STAFF_SPELLS. null when
    neither can say, and nobody can unlock a spell whose rank cannot be read.
  */
  function rankOf(spellDesc) {
    if (!own(STAFF_SPELLS, spellDesc)) { return null; }
    var P = g.__thornswoodProgression;
    var listed = (P && P.spellByDesc) ? P.spellByDesc(spellDesc) : null;
    if (listed) { return listed.rank; }
    return STAFF_SPELLS[spellDesc].rank || null;
  }

  /** A staff spell as the rules take it: { desc, name, rank }, or null. */
  function spellFor(spellDesc) {
    if (!own(STAFF_SPELLS, spellDesc)) { return null; }
    return { desc: spellDesc, name: spellName(spellDesc), rank: rankOf(spellDesc) };
  }

  /** A staff spell by its desc or by its name as somebody typed it, or null. */
  function find(words) {
    var want = String(words || '').trim();
    if (!want) { return null; }
    if (own(STAFF_SPELLS, want)) { return spellFor(want); }
    var lower = want.toLowerCase();
    for (var sp in STAFF_SPELLS) {
      if (own(STAFF_SPELLS, sp) && sp.toLowerCase() === lower) { return spellFor(sp); }
    }
    for (var sp2 in STAFF_SPELLS) {
      if (own(STAFF_SPELLS, sp2) && String(STAFF_SPELLS[sp2].name || '').toLowerCase() === lower) { return spellFor(sp2); }
    }
    return null;
  }

  /** The staff spells recorded on this character state, as a fresh array. */
  function known(state) {
    var list = state && state.staffSpells;
    return Array.isArray(list) ? list.slice() : [];
  }

  function knows(state, spellDesc) { return known(state).indexOf(spellDesc) !== -1; }

  /**
    An Enchanter unlocks a staff spell on K (/pick staffspell <name>). words
    is the spell's desc or its name. Pure: { ok, state, spell } or
    { ok: false, why, missing }.
  */
  function unlock(P, state, words) {
    var spell = find(words);
    if (!spell) { return { ok: false, why: 'no staff binds a spell called ' + String(words || '').trim() }; }
    if (!spell.rank) { return { ok: false, why: 'nobody can unlock ' + spell.name + ' yet, because its rank cannot be read' }; }
    var r = P.pickStaffSpell(state, spell, rankOf);
    if (r.ok) { r.spell = spell; }
    return r;
  }

  /**
    Somebody a Master Enchanter taught reads the tome of a staff spell: the
    non-mage rules (P.learnStaffFromTome). Pure, the same answer as unlock.
  */
  function learn(P, state, spellDesc) {
    var spell = spellFor(spellDesc);
    if (!spell) { return { ok: false, why: 'not a staff spell' }; }
    if (!spell.rank) { return { ok: false, why: 'nobody can learn ' + spell.name + ' for staves yet, because its rank cannot be read' }; }
    var r = P.learnStaffFromTome(state, spell, rankOf);
    if (r.ok) { r.spell = spell; }
    return r;
  }

  /*
    THE STAFF SPELL PAGE ON K, for an Enchanter, and null for anybody else.

      { points: n, rank: '<their Bladebinder rank>', mine: [desc, ...],
        spells: [[desc, name, rank], ...] }

    spells is every staff spell whose rank can be read, Novice first, then by
    name: 160 short rows, sent only to an Enchanter and only when the panel
    changes. The page draws it the way it draws a mage's spell book and sends
    back '/pick staffspell <desc>' for each one marked.
  */
  var pageRows = null;
  function view(P, state) {
    if (!state || !P || !P.isEnchanter || !P.isEnchanter(state)) { return null; }
    if (!pageRows) {
      var order = { novice: 0, advanced: 1, expert: 2, master: 3 };
      var rows = [];
      for (var sp in STAFF_SPELLS) {
        if (!own(STAFF_SPELLS, sp)) { continue; }
        var rk = rankOf(sp);
        if (!rk || !own(order, rk)) { continue; }
        rows.push([sp, spellName(sp), rk]);
      }
      rows.sort(function (a, b) {
        if (order[a[2]] !== order[b[2]]) { return order[a[2]] - order[b[2]]; }
        return a[1] < b[1] ? -1 : (a[1] > b[1] ? 1 : 0);
      });
      pageRows = rows;
    }
    return { points: P.staffPoints(state), rank: P.rankOf(state, P.STAFF_HALF) || 'novice',
             mine: known(state), spells: pageRows };
  }

  /** null when this state may bind this row's spell, otherwise the sentence. */
  function refusal(state, row) {
    if (!row || !row.spell || knows(state, row.spell)) { return null; }
    var made = aWord(row.name || 'staff');
    made = made.charAt(0).toUpperCase() + made.slice(1);
    var name = spellName(row.spell);
    var rk = rankOf(row.spell);
    if (!rk) {
      return made + ' binds ' + name + ', and its rank cannot be read, so nobody can make one yet.';
    }
    var P = g.__thornswoodProgression;
    if (P && P.isEnchanter && P.isEnchanter(state)) {
      return made + ' binds ' + name + ', and you have not unlocked it for staves yet. ' +
             'Press K and unlock it under Staff spells: it takes a staff spell point, ' +
             rk.charAt(0).toUpperCase() + rk.slice(1) +
             ' rank as a Bladebinder, and a staff spell of the rank below. No tome is needed.';
    }
    if (!taught(row.spell)) {
      return made + ' binds ' + name + ', and no spell tome here teaches it, so only an Enchanter can unlock it.';
    }
    return made + ' binds ' + name + ', and you have not learned it for staves yet. ' +
           'Read a spell tome of ' + name + ': somebody a Master Enchanter taught learns Novice staff spells ' +
           'from their tomes, up to ' + ((P && P.TABLE && P.TABLE.limits.outsiderSpells) || 2) + ' of them.';
  }

  g.__thornswoodStaffSpells = {
    STAFF_SPELLS: STAFF_SPELLS, spellForTome: spellForTome, known: known, knows: knows,
    isStaffSpell: isStaffSpell, rankOf: rankOf, spellFor: spellFor, find: find,
    unlock: unlock, learn: learn, view: view, refusal: refusal
  };
})();

/*
  Reading a book. A book that teaches no spell reads exactly as it does in
  Skyrim and nothing is said. A spell tome is decided by THE SPELL TOMES block
  above under the Mage rules (#1026): false keeps the tome and the spell away
  from the reader, and the line says which of the rules is missing, or what
  was learned.
*/
mp.onReadBook = guard('onReadBook', function (actorId, bookBaseId) {
  const tomes = globalThis.__thornswoodTomes;
  const r = tomes ? tomes.read(actorId, bookBaseId) : null;
  if (r && r.line) {
    notify(actorId, r.line);
    say(actorId, r.line);
  }
  if (r && r.refused) {
    /*
      A REFUSED TOME IS HANDED BACK TO THE READER'S PACK ON SCREEN (#2261).
      false keeps the tome on the server (the engine spends it only when a
      spell was learned), but the reader's own Skyrim has already taken it
      out of their inventory the moment they read it, and nothing told it
      otherwise: Ataxayk was refused, kept the tome on the server and saw it
      gone. So the pack is sent again as the server has it, now and once
      more after the client has finished its own read.
    */
    var back = function () { try { mp.set(actorId, 'inventory', mp.get(actorId, 'inventory')); } catch (e) { } };
    back();
    try { setTimeout(back, 750); } catch (e) { }
    return false;
  }
});
// ==== end thornswood staff spells ====

/* BOOKS-START */
/*
  A faction or a business book, kept here for the group. Not a page in a
  personal journal, and not stored on one character. docs/systems/factions.md.
*/
function thornswoodBooks(env) {
  env = env || {};
  var fs = env.fs;
  var path = env.path;
  if (!fs) { fs = require('fs'); }
  if (!path) { path = require('path'); }
  var privDir = env.privDir || 'private';
  var OFFER_MS = 45000;
  var MAX_MEMBERS = 40;
  var MAX_PRICES = 100;
  var MAX_CHAT = 50;
  var MAX_LINE = 300;
  var MAX_NAME = 60;
  var PERMS = ['Read', 'Prices', 'Invite', 'Roles', 'Speak'];
  var store = [];
  var ledgers = {};
  var leftAt = {};
  var seen = {};
  var seeded = false;
  var pending = {};
  var seq = 1;
  var active = true;

  function now() { return env.now ? env.now() : Date.now(); }

  function rolesOf(pid) {
    var row;
    if (env.roles) { row = env.roles(pid); }
    else {
      var f = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodBookRoles;
      row = (typeof f === 'function') ? f(pid) : null;
    }
    row = row || {};
    return {
      staff: !!row.staff,
      dev: !!row.dev,
      business: !!row.business,
      leads: Array.isArray(row.leads) ? row.leads.map(String) : [],
      account: row.account ? String(row.account) : ('p:' + Number(pid))
    };
  }

  /*
    A FACTION'S BOOK FOLLOWS ITS LEADER ROLE (#3317, Patrick, 22 Oct, page
    card q-3317-faction-books, A): one book per faction, owned by whoever
    holds that faction's Leader role in Discord, and it moves with the role.
    book.leader names the role. Whoever holds it is the owner, whatever
    account founded the book; book.owner and book.account follow the account
    that holds it the first time one of its characters opens the book, and
    that character is put in it. Another character on the same account is
    the owner as it is, so the book does not move between them. A faction
    book founded before #3317 has no leader and keeps the account rule it had.
  */
  function leads(book, pid) {
    return !!(book && book.leader) && rolesOf(pid).leads.indexOf(book.leader) !== -1;
  }

  function bookOfLeader(role) {
    for (var i = 0; i < store.length; i++) {
      if (store[i].kind === 'faction' && store[i].leader === role) { return store[i]; }
    }
    return null;
  }

  function followLeader(book, pid, name) {
    if (!leads(book, pid) || book.account === rolesOf(pid).account) { return false; }
    if (!memberOf(book, pid)) {
      if (book.members.length >= MAX_MEMBERS) { return false; }
      book.members.push({ pid: Number(pid), name: name || 'somebody', role: 'Member' });
    }
    book.owner = Number(pid);
    book.account = rolesOf(pid).account;
    return true;
  }

  function silenced(pid) {
    if (env.silenced && env.silenced(pid)) { return true; }
    var st = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodStaff;
    if (st && typeof st.silencedFor === 'function' && st.silencedFor(pid)) { return true; }
    return false;
  }

  function myName(actorId, pid) {
    if (env.nameOf) { return env.nameOf(actorId, pid) || 'somebody'; }
    var soc = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodSocial;
    if (soc && actorId && soc.nameOfPerson) { return soc.nameOfPerson(actorId) || 'somebody'; }
    return 'somebody';
  }

  function findWho(actorId, who) {
    if (env.find) { return env.find(actorId, who); }
    var soc = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodSocial;
    if (!soc || !soc.findPerson) {
      return { actorId: 0, pid: 0, name: '', why: 'Nobody here by that name.' };
    }
    var hit = soc.findPerson(who);
    if (!hit || !hit.actorId) {
      return { actorId: 0, pid: 0, name: '', why: (hit && hit.why) || 'Nobody here by that name.' };
    }
    return {
      actorId: hit.actorId,
      pid: soc.profileOf(hit.actorId),
      name: soc.nameOfPerson(hit.actorId),
      why: ''
    };
  }

  function onlineMap() {
    if (env.online) { return env.online() || {}; }
    var out = {};
    var soc = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodSocial;
    var mp = (typeof globalThis !== 'undefined' ? globalThis : this).mp;
    try {
      var ids = (mp && mp.get) ? (mp.get(0, 'onlinePlayers') || []) : [];
      for (var i = 0; i < ids.length; i++) {
        var pid = soc ? soc.profileOf(ids[i]) : 0;
        if (!pid && mp && mp.get) { pid = Number(mp.get(ids[i], 'profileId')) || 0; }
        if (!pid) { continue; }
        var name = (soc && soc.nameOfPerson) ? soc.nameOfPerson(ids[i]) : '';
        out[pid] = name || 'somebody';
      }
    } catch (e) { }
    return out;
  }

  function refresh() {
    if (env.refresh) { env.refresh(); return; }
    var soc = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodSocial;
    var mp = (typeof globalThis !== 'undefined' ? globalThis : this).mp;
    if (!soc || !soc.push || !mp || !mp.get) { return; }
    try {
      var ids = mp.get(0, 'onlinePlayers') || [];
      for (var i = 0; i < ids.length; i++) { soc.push(ids[i]); }
    } catch (e) { }
  }

  function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { return fallback; }
  }

  function writeJson(file, obj) {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) { }
    var body = JSON.stringify(obj);
    var tmp = file + '.tmp';
    fs.writeFileSync(tmp, body);
    var fd = fs.openSync(tmp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  }

  /*
    Both in the private folder, never data (#2582, 16 Oct). The resources
    port hands anything under data to anybody who asks, and both name
    people: every member of a book by profile id, and the moment each
    profile last left the world. Measured that morning: last-left.json
    answered 200 on 3000 (3 profile ids) and on 7788 (43). #541 moved the
    property register, the farm claims and the door list out of data for
    the same reason on 25 Sep. tests\test-2582-nothing-personal-served.js.
  */
  function booksFile() { return path.join(privDir, 'books.json'); }
  function leftFile() { return path.join(privDir, 'last-left.json'); }

  function loadStore() {
    var doc = null;
    if (fs.existsSync(booksFile())) {
      try {
        doc = JSON.parse(fs.readFileSync(booksFile(), 'utf8').replace(/^\uFEFF/, ''));
        if (!doc || !Array.isArray(doc.books)) { throw new Error('invalid saved books'); }
      } catch (e) { throw new Error('Saved books cannot be verified: ' + e.message); }
    }
    store = (doc && Array.isArray(doc.books)) ? doc.books : [];
    var bookIds = Object.create(null);
    for (var bi = 0; bi < store.length; bi++) {
      var book = store[bi];
      if (!book || typeof book !== 'object' || typeof book.id !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(book.id) || book.id === '__proto__' || bookIds[book.id] ||
          (book.kind !== 'business' && book.kind !== 'faction') ||
          typeof book.name !== 'string' || !book.name.trim() || book.name.length > MAX_NAME ||
          typeof book.account !== 'string' || !Number.isInteger(book.owner) ||
          // A faction book is vacant (owner 0, no account) while the
          // character that led it has been deleted and nobody holding its
          // Leader role has opened it since (#3317). Any other book has both.
          !(book.owner > 0 && book.account) && !(book.leader && book.owner === 0 && book.account === '') ||
          (book.leader !== undefined && (book.kind !== 'faction' || typeof book.leader !== 'string' ||
                                         !/^[^\n]{1,96} Leader$/.test(book.leader))) ||
          !Array.isArray(book.members) || book.members.length > MAX_MEMBERS ||
          !Array.isArray(book.roles) || !Array.isArray(book.chat) || book.chat.length > MAX_CHAT ||
          !validPrices(book.prices)) { throw new Error('Saved book entries cannot be verified'); }
      bookIds[book.id] = book;
      var members = Object.create(null);
      for (var mi = 0; mi < book.members.length; mi++) {
        var member = book.members[mi];
        if (!member || !Number.isInteger(member.pid) || member.pid <= 0 || members[member.pid] ||
            typeof member.name !== 'string' || typeof member.role !== 'string') {
          throw new Error('Saved book members cannot be verified');
        }
        members[member.pid] = true;
      }
      var roleNames = Object.create(null);
      for (var ri = 0; ri < book.roles.length; ri++) {
        var role = book.roles[ri];
        if (!role || typeof role.name !== 'string' || !role.name.trim() || role.name.length > MAX_NAME ||
            roleNames[role.name.toLowerCase()] || !Array.isArray(role.perms) ||
            !role.perms.every(function (p) { return PERMS.indexOf(p) >= 0; })) {
          throw new Error('Saved book roles cannot be verified');
        }
        roleNames[role.name.toLowerCase()] = true;
      }
      if (!roleNames.member || (book.owner > 0 && !members[book.owner]) || book.members.some(function (m) {
        return !roleNames[m.role.toLowerCase()];
      })) {
        throw new Error('Saved book role references cannot be verified');
      }
      for (var ci = 0; ci < book.chat.length; ci++) {
        var line = book.chat[ci];
        if (!line || !Number.isInteger(line.pid) || line.pid <= 0 || typeof line.name !== 'string' ||
            typeof line.text !== 'string' || line.text.length > MAX_LINE || !Number.isFinite(line.at) || line.at < 0) {
          throw new Error('Saved book chat cannot be verified');
        }
      }
    }
    ledgers = (doc && doc.ledgers && typeof doc.ledgers === 'object' && !Array.isArray(doc.ledgers)) ? doc.ledgers : {};
    if (doc && doc.ledgers !== undefined && doc.ledgers !== ledgers) { throw new Error('Saved book ledgers cannot be verified'); }
    for (var hold in ledgers) {
      if (!Object.prototype.hasOwnProperty.call(ledgers, hold)) { continue; }
      if (!validHold(hold) || !ledgers[hold] || typeof ledgers[hold] !== 'object' || Array.isArray(ledgers[hold])) {
        throw new Error('Saved book ledger hold cannot be verified');
      }
      for (var id in ledgers[hold]) {
        if (!Object.prototype.hasOwnProperty.call(ledgers[hold], id)) { continue; }
        if (id === '__proto__' || !ledgers[hold][id] || !validPrices(ledgers[hold][id].prices)) {
          throw new Error('Saved book ledger prices cannot be verified');
        }
        var entry = ledgers[hold][id];
        if (!bookIds[id] || entry.book !== id || entry.kind !== bookIds[id].kind ||
            typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > MAX_NAME ||
            !Number.isFinite(entry.at) || entry.at < 0) {
          throw new Error('Saved book ledger references cannot be verified');
        }
      }
    }
    var left = readJson(leftFile(), null);
    leftAt = (left && typeof left === 'object' && !Array.isArray(left)) ? left : {};
  }

  function save() {
    try { writeJson(booksFile(), { books: store, ledgers: ledgers }); }
    catch (e) {
      var failure = new Error('The server could not save the book. Nothing changed.');
      failure.bookSaveFailed = true;
      throw failure;
    }
  }
  function saveLeft() { writeJson(leftFile(), leftAt); }

  loadStore();

  function byId(id) {
    var want = String(id || '');
    for (var i = 0; i < store.length; i++) {
      if (store[i].id === want) { return store[i]; }
    }
    return null;
  }

  function memberOf(book, pid) {
    var n = Number(pid);
    var rows = (book && book.members) || [];
    for (var i = 0; i < rows.length; i++) {
      if (Number(rows[i].pid) === n) { return rows[i]; }
    }
    return null;
  }

  function roleByName(book, name) {
    var low = String(name || '').toLowerCase();
    var rows = (book && book.roles) || [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].name || '').toLowerCase() === low) { return rows[i]; }
    }
    return null;
  }

  function ownsKind(account, kind) {
    for (var i = 0; i < store.length; i++) {
      if (store[i].account === account && store[i].kind === kind) { return store[i]; }
    }
    return null;
  }

  function isOwner(book, pid) {
    var r = rolesOf(pid);
    if (r.staff) { return true; }
    if (book.leader) { return leads(book, pid); }
    if (r.account && book.account === r.account) { return true; }
    return Number(book.owner) === Number(pid);
  }

  function hasPerm(book, pid, perm) {
    if (isOwner(book, pid)) { return true; }
    var m = memberOf(book, pid);
    if (!m) { return false; }
    var role = roleByName(book, m.role);
    return !!(role && role.perms && role.perms.indexOf(perm) !== -1);
  }

  function canSee(book, pid) {
    var r = rolesOf(pid);
    if (r.staff) { return true; }
    if (memberOf(book, pid)) { return true; }
    if (book.leader) { return leads(book, pid); }
    return !!(r.account && book.account === r.account);
  }

  function visible(pid) {
    var out = [];
    for (var i = 0; i < store.length; i++) {
      if (canSee(store[i], pid)) { out.push(store[i]); }
    }
    return out;
  }

  function showTab(pid) {
    var r = rolesOf(pid);
    if (r.staff || r.business || r.leads.length) { return true; }
    return visible(pid).length > 0;
  }

  function clipName(name) {
    var n = String(name || '').replace(/\s+/g, ' ').trim();
    if (!n) { return { name: '', why: 'A name is needed.' }; }
    if (n.length > MAX_NAME) { return { name: '', why: 'A name is at most 60 characters.' }; }
    return { name: n, why: '' };
  }

  function found(actorId, pid, kind, name) {
    if (kind !== 'business' && kind !== 'faction') {
      return 'That kind is business or faction.';
    }
    var named = clipName(name);
    if (!named.name) { return named.why; }
    var r = rolesOf(pid);
    // A Dev may found one business. Any other account needs Business Owner.
    if (kind === 'business' && !r.business && !r.dev) {
      return 'Your Discord account does not hold Business Owner.';
    }
    if (kind === 'business' && ownsKind(r.account, kind)) {
      return 'This account already has a business.';
    }
    // A faction's book is its Leader's (#3317), one per faction.
    var leader = '';
    if (kind === 'faction') {
      if (!r.leads.length) {
        return 'A faction\'s book belongs to whoever holds its Leader role in Discord, ' +
               'and your Discord account holds none.';
      }
      for (var li = 0; li < r.leads.length && !leader; li++) {
        if (!bookOfLeader(r.leads[li])) { leader = r.leads[li]; }
      }
      if (!leader) { return 'Your faction already has its book.'; }
    }
    seq += 1;
    var book = {
      id: 'b' + seq.toString(36) + now().toString(36),
      kind: kind,
      name: named.name,
      account: r.account,
      owner: Number(pid),
      roles: [{ name: 'Member', perms: ['Read', 'Speak'] }],
      members: [{ pid: Number(pid), name: myName(actorId, pid), role: 'Member' }],
      prices: [],
      chat: []
    };
    if (leader) { book.leader = leader; }
    store.push(book);
    save();
    refresh();
    return 'Founded ' + book.name + '.';
  }

  function booksWhere(pid, pred) {
    var all = visible(pid);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (!pred || pred(all[i], pid)) { out.push(all[i]); }
    }
    return out;
  }

  function splitBook(pid, words, pred) {
    words = words || [];
    var candidates = booksWhere(pid, pred);
    if (words.length) {
      var idHit = byId(words[0]);
      /* An id they can see is that book, even when this command is one their
         role cannot run. The command then says which permission is missing,
         instead of pretending they are not in it. */
      if (idHit && canSee(idHit, pid)) {
        return { book: idHit, rest: words.slice(1).join(' '), why: '' };
      }
    }
    var joined = words.join(' ');
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var n = String(candidates[i].name || '');
      var low = joined.toLowerCase();
      var nl = n.toLowerCase();
      if (low === nl || low.indexOf(nl + ' ') === 0) {
        if (!best || n.length > best.name.length) { best = candidates[i]; }
      }
    }
    if (best) {
      return { book: best, rest: joined.slice(best.name.length).trim(), why: '' };
    }
    if (candidates.length === 1) {
      return { book: candidates[0], rest: joined, why: '' };
    }
    if (!candidates.length) { return { book: null, rest: '', why: 'You are not in a book.' }; }
    return { book: null, rest: '', why: 'Which book? Name it.' };
  }

  function memberByName(book, who) {
    var low = String(who || '').trim().toLowerCase();
    if (!low) { return { member: null, why: 'Who?' }; }
    var exact = [], part = [];
    var rows = book.members || [];
    for (var i = 0; i < rows.length; i++) {
      var n = String(rows[i].name || '').toLowerCase();
      if (n === low) { exact.push(rows[i]); }
      else if (n.indexOf(low) === 0) { part.push(rows[i]); }
    }
    var hit = exact.length ? exact : part;
    if (hit.length === 1) { return { member: hit[0], why: '' }; }
    if (hit.length > 1) { return { member: null, why: 'More than one person in the book by that name.' }; }
    return { member: null, why: 'They are not in that book.' };
  }

  function ownsAccount(book, pid) {
    var r = rolesOf(pid);
    if (book.leader) { return leads(book, pid) || Number(book.owner) === Number(pid); }
    return Number(book.owner) === Number(pid) || (!!r.account && book.account === r.account);
  }

  function leave(pid, words) {
    var taken = splitBook(pid, words, function (b, p) { return !!memberOf(b, p); });
    if (!taken.book) { return taken.why; }
    if (ownsAccount(taken.book, pid)) {
      return 'The owner disbands a book. A member can leave.';
    }
    if (!memberOf(taken.book, pid)) { return 'You are not in that book.'; }
    var name = taken.book.name;
    var keep = [];
    for (var i = 0; i < taken.book.members.length; i++) {
      if (Number(taken.book.members[i].pid) !== Number(pid)) { keep.push(taken.book.members[i]); }
    }
    taken.book.members = keep;
    save();
    refresh();
    return 'You left ' + name + '.';
  }

  function invite(actorId, pid, words) {
    var taken = splitBook(pid, words, function (b, p) { return hasPerm(b, p, 'Invite'); });
    if (!taken.book) { return taken.why; }
    if (!hasPerm(taken.book, pid, 'Invite')) { return 'You cannot invite someone to that book.'; }
    var who = String(taken.rest || '').trim();
    if (!who) { return 'Invite whom?'; }
    if (taken.book.members.length >= MAX_MEMBERS) { return taken.book.name + ' is full.'; }
    var hit = findWho(actorId, who);
    if (!hit.pid) { return hit.why || 'Nobody here by that name.'; }
    if (Number(hit.pid) === Number(pid)) { return 'That is you.'; }
    if (memberOf(taken.book, hit.pid)) { return 'They are already in it.'; }
    pending[hit.pid] = { bookId: taken.book.id, from: Number(pid), at: now() };
    // The P prompt says which book it is, "the business The Bee" (#1591).
    var about = 'the ' + taken.book.kind + ' ' + taken.book.name;
    var asked = '';
    if (env.offer) { asked = env.offer(actorId, hit.actorId, about) || ''; }
    else {
      var soc = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodSocial;
      if (soc && soc.offer && hit.actorId) { asked = soc.offer('book', actorId, hit.actorId, about) || ''; }
    }
    if (asked) { delete pending[hit.pid]; return asked; }
    refresh();
    return 'You asked ' + (hit.name || 'them') + '. They have 45 seconds.';
  }

  function accept(pid, name) {
    var p = pending[Number(pid)] || pending[pid];
    if (!p || now() - p.at > OFFER_MS) {
      delete pending[pid];
      return { ok: false, text: 'That offer has gone.' };
    }
    var book = byId(p.bookId);
    delete pending[pid];
    if (!book) { return { ok: false, text: 'That book is gone.' }; }
    if (memberOf(book, pid)) { return { ok: false, text: 'You are already in ' + book.name + '.' }; }
    if (book.members.length >= MAX_MEMBERS) {
      return { ok: false, text: book.name + ' is full.' };
    }
    book.members.push({ pid: Number(pid), name: name || 'somebody', role: 'Member' });
    save();
    refresh();
    return { ok: true, text: 'You joined ' + book.name + '.' };
  }

  function decline(pid) { delete pending[pid]; }

  function sayLine(pid, actorId, words) {
    var taken = splitBook(pid, words, function (b, p) { return hasPerm(b, p, 'Speak'); });
    if (!taken.book) { return taken.why; }
    if (!hasPerm(taken.book, pid, 'Speak')) { return 'You cannot write in that book.'; }
    if (silenced(pid)) { return 'You are silenced, so this book takes no line.'; }
    var text = String(taken.rest || '').replace(/\s+/g, ' ').trim();
    if (!text) { return 'Say what?'; }
    if (text.length > MAX_LINE) { text = text.slice(0, MAX_LINE); }
    taken.book.chat = taken.book.chat || [];
    taken.book.chat.push({
      at: now(), pid: Number(pid), name: myName(actorId, pid), text: text
    });
    if (taken.book.chat.length > MAX_CHAT) {
      taken.book.chat = taken.book.chat.slice(taken.book.chat.length - MAX_CHAT);
    }
    save();
    refresh();
    return 'Said in ' + taken.book.name + '.';
  }

  function parseGold(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s === '-') { return { ok: true, n: null }; }
    if (!/^\d+$/.test(s)) { return { ok: false }; }
    var n = Number(s);
    return validGold(n) ? { ok: true, n: n } : { ok: false };
  }

  function setPrice(book, item, buyRaw, sellRaw) {
    var named = clipName(item);
    if (!named.name) { return named.why; }
    var buy = parseGold(buyRaw);
    var sell = parseGold(sellRaw);
    if (!buy.ok || !sell.ok) { return 'A price is a whole number of gold, or a blank.'; }
    book.prices = book.prices || [];
    var low = named.name.toLowerCase();
    for (var i = 0; i < book.prices.length; i++) {
      if (String(book.prices[i].name || '').toLowerCase() === low) {
        book.prices[i] = { name: named.name, buy: buy.n, sell: sell.n };
        save();
        refresh();
        return 'Set ' + named.name + ' in ' + book.name + '.';
      }
    }
    if (book.prices.length >= MAX_PRICES) { return 'The list is full. 100 lines.'; }
    book.prices.push({ name: named.name, buy: buy.n, sell: sell.n });
    save();
    refresh();
    return 'Set ' + named.name + ' in ' + book.name + '.';
  }

  function dropPrice(book, item) {
    var low = String(item || '').trim().toLowerCase();
    if (!low) { return 'Which line?'; }
    var keep = [];
    var gone = false;
    var rows = book.prices || [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].name || '').toLowerCase() === low) { gone = true; }
      else { keep.push(rows[i]); }
    }
    if (!gone) { return 'No line by that name.'; }
    book.prices = keep;
    save();
    refresh();
    return 'Removed ' + item.trim() + '.';
  }

  function pipes(rest) {
    var bits = String(rest || '').split('|');
    var out = [];
    for (var i = 0; i < bits.length; i++) {
      var t = bits[i].trim();
      if (t) { out.push(t); }
    }
    return out;
  }

  function knownPerms(text) {
    var want = String(text || '').split(/[\s,]+/);
    var out = [];
    for (var i = 0; i < want.length; i++) {
      for (var j = 0; j < PERMS.length; j++) {
        if (want[i].toLowerCase() === PERMS[j].toLowerCase() && out.indexOf(PERMS[j]) < 0) {
          out.push(PERMS[j]);
        }
      }
    }
    return out;
  }

  function editRoles(book, rest) {
    var bits = pipes(rest);
    var verb = String(bits[0] || '').toLowerCase();
    if (verb === 'new') {
      var title = clipName(bits[1] || '');
      if (!title.name) { return title.why; }
      if (roleByName(book, title.name)) { return 'That role is already there.'; }
      book.roles.push({ name: title.name, perms: [] });
      save();
      refresh();
      return 'Made the role ' + title.name + '.';
    }
    if (verb === 'rename') {
      var role = roleByName(book, bits[1] || '');
      if (!role) { return 'No role by that name.'; }
      if (role.name === 'Member') { return 'Member stays, so a new person has a role to land on.'; }
      var next = clipName(bits[2] || '');
      if (!next.name) { return next.why; }
      if (roleByName(book, next.name) && roleByName(book, next.name) !== role) {
        return 'That role is already there.';
      }
      var old = role.name;
      role.name = next.name;
      var members = book.members || [];
      for (var i = 0; i < members.length; i++) {
        if (members[i].role === old) { members[i].role = next.name; }
      }
      save();
      refresh();
      return 'Renamed ' + old + ' to ' + next.name + '.';
    }
    if (verb === 'perm') {
      var held = roleByName(book, bits[1] || '');
      if (!held) { return 'No role by that name.'; }
      held.perms = knownPerms(bits[2] || '');
      save();
      refresh();
      return 'Set ' + held.name + '.';
    }
    return 'A role is new, rename, or perm.';
  }

  function editMember(book, pid, rest) {
    var bits = pipes(rest);
    var verb = String(bits[0] || '').toLowerCase();
    if (verb === 'remove') {
      if (!hasPerm(book, pid, 'Invite') && !rolesOf(pid).staff) {
        return 'You cannot remove someone from that book.';
      }
      var who = memberByName(book, bits.slice(1).join(' '));
      if (!who.member) { return who.why; }
      if (Number(who.member.pid) === Number(book.owner)) {
        return 'The owner stays until the book is disbanded or handed on.';
      }
      var keep = [];
      for (var i = 0; i < book.members.length; i++) {
        if (book.members[i] !== who.member) { keep.push(book.members[i]); }
      }
      book.members = keep;
      save();
      refresh();
      return 'Removed ' + who.member.name + '.';
    }
    if (verb === 'role') {
      if (!hasPerm(book, pid, 'Roles')) { return 'You cannot set roles in that book.'; }
      var person = memberByName(book, bits[1] || '');
      if (!person.member) { return person.why; }
      if (Number(person.member.pid) === Number(book.owner)) {
        return 'The owner is not put on a role.';
      }
      var role = roleByName(book, bits[2] || '');
      if (!role) { return 'No role by that name.'; }
      person.member.role = role.name;
      save();
      refresh();
      return person.member.name + ' is ' + role.name + '.';
    }
    return 'Say role or remove.';
  }

  function hand(book, pid, rest) {
    if (!rolesOf(pid).staff) { return 'Staff hand a book on.'; }
    if (book.leader) {
      return 'This book moves with the ' + book.leader + ' role in Discord, not by hand.';
    }
    var who = memberByName(book, pipes(rest).join(' '));
    if (!who.member) { return who.why; }
    if (Number(who.member.pid) === Number(book.owner)) { return 'They already own it.'; }
    book.owner = Number(who.member.pid);
    book.account = rolesOf(book.owner).account;
    save();
    refresh();
    return who.member.name + ' owns ' + book.name + ' now.';
  }

  function rename(book, pid, rest) {
    if (!isOwner(book, pid)) { return 'The owner renames a book.'; }
    var named = clipName(rest);
    if (!named.name) { return named.why; }
    book.name = named.name;
    save();
    refresh();
    return 'Renamed to ' + book.name + '.';
  }

  function disband(book, pid) {
    if (!isOwner(book, pid)) { return 'The owner disbands a book.'; }
    var name = book.name;
    var keep = [];
    for (var i = 0; i < store.length; i++) {
      if (store[i] !== book) { keep.push(store[i]); }
    }
    store = keep;
    forgetLedger(book.id);
    save();
    refresh();
    return 'Disbanded ' + name + '.';
  }

  function standingHold(actorId) {
    if (env.atBox) { return String(env.atBox(actorId) || ''); }
    var prop = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodProperty;
    if (prop && typeof prop.holdStanding === 'function') {
      return String(prop.holdStanding(actorId) || '');
    }
    return '';
  }

  function validHold(hold) {
    return ['whiterun', 'solitude', 'riften', 'markarth', 'windhelm', 'falkreath',
      'morthal', 'dawnstar', 'winterhold', 'ravenrock'].indexOf(hold) >= 0;
  }

  function validGold(n) {
    return n === null || (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 2147483647);
  }

  function validPrices(rows) {
    if (!Array.isArray(rows) || rows.length > MAX_PRICES) { return false; }
    var names = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || typeof row.name !== 'string' || !row.name.trim() || row.name.length > MAX_NAME ||
          !validGold(row.buy) || !validGold(row.sell)) { return false; }
      var key = row.name.trim().toLowerCase();
      if (names[key]) { return false; }
      names[key] = true;
    }
    return true;
  }

  function copyPrices(book) {
    var out = [];
    var rows = (book && book.prices) || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      out.push({
        name: row.name,
        buy: (row.buy == null || row.buy === '') ? null : Number(row.buy),
        sell: (row.sell == null || row.sell === '') ? null : Number(row.sell)
      });
    }
    return out;
  }

  function forgetLedger(id) {
    var want = String(id || '');
    for (var hold in ledgers) {
      if (!Object.prototype.hasOwnProperty.call(ledgers, hold)) { continue; }
      if (ledgers[hold] && ledgers[hold][want]) { delete ledgers[hold][want]; }
    }
  }

  function submittedHolds(id) {
    var want = String(id || '');
    var out = [];
    for (var hold in ledgers) {
      if (!Object.prototype.hasOwnProperty.call(ledgers, hold)) { continue; }
      if (ledgers[hold] && ledgers[hold][want]) { out.push(hold); }
    }
    out.sort();
    return out;
  }

  function roundGold(n) {
    return Math.floor(Number(n) + 0.5);
  }

  function sideNumbers(hold, item, side) {
    var bag = ledgers[hold];
    var out = [];
    if (!bag) { return out; }
    var low = String(item || '').toLowerCase();
    for (var id in bag) {
      if (!Object.prototype.hasOwnProperty.call(bag, id)) { continue; }
      var rows = (bag[id] && bag[id].prices) || [];
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].name || '').toLowerCase() !== low) { continue; }
        var v = rows[i][side];
        if (v == null || v === '') { continue; }
        out.push(Number(v));
      }
    }
    return out;
  }

  function meanGold(nums) {
    if (!nums.length) { return null; }
    var sum = 0;
    for (var i = 0; i < nums.length; i++) { sum += nums[i]; }
    return roundGold(sum / nums.length);
  }

  function sidePrice(hold, item, side) {
    var own = meanGold(sideNumbers(hold, item, side));
    if (own !== null) { return own; }
    var fromHolds = [];
    for (var name in ledgers) {
      if (!Object.prototype.hasOwnProperty.call(ledgers, name)) { continue; }
      if (name === hold) { continue; }
      var one = meanGold(sideNumbers(name, item, side));
      if (one !== null) { fromHolds.push(one); }
    }
    return meanGold(fromHolds);
  }

  function catalog(hold) {
    var name = String(hold || '').toLowerCase();
    if (!active || !validHold(name)) { return []; }
    var seen = Object.create(null);
    var order = [];
    function take(rows) {
      for (var i = 0; i < rows.length; i++) {
        var label = String((rows[i] && rows[i].name) || '').trim();
        var key = label.toLowerCase();
        if (!key || seen[key]) { continue; }
        seen[key] = label;
        order.push(key);
      }
    }
    var bag = ledgers[name];
    if (bag) {
      for (var id in bag) {
        if (Object.prototype.hasOwnProperty.call(bag, id)) { take((bag[id] && bag[id].prices) || []); }
      }
    }
    for (var other in ledgers) {
      if (!Object.prototype.hasOwnProperty.call(ledgers, other) || other === name) { continue; }
      var otherBag = ledgers[other];
      for (var id2 in otherBag) {
        if (Object.prototype.hasOwnProperty.call(otherBag, id2)) { take((otherBag[id2] && otherBag[id2].prices) || []); }
      }
    }
    var out = [];
    for (var k = 0; k < order.length; k++) {
      var item = seen[order[k]];
      var price = guildPrice(name, item);
      if (price.buy === null && price.sell === null) { continue; }
      out.push({ name: item, buy: price.buy, sell: price.sell });
    }
    return out;
  }

  function guildPrice(hold, item) {
    var name = String(hold || '').toLowerCase();
    if (!active || !validHold(name)) { return { buy: null, sell: null }; }
    return {
      buy: sidePrice(name, item, 'buy'),
      sell: sidePrice(name, item, 'sell')
    };
  }

  function submit(actorId, pid, words) {
    var taken = splitBook(pid, words, function (b, p) { return hasPerm(b, p, 'Prices'); });
    if (!taken.book) { return taken.why; }
    if (!hasPerm(taken.book, pid, 'Prices')) { return 'You cannot set prices in that book.'; }
    if (taken.rest) { return 'Name the book to submit at the hold box.'; }
    var hold = standingHold(actorId).toLowerCase();
    if (!validHold(hold)) { return 'Stand at the hold\'s notice board, then submit the list.'; }
    if (!validPrices(taken.book.prices)) { return 'That price list cannot be verified.'; }
    var previous = ledgers;
    var next = JSON.parse(JSON.stringify(ledgers));
    if (!Object.prototype.hasOwnProperty.call(next, hold)) { next[hold] = {}; }
    next[hold][taken.book.id] = {
      book: taken.book.id,
      name: taken.book.name,
      kind: taken.book.kind,
      at: now(),
      prices: copyPrices(taken.book)
    };
    ledgers = next;
    try { save(); }
    catch (e) {
      ledgers = previous;
      return 'The server could not save the list. Nothing was submitted.';
    }
    refresh();
    return 'Submitted ' + taken.book.name + ' to ' + hold + '\'s box. The list stays in the book.';
  }

  function command(ctx) {
    var parts = (ctx && ctx.parts) || [];
    var sub = String(parts[1] || '').toLowerCase();
    var pid = Number(ctx && ctx.profileId) || 0;
    var actorId = ctx && ctx.actorId;
    var words = parts.slice(2);
    if (!pid) { return 'You are not in the world yet.'; }
    if (sub === 'new') {
      return found(actorId, pid, String(parts[2] || '').toLowerCase(), parts.slice(3).join(' '));
    }
    if (sub === 'submit') {
      var said = submit(actorId, pid, words);
      if (String(said).indexOf('Submitted ') === 0) {
        try {
          var soc = g.__thornswoodSocial;
          if (soc && soc.push && actorId) { soc.push(actorId, true); }
        } catch (eSubmit) { }
      }
      return said;
    }
    if (sub === 'leave') { return leave(pid, words); }
    if (sub === 'invite') { return invite(actorId, pid, words); }
    if (sub === 'say') { return sayLine(pid, actorId, words); }
    if (sub === 'rename' || sub === 'disband' || sub === 'price' || sub === 'role' ||
        sub === 'member' || sub === 'give') {
      var pred = null;
      if (sub === 'price') { pred = function (b, p) { return hasPerm(b, p, 'Prices'); }; }
      if (sub === 'role' || sub === 'member') { pred = function (b, p) { return hasPerm(b, p, 'Roles') || hasPerm(b, p, 'Invite'); }; }
      if (sub === 'give' || sub === 'rename' || sub === 'disband') {
        pred = function (b, p) { return isOwner(b, p); };
      }
      var taken = splitBook(pid, words, pred);
      if (!taken.book) { return taken.why; }
      if (sub === 'rename') { return rename(taken.book, pid, taken.rest); }
      if (sub === 'disband') { return disband(taken.book, pid); }
      if (sub === 'give') { return hand(taken.book, pid, taken.rest); }
      if (sub === 'role') {
        if (!hasPerm(taken.book, pid, 'Roles')) { return 'You cannot set roles in that book.'; }
        return editRoles(taken.book, taken.rest);
      }
      if (sub === 'member') { return editMember(taken.book, pid, taken.rest); }
      if (!hasPerm(taken.book, pid, 'Prices')) { return 'You cannot set prices in that book.'; }
      var bits = pipes(taken.rest);
      if (String(bits[0] || '').toLowerCase() === 'drop' && bits.length < 3) {
        return dropPrice(taken.book, bits.slice(1).join(' '));
      }
      // Prices are positional. The shared role parser removes blank fields.
      bits = String(taken.rest || '').split('|').map(function (s) { return s.trim(); });
      if (!bits[0] && bits.length > 1) { bits.shift(); }
      if (!bits[0] || bits.length > 3) { return 'Name the line, then the buy and the sell. A blank is -.'; }
      return setPrice(taken.book, bits[0], bits[1], bits[2]);
    }
    return 'The group book is on J.';
  }

  function view(pid, textOff) {
    if (!active) { return { show: false }; }
    var off = textOff || {};
    var r = rolesOf(pid);
    if (!showTab(pid)) { return { show: false }; }
    var here = onlineMap();
    var books = [];
    // The Leader role changed hands in Discord since the book last saw its
    // holder: the book goes to them now, the first time they open it.
    var moved = false;
    for (var s = 0; s < store.length; s++) {
      if (followLeader(store[s], pid, here[pid] || here[String(pid)])) { moved = true; }
    }
    // The role decides who owns it, so a save that fails here loses nothing:
    // the next save of the book writes the same owner.
    if (moved) { try { save(); } catch (e) { } }
    var rows = visible(pid);
    for (var i = 0; i < rows.length; i++) {
      var b = rows[i];
      var read = hasPerm(b, pid, 'Read');
      var people = [];
      var chat = [];
      var prices = [];
      if (read) {
        var members = b.members || [];
        for (var m = 0; m < members.length; m++) {
          var row = members[m];
          var on = !!here[row.pid] || !!here[String(row.pid)];
          var when = Number(leftAt[row.pid] || leftAt[String(row.pid)] || 0);
          people.push({
            name: row.name,
            role: Number(row.pid) === Number(b.owner) ? 'Owner' : row.role,
            on: on,
            left: on ? 0 : when
          });
        }
        var lines = b.chat || [];
        for (var c = 0; c < lines.length; c++) {
          var line = lines[c];
          if (off[line.pid] || off[String(line.pid)]) { continue; }
          chat.push({ name: line.name, text: line.text, at: line.at });
        }
        var list = b.prices || [];
        for (var p = 0; p < list.length; p++) {
          prices.push({ name: list[p].name, buy: list[p].buy, sell: list[p].sell });
        }
      }
      var roleNames = [];
      var roleRows = [];
      if (hasPerm(b, pid, 'Roles')) {
        var roles = b.roles || [];
        for (var rr = 0; rr < roles.length; rr++) {
          roleNames.push(roles[rr].name);
          // What each role may do, so J switches a permission on and off
          // rather than anybody typing the list (#1630).
          roleRows.push({ name: roles[rr].name, perms: (roles[rr].perms || []).slice() });
        }
      }
      books.push({
        id: b.id,
        kind: b.kind,
        name: b.name,
        read: read,
        speak: hasPerm(b, pid, 'Speak'),
        canPrices: hasPerm(b, pid, 'Prices'),
        invite: hasPerm(b, pid, 'Invite'),
        canRoles: hasPerm(b, pid, 'Roles'),
        owner: isOwner(b, pid),
        staff: !!r.staff,
        leave: !!(memberOf(b, pid) && !ownsAccount(b, pid)),
        people: people,
        chat: chat,
        priceList: prices,
        submitted: read ? submittedHolds(b.id) : [],
        roleNames: roleNames,
        roles: roleRows
      });
    }
    return {
      show: true,
      canBusiness: !!((r.business || r.dev) && !ownsKind(r.account, 'business')),
      canFaction: r.leads.some(function (role) { return !bookOfLeader(role); }),
      permNames: PERMS.slice(),
      books: books
    };
  }

  function noteTick() {
    if (!active) { return; }
    var here = onlineMap();
    if (!seeded) {
      for (var id in here) {
        if (Object.prototype.hasOwnProperty.call(here, id)) { seen[id] = true; }
      }
      seeded = true;
      return;
    }
    var changed = false;
    for (var was in seen) {
      if (!Object.prototype.hasOwnProperty.call(seen, was)) { continue; }
      if (!here[was]) {
        leftAt[was] = now();
        delete seen[was];
        changed = true;
      }
    }
    for (var on in here) {
      if (Object.prototype.hasOwnProperty.call(here, on)) { seen[on] = true; }
    }
    if (changed) { saveLeft(); }
  }

  function mutate(action, structured) {
    var unavailable = 'The books are unavailable while their saved state is checked.';
    if (!active) { return structured ? { ok: false, text: unavailable } : unavailable; }
    var before = JSON.parse(JSON.stringify({ store: store, ledgers: ledgers, pending: pending, seq: seq }));
    try { return action(); }
    catch (e) {
      if (!e || !e.bookSaveFailed) { throw e; }
      store = before.store;
      ledgers = before.ledgers;
      pending = before.pending;
      seq = before.seq;
      return structured ? { ok: false, text: e.message } : e.message;
    }
  }

  /*
    A DELETED CHARACTER OUT OF THE BOOKS (#2351). Asked once, as the books
    start, through __thornswoodRelease, with the list Delete-Person.ps1
    wrote. Their place
    in every book goes, as a member's leave does, and so do the lines they
    wrote in a book's chat, which are their words. A book they own is
    disbanded, as its owner's disband does, with its ledger entries: a book
    has to have its owner among its members (loadStore), and handing it on is
    staff's (hand), so the procedure for a deletion request says to hand it on
    in the game before the real run when the group wants to keep it. A
    faction's book is its Leader role's and is never handed on (#3317), so it
    stays, vacant, until whoever holds the role next opens it. When
    they last left goes too. A save that fails puts everything back, as
    mutate does, and the list waits. Answers the counts and whether it took.
  */
  function release(who) {
    var c = { books: 0, members: 0, lines: 0, left: 0 };
    if (!active) { return { counts: c, saved: false }; }
    var before = JSON.parse(JSON.stringify({ store: store, ledgers: ledgers, leftAt: leftAt }));
    var keep = [];
    for (var i = 0; i < store.length; i++) {
      var book = store[i];
      if (who.profile(book.owner) && !book.leader) { forgetLedger(book.id); c.books++; continue; }
      var m = book.members.length, l = book.chat.length;
      if (book.leader && who.profile(book.owner)) { book.owner = 0; book.account = ''; }
      book.members = book.members.filter(function (x) { return !who.profile(x.pid); });
      book.chat = book.chat.filter(function (x) { return !who.profile(x.pid); });
      c.members += m - book.members.length;
      c.lines += l - book.chat.length;
      keep.push(book);
    }
    store = keep;
    for (var k in leftAt) {
      if (Object.prototype.hasOwnProperty.call(leftAt, k) && who.profile(Number(k))) { delete leftAt[k]; c.left++; }
    }
    for (var p in pending) {
      if (Object.prototype.hasOwnProperty.call(pending, p) && who.profile(Number(p))) { delete pending[p]; }
    }
    if (!c.books && !c.members && !c.lines && !c.left) { return { counts: c, saved: true }; }
    try {
      if (c.books || c.members || c.lines) { save(); }
      if (c.left) { saveLeft(); }
    } catch (e) {
      store = before.store;
      ledgers = before.ledgers;
      leftAt = before.leftAt;
      return { counts: c, saved: false };
    }
    refresh();
    return { counts: c, saved: true };
  }

  return {
    release: release,
    command: function (ctx) { return mutate(function () { return command(ctx); }, false); },
    accept: function (pid, name) { return mutate(function () { return accept(pid, name); }, true); },
    decline: function (pid) { if (active) { decline(pid); } },
    view: view,
    noteTick: noteTick,
    shutdown: function () { active = false; pending = {}; },
    books: function () { return active ? JSON.parse(JSON.stringify(store)) : []; },
    guildPrice: guildPrice,
    catalog: catalog,
    ledgers: function () { return active ? JSON.parse(JSON.stringify(ledgers)) : {}; }
  };
}
/* BOOKS-END */

(function () {
  var g = (typeof globalThis !== 'undefined' ? globalThis : this);
  if (g.__thornswoodBooks && typeof g.__thornswoodBooks.shutdown === 'function') {
    g.__thornswoodBooks.shutdown();
  }
  g.__thornswoodBooks = null;
  if (g.__thornswoodBooksTimer) {
    try { clearInterval(g.__thornswoodBooksTimer); } catch (eClear) { }
  }
  g.__thornswoodBooksTimer = null;
  try {
    var fs = require('fs');
    var path = require('path');
    var privDir = 'private';
    try {
      var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
      if (cfg && cfg.privDir) { privDir = String(cfg.privDir); }
    } catch (e) { }
    var api = thornswoodBooks({ fs: fs, path: path, privDir: privDir });
    g.__thornswoodBooks = api;
    if (typeof g.__thornswoodRelease === 'function') { g.__thornswoodRelease('books', api.release); }
    g.__thornswoodBooksTimer = setInterval(function () {
      try { api.noteTick(); } catch (e3) { }
    }, 5000);
  } catch (e) {
    try { log('books: ' + ((e && e.message) || e)); } catch (e4) { }
  }
})();


