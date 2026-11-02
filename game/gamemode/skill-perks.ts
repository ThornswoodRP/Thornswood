// ==== thornswood skill perks ====
/*
  THE FILLED PERKS OF THE SKILL TREE (#1385).

  docs/systems/skill-tree.md is the table. Five points fill a sub-skill and a
  filled one grants its perk. Which perks somebody holds is never stored: it
  is P.perks over the tree, so the points are the whole of it. What is stored
  is when a perk that waits may fire again, and that is this block's.

  WHAT EACH ONE DOES HERE, AND WHAT THE SERVER CANNOT DO.
    Cheat Death        The engine asks mp.onDying before a write that takes
                       health to nothing kills, before anything is sent
                       (#1626, skymp #101). cheatDeath() is the answer: once a
                       day it refuses the death and names the share of the
                       most that is 1 health, and the engine keeps them there.
                       Nobody sees a death, because none was sent.
    Troll's Blood      During a fight, 2 health a second, through the engine's
                       own Actor.RestoreActorValue, so in the engine's own
                       units, the ones every blow is dealt in. A fight is a hit
                       landed or taken, or health falling, in the last 15
                       seconds: the signs and the 15 seconds /stuck reads.
    Devastating Blow   A power attack takes a quarter again of what it took,
                       measured the way the maneuvers measure a Heavy blow.
    Unshakeable        Nothing staggers you while you block. A stagger is an
                       animation on your own machine, so the front plugin
                       refuses it there (thornswood-front.js, the filled
                       perks on this machine), and the maneuvers block's
                       staggerOf refuses the server's own Break and Wreck.
    Purified Blood     The game's own disease and poison resistance, through
                       the tree's totals (TUNING.perkApplies). A disease the
                       server itself gives asks holds(actorId, 'purifiedblood').
    Archmage's Vessel  Once a day, magicka under a tenth is set to half.
    Leyline Attunement While magicka is falling, which is the one sign of a
                       cast the server holds, it comes back at half the usual
                       rate: the race's own rate (RACE DATA, as the engine
                       reads it) raised by the tree's Clarity, as the client
                       raises it.
    Overcharge         Every fifth spell of yours that takes health takes as
                       much again. And every fifth spell of yours that holds
                       (one you cast and let go, with an effect that lasts a
                       time and none that takes health: a ward of flesh, a
                       light, a fear) holds twice as long. A spell's effects
                       run on the machine that runs the actor they land on,
                       so the engine fork counts those on your own machine
                       (setCastDurationEvery, which the front plugin sets
                       while Overcharge is held) and the cast says how long
                       it holds. The server counts the same casts by the same
                       rule (holdsLonger below) and answers onSpellCast with
                       how long it holds on everybody else's machine, so a
                       client's word alone holds nothing longer for anybody
                       (THE CASTS THAT HOLD, below). Two counts: a spell that
                       takes health never holds longer, and one that holds
                       never deals double.
    Spellbreaker       A spell that hits you gives you a fifth of what it
                       costs, its SPIT cost as the record carries it. A
                       concentration spell's cost is a second of it, so it
                       counts once a second.
    Font of Magic      Once a day, from the Use button beside it on the K
                       panel: for 15 seconds each school's cost value (<School>Mod, the value the game's own
                       Fortify <School> enchantments raise, a percent off what
                       a spell costs) is 100 more, which is the game itself
                       making a spell free. It rides the totals map the client
                       already applies, the way a warrior's Rush does, through
                       effects() below and withPerks in the character block.
                       So the game never takes the magicka at all, and a spell
                       you could not have afforded can be cast.
    Tireless           What a sprint, a power attack and a shield bash cost
                       is the game's own sum on your own machine, so the front
                       plugin holds those game settings at half there. A bash
                       counts as a swing (Patrick, 12 Oct). Running and a
                       plain swing cost nothing in this game.
    Second Wind        Stamina that reaches nothing fills, once every 5
                       minutes.
    Windwalker         +4 speed, through the tree's totals. The fall is the
                       game's own sum on your own machine, so the front plugin
                       holds its multiplier at nothing there.
    Pack Mule          Being overloaded makes the game walk you, on your own
                       machine, and no game setting changes that. So the
                       engine fork's client keeps a list of characters the
                       game does not hold to their carry weight (Patrick, 12
                       Oct: the engine change), and the front plugin puts your
                       own character on it while Pack Mule is held. Nothing
                       here reads carry weight.
    Lethal Aim         An arrow or a bolt takes what it would have taken
                       against half the armour: the engine's own armour sum
                       (TES5DamageFormula, worn ARMO and their enchantments),
                       worked again with half of it.

  PRECISION. The client puts critical chance on the character and nothing
  reads it. The server works out every blow in TES5DamageFormula, and there is
  no critical hit in that sum at all. So the answer to a point put in
  Precision says so, and nothing here calls a hit a critical one.

  NOTHING HERE IS A COMMAND (Patrick, 4 Oct: things people do are buttons and
  GUI, not chat commands). Font of Magic, the one perk a person starts, is the
  Use button beside it on the K panel. The panel sends 'skills:pick perk
  fontofmagic', which reaches the server as /pick perk fontofmagic, the route
  every other press on that panel travels, and no person is told to type it.
  What a waiting perk's clock says is on the panel too: perkClocks in the
  character block's view, out of clocks() below.

  THE CLOCKS LIVE ON THE CHARACTER, in PERK_PROPERTY, and the clock is written
  before the perk fires. A restart or a relog reads the same clock, and a
  clock that cannot be written does not fire, so nothing fires twice. A day is
  24 real hours from the moment it fired. Font of Magic's 15 seconds are
  not kept: its end is a timer in memory, and a restart ends it. The day it
  spent is still spent. The view a person gets when they come back is worked
  out then (arrival in the character block, #1642), so the free spells are
  not on it; the same for a warrior's Rush and restoration strain.

  EVERY TIME ONE FIRES it is a line in thornswood.log, "perks: <name> fired
  for <actor>", which is the record the page asks for. Troll's Blood and
  Leyline Attunement say it once a fight and once a cast, not every second.

  STACKING. A Devastating Blow and a warrior's Heavy on one blow each take
  their quarter of what the blow took before them, so they multiply. The two
  blocks measure the same blow one after the other.
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var P = g.__thornswoodProgression;
  if (!P) { console.log('[thornswood perks] the rules block is missing, nothing registered'); return; }

  var PERK_PROPERTY = 'thornswoodPerks';
  var SECOND = 1000;
  var MINUTE = 60 * SECOND;
  var DAY = 24 * 60 * MINUTE;
  var FIGHT_MS = 15 * SECOND;     // the 15 seconds /stuck counts as a fight
  var TICK_MS = 250;
  var HELD_MS = 2000;             // how long who holds what is trusted

  /*
    The page's table, one row a perk. say is the page's own sentence; not is
    what of it the game does not do yet, said wherever the perk is named, and
    none marks a perk of which nothing is in the game yet.
  */
  var PERKS = {
    cheatdeath:        { name: 'Cheat Death', skill: 'vitality', every: DAY, health: 1,
                         say: 'Once a day, the blow that would kill you leaves you at 1 health.' },
    trollsblood:       { name: 'Troll\'s Blood', skill: 'fortitude', perSecond: 2,
                         say: 'During a fight, health returns at 2 a second.' },
    devastatingblow:   { name: 'Devastating Blow', skill: 'might', more: 0.25,
                         say: 'A power attack deals 25% more.' },
    unshakeable:       { name: 'Unshakeable', skill: 'resilience',
                         say: 'Nothing staggers you while you block.' },
    purifiedblood:     { name: 'Purified Blood', skill: 'toughness',
                         say: 'Disease does not take. Poison deals 25%.' },
    archmagesvessel:   { name: 'Archmage\'s Vessel', skill: 'capacity', every: DAY, below: 0.1, to: 0.5,
                         say: 'Drop below a tenth of magicka and it returns to half, once a day.' },
    leylineattunement: { name: 'Leyline Attunement', skill: 'clarity', rate: 0.5,
                         say: 'Magicka still returns while you cast, at half the usual rate.' },
    overcharge:        { name: 'Overcharge', skill: 'potency', inEvery: 5, more: 1, longer: 2,
                         say: 'One spell in five deals double, or holds twice as long.' },
    spellbreaker:      { name: 'Spellbreaker', skill: 'ward', share: 0.2,
                         say: '20% of the magicka in a spell that hits you is added to yours.' },
    fontofmagic:       { name: 'Font of Magic', skill: 'efficiency', every: DAY, seconds: 15, costOff: 100,
                         say: 'Once a day, 15 seconds where a spell costs nothing. Press Use beside it on the K panel to start it.' },
    tireless:          { name: 'Tireless', skill: 'endurance',
                         say: 'Running and swinging cost half stamina.' },
    secondwind:        { name: 'Second Wind', skill: 'vigor', every: 5 * MINUTE,
                         say: 'When stamina hits 0 it fills, once every 5 minutes.' },
    windwalker:        { name: 'Windwalker', skill: 'agility',
                         say: '+4 speed, and a fall deals no damage.' },
    packmule:          { name: 'Pack Mule', skill: 'burden',
                         say: 'Being overloaded does not slow you.' },
    lethalaim:         { name: 'Lethal Aim', skill: 'precision', armour: 0.5,
                         say: 'An arrow ignores half the armour it hits.' }
  };
  var ORDER = ['cheatdeath', 'trollsblood', 'devastatingblow', 'unshakeable', 'purifiedblood',
               'archmagesvessel', 'leylineattunement', 'overcharge', 'spellbreaker', 'fontofmagic',
               'tireless', 'secondwind', 'windwalker', 'packmule', 'lethalaim'];

  var CRIT_LINE = 'Critical chance is put on your character, and the game ignores it: the server ' +
                  'works out what every blow deals and there is no critical hit in that.';

  function plog() {
    var a = Array.prototype.slice.call(arguments);
    var line = 'perks: ' + a.join(' ');
    if (typeof log === 'function') { log(line); } else { console.log('[thornswood] ' + line); }
  }
  // say() is the file's own: it finds the profile and posts the line, and
  // answers nothing when there is nobody to tell.
  function tell(actorId, text) { say(actorId, text); }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function hex(id) { return (Number(id) >>> 0).toString(16); }
  function now() { return Date.now(); }
  function selfOf(id) { return { type: 'form', desc: mp.getDescFromId(id) }; }
  function personOf(id) {
    try { return Number(mp.get(id, 'profileId')) > 0; } catch (e) { return false; }
  }
  function deadOf(id) {
    try { return !!mp.get(id, 'isDead'); } catch (e) { return true; }
  }
  function pct(id) {
    try {
      var p = mp.get(id, 'percentages');
      if (!p) { return null; }
      var out = { health: Number(p.health), magicka: Number(p.magicka), stamina: Number(p.stamina) };
      return (isNaN(out.health) || isNaN(out.magicka) || isNaN(out.stamina)) ? null : out;
    } catch (e) { return null; }
  }
  function setPct(id, health, magicka, stamina) {
    try {
      mp.set(id, 'percentages', { health: health, magicka: magicka, stamina: stamina });
      return true;
    } catch (e) {
      plog('could not write the percentages of', hex(id) + ':', e);
      return false;
    }
  }
  /* The engine's own Actor.RestoreActorValue: an amount in the engine's units. */
  function restore(id, what, amount) {
    try {
      mp.callPapyrusFunction('method', 'Actor', 'RestoreActorValue', selfOf(id), [what, amount]);
      return true;
    } catch (e) {
      plog('could not restore', what, 'on', hex(id) + ':', e);
      return false;
    }
  }
  function wait(ms) {
    var s = Math.max(1, Math.ceil(ms / 1000));
    if (s < 120) { return s + (s === 1 ? ' second' : ' seconds'); }
    var m = Math.ceil(s / 60);
    if (m < 120) { return m + ' minutes'; }
    return Math.ceil(m / 60) + ' hours';
  }

  // ------------------------------------------------------ who holds what --
  function stateOf(id) {
    var ch = g.__thornswoodCharacter;
    return (ch && ch.stateOf) ? ch.stateOf(id) : null;
  }
  function heldIn(s) {
    var out = {};
    if (!s) { return out; }
    var list = P.perks(s);
    for (var i = 0; i < list.length; i++) { if (has(PERKS, list[i])) { out[list[i]] = true; } }
    return out;
  }

  /*
    The runtime half, on globalThis so a hot reload keeps it. Nothing in here
    is a clock that matters across a restart: those are on the character.
      held   actor -> { at, keys, rate }   who holds what, read every HELD_MS
      last   actor -> { h, m, at }         the shares last seen, for the tick
      fight  actor -> when they last hit, were hit, or lost health
      font   actor -> { until }            a Font of Magic that is running
      troll  actor -> { at, said }         Troll's Blood's second, and its fight
      ley    actor -> when Leyline Attunement last gave
      spells actor -> how many spells of theirs have landed towards Overcharge
      holding actor -> how many casts of theirs that hold, towards Overcharge
      sb     'target:caster:spell' -> when a concentration spell last gave
      blow   actor -> { by, at }           whose blow, when this block's write killed
  */
  var ST = g.__thornswoodPerkState;
  if (!ST || typeof ST !== 'object') {
    ST = g.__thornswoodPerkState = { held: {}, last: {}, fight: {}, font: {}, troll: {}, ley: {},
                                     spells: {}, holding: {}, sb: {}, blow: {} };
  }
  if (!ST.holding || typeof ST.holding !== 'object') { ST.holding = {}; }

  function heldOf(id, t) {
    var c = ST.held[id];
    if (c && t - c.at < HELD_MS) { return c.keys; }
    var s = personOf(id) ? stateOf(id) : null;
    var keys = heldIn(s);
    var rate = 0;
    if (keys.leylineattunement) { rate = Number(P.treeApplies(s).magickaRateMult) || 0; }
    ST.held[id] = { at: t, keys: keys, rate: rate };
    return keys;
  }

  /** Does this character hold that perk right now. Read fresh, for any block. */
  function holds(actorId, key) {
    if (!actorId || !has(PERKS, key) || !personOf(actorId)) { return false; }
    return !!heldIn(stateOf(actorId))[key];
  }

  // ------------------------------------------------------------- the clocks --
  try {
    mp.makeProperty(PERK_PROPERTY, {
      isVisibleByOwner: false, isVisibleByNeighbors: false,
      updateOwner: '', updateNeighbor: ''
    });
  } catch (e) { /* made by an earlier load. harmless. */ }

  /*
    One character's clocks. Never set reads as null and is an empty record.
    A read that throws is null here: a clock that cannot be read does not
    fire, the same as one that cannot be written, because an empty record in
    its place would hand the day back.
  */
  function record(id) {
    var v = null;
    try {
      v = mp.get(id, PERK_PROPERTY);
    } catch (e) {
      plog('could not read the clocks of', hex(id) + ':', e);
      return null;
    }
    if (!v || typeof v !== 'object' || v.v !== 1) { v = { v: 1 }; }
    if (!v.ready || typeof v.ready !== 'object') { v.ready = {}; }
    if (!v.fired || typeof v.fired !== 'object') { v.fired = {}; }
    return v;
  }
  function readyAt(id, key) {
    var rec = record(id);
    return rec ? (Number(rec.ready[key]) || 0) : 0;
  }

  /* Take the clock. Written first; the perk fires only once it is written. */
  function take(id, key, t) {
    var rec = record(id);
    if (!rec || (Number(rec.ready[key]) || 0) > t) { return false; }
    rec.ready[key] = t + PERKS[key].every;
    rec.fired[key] = (Number(rec.fired[key]) || 0) + 1;
    try {
      mp.set(id, PERK_PROPERTY, rec);
    } catch (e) {
      plog('could not write the', PERKS[key].name, 'clock of', hex(id) + ', so it does not fire:', e);
      return false;
    }
    return true;
  }

  function fired(id, key, more) {
    plog(PERKS[key].name, 'fired for', hex(id) + (more ? ' ' + more : ''));
  }

  // ------------------------------------------------------------ Cheat Death --
  /*
    THE ONE CHECK mp.onDying ASKS (#1626), for a death the engine is about to
    make and has sent nothing of. When Cheat Death takes it: the clock is
    written first, the person is told, and the answer is the share of their
    most that is 1 health, which the engine keeps them at. 0 is an ordinary
    death. mp.onDeath must never ask it: by then the death has been sent.

    THE MOST IS THE ONE THEIR BAR IS DRAWN AGAINST: the engine's own, from the
    race and the base (engineMost in the maneuvers block, as
    GetBaseActorValues works it out), plus the health the client's map adds,
    Vitality's 10 a point among it (effectsOf in the character block). A share
    is of that, the way the client sets it (setActorValuePercentage). Health
    from gear or a potion the server cannot see is not in it, so with a
    Fortify Health running 1 health comes out a little over 1. It is read
    before the clock is touched, so a most that cannot be read spends no day:
    the death goes ahead and the log says why.
  */
  function mostHealth(actorId) {
    var M = g.__thornswoodManeuvers;
    var ch = g.__thornswoodCharacter;
    if (!M || !M.engineMost || !ch || !ch.effectsOf) { return NaN; }
    var base = Number(M.engineMost(actorId, 'health')) || 0;
    if (!(base > 0)) { return NaN; }
    var map = ch.effectsOf(actorId);
    return base + ((map && typeof map.health === 'number') ? map.health : 0);
  }

  function cheatDeath(actorId) {
    if (!actorId || !personOf(actorId)) { return 0; }
    if (!heldIn(stateOf(actorId)).cheatdeath) { return 0; }
    var most = NaN;
    try {
      most = mostHealth(actorId);
    } catch (e) {
      plog('reading the most health of', hex(actorId), 'threw:', e);
    }
    if (!(most > 0)) {
      plog('Cheat Death could not read the most health of', hex(actorId) + ', so it does not fire');
      return 0;
    }
    if (!take(actorId, 'cheatdeath', now())) { return 0; }
    fired(actorId, 'cheatdeath');
    tell(actorId, 'Cheat Death. The blow that would have killed you leaves you at ' +
                  PERKS.cheatdeath.health + ' health. It comes back in 24 hours.');
    return Math.min(1, PERKS.cheatdeath.health / most);
  }

  // -------------------------------------------------------------- the hits --
  var kinds = {};
  var records = {};
  var gmst = null;

  function lookup(id) {
    if (!id) { return null; }
    if (has(records, id)) { return records[id]; }
    var r = null;
    try { r = mp.lookupEspmRecordById(id) || null; } catch (e) { r = null; }
    records[id] = r;
    return r;
  }
  function typeOf(r) { return (r && r.record) ? String(r.record.type || '') : ''; }
  function fieldOf(r, type) {
    var fields = (r && r.record && r.record.fields) || [];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i] && String(fields[i].type) === type) { return fields[i].data || []; }
    }
    return null;
  }
  function u32(b, at) {
    if (!b || b.length < at + 4) { return null; }
    return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000;
  }
  function f32(b, at) {
    if (!b || b.length < at + 4) { return NaN; }
    var view = new DataView(new ArrayBuffer(4));
    for (var i = 0; i < 4; i++) { view.setUint8(i, b[at + i]); }
    return view.getFloat32(0, true);
  }
  function globalOf(r, local) {
    if (!r || typeof r.toGlobalRecordId !== 'function') { return local || 0; }
    try { return Number(r.toGlobalRecordId(local)) || 0; } catch (e) { return 0; }
  }
  function idOfForm(v) {
    if (typeof v === 'number') { return v; }
    if (v && v.desc) {
      try { return Number(mp.getIdFromDesc(String(v.desc))) || 0; } catch (e) { return 0; }
    }
    return 0;
  }

  /* What landed the hit: 'spell', 'bow' (a bow or a crossbow), 'melee', or ''. */
  function kindOf(id) {
    if (!id) { return ''; }
    if (has(kinds, id)) { return kinds[id]; }
    var kind = '';
    if (id === 0x1f4) {
      kind = 'melee';
    } else {
      var r = lookup(id);
      var type = typeOf(r);
      if (type === 'SPEL') { kind = 'spell'; }
      else if (type === 'WEAP') {
        // WEAP DNAM: the animation type is the first byte. Bow 7, crossbow 9.
        var dnam = fieldOf(r, 'DNAM');
        var anim = dnam && dnam.length ? dnam[0] : -1;
        kind = (anim === 7 || anim === 9) ? 'bow' : 'melee';
      }
    }
    kinds[id] = kind;
    return kind;
  }

  /*
    WHAT A SPELL COSTS, as the record carries it: SPIT's first four bytes. All
    85 spells in the book carry one (game/data/spells.json, built from the
    same field). The cast type is at 16, and 2 is concentration.
  */
  var spellCosts = {};
  function spellOf(id) {
    if (has(spellCosts, id)) { return spellCosts[id]; }
    var spit = fieldOf(lookup(id), 'SPIT');
    var cost = u32(spit, 0);
    var info = { id: id, cost: cost || 0, concentration: u32(spit, 16) === 2 };
    if (!info.cost) { plog('the spell', hex(id), 'carries no cost, so Spellbreaker gives nothing for it'); }
    spellCosts[id] = info;
    return info;
  }

  /*
    THE CASTS THAT HOLD (Overcharge's other half). A spell holds when it is a
    spell (SPIT type 0, not a power, a shout or an ability), cast and let go
    (cast type 1, not held like a ward or a stream of flame), with at least
    one effect that lasts a time (EFIT's duration, at 8) and none that takes
    health: an effect whose MGEF is hostile (DATA flags, bit 4) and works on
    Health (its value, DATA at 0x44, is 24). The engine fork's
    CastDurationsGame::Holds judges a cast on the caster's machine by the
    same rule, so both count the same casts.
  */
  var HEALTH = 24;
  var DETRIMENTAL = 4;
  var holdsCache = {};
  function holdsLonger(id) {
    if (!id) { return false; }
    if (has(holdsCache, id)) { return holdsCache[id]; }
    var r = lookup(id);
    var spit = typeOf(r) === 'SPEL' ? fieldOf(r, 'SPIT') : null;
    var ok = !!spit && u32(spit, 8) === 0 && u32(spit, 16) === 1;
    var lasts = false;
    var fields = (ok && r.record.fields) || [];
    for (var i = 0; i < fields.length && ok; i++) {
      var f = fields[i];
      if (!f) { continue; }
      if (String(f.type) === 'EFID') {
        var data = fieldOf(lookup(globalOf(r, u32(f.data, 0))), 'DATA');
        if (((u32(data, 0) || 0) & DETRIMENTAL) && u32(data, 0x44) === HEALTH) { ok = false; }
      } else if (String(f.type) === 'EFIT') {
        if ((u32(f.data, 8) || 0) > 0) { lasts = true; }
      }
    }
    holdsCache[id] = ok && lasts;
    return holdsCache[id];
  }

  /*
    A cast, from mp.onSpellCast, before the engine sends it to anybody near.
    asked is how many times its usual time the caster's own machine gave its
    effects; the answer is what everybody else's machine gives them. Every
    cast that holds, by somebody who holds Overcharge, counts. The fifth
    holds twice as long, and only when the caster's machine counted it the
    fifth as well and asked for it; the one that asked is the one everybody
    sees. A cast that asked without the count behind it holds its own time
    for everybody else, and counts. A cast that did not ask at the fifth
    (its machine counted one fewer) holds its own time and keeps the count,
    so the next one is it.
  */
  function cast(casterId, spellId, asked) {
    var by = Number(casterId) || 0;
    var id = Number(spellId) || 0;
    if (!by || !id || !personOf(by) || !heldOf(by, now()).overcharge || !holdsLonger(id)) { return 1; }
    var longer = PERKS.overcharge.longer;
    var n = (ST.holding[by] || 0) + 1;
    if (n >= PERKS.overcharge.inEvery) {
      if (Number(asked) === longer) {
        ST.holding[by] = 0;
        fired(by, 'overcharge', '(' + hex(id) + ' holds ' + longer + ' times as long)');
        tell(by, 'Overcharge: that spell holds twice as long.');
        return longer;
      }
      ST.holding[by] = n - 1;
      return 1;
    }
    if (Number(asked) > 1) {
      plog('Overcharge: the cast of', hex(id), 'by', hex(by), 'asked for', asked, 'times as long at',
           n, 'of', PERKS.overcharge.inEvery + ', so it holds its own time for everybody else');
    }
    ST.holding[by] = n;
    return 1;
  }

  /*
    THE ARMOUR, the way the engine sums it (TES5DamageFormula,
    CalcOpponentArmorRating): each worn ARMO's DNAM rating over 100, and each
    of its enchantment's effects whose primary value is DamageResist (39, MGEF
    DATA at 0x44) by its magnitude. The penalty is the engine's too, out of
    the two game settings it reads.
  */
  var DAMAGE_RESIST = 39;
  function settings() {
    if (gmst) { return gmst; }
    var cap = f32(fieldOf(lookup(0x37deb), 'DATA'), 0);     // fMaxArmorRating
    var scale = f32(fieldOf(lookup(0x21a72), 'DATA'), 0);   // fArmorScalingFactor
    gmst = (isFinite(cap) && isFinite(scale) && scale > 0) ? { cap: cap, scale: scale } : { broken: true };
    if (gmst.broken) { plog('the two armour settings could not be read, so Lethal Aim adds nothing'); }
    return gmst;
  }
  function enchantArmour(enchId) {
    var r = lookup(enchId);
    var fields = (r && r.record && r.record.fields) || [];
    var total = 0, av = -1;
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!f) { continue; }
      if (String(f.type) === 'EFID') {
        var mgef = lookup(globalOf(r, u32(f.data, 0)));
        var data = fieldOf(mgef, 'DATA');
        var n = u32(data, 0x44);
        av = n === null ? -1 : (n | 0);
      } else if (String(f.type) === 'EFIT') {
        var mag = f32(f.data, 0);
        if (av === DAMAGE_RESIST && isFinite(mag)) { total += mag; }
        av = -1;
      }
    }
    return total;
  }
  function armourOf(target) {
    var eq = null;
    try { eq = mp.get(target, 'equipment'); } catch (e) { return 0; }
    var entries = (eq && eq.inv && eq.inv.entries) || (eq && eq.entries) || [];
    var total = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !e.baseId || !(e.worn || e.wornLeft)) { continue; }
      var r = lookup(e.baseId);
      if (typeOf(r) !== 'ARMO') { continue; }
      var rating = u32(fieldOf(r, 'DNAM'), 0);
      if (rating !== null) { total += rating / 100; }
      var ench = u32(fieldOf(r, 'EITM'), 0);
      if (ench) { total += enchantArmour(globalOf(r, ench)); }
    }
    return total;
  }
  /* What a blow against this much armour keeps, out of 1. */
  function penalty(armour, set) {
    return (100 - Math.min(armour * set.scale, set.cap)) / 100;
  }
  /* What Lethal Aim adds to a bow hit that took this much. */
  function lethalExtra(target, took) {
    var set = settings();
    if (set.broken) { return 0; }
    var armour = armourOf(target);
    if (!(armour > 0)) { return 0; }
    var full = penalty(armour, set);
    var half = penalty(armour * PERKS.lethalaim.armour, set);
    if (!(full > 0)) { return 0; }
    return took * (half / full - 1);
  }

  /*
    WHAT A HIT TOOK, MEASURED. The same way the maneuvers measure it: OnHit
    comes before the engine's damage, so health is read at the event and again
    on the next turn, and the difference is the blow. A hit the engine threw
    away took nothing and changes nothing.
  */
  var pending = {};
  var queued = false;

  function hit(targetId, aggressor, source, power, bash) {
    var target = Number(targetId) || 0;
    if (!target) { return; }
    var t = now();
    var by = idOfForm(aggressor);
    if (personOf(target)) { ST.fight[target] = t; }
    if (by && by !== target && personOf(by)) { ST.fight[by] = t; }
    var open = pending[target];
    if (open && open.length && open[open.length - 1].after === null) {
      open[open.length - 1].after = (pct(target) || { health: -1 }).health;
    }
    var kind = kindOf(idOfForm(source));

    // Spellbreaker is on the one hit, now.
    if (kind === 'spell' && heldOf(target, t).spellbreaker) { breakSpell(target, by, idOfForm(source), t); }

    if (!by || by === target || !personOf(by)) { return; }
    var identity = MERCHANT_TRADING.actorIdentity(mp, by);
    if (!identity) { return; }
    var mine = heldOf(by, t);
    var e = { before: -1, after: null, by: by, identity: identity, more: 0, overcharge: false, aim: false };
    if (kind === 'melee' && power && !bash && mine.devastatingblow) { e.more = PERKS.devastatingblow.more; }
    if (kind === 'spell' && mine.overcharge) { e.overcharge = true; }
    if (kind === 'bow' && mine.lethalaim) { e.aim = true; }
    if (!e.more && !e.overcharge && !e.aim) { return; }
    e.target = targetLife(target);
    var p = pct(target);
    e.before = p ? p.health : -1;
    if (!(e.before > 0)) { return; }
    if (!pending[target]) { pending[target] = []; }
    pending[target].push(e);
    if (!queued) {
      queued = true;
      setTimeout((typeof guard === 'function') ? guard('perkHits', flush) : flush, 0);
    }
  }

  /*
    WHOSE BODY A QUEUED BLOW IS FOR (#2069). Queues are keyed by the target's
    actor ID, and a new life or another character can be loaded at that ID
    before the flush. The descriptor and native life are taken when the blow
    is queued and asked again before the target is read or written, and a
    blow whose target was replaced is let go. The attacker's side is #2070's.
  */
  function targetLife(target) {
    return MERCHANT_TRADING.targetIdentity(mp, target);
  }
  function sameTarget(target, life) { return typeof life === 'string' && targetLife(target) === life; }

  function breakSpell(target, by, spellId, t) {
    var info = spellOf(spellId);
    if (!(info.cost > 0)) { return; }
    if (info.concentration) {
      var key = target + ':' + by + ':' + spellId;
      if (t - (ST.sb[key] || 0) < SECOND) { return; }
      ST.sb[key] = t;
    }
    var gain = info.cost * PERKS.spellbreaker.share;
    if (restore(target, 'Magicka', gain)) {
      fired(target, 'spellbreaker', '(' + (Math.round(gain * 10) / 10) + ' magicka from ' + hex(spellId) + ')');
    }
  }

  function setHealth(target, h, change, killer) {
    var next = h + change;
    if (next > 1) { next = 1; }
    if (next <= 0) {
      next = 0;
      // The engine asks mp.onDying on this write with nobody named, and
      // mp.onDeath asks this block who it was.
      if (killer) { ST.blow[target] = { by: killer.by, identity: killer.identity, at: now() }; }
    }
    if (has(ST.blow, target) && next <= 0) { ST.blow[target].target = targetLife(target); }
    var p = pct(target);
    if (!p) { return; }
    setPct(target, next, p.magicka, p.stamina);
  }

  function flush() {
    queued = false;
    var all = pending;
    pending = {};
    for (var k in all) {
      if (!has(all, k)) { continue; }
      var target = Number(k);
      var list = all[k].filter(function (q) { return sameTarget(target, q.target); });
      if (!list.length) { continue; }
      var p = pct(target);
      var h = p ? p.health : -1;
      if (list.length && list[list.length - 1].after === null) { list[list.length - 1].after = h; }
      var change = 0, killer = 0;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e.identity || MERCHANT_TRADING.actorIdentity(mp, e.by) !== e.identity) { continue; }
        var took = e.before - e.after;
        if (!(e.after >= 0) || !(took > 0)) { continue; }
        if (e.more) {
          change -= took * e.more;
          killer = e;
          fired(e.by, 'devastatingblow');
        }
        if (e.aim) {
          var extra = lethalExtra(target, took);
          if (extra > 0) {
            change -= extra;
            killer = e;
            fired(e.by, 'lethalaim');
          }
        }
        if (e.overcharge) {
          var n = (ST.spells[e.by] || 0) + 1;
          if (n >= PERKS.overcharge.inEvery) {
            n = 0;
            change -= took * PERKS.overcharge.more;
            killer = e;
            fired(e.by, 'overcharge');
            tell(e.by, 'Overcharge: that spell lands double.');
          }
          ST.spells[e.by] = n;
        }
      }
      if (h > 0 && change !== 0) { setHealth(target, h, change, killer); }
    }
  }

  /** Whose blow it was, when this block's own write was the killing one. */
  function killerOf(target) {
    var b = has(ST.blow, target) ? ST.blow[target] : null;
    if (!b) { return 0; }
    if (!sameTarget(target, b.target)) { delete ST.blow[target]; return 0; }
    delete ST.blow[target];
    return (now() - b.at) < 2000 && b.identity && MERCHANT_TRADING.actorIdentity(mp, b.by) === b.identity ? b.by : 0;
  }

  // -------------------------------------------------------------- the tick --
  /*
    THE MAGICKA, THE STAMINA AND THE HEALTH, four times a second, for the
    people who hold a perk that watches them. The client reports both and the server keeps
    the share; this reads that share and writes it back up. RACE DATA at 88 is
    the race's own magicka rate, a percent of the most there is each second.
  */
  var raceRates = {};
  function raceRate(id) {
    var raceId = 0;
    try { raceId = Number((mp.get(id, 'appearance') || {}).raceId) || 0; } catch (e) { raceId = 0; }
    if (!raceId) { return 0; }
    if (!has(raceRates, raceId)) {
      var rate = f32(fieldOf(lookup(raceId), 'DATA'), 88);
      raceRates[raceId] = (isFinite(rate) && rate > 0) ? rate : 0;
      if (!raceRates[raceId]) { plog('the race', hex(raceId), 'has no magicka rate to read, so Leyline Attunement gives nothing'); }
    }
    return raceRates[raceId];
  }

  function inFight(id, t) { return has(ST.fight, id) && t - ST.fight[id] < FIGHT_MS; }

  function one(id, t) {
    var mine = heldOf(id, t);
    if (!mine.trollsblood && !mine.archmagesvessel && !mine.leylineattunement && !mine.secondwind) {
      delete ST.last[id];
      return;
    }
    if (deadOf(id)) { delete ST.last[id]; return; }
    var p = pct(id);
    if (!p) { return; }
    var last = has(ST.last, id) ? ST.last[id] : null;
    if (last && p.health < last.h - 0.0001) { ST.fight[id] = t; }
    var m = p.magicka, st = p.stamina, changed = false, clocked = false;

    if (mine.secondwind && st <= 0.001 && take(id, 'secondwind', t)) {
      st = 1;
      changed = true;
      clocked = true;
      fired(id, 'secondwind');
      tell(id, 'Second Wind: your stamina fills. It comes back in 5 minutes.');
    }
    if (mine.archmagesvessel && m < PERKS.archmagesvessel.below && take(id, 'archmagesvessel', t)) {
      m = PERKS.archmagesvessel.to;
      changed = true;
      clocked = true;
      fired(id, 'archmagesvessel');
      tell(id, 'Archmage\'s Vessel: your magicka returns to half. It comes back in 24 hours.');
    }
    if (mine.leylineattunement && last && m < last.m - 0.0005 && m < 1) {
      var rate = raceRate(id) * (100 + ((ST.held[id] && ST.held[id].rate) || 0)) / 100;
      var add = PERKS.leylineattunement.rate * (rate / 100) * Math.min(t - last.at, SECOND) / 1000;
      if (add > 0) {
        m = Math.min(1, m + add);
        changed = true;
        if (t - (ST.ley[id] || 0) > 2 * SECOND) { fired(id, 'leylineattunement'); }
        ST.ley[id] = t;
      }
    }
    if (changed) { setPct(id, p.health, m, st); }
    // A clock that moved is on the K panel, so the panel is sent it now.
    if (clocked) { push(id); }
    ST.last[id] = { h: p.health, m: m, at: t };

    if (mine.trollsblood && inFight(id, t) && p.health < 1) {
      var tr = has(ST.troll, id) ? ST.troll[id] : (ST.troll[id] = { at: 0, said: 0 });
      if (t - tr.at >= SECOND) {
        tr.at = t;
        if (restore(id, 'Health', PERKS.trollsblood.perSecond) && t - tr.said > FIGHT_MS) {
          fired(id, 'trollsblood');
        }
        tr.said = t;
      }
    }
  }

  function tick() {
    var t = now();
    var online = [];
    online = mp.get(0, 'onlinePlayers') || [];
    var here = {};
    for (var i = 0; i < online.length; i++) {
      here[online[i]] = true;
      try { one(online[i], t); } catch (e) { plog('the tick threw for', hex(online[i]) + ':', e); }
    }
    var maps = [ST.held, ST.last, ST.font, ST.troll, ST.ley, ST.fight];
    for (var j = 0; j < maps.length; j++) {
      for (var k in maps[j]) { if (has(maps[j], k) && !here[k]) { delete maps[j][k]; } }
    }
    for (var key in ST.sb) { if (has(ST.sb, key) && t - ST.sb[key] > 5 * SECOND) { delete ST.sb[key]; } }
    for (var b in ST.blow) { if (has(ST.blow, b) && t - ST.blow[b].at > 5 * SECOND) { delete ST.blow[b]; } }
  }

  // ------------------------------------------------------------- the words --
  function about(key) {
    var p = PERKS[key];
    return p.name + ': ' + p.say + (p.not ? ' ' + p.not : '');
  }

  /*
    FONT OF MAGIC, from the Use button on the K panel. Answers { ok, why } the
    way every pick on that panel is answered: why is the refusal in plain
    words, said as 'No: <why>.' in the chat and under the panel, and line is
    what to say when it starts. The day is spent only once the redraw that
    carries the free spells can be sent.
  */
  function startFont(actorId, s) {
    var key = 'fontofmagic';
    if (!heldIn(s)[key]) { return { ok: false, why: 'Font of Magic comes with five points in Efficiency' }; }
    if (deadOf(actorId)) { return { ok: false, why: 'not while you are down' }; }
    var t = now();
    if (has(ST.font, actorId) && ST.font[actorId].until > t) {
      return { ok: false, why: 'Font of Magic is running, ' + wait(ST.font[actorId].until - t) + ' left' };
    }
    var at = readyAt(actorId, key);
    if (at > t) { return { ok: false, why: 'Font of Magic comes back in ' + wait(at - t) }; }
    if (!canPush()) { return { ok: false, why: 'Font of Magic cannot reach your character right now' }; }
    if (!take(actorId, key, t)) { return { ok: false, why: 'Font of Magic could not be started' }; }
    var ms = PERKS.fontofmagic.seconds * SECOND;
    var until = t + ms;
    ST.font[actorId] = { until: until };
    push(actorId);
    var end = function () {
      // Only this start's own end: a later start keeps its own 15 seconds.
      if (has(ST.font, actorId) && ST.font[actorId].until !== until) { return; }
      delete ST.font[actorId];
      push(actorId);
      tell(actorId, 'Font of Magic has run out.');
    };
    setTimeout((typeof guard === 'function') ? guard('fontOfMagicEnd', end) : end, ms + 50);
    fired(actorId, key);
    return { ok: true, line: 'Font of Magic: for 15 seconds, a spell costs nothing. It comes back in 24 hours.' };
  }

  /*
    A press of a perk's button on the K panel: /pick perk <key>. Font of Magic
    is the one perk the page has somebody start; every other perk fires by
    itself, so its key is refused.
  */
  function use(actorId, s, word) {
    var key = String(word || '').toLowerCase();
    if (key === 'fontofmagic') { return startFont(actorId, s); }
    return { ok: false, why: has(PERKS, key) ? PERKS[key].name + ' fires by itself' : 'there is no perk by that name' };
  }

  /*
    WHAT THE K PANEL SHOWS OF THE CLOCKS, for the perks this character holds
    that wait between firings: { <key>: { ready: <ms> } }, and until: <ms> on
    Font of Magic while it runs. ready is when it may fire again, 0 for never
    fired. Times, not time left, so the view is the same until a perk fires
    and the panel counts down against its own clock. null when there is
    nothing to show.
  */
  function clocks(actorId, s) {
    var mine = heldIn(s);
    var out = null;
    for (var i = 0; i < ORDER.length; i++) {
      var k = ORDER[i];
      if (!mine[k] || !PERKS[k].every) { continue; }
      out = out || {};
      out[k] = { ready: readyAt(actorId, k) };
      if (k === 'fontofmagic' && has(ST.font, actorId) && ST.font[actorId].until > now()) {
        out[k].until = ST.font[actorId].until;
      }
    }
    return out;
  }

  /*
    WHAT A RUNNING PERK ADDS TO THE CLIENT'S MAP: Font of Magic's 15 seconds,
    100 on every school's cost value. The character block folds this into the
    totals it sends (withPerks), beside a warrior's Rush, because the client
    SETS each value to the total it is given. Every school, not only the ones
    held: the page says a spell costs nothing, whichever school it is. The
    names are the progression block's own, TUNING.schoolValues.
  */
  function effects(actorId) {
    var f = has(ST.font, actorId) ? ST.font[actorId] : null;
    if (!f || !(f.until > now())) { return null; }
    var schools = (P.TUNING && P.TUNING.schoolValues) || {};
    var out = null;
    for (var school in schools) {
      if (!has(schools, school) || !schools[school].cost) { continue; }
      out = out || {};
      out[schools[school].cost] = PERKS.fontofmagic.costOff;
    }
    return out;
  }

  /*
    The client's skill tree hand sets the totals map on the panel view, and
    the map is rebuilt from the state on every write, so a redraw is the one
    way to send Font of Magic and to take it off again. The same as Rush.
  */
  function canPush() {
    var ch = g.__thornswoodCharacter;
    return !!(ch && ch.writeState && ch.stateOf);
  }
  function push(actorId) {
    if (!canPush()) { return; }
    var ch = g.__thornswoodCharacter;
    try { ch.writeState(actorId, ch.stateOf(actorId), true); } catch (e) { plog('could not redraw', hex(actorId) + ':', e); }
  }

  function treeOf(skill) {
    for (var attr in P.TABLE.tree) {
      if (has(P.TABLE.tree, attr) && has(P.TABLE.tree[attr].skills, skill)) { return attr; }
    }
    return '';
  }

  /*
    What a point spent says once it is in: the perk the moment a sub-skill
    fills, and, for Precision, every time, that the game ignores critical
    chance. Nothing for any other point: the panel shows those.
  */
  function spendLine(s, skill) {
    var key = '';
    for (var i = 0; i < ORDER.length; i++) { if (PERKS[ORDER[i]].skill === skill) { key = ORDER[i]; } }
    if (!key || !s || !s.tree) { return ''; }
    var bits = [];
    if ((s.tree[skill] || 0) >= P.TABLE.limits.skillCap) {
      var attr = treeOf(skill);
      bits.push(P.TABLE.tree[attr].skills[skill].name + ' is full. ' + about(key));
    }
    if (skill === 'precision') { bits.push(CRIT_LINE); }
    return bits.join(' ');
  }

  if (g.__thornswoodPerkTimer) { clearInterval(g.__thornswoodPerkTimer); }
  g.__thornswoodPerkTimer = setInterval((typeof guard === 'function') ? guard('perkTick', tick) : tick, TICK_MS);

  g.__thornswoodPerks = {
    PERKS: PERKS, ORDER: ORDER, PROPERTY: PERK_PROPERTY, CRIT_LINE: CRIT_LINE, FIGHT_MS: FIGHT_MS,
    holds: holds, cheatDeath: cheatDeath, hit: hit, flush: flush, killerOf: killerOf, tick: tick,
    use: use, clocks: clocks, spendLine: spendLine, effects: effects, armourOf: armourOf,
    lethalExtra: lethalExtra, readyAt: readyAt, fired: fired, cast: cast, holdsLonger: holdsLonger, state: ST
  };
  console.log('[thornswood perks] ready: ' + ORDER.length + ' perks');
})();
// ==== end thornswood skill perks ====

/*
  Every cast, before the engine sends it to anybody near (skymp #86,
  SpellCastEvent.h): how many times its usual time its effects hold on their
  machines. 1, the game's own, unless the skill perks block above agrees to
  more for Overcharge. Nothing here refuses a cast: a false refuses nothing,
  the cast was made on the caster's own machine.
*/
mp.onSpellCast = guard('onSpellCast', function (casterId, spell, asked) {
  var pk = globalThis.__thornswoodPerks;
  var mult = 1;
  try { mult = (pk && pk.cast) ? pk.cast(casterId, spell, asked) : 1; } catch (e) { log('perks: the cast threw:', e); }
  if (mult !== 1) { mp.set(casterId, 'spellCastDurationMult', mult); }
});

