// ==== thornswood spell tomes ====
/*
  A SPELL TOME TEACHES ONLY UNDER THE MAGE RULES. Patrick, 29 September, on
  issue #1026: "No they still need the spell points, the level, and a spell
  from the level below."

  The engine teaches the spell of any book with the teaches-spell flag and
  spends the book (ReadBookEvent::OnFireSuccess in the fork), unless
  mp.onReadBook answers false: then the book is kept and the engine takes the
  spell back off the client (OnFireBlocked). So the handler at the end of the
  staff spells block asks read() below, which asks the rules
  (learnFromTome in the progression block) and answers whether to refuse and
  the line to say. Every one of the three that is missing is named.

  WHICH SPELL, AND WHAT SCHOOL AND RANK, READ OUT OF THE GAME'S OWN RECORDS at
  the moment somebody reads, through mp.lookupEspmRecordById (the same way the
  spoils block classifies a container), so nothing is generated and a magic
  mod's tomes are covered the day it is added:
    BOOK  DATA byte 0 carries flag 0x04 (TeachesSpell, libespm BOOK.h) and the
          uint32 at offset 4 is the spell, a plugin-local form id turned
          global with the lookup's own toGlobalRecordId.
    SPEL  a spell SPELLS lists (by its form id in SPELL_IDS) is the rulebook's,
          school and rank and all. Anything else: the half cost perk in SPIT
          at offset 32, whose editor id names both (DestructionAdept50,
          AlterationNovice00), and failing that its effects.
    MGEF  DATA int32 at offset 12 is the magic skill (actor value 18
          Alteration, 19 Conjuration, 20 Destruction, 21 Illusion, 22
          Restoration) and uint32 at 40 the minimum skill level. The highest
          level among the effects of the five schools decides.
  Skyrim's levels map to ranks as SPELLS sorts them: 0 Novice, 25 Apprentice
  and 50 Adept are Advanced, 75 Expert, 100 Master (rankForLevel).

  MEASURED 29 September, this block run against the 57 plugins of the server
  load order read off disk: 497 books teach a spell, 84 of them a spell
  SPELLS lists, and 492 give a school and rank. The five that do not are the
  Oghma Infinium (1a332:Skyrim.esm, which ZIA_Complete Pack.esp makes teach
  d788c, Dragon Knowledge) and the four Fishing in Skyrim cheat books
  (27a95, 27a96, 27a97 and 27a9b:FishingInSkyrim.esp, the rod, net,
  dynamite and depth charge spells). For the 85 spells SPELLS lists, the
  records alone agree with the book on 83; Odin moves Invisibility to Expert
  and Call to Arms to Master, and the book wins.

  WHAT READING THOSE FIVE DOES (#1127): it is refused as off the book, with
  the same line as every other tome the book does not list, and the tome is
  kept. None of the five spells is on a school's page, and magic.md grants
  only the book's ("A mod that adds a spell ... is not in the book. It is
  not a college spell and it is not granted"), so none is given a school and
  rank here. A spell the book lists always has its school and rank from
  SPELLS, so a spell whose school or rank cannot be read is never the
  book's, and its refusal is the off-book one. It used to say the school
  and rank could not be read and to tell staff, which asked for reports
  about books nothing was wrong with. Nothing here keeps the five out of
  the world: the dungeon loot block hands out only the Skyrim tomes it
  lists, and whether the four cheat books should leave world containers as
  well is asked on #1127.

  A missing character block is a build fault and lets the book read as
  Skyrim reads it, the same choice every gate in this file makes.
*/
(function () {
  'use strict';
  var g = globalThis;

  var TEACHES_SPELL = 0x04;
  var AV_SCHOOL = { 18: 'alteration', 19: 'conjuration', 20: 'destruction', 21: 'illusion', 22: 'restoration' };
  var PERK_RANK = /(alteration|conjuration|destruction|illusion|restoration)(novice|apprentice|adept|expert|master)/i;
  var PERK_WORD = { novice: 'novice', apprentice: 'advanced', adept: 'advanced', expert: 'expert', master: 'master' };

  function tlog() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[tomes]');
    console.log(a.join(' '));
  }

  function lookup(id) {
    if (!id) { return null; }
    try { return mp.lookupEspmRecordById(id) || null; } catch (e) { return null; }
  }
  function fieldsOf(res, type) {
    var out = [];
    var fields = (res && res.record && res.record.fields) || [];
    for (var i = 0; i < fields.length; i++) {
      if (String(fields[i].type) === type) { out.push(fields[i].data || []); }
    }
    return out;
  }
  function field(res, type) { return fieldsOf(res, type)[0] || null; }
  function u32(b, at) {
    if (!b || b.length < at + 4) { return null; }
    return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000;
  }
  function i32(b, at) {
    var n = u32(b, at);
    return n === null ? null : (n | 0);
  }
  function globalOf(res, local) {
    if (!res || typeof res.toGlobalRecordId !== 'function') { return 0; }
    try { return Number(res.toGlobalRecordId(local)) || 0; } catch (e) { return 0; }
  }

  /** School and rank out of a SPEL record: its half cost perk, then its effects. */
  function schoolAndRank(P, spellRes) {
    var perkLocal = u32(field(spellRes, 'SPIT'), 32);
    if (perkLocal) {
      var perk = lookup(globalOf(spellRes, perkLocal));
      var m = perk && perk.record ? PERK_RANK.exec(String(perk.record.editorId || '')) : null;
      if (m) { return { school: m[1].toLowerCase(), rank: PERK_WORD[m[2].toLowerCase()] }; }
    }
    var best = null;
    var efids = fieldsOf(spellRes, 'EFID');
    for (var i = 0; i < efids.length; i++) {
      var mgef = lookup(globalOf(spellRes, u32(efids[i], 0)));
      var data = field(mgef, 'DATA');
      var av = i32(data, 12);
      var level = u32(data, 40);
      if (!Object.prototype.hasOwnProperty.call(AV_SCHOOL, av) || level === null) { continue; }
      if (!best || level > best.level) { best = { school: AV_SCHOOL[av], level: level }; }
    }
    if (!best) { return null; }
    return { school: best.school, rank: P.rankForLevel(best.level) };
  }

  /** A name a person reads: the staff table's, else the record's FULL when it is plain text, else its editor id. */
  function nameOf(spellRes, desc) {
    var staff = g.__thornswoodStaffSpells;
    var st = staff && staff.STAFF_SPELLS;
    if (st && Object.prototype.hasOwnProperty.call(st, desc) && st[desc].name) { return st[desc].name; }
    var full = field(spellRes, 'FULL');
    if (full && full.length > 1) {
      var text = '';
      for (var i = 0; i < full.length && full[i]; i++) {
        if (full[i] < 32 || full[i] > 126) { text = ''; break; }
        text += String.fromCharCode(full[i]);
      }
      if (text) { return text; }
    }
    var edid = spellRes && spellRes.record && spellRes.record.editorId;
    return edid ? String(edid) : desc;
  }

  /*
    The spell a book teaches, as the rules want it: { desc, name, school,
    rank }, school null when it cannot be read, or null when the book teaches
    no spell. Memoed per book, because a record never changes under a running
    server.
  */
  var byBook = {};
  function tomeSpell(bookBaseId) {
    var key = String(bookBaseId);
    if (Object.prototype.hasOwnProperty.call(byBook, key)) { return byBook[key]; }
    var P = g.__thornswoodProgression;
    var out = null;
    var book = lookup(bookBaseId);
    var data = field(book, 'DATA');
    if (book && book.record && String(book.record.type) === 'BOOK' && data && (data[0] & TEACHES_SPELL)) {
      var spellId = globalOf(book, u32(data, 4));
      var desc = '';
      try { desc = String(mp.getDescFromId(spellId) || ''); } catch (e) { desc = ''; }
      var listed = (P && desc) ? P.spellByDesc(desc) : null;
      if (listed) {
        out = { desc: desc, name: listed.name, school: listed.school, rank: listed.rank };
      } else {
        var res = lookup(spellId);
        var sr = (P && res) ? schoolAndRank(P, res) : null;
        out = { desc: desc, name: nameOf(res, desc), school: sr ? sr.school : null, rank: sr ? sr.rank : null };
      }
    }
    byBook[key] = out;
    return out;
  }

  function word(key) { return String(key).charAt(0).toUpperCase() + String(key).slice(1); }

  /** The one line for a refusal: what the tome teaches and every one of the three that is missing. */
  function refusalLine(spell, missing) {
    var needs = missing.map(function (m) { return m.why; });
    var list = needs.length === 1 ? needs[0]
      : needs.slice(0, -1).join('; ') + '; and ' + needs[needs.length - 1];
    return 'You cannot learn ' + spell.name + ' (' + word(spell.rank) + ' ' + word(spell.school) +
           ') from this tome yet, so you keep it. You need ' + list + '.';
  }

  /** Every missing requirement in one list: 'a; b; and c'. */
  function joinNeeds(missing) {
    var needs = missing.map(function (m) { return m.why; });
    return needs.length === 1 ? needs[0]
      : needs.slice(0, -1).join('; ') + '; and ' + needs[needs.length - 1];
  }

  /*
    The tome goes when it unlocked a staff spell and the engine will not
    spend it: the engine spends a book only when it taught the spell itself
    (MpActor.cpp, spellLearned), and it does not when the character already
    knew the spell. Same helper the tools use, so the pack is written once.
  */
  function spendTome(actorId, bookBaseId) {
    try {
      if (typeof takeItemById === 'function') { return !!takeItemById(actorId, bookBaseId, 1); }
    } catch (e) {
      tlog('could not spend the tome', Number(bookBaseId).toString(16), 'of', Number(actorId).toString(16) + ':', e);
    }
    return false;
  }

  /*
    Somebody read a book. Answers null to let it read as Skyrim reads it and
    say nothing, or { refused, line }: refused true keeps the book and the
    spell away from them, and line is said either way.

    A tome of a staff spell does one more thing for one kind of reader (#1128):
    somebody a Master Enchanter taught learns it for staves under the non-mage
    rules (a place under the cap, Novice only), whether or not the Mage rules
    would have taught it, and the engine then teaches the spell and spends
    the tome as it does for anybody, because the crafting menu shows a staff
    only to somebody who holds its spell. An Enchanter is told that staves
    need no tome: they unlock the spell on K.
  */
  function read(actorId, bookBaseId) {
    var spell = tomeSpell(bookBaseId);
    if (!spell) { return null; }
    var C = g.__thornswoodCharacter;
    var P = g.__thornswoodProgression;
    var S = g.__thornswoodStaffSpells;
    if (!C || !C.stateOf || !P || !P.learnFromTome) {
      tlog('the character block is not loaded, so', spell.name, 'is taught as Skyrim teaches it');
      return null;
    }
    var s = C.stateOf(actorId);
    if (!spell.school || !spell.rank) {
      // Not the book's, since the book gives every spell it lists a school
      // and rank: refused as off the book, like any other (#1127).
      tlog('no school and rank readable for', spell.desc, '(' + spell.name + '), so it is off the book and the tome is refused to',
           Number(actorId).toString(16));
      return { refused: true, line: 'You cannot learn ' + spell.name + ' from this tome: ' + P.OFF_BOOK + '. You keep the tome.' };
    }

    var staffDesc = (S && S.isStaffSpell && spell.desc && S.isStaffSpell(spell.desc)) ? spell.desc : null;
    var fresh = !!staffDesc && !!P.knowsStaff && !P.knowsStaff(s, staffDesc);
    var outsider = fresh && !!P.staffTaught && P.staffTaught(s);
    var enchNote = (fresh && P.isEnchanter && P.isEnchanter(s))
      ? ' Staves need no tome for an Enchanter: press K and unlock ' + spell.name + ' under Staff spells.'
      : '';

    // Already in their book: nothing to spend, and the engine keeps a tome
    // whose spell the character has. Only the staff record can be new, for
    // somebody a Master Enchanter taught.
    if (P.knowsSpell(s, spell.name)) {
      if (outsider) {
        var again = S.learn(P, s, staffDesc);
        if (again.ok) {
          C.writeState(actorId, again.state);
          var gone = spendTome(actorId, bookBaseId);
          return { refused: false, line: 'You know ' + spell.name + ' already, and the tome unlocks it for staves: ' +
                   'you can bind it into a staff at a staff enchanter now.' + (gone ? ' The tome is spent.' : '') };
        }
        return { refused: false, line: 'You know ' + spell.name + ' already, and you cannot unlock it for staves yet. You need ' +
                 joinNeeds(again.missing || [{ why: again.why }]) + '.' };
      }
      return enchNote ? { refused: false, line: 'You know ' + spell.name + ' already.' + enchNote } : null;
    }

    var r = P.learnFromTome(s, spell);
    if (!r.ok) {
      tlog(Number(actorId).toString(16), 'was refused', spell.name, spell.desc + ':', r.why);
      if (outsider) {
        var st = S.learn(P, s, staffDesc);
        if (st.ok) {
          /*
            Unlocked for staves under the non-mage rules, so the engine is let
            teach the spell and spend the tome: the game's crafting menu lists
            a staff only for somebody who knows its spell (the recipe's
            HasSpell), so a staff spell nobody holds is a staff nobody sees.
            It is not written into their spell book, so it takes none of the
            places a Master mage's teaching gives.
          */
          C.writeState(actorId, st.state);
          tlog(Number(actorId).toString(16), 'unlocked', spell.name, spell.desc, 'for staves from a tome');
          return { refused: false, line: 'The tome unlocks ' + spell.name + ' for staves: you can bind it into a staff ' +
                   'at a staff enchanter now. It took one of your ' + P.TABLE.limits.outsiderSpells +
                   ' staff spell places, and the tome is spent.' };
        }
        var both = r.missing ? refusalLine(spell, r.missing)
          : 'You cannot learn ' + spell.name + ' from this tome: ' + r.why + '. You keep the tome.';
        return { refused: true, line: both + ' Nor can you unlock it for staves yet: you need ' +
                 joinNeeds(st.missing || [{ why: st.why }]) + '.' };
      }
      return { refused: true, line: (r.missing ? refusalLine(spell, r.missing)
               : 'You cannot learn ' + spell.name + ' from this tome: ' + r.why + '. You keep the tome.') + enchNote };
    }

    var next = r.state;
    var staffLine = enchNote;
    if (outsider) {
      var st2 = S.learn(P, next, staffDesc);
      if (st2.ok) {
        next = st2.state;
        staffLine = ' It is unlocked for staves too: you can bind it into a staff at a staff enchanter now.';
      } else {
        staffLine = ' It is not unlocked for staves: you need ' + joinNeeds(st2.missing || [{ why: st2.why }]) + '.';
      }
    }
    C.writeState(actorId, next);
    var raised = C.raiseLines ? C.raiseLines(actorId, r) : null;
    tlog(Number(actorId).toString(16), 'learned', spell.name, spell.desc, 'from a tome');
    return { refused: false, line: 'The tome teaches you ' + spell.name + ', ' + word(spell.rank) + ' ' +
             word(spell.school) + '. It cost a spell point.' + staffLine + (raised ? ' ' + raised : '') };
  }

  /*
    The record readers, for the college block (#1387): what kind of spell is
    on a character, and whether a spell raises the dead.
  */
  g.__thornswoodTomes = {
    tomeSpell: tomeSpell, read: read, refusalLine: refusalLine, nameOf: nameOf,
    schoolAndRank: function (spellRes) { return schoolAndRank(g.__thornswoodProgression, spellRes); },
    record: { lookup: lookup, field: field, fieldsOf: fieldsOf, u32: u32, globalOf: globalOf }
  };
})();
// ==== end thornswood spell tomes ====

