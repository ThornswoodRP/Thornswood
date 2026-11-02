// ==== thornswood college ====
/*
  THE COLLEGE, THE BOOK, A THRALL OF A PERSON, AND RESTORATION STRAIN (#1387).
  docs/systems/magic.md, docs/systems/potions.md and
  docs/systems/professions/mage/conjuration.md.

  Four rules the progression block cannot keep on its own, because each one
  needs the world: where somebody is standing, what is on their character,
  whose body a spell landed on, and when a spell was cast.

  A SEMESTER. Studying at the College hands out spell points once a
  semester; P.study holds the numbers and the clock, and keeps the moment on
  the character, so a relog or a restart does not reset it. It is taken at a
  study desk in the College halls (Patrick, 22 October 2026, A on #1387: a
  desk, not a command). Thornswood-Content.esp stands one in each of the
  four halls, the Hall of the Elements, the Hall of Countenance, the Hall of
  Attainment and the Arcanaeum, and pressing E at one is the semester
  (deskActivated, from mp.onActivate). The College page on K says where the
  desks are and when the next semester opens; it has no button for it.

  ONLY THE BOOK IS GRANTED. A spell of the five schools that the book
  (SPELLS, by its form id in SPELL_IDS) does not list is not a college spell
  and is not granted. Three doors let one in, and each is shut here:
    a tome   learnFromTome refuses it now, and the engine keeps the tome
             and takes the spell back off the client (mp.onReadBook).
    a tome, before this rule   #1026 taught them and the engine recorded
             them on the character. cleanAtLogin takes them off at the next
             login, out of the engine's own list (Actor.GetNthSpell), and
             P.bookClean takes the name out of the book and gives a mage the
             point back.
    a menu   a mod's spell menu runs inside the client's own game, so the
             server never hears of the spell until it is put in a hand: the
             equipment update names it (mp.onUpdateEquipmentAttempt). The
             engine cannot take back a spell it never recorded (Actor
             .RemoveSpell sends nothing for one), so the server tells that
             client to, through TAKE_PROPERTY, the way PICKED_PROPERTY tells
             a client to empty a plant it was given. A spawn takes it
             off as well, because the client rebuilds its spells from the
             server's list every time it spawns (remoteServer.ts).
  Kept, because none of them is a spell of the book's kind: a disease, a
  power or an ability (SPIT type), a shrine blessing, the instruments, and a
  staff spell the staff rules unlocked (staffKnown), which the staff block
  owns.

  NO THRALL OF A PERSON. Dead Thrall, Revenant and the reanimate spells used
  on a person's character are a death or a change for good, and they need
  everyone's yes (magic.md, death.md). The server has no record of a yes, so
  it refuses them on a person, every time. A spell cannot be refused before
  it lands: the engine hears a cast after the client has made it
  (ActionListener::OnSpellCast) and a hit after it has landed
  (onPapyrusEvent:OnHit). So the refusal is the server's answer to the hit:
  the caster is told, staff can read it in the log, and every machine that
  sees the body is told to put it back down (LAYDOWN_PROPERTY), which is
  what the server already holds it as. Anything the spell's effects list
  that is the game's Reanimate archetype counts, so a scroll does too. A
  body the world placed is the spell working as written.

  RESTORATION STRAIN (potions.md). Inside 30 seconds, each restoration spell
  after the first costs 25% more magicka than the last; after the fourth,
  the next is refused for 20 seconds, and stamina and health recovery sit at
  the weary cold numbers for those 20 seconds. The engine does not let the
  server refuse a cast, so the cost is the lever: each school's cost value
  (RestorationMod, the value the game's own Fortify Restoration moves,
  'spells cost X% less') goes down by what the page asks, through the
  effects map the client already applies, and while refused it goes down far
  enough that no magicka pays for a restoration spell.

  WITHERED (potions.md). Five potions in an hour, or ten restoration casts
  in an hour, sets withered for 30 real minutes: max health and max magicka
  are 80% of what they were. The map carries amounts, so the fifth taken off
  is worked out here as an amount: the engine's own most (the maneuvers
  block reads it off the race and the base, as the engine does) plus what the
  map already adds or takes off. A fortify from gear or a potion running on
  the character is not in it, because the server does not see those. The
  moment it ends is kept on the character, so a relog or a restart does not
  end it early. Waiting the 30 minutes clears it. The page's other clear, a
  cooked meal and a bed, waits for the cooked meal (#1382), which the server
  does not know yet.
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var P = g.__thornswoodProgression;
  var T = g.__thornswoodTomes;
  if (!P || !T || !T.record) { console.log('[college] the rules or the tomes block is missing, nothing registered'); return; }
  var L = P.TABLE.limits;
  var R = T.record;

  function clog() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[college]');
    console.log(a.join(' '));
  }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function hex(id) { return (Number(id) >>> 0).toString(16); }
  function now() { return Date.now(); }
  function personOf(id) {
    try { return Number(mp.get(id, 'profileId')) > 0; } catch (e) { return false; }
  }
  function idOfDesc(desc) {
    try { return Number(mp.getIdFromDesc(String(desc))) || 0; } catch (e) { return 0; }
  }
  function descOfId(id) {
    try { return String(mp.getDescFromId(id) || ''); } catch (e) { return ''; }
  }
  function char() { return g.__thornswoodCharacter || null; }
  function tell(actorId, line) {
    try { if (typeof say === 'function') { say(actorId, line); } } catch (e) { }
  }

  // ----------------------------------------------------------- the desks --
  /*
    THE STUDY DESK. Thornswood-Content.esp's activator
    ThornswoodActivatorStudyDesk, wearing Skyrim's NobleDesk01, stands in
    each hall where game/data/station-sites.json, kind study, measures it
    (scripts/dev/Build-StationSites.py, the way the stations of #2553 are
    placed). The halls are interior cells, read out of game/data/doors.json
    (the cells table there is built from the plugins by
    tools/Build-DoorTable.py), and the hall a semester is taken in is the
    one the pressed desk stands in.
  */
  var DESK_BASE = '18032:Thornswood-Content.esp';
  var HALLS = {
    '1380e:Skyrim.esm': 'the Hall of the Elements',
    '1380f:Skyrim.esm': 'the Hall of Countenance',
    'cab91:Skyrim.esm': 'the Hall of Attainment',
    '13810:Skyrim.esm': 'the Arcanaeum'
  };
  var HALL_LIST = ['the Hall of the Elements', 'the Hall of Countenance', 'the Hall of Attainment', 'the Arcanaeum'];

  /** The hall a reference stands in, as a person would say it, or '' outside the four. */
  function hallOf(refrId) {
    var cell = '';
    try { cell = String(mp.get(refrId, 'worldOrCellDesc') || ''); } catch (e) { return ''; }
    return own(HALLS, cell) ? HALLS[cell] : '';
  }

  // ---------------------------------------------------------- a semester --
  /*
    A semester at the desk deskId. Answers what P.study answers, with line,
    the words for the chat, on a yes. The rules go first, so somebody with
    no magic, or a semester that is not open yet, is told that at any desk.
  */
  function study(actorId, s, deskId) {
    var r = P.study(s, now());
    if (!r.ok) { return r; }
    var where = hallOf(deskId);
    if (!where) {
      return { ok: false, why: 'this desk is not in one of the College\'s halls' };
    }
    var left = P.spellPoints(r.state);
    var got = r.gained + (r.gained === 1 ? ' spell point' : ' spell points');
    r.line = 'A semester at the College, in ' + where + ': ' + got +
      (r.school ? ', for a Novice spell of ' + r.school.charAt(0).toUpperCase() + r.school.slice(1) + ' from its tome' : '') +
      '. ' + (left ? 'You have ' + left + ' to spend.'
                   : 'You have none to spend: you hold ' + L.outsiderSpells + ' spells, the most anybody who is not a Mage holds.') +
      ' The next semester opens in ' + L.semesterHours + ' hours.';
    clog(hex(actorId), 'studied in', where, '+' + r.gained);
    return r;
  }

  /*
    A press in the world (mp.onActivate). Answers null for anything that is
    not a study desk, which goes on down the chain; for a desk, the line to
    say to the person who pressed it, the semester or why not. A yes is
    written to the character, which tells the K panel the next semester's
    clock; a refusal changes nothing.
  */
  function deskActivated(refrId, actorId, baseDesc) {
    if (String(baseDesc || '') !== DESK_BASE) { return null; }
    var C = char();
    if (!C || !C.stateOf || !C.writeState) { return 'The College is not running on this server right now.'; }
    var r = study(actorId, C.stateOf(actorId), refrId);
    if (!r.ok) { return 'No: ' + r.why + '.'; }
    r.state.note = null;
    C.writeState(actorId, r.state);
    return r.line;
  }

  /** What the College page on K draws, or null for somebody magic is not open to. */
  function view(s) {
    if (!s) { return null; }
    var mage = s.prof === 'mage';
    var schools = P.schoolsOf(s);
    if (!schools.length) { return null; }
    return {
      gain: mage ? L.collegeSemester : L.outsiderSemester,
      school: mage ? null : schools[0],
      opens: P.semesterOpens(s),
      hours: L.semesterHours,
      halls: HALL_LIST.slice()
    };
  }

  // ------------------------------------------------------- only the book --
  var SPELL_TYPE = 0;   // SPIT type: 0 a spell, 1 a disease, 2 a power, 3 a lesser power, 4 an ability

  /*
    What a SPEL record is: { name, type, school }, school null when it is not
    one of the five. Memoed by id, because a record never changes under a
    running server.
  */
  var kinds = {};
  function spellKind(id) {
    var key = String(id);
    if (own(kinds, key)) { return kinds[key]; }
    var out = null;
    var res = R.lookup(id);
    if (res && res.record && String(res.record.type) === 'SPEL') {
      var sr = T.schoolAndRank(res);
      var t = R.u32(R.field(res, 'SPIT'), 8);
      out = { name: T.nameOf(res, descOfId(id)), type: t === null ? -1 : t, school: sr ? sr.school : null };
    }
    kinds[key] = out;
    return out;
  }

  /** True when this spell on this character is one the book does not grant. */
  function offBook(s, desc, kind) {
    if (!kind || kind.type !== SPELL_TYPE || !kind.school) { return false; }
    if (P.spellByDesc(desc)) { return false; }
    if (P.staffKnown && P.staffKnown(s).indexOf(desc) !== -1) { return false; }
    if (typeof INSTRUMENT_SPELL !== 'undefined' && String(INSTRUMENT_SPELL).toLowerCase() === String(desc).toLowerCase()) { return false; }
    return true;
  }

  var TAKE_PROPERTY = 'thornswoodTakeSpell';

  /*
    Edge triggered on v.at through ctx.state, because updateOwner runs every
    frame (see SWING_PROPERTY): one removal per order, never a loop. The
    stamp is kept only once the character was there to take it from.
  */
  function takeScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || !v.at || !v.ids || !v.ids.length) { return; }',
      '    var st = ctx.state;',
      '    if (!st || st.thornswoodTakeAt === v.at) { return; }',
      '    var sp = ctx.sp;',
      '    var pc = sp.Game.getPlayer();',
      '    if (!pc) { return; }',
      '    st.thornswoodTakeAt = v.at;',
      '    for (var i = 0; i < v.ids.length; i++) {',
      '      var spell = sp.Spell.from(sp.Game.getFormEx(v.ids[i]));',
      '      if (spell && pc.hasSpell(spell)) { pc.removeSpell(spell); }',
      '    }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  /*
    At login, once (grantKnown calls this before it puts the book back on):
    the book's names first, then what the engine holds on the character.
    Answers the descs taken off.
  */
  function cleanAtLogin(actorId) {
    var C = char();
    if (!C || !C.stateOf) { return []; }
    var s = C.stateOf(actorId);
    var book = P.bookClean(s);
    if (book.removed.length) {
      C.writeState(actorId, book.state);
      s = book.state;
      clog(hex(actorId), 'book: took out', book.removed.join(', '));
    }
    var self = { type: 'form', desc: descOfId(actorId) };
    var count = 0;
    try { count = Number(mp.callPapyrusFunction('method', 'Actor', 'GetSpellCount', self, [])) || 0; }
    catch (e) { clog(hex(actorId), 'could not read the spells on the character:', e); count = 0; }
    var gone = [], names = [];
    for (var i = 0; i < count; i++) {
      var r = null;
      try { r = mp.callPapyrusFunction('method', 'Actor', 'GetNthSpell', self, [i]); } catch (e) { r = null; }
      var desc = (r && r.desc) ? String(r.desc) : '';
      var id = desc ? idOfDesc(desc) : 0;
      var kind = id ? spellKind(id) : null;
      if (id && offBook(s, desc, kind)) { gone.push(desc); names.push(kind.name); }
    }
    for (var j = 0; j < gone.length; j++) {
      if (typeof spellOn === 'function') { spellOn(actorId, gone[j], false); }
    }
    if (gone.length) { clog(hex(actorId), 'took off', gone.join(', ')); }
    var told = book.removed.concat(names.filter(function (n) { return book.removed.indexOf(n) === -1; }));
    if (told.length) {
      tell(actorId, told.join(', ') + (told.length === 1 ? ' is' : ' are') + ' not in the College\'s book, so ' +
           (told.length === 1 ? 'it was' : 'they were') + ' taken back. Only the book\'s spells are granted here' +
           (s.prof === 'mage' && book.removed.length ? ', and the spell points they cost are yours again.' : '.'));
    }
    // An order from the last session is done with: the client rebuilt its
    // spells from the server's list when it spawned. Cleared so it never
    // replays.
    var order = null;
    try { order = mp.get(actorId, TAKE_PROPERTY); } catch (e) { order = null; }
    if (order && order.at) {
      try { mp.set(actorId, TAKE_PROPERTY, { ids: [], at: 0 }); } catch (e) { }
    }
    return gone;
  }

  /*
    What is in somebody's hands, every time their equipment changes. Only
    the two hands: a spell of the book's kind is cast from a hand, and the
    voice slot holds powers. An update with the same two spells as the last
    is one comparison.
  */
  var inHands = {};
  function equipped(actorId, eq) {
    if (!eq || typeof eq !== 'object') { return; }
    var ids = [Number(eq.leftSpell) || 0, Number(eq.rightSpell) || 0];
    var key = ids.join(',');
    if (inHands[actorId] === key) { return; }
    inHands[actorId] = key;
    if ((!ids[0] && !ids[1]) || !personOf(actorId)) { return; }
    var C = char();
    if (!C || !C.stateOf) { return; }
    var s = C.stateOf(actorId);
    var take = [], names = [];
    for (var i = 0; i < ids.length; i++) {
      if (!ids[i] || take.indexOf(ids[i]) !== -1) { continue; }
      var desc = descOfId(ids[i]);
      var kind = desc ? spellKind(ids[i]) : null;
      if (desc && offBook(s, desc, kind)) { take.push(ids[i]); names.push(kind.name); }
    }
    if (!take.length) { return; }
    try { mp.set(actorId, TAKE_PROPERTY, { ids: take, at: now() }); } catch (e) { clog(hex(actorId), 'could not order', names.join(', '), 'taken back:', e); return; }
    clog(hex(actorId), 'held', names.join(', '), 'from outside the book; taken back');
    tell(actorId, names.join(' and ') + (names.length === 1 ? ' is' : ' are') + ' not in the College\'s book, so ' +
         (names.length === 1 ? 'it is' : 'they are') + ' taken back. Only the book\'s spells are granted here.');
  }

  // -------------------------------------------------- no thrall of a person --
  var REANIMATE = 22;   // MGEF DATA archetype at offset 0x40 (libespm MGEF.h): Reanimate

  /*
    Does this spell, scroll or staff raise the dead: any of its effects is the
    Reanimate archetype. A staff's effects are its enchantment's (EITM).
    Memoed by id.
  */
  var raises = {};
  function reanimates(id) {
    var key = String(id);
    if (own(raises, key)) { return raises[key]; }
    var out = false;
    var res = R.lookup(id);
    var type = res && res.record ? String(res.record.type) : '';
    if (type === 'WEAP') {
      var ench = R.u32(R.field(res, 'EITM'), 0);
      res = ench ? R.lookup(R.globalOf(res, ench)) : null;
      type = res && res.record ? String(res.record.type) : '';
    }
    if (type === 'SPEL' || type === 'SCRL' || type === 'ENCH') {
      var efids = R.fieldsOf(res, 'EFID');
      for (var i = 0; i < efids.length && !out; i++) {
        var mgef = R.lookup(R.globalOf(res, R.u32(efids[i], 0)));
        out = R.u32(R.field(mgef, 'DATA'), 0x40) === REANIMATE;
      }
    }
    raises[key] = out;
    return out;
  }

  var LAYDOWN_PROPERTY = 'thornswoodLaidDown';

  /*
    On every machine that sees the body: put it back down, once per order,
    and only while the server holds it dead (ctx.get('isDead') is the
    server's word). The same two calls the client's own death sync makes for
    somebody else's body (deathService.ts, killActor).
  */
  function laydownScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || !v.at) { return; }',
      '    var st = ctx.state;',
      '    if (!st || st.thornswoodLaidAt === v.at) { return; }',
      '    if (!ctx.get("isDead")) { return; }',
      '    var a = ctx.sp.Actor.from(ctx.refr);',
      '    if (!a) { return; }',
      '    st.thornswoodLaidAt = v.at;',
      '    if (!a.isDead()) { a.endDeferredKill(); a.kill(null); }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  /*
    Every hit, from the one OnHit handler. A reanimate spell on a person's
    body is refused: the body goes back down and the caster is told. Answers
    true when it refused.
  */
  function hit(targetId, aggressor, source) {
    var srcId = (source && source.desc) ? idOfDesc(source.desc) : 0;
    if (!srcId || !reanimates(srcId)) { return false; }
    var target = Number(targetId) || 0;
    if (!target || !personOf(target)) { return false; }
    var caster = (aggressor && aggressor.desc) ? idOfDesc(aggressor.desc) : 0;
    var book = P.spellByDesc(source.desc);
    var name = book ? book.name : 'That spell';
    try { mp.set(target, LAYDOWN_PROPERTY, { at: now() }); } catch (e) { clog('could not lay down', hex(target) + ':', e); }
    clog(caster ? hex(caster) : 'something', 'cast', name, '(' + source.desc + ') on the body of', hex(target), '- refused, a person');
    if (caster && personOf(caster)) {
      tell(caster, name + ' does not take a person. Raising somebody\'s character is a death or a change for good, ' +
           'and it needs everyone\'s yes out of character first, so the body stays down.');
    }
    return true;
  }

  // ------------------------------------------------- restoration strain --
  /*
    potions.md, Restoration strain, and the weary cold row of
    temperature.md for the 20 seconds (TEMP_COST.cold.weary in the needs
    block: -20 stamina recovery, which the page applies to health recovery
    too).
  */
  var STRAIN = {
    window: 30,      // seconds from the first restoration cast
    rise: 0.25,      // each one after the first costs this much more than the last
    casts: 4,        // the fifth inside the window is refused
    refused: 20,     // seconds
    weary: -20,      // stamina and health recovery, percent, while refused
    shut: 1000000    // RestorationMod while refused: costs 10001 times as much
  };

  var strain = {};   // actorId -> { start, n, until }

  /* The book's school when the book lists it, else the record's. Memoed by id. */
  var restoration = {};
  function isRestoration(id) {
    var key = String(id);
    if (own(restoration, key)) { return restoration[key]; }
    var desc = descOfId(id);
    var book = desc ? P.spellByDesc(desc) : null;
    var kind = book ? null : spellKind(id);
    restoration[key] = book ? book.school === 'restoration'
      : (!!kind && kind.type === SPELL_TYPE && kind.school === 'restoration');
    return restoration[key];
  }

  /** What the strain and withered put on the client's map now, or null.
      before is the map so far, which withered takes its share of. */
  function effects(actorId, at, before) {
    var t = at || now();
    var strained = strainEffects(actorId, t);
    var withered = witheredEffects(actorId, t, before);
    if (!strained) { return withered; }
    if (!withered) { return strained; }
    for (var k in withered) { if (own(withered, k)) { strained[k] = withered[k]; } }
    return strained;
  }

  function strainEffects(actorId, t) {
    var rec = own(strain, actorId) ? strain[actorId] : null;
    if (!rec) { return null; }
    // A refusal that has run its 20 seconds ends the window with it.
    if (rec.until) {
      return rec.until > t ? { RestorationMod: -STRAIN.shut, staminaRateMult: STRAIN.weary, healRateMult: STRAIN.weary } : null;
    }
    if (rec.n > 0 && t < rec.start + STRAIN.window * 1000) {
      return { RestorationMod: -Math.round((Math.pow(1 + STRAIN.rise, rec.n) - 1) * 10000) / 100 };
    }
    return null;
  }

  function push(actorId) {
    var C = char();
    if (!C || !C.writeState || !C.stateOf) { return; }
    try { C.writeState(actorId, C.stateOf(actorId), true); } catch (e) { clog('could not redraw', hex(actorId) + ':', e); }
  }

  /*
    Every cast, from the OnSpellCast handler. Only a person's, and only a
    restoration spell. The window and the refusal each end on their own
    clock, and the map is written again when they do. A restart ends both,
    and the view a person gets when they come back is worked out then
    (arrival in the character block, #1642).
  */
  function cast(casterId, spell, at) {
    var actorId = Number(casterId) || 0;
    var id = (spell && spell.desc) ? idOfDesc(spell.desc) : 0;
    if (!actorId || !id || !personOf(actorId) || !isRestoration(id)) { return null; }
    var t = at || now();
    // Every restoration cast counts towards withered, refused or not.
    witherCount(actorId, 'cast', t);
    var rec = own(strain, actorId) ? strain[actorId] : null;
    if (rec && rec.until > t) {
      clog(hex(actorId), 'cast', spell.desc, 'while restoration is refused; the cost did not stop it');
      return rec;
    }
    if (!rec || rec.until || t >= rec.start + STRAIN.window * 1000) {
      rec = strain[actorId] = { start: t, n: 0, until: 0 };
      setTimeout(guardOf('strainWindow', function () {
        if (strain[actorId] === rec && !rec.until) { delete strain[actorId]; push(actorId); }
      }), STRAIN.window * 1000 + 50);
    }
    rec.n++;
    if (rec.n >= STRAIN.casts) {
      rec.until = t + STRAIN.refused * 1000;
      clog(hex(actorId), 'restoration refused for', STRAIN.refused, 'seconds after', rec.n, 'casts');
      tell(actorId, 'Your restoration is strained: for ' + STRAIN.refused + ' seconds no restoration spell takes, ' +
           'and your stamina and health come back slower.');
      setTimeout(guardOf('strainRefused', function () {
        if (strain[actorId] === rec) { delete strain[actorId]; push(actorId); }
      }), STRAIN.refused * 1000 + 50);
    }
    push(actorId);
    return rec;
  }

  function guardOf(name, fn) { return (typeof guard === 'function') ? guard(name, fn) : fn; }

  // ------------------------------------------------------------ withered --
  var WITHERED = {
    hour: 60,        // minutes the count looks back over
    potions: 5,      // potions in that hour
    casts: 10,       // restoration casts in that hour
    minutes: 30,     // real minutes it lasts
    share: 0.8       // of max health and max magicka, while it lasts
  };
  var WITHERED_PROPERTY = 'thornswoodWithered';
  var witherTimers = {};   // actorId -> the timer that ends it, in this process

  function witheredRead(actorId) {
    var rec = null;
    try { rec = mp.get(actorId, WITHERED_PROPERTY); } catch (e) { rec = null; }
    if (!rec || typeof rec !== 'object') { rec = {}; }
    return {
      drank: Array.isArray(rec.drank) ? rec.drank.filter(isFinite) : [],
      cast: Array.isArray(rec.cast) ? rec.cast.filter(isFinite) : [],
      until: Number(rec.until) || 0
    };
  }

  function witheredWrite(actorId, rec) {
    try { mp.set(actorId, WITHERED_PROPERTY, rec); } catch (e) { clog('could not write withered for', hex(actorId) + ':', e); }
  }

  /** True while this person is withered. */
  function isWithered(actorId, at) {
    return witheredRead(actorId).until > (at || now());
  }

  /* The end of it, on its own clock, and the map written again when it comes. */
  function armWithered(actorId, until) {
    if (witherTimers[actorId] && witherTimers[actorId].until === until) { return; }
    var mine = { until: until };
    witherTimers[actorId] = mine;
    setTimeout(guardOf('witheredEnds', function () {
      if (witherTimers[actorId] !== mine) { return; }
      delete witherTimers[actorId];
      if (witheredRead(actorId).until > now()) { return; }
      clog(hex(actorId), 'is no longer withered');
      tell(actorId, 'The withering has passed. Your health and magicka are your own again.');
      push(actorId);
    }), Math.max(0, until - now()) + 50);
  }

  /*
    One potion or one restoration cast, counted against the hour. The fifth
    potion or the tenth cast inside an hour sets withered for 30 minutes from
    that moment, and the counts start again from nothing.
  */
  function witherCount(actorId, kind, at) {
    var t = at || now();
    var rec = witheredRead(actorId);
    var since = t - WITHERED.hour * 60000;
    rec.drank = rec.drank.filter(function (x) { return x > since && x <= t; });
    rec.cast = rec.cast.filter(function (x) { return x > since && x <= t; });
    rec[kind].push(t);
    var set = rec.drank.length >= WITHERED.potions || rec.cast.length >= WITHERED.casts;
    if (set) {
      rec.until = t + WITHERED.minutes * 60000;
      rec.drank = [];
      rec.cast = [];
    }
    witheredWrite(actorId, rec);
    if (set) {
      clog(hex(actorId), 'is withered for', WITHERED.minutes, 'minutes after', kind === 'drank' ? 'a fifth potion' : 'a tenth restoration cast', 'in an hour');
      tell(actorId, 'You are withered: ' + (kind === 'drank' ? 'five potions' : 'ten restoration spells') +
           ' in an hour. For ' + WITHERED.minutes + ' minutes your health and magicka are four fifths of what they were.');
      armWithered(actorId, rec.until);
      push(actorId);
    }
    return rec;
  }

  /*
    A potion drunk, from the one onEatItem handler (the injury block's), which
    the engine raises once it has checked the pack holds it. Only a person's,
    and only a potion: the needs block's table says which, and a brewed one is
    a form only the brewer's game has, above the runtime line, which the
    needs block counts as a potion too. Food, drink, ale and a poison are not.
  */
  function drank(actorId, baseId, at) {
    var id = Number(actorId) || 0;
    var base = Number(baseId) || 0;
    if (!id || !base || !personOf(id)) { return null; }
    var N = g.__thornswoodNeeds;
    var kind = (N && N.kindOf) ? N.kindOf(base) : '';
    if (!kind && base >= 0xff000000) { kind = 'potion'; }
    if (kind !== 'potion') { return null; }
    return witherCount(id, 'drank', at);
  }

  /*
    What withered takes off, as amounts on the map. before is the map the
    other blocks have folded so far, which is what "what they were" means
    here: the engine's most plus the tree, the needs and the rest.
  */
  function witheredEffects(actorId, at, before) {
    if (!isWithered(actorId, at)) { return null; }
    var M = g.__thornswoodManeuvers;
    if (!M || !M.engineMost) { clog('withered: the maneuvers block is not loaded, so the most cannot be read'); return null; }
    var out = {};
    ['health', 'magicka'].forEach(function (av) {
      var most = Number(M.engineMost(actorId, av)) || 0;
      var had = most + ((before && typeof before[av] === 'number') ? before[av] : 0);
      if (!(most > 0) || !(had > 0)) { return; }
      out[av] = -Math.round(had * (1 - WITHERED.share) * 100) / 100;
    });
    return Object.keys(out).length ? out : null;
  }

  /*
    At login: a withering that is still running gets its end armed in this
    process, so a restart does not leave it on past its 30 minutes.
  */
  function witheredAtLogin(actorId) {
    var rec = witheredRead(actorId);
    if (rec.until > now()) { armWithered(actorId, rec.until); }
  }

  // ------------------------------------------------------------ register --
  try {
    mp.makeProperty(TAKE_PROPERTY, {
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: takeScript(),
      updateNeighbor: ''
    });
    mp.makeProperty(LAYDOWN_PROPERTY, {
      isVisibleByOwner: false,
      isVisibleByNeighbors: true,
      updateOwner: '',
      updateNeighbor: laydownScript()
    });
  } catch (e) {
    // already made by a previous load; a changed script needs a restart,
    // which a deploy is.
  }
  try {
    // The server's own record of withered: nobody's client reads it.
    mp.makeProperty(WITHERED_PROPERTY, {
      isVisibleByOwner: false, isVisibleByNeighbors: false,
      updateOwner: '', updateNeighbor: ''
    });
  } catch (e) {
    // already made by a previous load; a changed script needs a restart,
    // which a deploy is.
  }

  g.__thornswoodCollege = {
    HALLS: HALLS, DESK_BASE: DESK_BASE, STRAIN: STRAIN, REANIMATE: REANIMATE,
    TAKE_PROPERTY: TAKE_PROPERTY, LAYDOWN_PROPERTY: LAYDOWN_PROPERTY,
    hallOf: hallOf, study: study, deskActivated: deskActivated, view: view,
    spellKind: spellKind, offBook: offBook, cleanAtLogin: cleanAtLogin, equipped: equipped,
    reanimates: reanimates, hit: hit,
    isRestoration: isRestoration, cast: cast, effects: effects, strain: strain,
    WITHERED: WITHERED, WITHERED_PROPERTY: WITHERED_PROPERTY, drank: drank, isWithered: isWithered,
    witheredAtLogin: witheredAtLogin,
    takeScript: takeScript, laydownScript: laydownScript
  };
  clog('ready');
})();

/*
  What somebody holds, every time it changes (#1387): a spell the book does
  not list is taken back, in the college block. It returns nothing: the
  engine has already decided by the time this fires, and its OnFireBlocked
  is not written, so a false here would only log a warning.
*/
mp.onUpdateEquipmentAttempt = guard('onUpdateEquipmentAttempt', function (actorId, equipment) {
  var college = globalThis.__thornswoodCollege;
  if (college && college.equipped) { college.equipped(actorId, equipment); }
  // A pair of Prisoner's Cuffs put on facing somebody (#2573), on an engine
  // without onEquipItemAttempt. See the cuffs block.
  var cuffsEq = globalThis.__thornswoodCuffs;
  if (cuffsEq && cuffsEq.equipped) { cuffsEq.equipped(actorId, equipment); }
});
// ==== end thornswood college ====

