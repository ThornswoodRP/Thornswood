// ==== thornswood injury and disease ====
/*
  ============================================================================
  WOUNDS AND DISEASE, ON THE CHARACTER THE WAY HUNGER IS (#1383).

  docs/systems/injury.md and docs/systems/disease.md are the design, and every
  number below is one of theirs, named where it is used. A wound and a disease
  are a short list on the character, in the thornswoodHurt property, ticked by
  this server. Not a mod script and not the old survival mod: nothing here
  runs on the client except the lines that draw what you have.

  WHAT THE SERVER CAN SEE, AND SO WHAT STARTS EACH ONE TODAY.

    A burn     the client says when it catches fire and when the fire goes out
               (/burn, the same report the spreading uses), and the coals deal
               BURN_PER_SECOND a second on that client while it burns. So the
               server times the fire and knows what it dealt.
    A chill    an hour of sleep on open ground, read off the rest the needs
               block already holds (resting at the sitting rate, with no roof
               over you), or an hour at spent cold, read off its temperature.
    Wound fever and bite sickness
               a cut, a bite or a bad burn left untreated for 10 minutes.
    Food sickness and fouled water
               what somebody ate or drank, which is the meal and drink work
               (#1382). It calls exposed() with what it was, and the chances
               are here, beside the disease they start.
    A cut, a break, a bite
               the blow that lands, by Patrick's answer on #1383 (blow, below):
               a power or sneak attack with a blade or an axe, or an arrow or a
               bolt, cuts; a power attack with a mace or a warhammer breaks an
               arm or a leg; an animal that bites, bites. Staff can still give
               one with /hurt for a scene.

  WHAT TREATS THEM (treat, below): torn cloth, a bandage, a splint, a poultice
  and a physicker's remedy, the last four items in Thornswood-Content.esp, and
  a physicker setting a bone. Yours from the inventory, somebody else's from
  the look prompt, both through one panel (game/ui/thornswood-treat.js).

  GOING DOWN IS NOT HERE YET. The engine now asks mp.onDying before health
  reaching zero kills, before anything is sent (#1626), so that is the moment
  this file can say "down, not dead": refuse the death and keep them at a
  health of its own. The rest of going down (the downed flag the clients are
  sent, no fighting or casting while down, being stabilized, the wake) is
  #2681. Until it is built a bleed that empties your health is a death with
  no killer, the world's, and the temple keeps your wounds.
  ============================================================================
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  function hlog() {
    var a = ['[thornswood hurt]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  var HURT_PROPERTY = 'thornswoodHurt';
  var MIN = 60000;
  var DAY = 24 * 60 * MIN;

  /*
    THE NUMBERS, ALL OF THEM OFF THE TWO PAGES.

    injury.md: a cut bleeds 2 a second until stopped and torn cloth slows it
    to 1. Left open 10 minutes, wound fever is 40%, 10% with a bandage, 5% with
    a poultice. A bite is a cut and bite sickness, 25% if it is closed inside
    the 10 minutes and 60% if it is not. A break heals in 3 real days looked
    after and crooked in 3 days ignored. A burn is bad at 30 health dealt,
    halves the warmth of what is worn and heals in a day. A missing eye is
    -20% damage with a bow or a spell.

    disease.md: caught is 10 minutes with no penalty, bad is another 20
    untreated, and the three durations.
  */
  var HURT = {
    bleed: { open: 2, cloth: 1 },
    feverAfter: 10,
    fever: { open: 0.40, bandage: 0.10, poultice: 0.05 },
    bite: { closed: 0.25, open: 0.60 },
    breakDays: 3,
    /*
      The broken limb and the crooked one, as the engine actor values the
      skills panel already carries. attackDamageMult is a multiplier, which is
      why its numbers are small (see TUNING.perPoint). "A block costs twice the
      stamina" and "sprint is refused" are not actor values: the record carries
      limbs (write, below). The maneuvers block reads it when it charges a
      block's stamina and doubles the charge for a broken arm (BLOCK.brokenArm),
      and the screen script hands it to the front plugin as
      thornswoodBrokenLimbs, which shuts the sprint gate on a broken leg (#1383).
    */
    broken: { arm: { attackDamageMult: -0.15 }, leg: { speedMult: -8 } },
    crooked: { arm: { attackDamageMult: -0.05 }, leg: { speedMult: -4 } },
    /*
      BURN_PER_SECOND in thornswood-front.js is what the coals deal a second
      and has to be the same number, because the server works out what a fire
      dealt from how long it burned.
    */
    burn: { perSecond: 7, bad: 30, healDays: 1, warmth: 0.5 },
    /*
      Bow damage and spell damage. The bow is MarksmanPowerMod; a spell that
      does damage is the destruction school, DestructionPowerMod, the name
      schoolValues in the progression block sends. Both are per cent.
    */
    eye: { MarksmanPowerMod: -20, DestructionPowerMod: -20 },
    // The most wounds one record holds, so a run of /hurt cannot grow it for ever.
    most: 12
  };

  /*
    THE FIVE, AND WHICH METER EACH ONE IS CLOSEST TO.

    "Ill. The weary penalties of the closest meter: cold for a chill, hunger
    for food sickness, thirst for fouled water, and both hunger and rest for a
    fever." Read as a floor: the meter counts as at least weary while you are
    ill, and at least bad while you are badly ill, so a disease never stacks a
    second copy of a penalty you already have.

    lasts is minutes, and from says what it is counted from: a chill clears in
    2 hours from catching it; food sickness and fouled water last 30 and 45
    minutes once they show. 0 lasts until cured. bad is whether 20 untreated
    minutes after showing make it bad.

    Bite sickness is not on the page's list of closest meters. It is a wound
    disease that turns bad the way a fever does, so it reads as a fever does:
    hunger and rest (Patrick's answer on #1383, 4 October).
  */
  var DISEASE = {
    chill:  { name: 'chill', meters: { cold: true }, lasts: 120, from: 'caught', bad: false },
    food:   { name: 'food sickness', meters: { food: true }, lasts: 30, from: 'ill', bad: false },
    fouled: { name: 'fouled water', meters: { drink: true }, lasts: 45, from: 'ill', bad: false },
    fever:  { name: 'wound fever', meters: { food: true, rest: true }, lasts: 0, from: 'ill', bad: true },
    bite:   { name: 'bite sickness', meters: { food: true, rest: true }, lasts: 0, from: 'ill', bad: true }
  };
  var CAUGHT_MIN = 10;
  var BAD_AFTER_MIN = 20;
  // An hour of sleep on open ground, or an hour at spent cold. Shorter does not catch it.
  var CHILL_AFTER_MIN = 60;

  /*
    WHAT STARTS FOOD SICKNESS AND FOULED WATER, which the meal and drink work
    (#1382) reports through exposed(). disease.md: raw meat or fish 40%,
    eating at 90 hunger or above always, spoiled food always (#3163); marsh, a puddle or standing water
    80%, the sea 40%, a river unboiled 15%. Boiled water is no risk at all,
    so it is never reported.
  */
  var EXPOSED = {
    // Spoiled food always (#3163, Patrick, 26 October: it starts food sickness).
    food: { raw: 0.40, full: 1, spoiled: 1 },
    fouled: { marsh: 0.80, puddle: 0.80, standing: 0.80, sea: 0.40, river: 0.15 }
  };

  /*
    WHICH HEALING SPELLS DO WHAT. injury.md, who treats what: novice
    restoration stops a bleed; advanced and up closes a cut; an expert
    healing spell sets a break that is already splinted. The rank is the
    spell's own, out of the progression block's book (spellByDesc), so a
    spell moving rank there moves it here too. self is a spell cast on
    yourself, heard as a cast; the other two land on somebody else and are
    heard as a hit.
  */
  var HEALING = {
    'Healing': { self: true },
    'Fast Healing': { self: true },
    'Close Wounds': { self: true },
    'Grand Healing': { self: true },
    'Guardian Circle': { self: true },
    'Healing Hands': { self: false },
    'Heal Other': { self: false }
  };
  var RANKS = ['novice', 'advanced', 'expert', 'master'];

  /*
    THE POTION OF CURE DISEASE. The one ALCH record in this load order whose
    effect is Cure Disease, CureDisease in Skyrim.esm (game\data\food.json).
    A potion somebody brews has no record (it is made above 0xff000000), so
    it cures by the brew instead: the alchemy gate tells brewed() which
    runtime id a brew carrying CURE_DISEASE_EFFECT (the magic effect
    AlchCureDisease) made, and swallowed() cures for that id too. The engine
    raises onEatItem for a brewed bottle from fork #78 on (#1383).
  */
  var CURE_DISEASE = ['ae723:Skyrim.esm'];
  var CURE_DISEASE_EFFECT = 'ae722:Skyrim.esm';
  var RUNTIME = 0xff000000;
  // The most brewed bottles one record remembers, newest kept.
  var BREWS_MOST = 16;

  /*
    A COOKED MEAL'S HELP AGAINST DISEASE, the guard. food.md: "the chance of
    catching a disease cut in half while it lasts", for 20 real minutes, and
    a feast is "double the help and half the time, so the disease chance is a
    quarter". chanceFor reads it. Patrick, 18 October (#2682): a cooked meal
    gives only its temperature help unless the cook adds one extra ingredient
    at the pot, so the guard comes ONLY from a dish seasoned at the cooking
    pot with garlic. Which extra that is stays data (the one
    FOOD_GROUPS.season.extras maps to 'guard'). This is the only guard; there
    is no second one. The needs block's meal help (#2682) calls
    guarded(actorId, false) for it, and unguarded() when a later meal's
    warmth or stamina replaces it.
  */
  var MEAL_GUARD = { cooked: { mult: 0.5, min: 20 }, feast: { mult: 0.25, min: 10 } };

  /*
    BENCHES THAT TAKE BOTH HANDS, by the keyword a bench carries (BENCH_BY_BASE).
    A broken arm and a missing hand refuse these. The page does not list them,
    and Patrick's answer on #1383 (4 October) is these: the forges, the armour
    table, the wheel, the smelter, the tanning rack, the loom and the kiln.
    Cooking, brewing and enchanting are not on it.
  */
  var TWO_HANDS = {
    '88105:Skyrim.esm': 'the forge',
    'f46ce:Skyrim.esm': 'the Skyforge',
    'adb78:Skyrim.esm': 'the armour table',
    '88108:Skyrim.esm': 'the sharpening wheel',
    'a5cce:Skyrim.esm': 'the smelter',
    '7866a:Skyrim.esm': 'the tanning rack',
    'f806:Dawnguard.esm': 'the forge',
    '5756:Dawnguard.esm': 'the forge',
    '6ce000:Update.esm': 'the loom',
    '1547f:Thornswood-Content.esp': 'the kiln'
  };

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }

  // ------------------------------------------------------------ the record --

  function fresh() {
    return { wounds: [], ills: [], crooked: {}, agreed: {}, cold: 0, ground: 0, show: [], brews: [], guard: null };
  }

  /*
    Rebuilt field by field, the same discipline as the needs block: this is
    where JSON somebody else wrote becomes things this file does arithmetic
    on, and a field not named here is dropped.
  */
  function read(actorId) {
    var v = null;
    try { v = mp.get(actorId, HURT_PROPERTY); } catch (e) { v = null; }
    var out = fresh();
    if (!v || typeof v !== 'object') { return out; }
    var ws = Array.isArray(v.wounds) ? v.wounds : [];
    for (var i = 0; i < ws.length && out.wounds.length < HURT.most; i++) {
      var w = ws[i];
      if (!w || typeof w !== 'object') { continue; }
      var k = String(w.k || '');
      if (k !== 'cut' && k !== 'bite' && k !== 'break' && k !== 'burn') { continue; }
      out.wounds.push({
        k: k, at: num(w.at, 0),
        limb: (w.limb === 'leg') ? 'leg' : 'arm',
        bleed: !!w.bleed, cloth: !!w.cloth, bandage: !!w.bandage,
        poultice: !!w.poultice, closed: !!w.closed, rolled: !!w.rolled,
        splint: !!w.splint, set: num(w.set, 0), dealt: num(w.dealt, 0)
      });
    }
    var is = Array.isArray(v.ills) ? v.ills : [];
    for (var j = 0; j < is.length; j++) {
      var d = is[j];
      if (!d || typeof d !== 'object' || !has(DISEASE, String(d.k || ''))) { continue; }
      out.ills.push({ k: String(d.k), at: num(d.at, 0), cold: !!d.cold, told: String(d.told || '') });
    }
    var cr = (v.crooked && typeof v.crooked === 'object') ? v.crooked : {};
    if (num(cr.arm, 0) > 0) { out.crooked.arm = num(cr.arm, 0); }
    if (num(cr.leg, 0) > 0) { out.crooked.leg = num(cr.leg, 0); }
    var ag = (v.agreed && typeof v.agreed === 'object') ? v.agreed : {};
    ['hand', 'eye', 'scar'].forEach(function (part) {
      var a = ag[part];
      if (!a || typeof a !== 'object' || !(num(a.at, 0) > 0)) { return; }
      out.agreed[part] = { at: num(a.at, 0), by: String(a.by || ''),
                           text: String(a.text || '').replace(/[<>&"]/g, '').slice(0, 200) };
    });
    out.cold = num(v.cold, 0);
    out.ground = num(v.ground, 0);
    out.show = Array.isArray(v.show) ? v.show.map(String) : [];
    var bs = Array.isArray(v.brews) ? v.brews : [];
    for (var b = 0; b < bs.length; b++) {
      var bid = num(bs[b], 0);
      if (bid >= RUNTIME && out.brews.indexOf(bid) === -1) { out.brews.push(bid); }
    }
    while (out.brews.length > BREWS_MOST) { out.brews.shift(); }
    var gd = (v.guard && typeof v.guard === 'object') ? v.guard : null;
    if (gd && num(gd.until, 0) > 0 && num(gd.mult, 1) > 0 && num(gd.mult, 1) < 1) {
      out.guard = { until: num(gd.until, 0), mult: num(gd.mult, 1) };
    }
    return out;
  }

  /*
    WHICH LIMB IS BROKEN (#1383). injury.md: a broken arm makes a block cost
    twice the stamina and a broken leg refuses sprint. Neither is an actor
    value, so the record carries the answer: the maneuvers block reads the arm
    when it charges a block, and the screen script hands the leg to the front
    plugin for the sprint gate. As long as the break lasts,
    splinted or set, the same as the -8 speed and the -0.15 melee in forNeeds.
  */
  function limbsOf(rec) {
    var out = { arm: 0, leg: 0 };
    for (var i = 0; i < rec.wounds.length; i++) {
      if (rec.wounds[i].k === 'break') { out[rec.wounds[i].limb === 'leg' ? 'leg' : 'arm'] = 1; }
    }
    return out;
  }

  function write(actorId, rec) {
    rec.show = lines(rec, Date.now());
    // Whether anybody could tend something here: the inventory's line and
    // the look prompt's row are offered only then (#1383).
    rec.care = (needsCare(rec) || hungOver(actorId)) ? 1 : 0;
    rec.limbs = limbsOf(rec);
    try { mp.set(actorId, HURT_PROPERTY, rec); return true; }
    catch (e) { hlog('could not write', actorId.toString(16) + ':', e); return false; }
  }

  // ------------------------------------------------------------ the clocks --

  function minutesSince(at, now) { return (now - at) / MIN; }

  /* caught, ill or bad. disease.md, "How sick". */
  function stageOf(ill, now) {
    var m = minutesSince(ill.at, now);
    if (m < CAUGHT_MIN) { return 'caught'; }
    if (DISEASE[ill.k].bad && m >= CAUGHT_MIN + BAD_AFTER_MIN) { return 'bad'; }
    return 'ill';
  }

  /* Whether this one has run its course on its own. */
  function runOut(ill, now) {
    var d = DISEASE[ill.k];
    if (!d.lasts) { return false; }
    var start = (d.from === 'caught') ? ill.at : ill.at + CAUGHT_MIN * MIN;
    return now >= start + d.lasts * MIN;
  }

  function hasIll(rec, k) {
    for (var i = 0; i < rec.ills.length; i++) { if (rec.ills[i].k === k) { return true; } }
    return false;
  }

  // ---------------------------------------------------------- resistance --

  function stateOf(actorId) {
    var C = g.__thornswoodCharacter;
    try { return (C && C.stateOf) ? C.stateOf(actorId) : null; } catch (e) { return null; }
  }

  /*
    TOUGHNESS. disease.md: each point adds disease resistance, and filled,
    Purified Blood means no disease takes. Purified Blood is the perks block's
    answer (holds), which is how it asks a disease the server gives to work.
    What a point is worth is the skill tree's own number
    (TUNING.perPoint.toughness.diseaseResist), the one the client puts on the
    actor, so the two cannot disagree.
  */
  function chanceFor(actorId, chance, rec) {
    var K = g.__thornswoodPerks;
    try { if (K && K.holds && K.holds(actorId, 'purifiedblood')) { return 0; } } catch (e) { }
    // A cooked meal's help (MEAL_GUARD), while it lasts.
    var r = rec || read(actorId);
    if (r.guard && Date.now() < r.guard.until) { chance = chance * r.guard.mult; }
    var P = g.__thornswoodProgression;
    var s = stateOf(actorId);
    if (!P || !s) { return chance; }
    var pts = (s.tree && has(s.tree, 'toughness')) ? num(s.tree.toughness, 0) : 0;
    var per = 0;
    try { per = num(P.TUNING.perPoint.toughness.diseaseResist, 0); } catch (e) { per = 0; }
    var resist = Math.min(100, Math.max(0, pts * per));
    return chance * (1 - resist / 100);
  }

  /* One roll at a disease. True when it took. A kind already held is not caught twice. */
  function catchIll(actorId, rec, k, chance, now) {
    if (!has(DISEASE, k) || hasIll(rec, k)) { return false; }
    var c = chanceFor(actorId, chance, rec);
    if (!(c > 0) || Math.random() >= c) { return false; }
    rec.ills.push({ k: k, at: now, cold: false, told: '' });
    hlog(actorId.toString(16), 'caught', DISEASE[k].name);
    return true;
  }

  // ------------------------------------------------------- what it costs --

  var ORDER = ['fine', 'weary', 'bad', 'spent'];
  function worse(a, b) {
    if (!b) { return a; }
    return ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a;
  }

  /*
    What the needs block reads (#1383, "nothing in the needs block reads a
    disease"): the band each meter counts as at least, and the actor values
    the wounds and an agreed loss add.
  */
  function forNeeds(actorId) {
    var rec = read(actorId);
    var now = Date.now();
    var floors = {};
    for (var i = 0; i < rec.ills.length; i++) {
      var stage = stageOf(rec.ills[i], now);
      if (stage === 'caught') { continue; }
      var band = (stage === 'bad') ? 'bad' : 'weary';
      var ms = DISEASE[rec.ills[i].k].meters;
      for (var m in ms) {
        if (has(ms, m)) { floors[m] = worse(floors[m] || 'fine', band); }
      }
    }
    var add = {};
    function plus(cost) {
      for (var av in cost) {
        if (has(cost, av)) { add[av] = (has(add, av) ? add[av] : 0) + cost[av]; }
      }
    }
    var limbs = {};
    for (var w = 0; w < rec.wounds.length; w++) {
      if (rec.wounds[w].k === 'break') { limbs[rec.wounds[w].limb] = true; }
    }
    if (limbs.arm) { plus(HURT.broken.arm); }
    if (limbs.leg) { plus(HURT.broken.leg); }
    if (rec.crooked.arm) { plus(HURT.crooked.arm); }
    if (rec.crooked.leg) { plus(HURT.crooked.leg); }
    if (rec.agreed.eye) { plus(HURT.eye); }
    return { floors: floors, add: add };
  }

  /*
    THE BURN ON WHAT YOU WEAR. injury.md: clothing on that part counts at half
    for warmth until it heals. The server is not told where the fire touched
    and the client puts the flames on the whole body, so it is everything
    worn (Patrick's answer on #1383, 4 October). The needs block's
    insulation() asks.
  */
  function burntWear(actorId) {
    var rec = read(actorId);
    for (var i = 0; i < rec.wounds.length; i++) {
      var w = rec.wounds[i];
      if (w.k === 'burn' && w.dealt >= HURT.burn.bad) { return { all: true, counts: HURT.burn.warmth }; }
    }
    return null;
  }

  // ------------------------------------------------------ what you see --

  var WORDS = {
    chill: 'Chilled', food: 'Food sickness', fouled: 'Fouled water',
    fever: 'Wound fever', bite: 'Bite sickness'
  };

  /* The short lines the left edge of the screen draws. A disease still in
     its caught window is not one of them: "a cure in that window and it
     never shows". */
  function lines(rec, now) {
    var out = [];
    var bleeding = 0, slowed = true;
    for (var i = 0; i < rec.wounds.length; i++) {
      var w = rec.wounds[i];
      if ((w.k === 'cut' || w.k === 'bite') && w.bleed) { bleeding++; if (!w.cloth) { slowed = false; } }
    }
    if (bleeding) { out.push(slowed ? 'Bleeding, slowed' : 'Bleeding'); }
    for (var j = 0; j < rec.wounds.length; j++) {
      var x = rec.wounds[j];
      if (x.k === 'cut' && !x.bleed) { out.push(x.closed ? 'Cut, closed' : (x.bandage ? 'Cut, bandaged' : 'Open cut')); }
      if (x.k === 'bite' && !x.bleed) { out.push((x.closed || x.bandage) ? 'Bite, closed' : 'Open bite'); }
      if (x.k === 'break') {
        out.push('Broken ' + x.limb + (x.set ? ', set' : (x.splint ? ', splinted' : '')));
      }
      if (x.k === 'burn' && x.dealt >= HURT.burn.bad) { out.push('Bad burn'); }
    }
    if (rec.crooked.arm) { out.push('Crooked arm'); }
    if (rec.crooked.leg) { out.push('Crooked leg'); }
    if (rec.agreed.hand) { out.push('Missing hand'); }
    if (rec.agreed.eye) { out.push('Missing eye'); }
    for (var k = 0; k < rec.ills.length; k++) {
      var stage = stageOf(rec.ills[k], now);
      if (stage === 'caught') { continue; }
      out.push(WORDS[rec.ills[k].k] + (stage === 'bad' ? ', bad' : ''));
    }
    return out;
  }

  function tell(actorId, line) {
    if (!line) { return; }
    try { notify(actorId, line); } catch (e) { }
    try { say(actorId, line); } catch (e) { }
  }

  /*
    A CHANGE HAS TO REACH THE CHARACTER, for the reason written over
    pushEffects in the needs block: the costs ride on the skills panel, and
    the panel is only written when the character changes. So a disease that
    shows, worsens or clears, and a wound that comes or goes, asks the
    character block to redraw.
  */
  function redraw(actorId) {
    try {
      var c = g.__thornswoodCharacter;
      if (!c || !c.stateOf || !c.writeState) { return; }
      var s = c.stateOf(actorId);
      if (s) { c.writeState(actorId, s, true); }
    } catch (e) { }
  }

  // ---------------------------------------------------------- the tick --

  /*
    WHAT THE NEEDS BLOCK KNOWS ABOUT WHERE YOU ARE. Read, never written: the
    chill is caught and cleared by the rest and the warmth that block already
    keeps. A bed is the beds' answer in the property block (#1392), a fire is
    the distance the client reports. read, not settle: the needs tick settles
    every 20 seconds, and a clock an hour long needs nothing fresher, nor a
    second write of that property.
  */
  function needsNow(actorId) {
    var N = g.__thornswoodNeeds;
    if (!N || !N.read) { return null; }
    try { return N.read(actorId); } catch (e) { return null; }
  }

  // The rest kinds that are lying in a bed or a bedroll (NEEDS.recover), and
  // bedroll for a record stored before the ladder.
  var IN_BED = { rough: true, camp: true, inn: true, bed: true, bedroll: true };

  var ILL_WORDS = {
    chill: 'A chill has settled in. A fire, a bed or getting warm again will shake it.',
    food: 'Your stomach turns. Food sickness, for a while.',
    fouled: 'The water was bad. You are sick with it for a while.',
    fever: 'Wound fever. A potion of cure disease or a temple shrine will clear it.',
    bite: 'The bite has gone bad: bite sickness. A potion of cure disease or a temple shrine will clear it.'
  };

  /*
    Bring one person's record up to now. Answers the lines worth saying and
    whether anything changed. Everything is worked from real time, the way the
    needs are, so a restart, a slow tick or a night away all land on the same
    answer.
  */
  function step(actorId, rec, now) {
    var said = [];
    var changed = false;
    var n = needsNow(actorId);
    var N = g.__thornswoodNeeds;

    /*
      THE CHILL. An hour of sleep on open ground: resting at the sitting rate,
      a seat with no fire in reach (exhaustion.md, "sleeping on open ground is
      sitting, 20 an hour"), with no roof and not indoors. Or an hour at spent
      cold. Each clock starts again once it has caught.
    */
    if (n && N) {
      var open = n.resting === 'sit' && !n.roof && !!n.place && n.place !== 'indoors';
      if (open) {
        if (!rec.ground) { rec.ground = now; changed = true; }
        else if (minutesSince(rec.ground, now) >= CHILL_AFTER_MIN) {
          catchIll(actorId, rec, 'chill', 1, now);
          rec.ground = now; changed = true;
        }
      } else if (rec.ground) { rec.ground = 0; changed = true; }

      var t = N.tempBand ? N.tempBand(n.temp) : { name: 'fine', cold: false };
      if (t.cold && t.name === 'spent') {
        if (!rec.cold) { rec.cold = now; changed = true; }
        else if (minutesSince(rec.cold, now) >= CHILL_AFTER_MIN) {
          catchIll(actorId, rec, 'chill', 1, now);
          rec.cold = now; changed = true;
        }
      } else if (rec.cold) { rec.cold = 0; changed = true; }
    }

    /*
      THE WOUNDS' OWN CLOCKS. At 10 minutes a cut, a bite and a bad burn roll
      wound fever, and a bite rolls bite sickness. A cut or a bite whose bleed
      has stopped and whose rolls are done has nothing left to do and leaves
      the list. A break heals 3 days after it was set, or crooked 3 days after
      it happened if nobody set it. A burn heals in a day.
    */
    var keep = [];
    for (var i = 0; i < rec.wounds.length; i++) {
      var w = rec.wounds[i];
      var m = minutesSince(w.at, now);
      if ((w.k === 'cut' || w.k === 'bite') && !w.rolled && m >= HURT.feverAfter) {
        if (!w.closed) {
          var fc = w.poultice ? HURT.fever.poultice : (w.bandage ? HURT.fever.bandage : HURT.fever.open);
          catchIll(actorId, rec, 'fever', fc, now);
        }
        if (w.k === 'bite') {
          catchIll(actorId, rec, 'bite', (w.closed || w.bandage) ? HURT.bite.closed : HURT.bite.open, now);
        }
        w.rolled = true; changed = true;
      }
      if ((w.k === 'cut' || w.k === 'bite') && w.rolled && !w.bleed) { changed = true; continue; }
      if (w.k === 'burn') {
        if (!w.rolled && m >= HURT.feverAfter) {
          var bc = w.poultice ? HURT.fever.poultice : (w.bandage ? HURT.fever.bandage : HURT.fever.open);
          catchIll(actorId, rec, 'fever', bc, now);
          w.rolled = true; changed = true;
        }
        if (now - w.at >= HURT.burn.healDays * DAY) {
          said.push('The burn has healed.'); changed = true; continue;
        }
      }
      if (w.k === 'break') {
        if (w.set && now - w.set >= HURT.breakDays * DAY) {
          said.push('Your broken ' + w.limb + ' has healed.'); changed = true; continue;
        }
        if (!w.set && now - w.at >= HURT.breakDays * DAY) {
          rec.crooked[w.limb] = now;
          said.push('Your broken ' + w.limb + ' has healed crooked. A master physicker or a temple shrine can put it right.');
          changed = true; continue;
        }
      }
      keep.push(w);
    }
    rec.wounds = keep;

    /*
      THE DISEASES. A chill clears at a fire, in a bed, or once you are warm
      again after being cold, and on its own after 2 hours. Food sickness and
      fouled water pass. A fever and bite sickness wait for a cure. Each says
      so once when it shows and once when it turns bad.
    */
    var ills = [];
    for (var j = 0; j < rec.ills.length; j++) {
      var ill = rec.ills[j];
      var d = DISEASE[ill.k];
      if (runOut(ill, now)) {
        if (stageOf(ill, now) !== 'caught') { said.push('The ' + d.name + ' has passed.'); }
        changed = true; continue;
      }
      if (ill.k === 'chill' && n && N) {
        var tb = N.tempBand ? N.tempBand(n.temp) : { name: 'fine', cold: false };
        var reach = (N.NEEDS && N.NEEDS.fire) ? N.NEEDS.fire.reach : 300;
        var fire = typeof n.fire === 'number' && n.fire >= 0 && n.fire < reach;
        // Any bed or bedroll, whoever's: the ladder's rough, camp, inn and bed (#1603).
        var bed = has(IN_BED, n.resting);
        var warm = tb.name === 'fine' && ill.cold;
        if (fire || bed || warm) {
          if (stageOf(ill, now) !== 'caught') {
            said.push(fire ? 'The fire shakes the chill off.'
              : (bed ? 'The bed shakes the chill off.' : 'You are warm again and the chill is gone.'));
          }
          changed = true; continue;
        }
        if (tb.cold && tb.name !== 'fine' && !ill.cold) { ill.cold = true; changed = true; }
      }
      var stage = stageOf(ill, now);
      if (stage !== 'caught' && ill.told !== stage) {
        said.push(stage === 'bad'
          ? ('The ' + d.name + ' is worse. You cannot work at a bench like this, and waiting will not clear it.')
          : ILL_WORDS[ill.k]);
        ill.told = stage; changed = true;
      }
      ills.push(ill);
    }
    rec.ills = ills;
    return { said: said, changed: changed };
  }

  var TICK_MS = 10000;

  /*
    The lines last written are what the screen and the panel last saw, so a
    change in them is what asks for a redraw. A clock that moved and changed
    nothing on screen is written without one.
  */
  function tick() {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    var now = Date.now();
    for (var i = 0; i < online.length; i++) {
      var who = online[i];
      try {
        var rec = read(who);
        var was = rec.show.join('|');
        var r = step(who, rec, now);
        var shown = lines(rec, now).join('|');
        if (r.changed || shown !== was) { write(who, rec); }
        if (shown !== was) { redraw(who); }
        for (var k = 0; k < r.said.length; k++) { tell(who, r.said[k]); }
      } catch (e) { hlog('tick', who, e); }
    }
  }

  /*
    THE BLEED, every second, for whoever is bleeding. One bleed a person,
    however many cuts: 2 a second, or 1 when every open one is wrapped in torn
    cloth. Taken with the engine's own DamageActorValue, which knows the
    person's most health, so nothing here has to. A bleed that empties it is
    the engine's death with no killer: see the top of this block.
  */
  var BLEED_MS = 1000;

  function bleedRate(rec) {
    var rate = 0;
    for (var i = 0; i < rec.wounds.length; i++) {
      var w = rec.wounds[i];
      if ((w.k === 'cut' || w.k === 'bite') && w.bleed) {
        rate = Math.max(rate, w.cloth ? HURT.bleed.cloth : HURT.bleed.open);
      }
    }
    return rate;
  }

  function bleedTick() {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    for (var i = 0; i < online.length; i++) {
      var who = online[i];
      var dead = false;
      try { dead = !!mp.get(who, 'isDead'); } catch (e) { continue; }
      if (dead) { continue; }
      var rate = bleedRate(read(who));
      if (!rate) { continue; }
      try {
        mp.callPapyrusFunction('method', 'Actor', 'DamageActorValue',
          { type: 'form', desc: mp.getDescFromId(who) }, ['Health', rate]);
      } catch (e) { hlog('could not bleed', who.toString(16) + ':', e); }
    }
  }

  // -------------------------------------------------------- the wounds --

  function blank(k, limb, now) {
    return { k: k, at: now, limb: limb === 'leg' ? 'leg' : 'arm', bleed: false, cloth: false,
             bandage: false, poultice: false, closed: false, rolled: false,
             splint: false, set: 0, dealt: 0 };
  }

  /* A cut, a bite or a break, opened now. Answers what to tell them, or '' when the record is full. */
  function wound(actorId, k, limb, now) {
    if (k !== 'cut' && k !== 'bite' && k !== 'break') { return ''; }
    var rec = read(actorId);
    now = now || Date.now();
    if (rec.wounds.length >= HURT.most) { return ''; }
    var w = blank(k, limb, now);
    var line = '';
    if (k === 'cut') { w.bleed = true; line = 'You are cut and bleeding.'; }
    else if (k === 'bite') { w.bleed = true; line = 'You are bitten and bleeding.'; }
    else { line = 'Your ' + w.limb + ' is broken.'; }
    rec.wounds.push(w);
    write(actorId, rec);
    redraw(actorId);
    return line;
  }

  /*
    THE FIRE, TIMED. The client reports /burn 1 when it catches and every few
    seconds while it burns, and /burn 0 when it goes out. A report after a
    long silence is a new fire. What it dealt is the seconds it burned at the
    coals' rate; 30 or more is a bad burn. Answers what to tell them, or ''.
  */
  // actorId -> { from, last }. On globalThis, so a hot reload mid fire keeps its start.
  if (!g.__thornswoodHurtFires) { g.__thornswoodHurtFires = {}; }
  var fires = g.__thornswoodHurtFires;
  var FIRE_GAP_MS = 6000;  // the needs block lets go of a silent client after three of its beats

  /*
    A FIRE NOBODY PUT OUT STILL BURNT (#2260). The burn used to be written
    only when the client said /burn 0, so logging out while alight, or a
    client that went quiet, sent no 0 and left no burn. Now a fire silent past
    FIRE_GAP_MS is settled at its last report: by the next /burn, and by the
    hurt tick for somebody who never came back to send one.
  */
  function burning(actorId, on, now) {
    now = now || Date.now();
    var f = has(fires, actorId) ? fires[actorId] : null;
    if (on) {
      if (f && (now - f.last) > FIRE_GAP_MS) { settleFire(actorId, f.last); f = null; }
      if (!f) { fires[actorId] = { from: now, last: now }; }
      else { f.last = now; }
      return '';
    }
    if (!f) { return ''; }
    return settleFire(actorId, (now - f.last) > FIRE_GAP_MS ? f.last : now);
  }
  /* Fires gone quiet, settled at their last report. Run from the hurt tick. */
  function settleQuietFires(now) {
    now = now || Date.now();
    for (var k in fires) {
      if (has(fires, k) && (now - fires[k].last) > FIRE_GAP_MS) { settleFire(Number(k), fires[k].last); }
    }
  }
  function settleFire(actorId, now) {
    var f = has(fires, actorId) ? fires[actorId] : null;
    if (!f) { return ''; }
    delete fires[actorId];
    var seconds = Math.max(1, Math.round((now - f.from) / 1000));
    var dealt = seconds * HURT.burn.perSecond;
    if (dealt < HURT.burn.bad) { return ''; }
    var rec = read(actorId);
    var had = null;
    for (var i = 0; i < rec.wounds.length; i++) { if (rec.wounds[i].k === 'burn') { had = rec.wounds[i]; } }
    if (had) {
      // One burn on a body, and the newest fire starts its day and its 10 minutes again.
      had.at = now; had.dealt = Math.max(had.dealt, dealt); had.rolled = false;
      had.bandage = false; had.poultice = false;
    } else if (rec.wounds.length < HURT.most) {
      var b = blank('burn', '', now);
      b.dealt = dealt;
      rec.wounds.push(b);
    }
    write(actorId, rec);
    redraw(actorId);
    hlog(actorId.toString(16), 'burnt for', seconds, 'seconds,', dealt, 'health');
    return 'That fire burnt you badly. What you wear keeps half its warmth until the burn heals, in a day.';
  }

  /*
    WHAT ONE HEALING SPELL DOES, by the spell's own rank. Answers a line, or ''
    when it changed nothing.
  */
  function healed(actorId, rank) {
    var at = RANKS.indexOf(rank);
    if (at < 0) { return ''; }
    var rec = read(actorId);
    var did = [];
    for (var i = 0; i < rec.wounds.length; i++) {
      var w = rec.wounds[i];
      if (w.k === 'cut' || w.k === 'bite') {
        if (at >= 1 && !w.closed) { w.closed = true; w.bleed = false; did.push('closed'); }
        else if (w.bleed) { w.bleed = false; did.push('stopped'); }
      }
      if (w.k === 'break' && at >= 2 && w.splint && !w.set) { w.set = Date.now(); did.push('set'); }
    }
    if (!did.length) { return ''; }
    write(actorId, rec);
    redraw(actorId);
    if (did.indexOf('set') !== -1) { return 'The spell sets the splinted bone. It heals in 3 days.'; }
    if (did.indexOf('closed') !== -1) { return 'The spell closes the wound.'; }
    return 'The spell stops the bleeding. The wound is still open.';
  }

  function spellRank(source) {
    var P = g.__thornswoodProgression;
    var desc = (source && typeof source === 'object') ? String(source.desc || '') : String(source || '');
    if (!P || !P.spellByDesc || !desc) { return null; }
    var sp = null;
    try { sp = P.spellByDesc(desc); } catch (e) { sp = null; }
    if (!sp || !has(HEALING, sp.name)) { return null; }
    return { name: sp.name, rank: sp.rank, self: HEALING[sp.name].self };
  }

  function personal(id) {
    try { return Number(mp.get(id, 'profileId')) > 0; } catch (e) { return false; }
  }

  /* A cast, heard from onPapyrusEvent:OnSpellCast: a healing spell on yourself. */
  function cast(casterId, spell) {
    var s = spellRank(spell);
    if (!s || !s.self || !personal(casterId)) { return; }
    tell(casterId, healed(casterId, s.rank));
  }

  /* A hit, heard from onPapyrusEvent:OnHit: a healing spell landing on somebody. */
  function hit(targetId, aggressor, source) {
    var s = spellRank(source);
    if (!s || s.self || !personal(targetId)) { return; }
    tell(targetId, healed(targetId, s.rank));
  }

  // ----------------------------------------------- the blow that opens one --

  /*
    WHICH BLOW OPENS A WOUND. Patrick's answer on #1383, 4 October:

      a cut    an unblocked power or sneak attack with a blade or an axe, or
               an arrow or a bolt that lands;
      a break  an unblocked power attack with a mace or a warhammer, the arm
               or the leg at even odds;
      a bite   an unblocked hit from an animal that bites: a wolf, a dog, a
               bear, a sabre cat, a skeever, a spider, a chaurus, a troll, a
               horker or a slaughterfish.

    A bash is a shove with the shield or the hilt, and a spell is none of
    these. Held back until a bandage existed, because a cut only a mage could
    stop would kill anybody else in about a minute.

    WHAT THE WEAPON IS, off its record. The weapon type keyword Skyrim puts on
    every weapon (WeapTypeSword and the rest), read by its editor id so no form
    id is remembered here; failing that, the animation type, the first byte of
    DNAM. A bow and a crossbow are told by the animation type alone, the way
    the perks block tells them. The animation type cannot tell a battleaxe
    from a warhammer, which swing alike, so without a keyword that one opens
    nothing.

    WHICH ANIMALS BITE is the warrior block's own lines of races by animal
    (WARRIOR_KILL), so a wolf here is the same races a wolf is there, and the
    race is the one the engine says the body has (raceEdidOf).

    MEASURED, NOT ASSUMED. OnHit is raised before the engine works the damage
    out, and a hit the engine then throws away raised it all the same. So
    health is read at the event and again on the next turn, the way the perks
    and the maneuvers measure a blow, and only a blow that took health and
    left the person standing opens a wound. A blow that killed is the death.
  */
  var BITERS = ['wolf', 'dog', 'bear', 'sabre cat', 'skeever', 'spider', 'chaurus', 'troll',
                'horker', 'slaughterfish'];
  var WEAPON_TYPES = {
    WeapTypeSword: 'blade', WeapTypeGreatsword: 'blade', WeapTypeDagger: 'blade',
    WeapTypeWarAxe: 'axe', WeapTypeBattleaxe: 'axe',
    WeapTypeMace: 'blunt', WeapTypeWarhammer: 'blunt'
  };
  // DNAM's animation type: 1 sword, 2 dagger, 3 war axe, 4 mace, 5 two handed
  // sword, 7 bow, 9 crossbow. 6, the two handed axe, is a battleaxe or a hammer.
  var BY_ANIM = { 1: 'blade', 2: 'blade', 3: 'axe', 4: 'blunt', 5: 'blade', 7: 'bow', 9: 'bow' };
  var weaponKinds = {};
  var biterRaces = null;

  function recordOf(id) {
    try { return mp.lookupEspmRecordById(id) || null; } catch (e) { return null; }
  }
  function fieldOf(res, type) {
    var fields = (res && res.record && res.record.fields) || [];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i] && String(fields[i].type) === type) { return fields[i].data || []; }
    }
    return null;
  }
  function textOf(v) {
    if (typeof v === 'string') { return v; }
    var out = '';
    for (var i = 0; v && i < v.length && v[i]; i++) { out += String.fromCharCode(v[i]); }
    return out;
  }
  function editorIdOf(res) {
    var e = (res && res.record) ? textOf(res.record.editorId) : '';
    return e || textOf(fieldOf(res, 'EDID'));
  }

  /* What landed it: 'blade', 'axe', 'blunt', 'bow', 'spell', or '' for a
     fist, a claw or anything else. Asked once per base. */
  function weaponKind(id) {
    if (!id) { return ''; }
    if (has(weaponKinds, id)) { return weaponKinds[id]; }
    var kind = '';
    var res = recordOf(id);
    var type = (res && res.record) ? String(res.record.type || '') : '';
    if (type === 'SPEL') { kind = 'spell'; }
    if (type === 'WEAP') {
      var dnam = fieldOf(res, 'DNAM');
      var anim = (dnam && dnam.length) ? Number(dnam[0]) : -1;
      if (anim === 7 || anim === 9) { kind = 'bow'; }
      var kw = fieldOf(res, 'KWDA') || [];
      for (var k = 0; !kind && k + 4 <= kw.length; k += 4) {
        var local = (kw[k] | (kw[k + 1] << 8) | (kw[k + 2] << 16)) + kw[k + 3] * 0x1000000;
        var global = local;
        try {
          if (typeof res.toGlobalRecordId === 'function') { global = Number(res.toGlobalRecordId(local)) || local; }
        } catch (e) { global = local; }
        var word = editorIdOf(recordOf(global));
        if (has(WEAPON_TYPES, word)) { kind = WEAPON_TYPES[word]; }
      }
      if (!kind && has(BY_ANIM, anim)) { kind = BY_ANIM[anim]; }
    }
    weaponKinds[id] = kind;
    return kind;
  }

  /* The races that bite, lower case, by the warrior block's lines. */
  function bitingRaces() {
    if (biterRaces) { return biterRaces; }
    var out = {};
    var rows = (typeof WARRIOR_KILL !== 'undefined' && WARRIOR_KILL)
      ? WARRIOR_KILL.kinds.concat(WARRIOR_KILL.unnamed) : [];
    for (var i = 0; i < rows.length; i++) {
      if (BITERS.indexOf(rows[i][0]) === -1) { continue; }
      for (var j = 0; j < rows[i][2].length; j++) { out[String(rows[i][2][j]).toLowerCase()] = rows[i][0]; }
    }
    biterRaces = out;
    return out;
  }

  function idOfForm(v) {
    if (typeof v === 'number') { return v; }
    if (v && v.desc) {
      try { return Number(mp.getIdFromDesc(String(v.desc))) || 0; } catch (e) { return 0; }
    }
    return 0;
  }

  /* 'cut', 'break', 'bite', or '' when this hit opens nothing. */
  function woundFrom(aggressorId, sourceId, power, sneak, bash, blocked) {
    if (blocked || bash) { return ''; }
    var kind = weaponKind(sourceId);
    if (kind === 'bow') { return 'cut'; }
    if (kind === 'blade' || kind === 'axe') { return (power || sneak) ? 'cut' : ''; }
    if (kind === 'blunt') { return power ? 'break' : ''; }
    if (kind === 'spell') { return ''; }
    var race = '';
    try { race = (typeof raceEdidOf === 'function') ? String(raceEdidOf(aggressorId) || '') : ''; } catch (e) { race = ''; }
    return (race && has(bitingRaces(), race.toLowerCase())) ? 'bite' : '';
  }

  function healthOf(id) {
    try {
      var p = mp.get(id, 'percentages');
      return p ? Number(p.health) : -1;
    } catch (e) { return -1; }
  }

  var blows = [];
  var blowsQueued = false;

  /* A hit, heard from onPapyrusEvent:OnHit: does it open a wound. */
  function blow(targetId, aggressor, source, projectile, power, sneak, bash, blocked) {
    var target = Number(targetId) || 0;
    if (!target || !personal(target)) { return; }
    var by = idOfForm(aggressor);
    if (!by || by === target) { return; }
    var k = woundFrom(by, idOfForm(source), !!power, !!sneak, !!bash, !!blocked);
    if (!k) { return; }
    var before = healthOf(target);
    if (!(before > 0)) { return; }
    blows.push({ target: target, k: k, before: before });
    if (!blowsQueued) {
      blowsQueued = true;
      setTimeout(guard('hurtBlows', landed), 0);
    }
  }

  /* The next turn: each blow that took health and left them standing opens its wound. */
  function landed() {
    blowsQueued = false;
    var all = blows;
    blows = [];
    var now = Date.now();
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      var dead = true;
      try { dead = !!mp.get(b.target, 'isDead'); } catch (e) { dead = true; }
      var after = healthOf(b.target);
      if (dead || !(after > 0) || !(after < b.before)) { continue; }
      var limb = (b.k === 'break') ? (Math.random() < 0.5 ? 'arm' : 'leg') : '';
      var line = wound(b.target, b.k, limb, now);
      if (line) { hlog(b.target.toString(16), 'took a', b.k, limb, 'from a blow'); }
      tell(b.target, line);
    }
  }

  // --------------------------------------------------------- the cures --

  /* The one furthest along, then the oldest. Answers it, or null. */
  function cureOne(rec, now) {
    var best = -1, bestStage = -1;
    for (var i = 0; i < rec.ills.length; i++) {
      var st = ['caught', 'ill', 'bad'].indexOf(stageOf(rec.ills[i], now));
      if (st > bestStage || (st === bestStage && rec.ills[i].at < rec.ills[best].at)) { best = i; bestStage = st; }
    }
    if (best < 0) { return null; }
    return { ill: rec.ills.splice(best, 1)[0], shown: bestStage > 0 };
  }

  /*
    SOMETHING DRUNK FROM THE PACK (mp.onEatItem, below). A potion of cure
    disease clears one ordinary disease. It is still the thirst sip, which the
    needs block gives from the same event (eaten). Answers a line, or ''.
  */
  function swallowed(actorId, baseId) {
    var cure = false;
    for (var i = 0; i < CURE_DISEASE.length; i++) {
      var id = 0;
      try { id = idOf(CURE_DISEASE[i]); } catch (e) { id = 0; }
      if (id && id === baseId) { cure = true; }
    }
    var rec = read(actorId);
    // A bottle of cure disease somebody brewed (brewed, below).
    var brew = !cure && baseId >= RUNTIME && rec.brews.indexOf(baseId) !== -1;
    if (!cure && !brew) { return ''; }
    var gone = cureOne(rec, Date.now());
    if (!gone) { return ''; }
    write(actorId, rec);
    redraw(actorId);
    hlog(actorId.toString(16), 'cured of', DISEASE[gone.ill.k].name, brew ? 'by a brewed potion' : 'by a potion');
    return gone.shown ? ('The ' + DISEASE[gone.ill.k].name + ' is gone.') : '';
  }

  /*
    A BREW AT A LAB, from the alchemy gate (recipelessCraft), with the magic
    effects the engine worked out from the ingredients. Remembers baseId as
    a bottle of cure disease when the brew carries CURE_DISEASE_EFFECT, and
    forgets it when it does not, because a runtime id is the brewing client's
    and the same number can be handed out again for another brew after a
    relog. Answers whether this brew cures.
  */
  function brewed(actorId, baseId, effects) {
    baseId = Number(baseId) || 0;
    if (baseId < RUNTIME || !Array.isArray(effects)) { return false; }
    var cureEffect = 0;
    try { cureEffect = idOf(CURE_DISEASE_EFFECT); } catch (e) { cureEffect = 0; }
    var cures = false;
    for (var i = 0; i < effects.length; i++) {
      if (cureEffect && (Number(effects[i]) || 0) === cureEffect) { cures = true; }
    }
    var rec = read(actorId);
    var at = rec.brews.indexOf(baseId);
    if (at === -1 && !cures) { return false; }
    if (at !== -1) { rec.brews.splice(at, 1); }
    if (cures) {
      rec.brews.push(baseId);
      while (rec.brews.length > BREWS_MOST) { rec.brews.shift(); }
    }
    write(actorId, rec);
    return cures;
  }

  /*
    A COOKED MEAL THAT GUARDS AGAINST DISEASE (MEAL_GUARD). feast is true for
    a feast. The latest meal's help is the one that counts: a cooked meal's
    help is "one of these, not all of them". minutes, when given, is how long
    it lasts instead of the row's: a fine dish's 30 (#2906). Answers true.
  */
  function guarded(actorId, feast, minutes) {
    var row = feast ? MEAL_GUARD.feast : MEAL_GUARD.cooked;
    var lasts = Number(minutes) > 0 ? Number(minutes) : row.min;
    var rec = read(actorId);
    rec.guard = { until: Date.now() + lasts * MIN, mult: row.mult };
    write(actorId, rec);
    return true;
  }

  /*
    THE GUARD TAKEN OFF (#2682). The latest meal's help is the one that
    counts, so a later meal's warmth or stamina replaces the guard. The 20
    minutes is rec.guard.until, which chanceFor compares against; there is no
    timer to stop. True when a guard was on the record and is now gone; false
    when there was none, and then nothing is written.
  */
  function unguarded(actorId) {
    var rec = read(actorId);
    if (!rec.guard) { return false; }
    rec.guard = null;
    write(actorId, rec);
    return true;
  }

  /*
    THE TEMPLE RITE: a shrine pressed inside one of the temples the wake uses
    (the stuck block's TEMPLES, the same cells). injury.md and disease.md: a
    temple sets breaks, clears a crooked heal and clears ordinary disease, and
    does not clear an agreed loss. A wayside shrine is a blessing only
    (Patrick's answer on #1383, 4 October). Answers a line, or ''.
  */
  function inTemple(actorId) {
    var cell = '';
    try { cell = String(mp.get(actorId, 'worldOrCellDesc') || '').toLowerCase(); } catch (e) { return false; }
    var S = g.__thornswoodStuck;
    var list = (S && S.TEMPLES) || [];
    for (var i = 0; i < list.length; i++) {
      if (cell && String(list[i].desc || '').toLowerCase() === cell) { return true; }
    }
    return false;
  }

  function rite(actorId) {
    if (!inTemple(actorId)) { return ''; }
    var rec = read(actorId);
    var did = [];
    if (rec.ills.length) { rec.ills = []; did.push('the sickness'); }
    var set = false;
    for (var i = 0; i < rec.wounds.length; i++) {
      if (rec.wounds[i].k === 'break' && !rec.wounds[i].set) { rec.wounds[i].set = Date.now(); set = true; }
    }
    if (set) { did.push('the break'); }
    if (rec.crooked.arm || rec.crooked.leg) { rec.crooked = {}; did.push('the crooked bone'); }
    if (!did.length) { return ''; }
    write(actorId, rec);
    redraw(actorId);
    hlog(actorId.toString(16), 'had the temple rite:', did.join(', '));
    return 'The temple sees to ' + did.join(' and ') + '.';
  }

  /*
    EXPOSED, for the meal and drink work (#1382): somebody ate raw meat or
    fish ('food', 'raw'), ate at 90 hunger or above ('food', 'full'), or drank
    from a source with a risk ('fouled', 'marsh' and the rest of EXPOSED). The
    chance is EXPOSED's. Answers whether it took, which is not something to
    tell them: a disease in its caught window does not show.
  */
  function exposed(actorId, kind, source) {
    var row = has(EXPOSED, kind) ? EXPOSED[kind] : null;
    if (!row || !has(row, source)) { return false; }
    var rec = read(actorId);
    var took = catchIll(actorId, rec, kind, row[source], Date.now());
    if (took) { write(actorId, rec); }
    return took;
  }

  /*
    THE BENCH. disease.md: while a disease is bad, crafting is refused.
    injury.md: a broken arm, and a missing hand for good, refuse crafting that
    needs both hands. Answers the refusal, or ''. workbenchId is the bench
    reference the craft was made at. Asked only through unfitToMake (#1733),
    the gate every way of making something asks: a bench's own menu, a key
    cut at a forge and a kiln burned by pressing it.
  */
  function craftRefusal(actorId, workbenchId) {
    var rec = read(actorId);
    var now = Date.now();
    for (var i = 0; i < rec.ills.length; i++) {
      if (stageOf(rec.ills[i], now) === 'bad') {
        return 'You are too sick to work: the ' + DISEASE[rec.ills[i].k].name +
               ' is bad. A potion of cure disease or a temple shrine clears it.';
      }
    }
    var arm = false;
    for (var j = 0; j < rec.wounds.length; j++) {
      if (rec.wounds[j].k === 'break' && rec.wounds[j].limb === 'arm') { arm = true; }
    }
    if (!arm && !rec.agreed.hand) { return ''; }
    var kw = '';
    try {
      var base = mp.get(workbenchId, 'baseDesc');
      kw = (typeof BENCH_BY_BASE !== 'undefined' && has(BENCH_BY_BASE, base)) ? BENCH_BY_BASE[base] : '';
    } catch (e) { kw = ''; }
    if (!kw || !has(TWO_HANDS, kw)) { return ''; }
    return rec.agreed.hand
      ? ('Work at ' + TWO_HANDS[kw] + ' takes two hands, and you have one.')
      : ('Work at ' + TWO_HANDS[kw] + ' takes two hands, and your arm is broken.');
  }

  /*
    A DEATH. The temple stopped the death and did not wash the cuts
    (death.md), so every wound and disease stays on the record. The bleed
    stops: the wake is the death being stopped, and a cut still bleeding in
    the temple would kill again before anybody could reach it (Patrick's
    answer on #1383, 4 October). The fire goes out with the body.
  */
  function died(actorId) {
    delete fires[actorId];
    var rec = read(actorId);
    var any = false;
    for (var i = 0; i < rec.wounds.length; i++) {
      if (rec.wounds[i].bleed) { rec.wounds[i].bleed = false; any = true; }
    }
    if (any) { write(actorId, rec); }
  }

  /*
    THE SCAR, the line other people are told when they look at you
    (injury.md). The social block puts it on the look prompt.
  */
  function scarOf(actorId) {
    var rec = read(actorId);
    return rec.agreed.scar ? rec.agreed.scar.text : '';
  }

  // ------------------------------------------------------ the treatments --

  /*
    WHAT TREATS A WOUND, AND WHO MAKES IT. injury.md, who treats what, and
    Patrick's answers on #1383, 4 October:

      torn cloth   anybody, and no item: a bleed from 2 a second to 1. It does
                   not change the fever chance.
      a bandage    a Haberdasher's, at the loom, used by anybody: stops a bleed,
                   and wound fever is 10% instead of 40%.
      a splint     a Woodwright's, at the kiln: holds a break. An expert healing
                   spell sets only a break that is splinted.
      a poultice   a Physicker's, novice, at the alchemy lab: wound fever 5%.
      a remedy     a Physicker's, advanced, at the alchemy lab: closes a cut the
                   way a bandage does, and clears one ordinary disease, wound
                   fever first (disease.md: "the better answer to wound fever").
      setting      a physicker, no item: sets a break, and its 3 days start. A
                   master physicker also clears a crooked heal.

    The four items are MISC records in Thornswood-Content.esp
    (scripts/mods/Add-ContentRecords.py). Skyrim's inventory cannot use a MISC,
    so they are used the way a repair kit is (#1384): in the inventory a key
    opens a panel of your wounds and what you can do for them, and on somebody
    hurt the look prompt's key opens the same panel for them. Its buttons send
    /treat, and nobody types it.

    NOTHING IS TAKEN UNLESS IT HELPS. Each treatment first finds the wound it
    would help, and a refusal leaves the item in the pack.
  */
  var TREAT = {
    bandage:  { name: 'Bandage', item: '154c0:Thornswood-Content.esp',
                maker: 'A Haberdasher makes them at a loom.' },
    splint:   { name: 'Splint', item: '154c1:Thornswood-Content.esp',
                maker: 'A Woodwright makes them at a kiln.' },
    poultice: { name: 'Poultice', item: '154c2:Thornswood-Content.esp',
                maker: 'A Physicker makes them at an alchemy lab.' },
    remedy:   { name: 'Physicker\'s Remedy', item: '154c3:Thornswood-Content.esp',
                maker: 'A Physicker makes them at an alchemy lab, from advanced.' }
  };
  // The panel's rows, in order, and what each is called.
  var TREAT_ROWS = [
    ['cloth', 'Torn cloth'], ['bandage', 'Bandage'], ['splint', 'Splint'],
    ['poultice', 'Poultice'], ['remedy', 'Physicker\'s remedy'], ['set', 'Set the bone']
  ];
  // About 4 metres. The look prompt offers only somebody under the
  // crosshair, and the server measures again when the line arrives.
  var TREAT_REACH = 300;
  // The panel's view, its owner's only (game/ui/thornswood-treat.js).
  var TREAT_VIEW_PROPERTY = 'thornswoodTreatView';

  function cutOrBite(w) { return w.k === 'cut' || w.k === 'bite'; }
  function badBurn(w) { return w.k === 'burn' && w.dealt >= HURT.burn.bad; }
  /* A bandage helps a bleed, and an open cut, bite or bad burn whose fever is still to roll. */
  function bandageHelps(w) {
    if (cutOrBite(w)) { return w.bleed || (!w.closed && !w.bandage && !w.rolled); }
    return badBurn(w) && !w.bandage && !w.rolled;
  }
  /* A poultice helps an open wound whose fever is still to roll. */
  function poulticeHelps(w) {
    return (cutOrBite(w) || badBurn(w)) && !w.closed && !w.poultice && !w.rolled;
  }
  /* The first wound test passes, taking one prefer also passes first. */
  function firstWound(rec, test, prefer) {
    var fallback = null;
    for (var i = 0; i < rec.wounds.length; i++) {
      var w = rec.wounds[i];
      if (!test(w)) { continue; }
      if (!prefer || prefer(w)) { return w; }
      if (!fallback) { fallback = w; }
    }
    return fallback;
  }
  function wordFor(w) { return w.k === 'break' ? 'broken ' + w.limb : w.k; }

  /* Whether anybody could tend anything on this record. */
  function needsCare(rec) {
    for (var i = 0; i < rec.wounds.length; i++) {
      var w = rec.wounds[i];
      if (bandageHelps(w) || poulticeHelps(w) || (w.k === 'break' && !w.set)) { return true; }
    }
    if (rec.crooked.arm || rec.crooked.leg) { return true; }
    var now = Date.now();
    for (var j = 0; j < rec.ills.length; j++) {
      if (stageOf(rec.ills[j], now) !== 'caught') { return true; }
    }
    return false;
  }
  function careOf(actorId) { return needsCare(read(actorId)) || hungOver(actorId); }
  /*
    A hangover is something to tend (#1382): a physicker's remedy ends it
    (docs/systems/drink.md), and the remedy is given from this panel, so the
    inventory's line and the look prompt's row are offered for it too. The
    needs block owns the hangover and says when it starts or ends (care).
  */
  function hungOver(actorId) {
    var needsH = g.__thornswoodNeeds;
    return !!(needsH && needsH.hungOver && needsH.hungOver(actorId));
  }
  /* The needs block's word that a hangover started or ended: care again. */
  function careChanged(actorId) { write(actorId, read(actorId)); }

  /* How many of one treatment the pack holds. */
  function carried(actorId, what) {
    if (!has(TREAT, what) || typeof packCount !== 'function') { return 0; }
    try { return Number(packCount(actorId, TREAT[what].item)) || 0; } catch (e) { return 0; }
  }

  function nameOf(actorId) {
    var soc = g.__thornswoodSocial;
    try { return (soc && soc.nameOfPerson) ? String(soc.nameOfPerson(actorId) || 'somebody') : 'somebody'; }
    catch (e) { return 'somebody'; }
  }

  function within(a, b) {
    try {
      var ca = String(mp.get(a, 'worldOrCellDesc') || '');
      var cb = String(mp.get(b, 'worldOrCellDesc') || '');
      if (!ca || ca !== cb) { return false; }
      var pa = mp.get(a, 'pos'), pb = mp.get(b, 'pos');
      if (!pa || !pb) { return false; }
      var dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
      return (dx * dx + dy * dy + dz * dz) <= TREAT_REACH * TREAT_REACH;
    } catch (e) { return false; }
  }

  function deadNow(id) {
    try { return !!mp.get(id, 'isDead'); } catch (e) { return true; }
  }

  /*
    WHAT ONE TREATMENT WOULD DO, before anything is done. Answers { why },
    the sentence to say, when it cannot be done; or { item, apply } when it
    can: item is what it takes from the doer's pack ('' for nothing), and
    apply changes the record and answers { line, them }, the line for the one
    doing it and the one for the person tended when that is somebody else.
  */
  function plan(doerId, targetId, rec, what, now) {
    var self = doerId === targetId;
    var your = self ? 'your' : (nameOf(targetId) + '\'s');
    var by = self ? '' : nameOf(doerId);
    if (what === 'cloth') {
      var bleeding = rec.wounds.filter(function (w) { return cutOrBite(w) && w.bleed; });
      if (!bleeding.length) { return { why: 'Nothing is bleeding.' }; }
      var bare = bleeding.filter(function (w) { return !w.cloth; });
      if (!bare.length) { return { why: 'The bleeding is already bound with cloth. A bandage stops it.' }; }
      return { item: '', apply: function () {
        bare.forEach(function (w) { w.cloth = true; });
        return { line: 'You tear a strip of cloth and bind ' + your + ' bleeding. It slows. It has not stopped.',
                 them: by + ' binds your bleeding with torn cloth. It slows. It has not stopped.' };
      } };
    }
    if (what === 'bandage') {
      var wb = firstWound(rec, bandageHelps, function (w) { return cutOrBite(w) && w.bleed; });
      if (!wb) { return { why: 'There is no open wound a bandage would help.' }; }
      if (carried(doerId, 'bandage') < 1) { return { why: 'You carry no bandage. ' + TREAT.bandage.maker }; }
      return { item: 'bandage', apply: function () {
        var bled = cutOrBite(wb) && wb.bleed;
        wb.bandage = true;
        if (cutOrBite(wb)) { wb.bleed = false; }
        var after = bled ? ' The bleeding stops.' : '';
        return { line: 'You bandage ' + your + ' ' + wordFor(wb) + '.' + after,
                 them: by + ' bandages your ' + wordFor(wb) + '.' + after };
      } };
    }
    if (what === 'splint') {
      var ws = firstWound(rec, function (w) { return w.k === 'break' && !w.splint && !w.set; });
      if (!ws) { return { why: 'There is no broken bone a splint would hold.' }; }
      if (carried(doerId, 'splint') < 1) { return { why: 'You carry no splint. ' + TREAT.splint.maker }; }
      return { item: 'splint', apply: function () {
        ws.splint = true;
        var still = ' It still has to be set: by a physicker, a temple shrine, or an expert healing spell.';
        return { line: 'You splint ' + your + ' ' + wordFor(ws) + '.' + still,
                 them: by + ' splints your ' + wordFor(ws) + '.' + still };
      } };
    }
    if (what === 'poultice') {
      var wp = firstWound(rec, poulticeHelps, cutOrBite);
      if (!wp) { return { why: 'There is no open wound whose fever is still to come.' }; }
      if (carried(doerId, 'poultice') < 1) { return { why: 'You carry no poultice. ' + TREAT.poultice.maker }; }
      return { item: 'poultice', apply: function () {
        wp.poultice = true;
        return { line: 'You press a poultice on ' + your + ' ' + wordFor(wp) + '. Wound fever is far less likely now.',
                 them: by + ' presses a poultice on your ' + wordFor(wp) + '. Wound fever is far less likely now.' };
      } };
    }
    if (what === 'remedy') {
      var wr = firstWound(rec, function (w) { return cutOrBite(w) && bandageHelps(w); },
                          function (w) { return w.bleed; });
      // A hangover is the remedy's too (#1382, docs/systems/drink.md).
      var needsR = g.__thornswoodNeeds;
      var hung = hungOver(targetId);
      if (!rec.ills.length && !wr && !hung) { return { why: 'There is no sickness, no open cut and no hangover for a remedy.' }; }
      if (carried(doerId, 'remedy') < 1) { return { why: 'You carry no remedy. ' + TREAT.remedy.maker }; }
      return { item: 'remedy', apply: function () {
        var did = [];
        if (wr) { wr.bleed = false; wr.bandage = true; did.push('closes the ' + wordFor(wr)); }
        if (hung && needsR.soberUp(targetId)) { did.push('clears the hangover'); }
        var gone = null;
        for (var i = 0; i < rec.ills.length; i++) {
          if (rec.ills[i].k === 'fever') {
            gone = { shown: stageOf(rec.ills[i], now) !== 'caught', ill: rec.ills.splice(i, 1)[0] };
            break;
          }
        }
        if (!gone) { gone = cureOne(rec, now); }
        if (gone && gone.shown) { did.push('clears the ' + DISEASE[gone.ill.k].name); }
        var words = did.length ? did.join(' and ') + '.' : 'goes down, and nothing you can feel changes.';
        return { line: 'The remedy ' + words, them: by + '\'s remedy ' + words };
      } };
    }
    if (what === 'set') {
      var breaks = rec.wounds.filter(function (w) { return w.k === 'break' && !w.set; });
      var crooked = ['arm', 'leg'].filter(function (l) { return !!rec.crooked[l]; });
      if (!breaks.length && !crooked.length) { return { why: 'There is no broken or crooked bone to set.' }; }
      var P = g.__thornswoodProgression;
      var s = stateOf(doerId);
      var rankOk = function (rank) {
        try { return !!(P && P.canWork && s && P.canWork(s, 'physicker', rank)); } catch (e) { return false; }
      };
      if (!rankOk('novice')) { return { why: 'Only a physicker sets a bone, or a shrine in a temple.' }; }
      var master = rankOk('master');
      if (!breaks.length && !master) { return { why: 'A crooked heal takes a master physicker, or a shrine in a temple.' }; }
      return { item: '', apply: function () {
        var did = [];
        breaks.forEach(function (w) { w.set = now; did.push('the broken ' + w.limb); });
        if (master && crooked.length) {
          rec.crooked = {};
          crooked.forEach(function (l) { did.push('the crooked ' + l); });
        }
        var list = did.join(' and ');
        var heals = breaks.length ? ' A set break heals in ' + HURT.breakDays + ' days.' : '';
        return { line: 'You set ' + list + (self ? '' : ' for ' + nameOf(targetId)) + '.' + heals,
                 them: by + ' sets your ' + did.map(function (d) { return d.replace(/^the /, ''); }).join(' and ') +
                       '.' + heals };
      } };
    }
    return { why: 'That is not a treatment.' };
  }

  /*
    ONE TREATMENT, DONE. Answers { ok, line, them }. The item comes out of
    the doer's pack only once the treatment is sure to help.
  */
  function treat(doerId, targetId, what) {
    var self = doerId === targetId;
    if (!self) {
      if (!personal(targetId)) { return { ok: false, line: 'That is nobody you can tend.' }; }
      if (!within(doerId, targetId)) { return { ok: false, line: 'Stand closer. You tend somebody within arm\'s reach.' }; }
    }
    if (deadNow(targetId)) { return { ok: false, line: 'It is too late for that.' }; }
    var rec = read(targetId);
    var now = Date.now();
    var p = plan(doerId, targetId, rec, String(what || ''), now);
    if (p.why) { return { ok: false, line: p.why }; }
    if (p.item) {
      var took = false;
      try { took = typeof takeItem === 'function' && takeItem(doerId, TREAT[p.item].item, 1); } catch (e) { took = false; }
      if (!took) {
        return { ok: false, line: 'The ' + TREAT[p.item].name + ' could not be taken from your pack. Nothing was done.' };
      }
    }
    var said = p.apply();
    write(targetId, rec);
    redraw(targetId);
    hlog(doerId.toString(16), 'tended', targetId.toString(16) + ':', what);
    return { ok: true, line: said.line, them: self ? '' : said.them };
  }

  /* What the panel shows: the wounds, and each treatment with whether it can be done and why not. */
  function viewFor(doerId, targetId, note) {
    var self = doerId === targetId;
    var rec = read(targetId);
    var now = Date.now();
    var dead = deadNow(targetId);
    var rows = [];
    for (var i = 0; i < TREAT_ROWS.length; i++) {
      var what = TREAT_ROWS[i][0];
      var p = dead ? { why: 'It is too late for that.' } : plan(doerId, targetId, rec, what, now);
      rows.push({ id: what, name: TREAT_ROWS[i][1], can: !p.why, why: p.why || '',
                  count: has(TREAT, what) ? carried(doerId, what) : -1 });
    }
    return { open: true, who: self ? '' : nameOf(targetId), target: self ? 'me' : targetId.toString(16),
             lines: lines(rec, now), rows: rows, note: String(note || '') };
  }

  var treatShownAt = 0;
  function showTreat(actorId, view) {
    var payload = JSON.parse(JSON.stringify(view || { open: false }));
    treatShownAt = Math.max(Date.now(), treatShownAt + 1);
    payload.at = treatShownAt;
    try { mp.set(actorId, TREAT_VIEW_PROPERTY, payload); } catch (e) {
      hlog('could not send the treatment panel to', actorId.toString(16) + ':', e);
    }
  }

  /*
    WHAT THE INVENTORY KEY, THE LOOK PROMPT AND THE PANEL SEND, as the words
    after /treat. Nothing: your own panel. A form id: theirs, the one the
    look prompt sends. Either, or me, then one of cloth, bandage, splint,
    poultice, remedy or set: do it, then draw the panel again. Answers the
    line to say in the chat, or '' for none.
  */
  function panel(actorId, words) {
    words = words || [];
    var first = String(words[0] || '').trim();
    var target = actorId;
    if (first && first.toLowerCase() !== 'me') {
      var soc = g.__thornswoodSocial;
      var found = (soc && soc.findPerson) ? soc.findPerson(first) : null;
      if (!found || !found.actorId) { return (found && found.why) || 'Nobody here by that name.'; }
      target = found.actorId;
    }
    if (target !== actorId && !within(actorId, target)) {
      return 'Stand closer. You tend somebody within arm\'s reach.';
    }
    var what = String(words[1] || '').toLowerCase();
    var note = '';
    if (what) {
      var r = treat(actorId, target, what);
      note = r.line;
      if (r.ok && r.them) { tell(target, r.them); }
    }
    showTreat(actorId, viewFor(actorId, target, note));
    return note;
  }

  // ------------------------------------------------------ staff, /hurt --

  /*
    /hurt <person> [what], for staff, through the staff block. A
    Gamemaster's scene needs a wound before the world opens one, and an
    agreed loss is agreed out of character, so staff are the ones who write
    it down. words are the words after the person. Answers { staff, them }.

      /hurt <person>                         what they have
      /hurt <person> cut | bite | break arm | break leg
      /hurt <person> chill | food | fouled | fever | bitesick
                                             caught now, with no roll
      /hurt <person> agreed hand | eye | scar <what people are told>
                                             they said yes, out of character
      /hurt <person> unagree hand | eye | scar   written down by mistake
      /hurt <person> clear                   every wound and disease, not an agreed loss
  */
  var STAFF_ILLS = { chill: 'chill', food: 'food', fouled: 'fouled', fever: 'fever', bitesick: 'bite' };

  function summary(rec, now) {
    var l = lines(rec, now);
    for (var i = 0; i < rec.ills.length; i++) {
      if (stageOf(rec.ills[i], now) === 'caught') { l.push(DISEASE[rec.ills[i].k].name + ' (caught, not showing yet)'); }
    }
    if (rec.agreed.scar) { l.push('a scar: ' + rec.agreed.scar.text); }
    return l.length ? l.join(', ') + '.' : 'nothing.';
  }

  function staff(actorId, words, byName) {
    var w = (words || []).map(function (s) { return String(s); });
    var what = String(w[0] || '').toLowerCase();
    var rec = read(actorId);
    var now = Date.now();
    if (!what) { return { staff: 'They have ' + summary(rec, now), them: '' }; }
    if (what === 'cut' || what === 'bite' || what === 'break') {
      var limb = String(w[1] || '').toLowerCase();
      if (what === 'break' && limb !== 'arm' && limb !== 'leg') {
        return { staff: 'Break which? /hurt <person> break arm, or break leg.', them: '' };
      }
      var line = wound(actorId, what, limb, now);
      return line ? { staff: 'Done. They have ' + summary(read(actorId), now), them: line }
                  : { staff: 'They already carry as many wounds as the record holds.', them: '' };
    }
    if (has(STAFF_ILLS, what)) {
      var k = STAFF_ILLS[what];
      if (hasIll(rec, k)) { return { staff: 'They already have ' + DISEASE[k].name + '.', them: '' }; }
      rec.ills.push({ k: k, at: now, cold: false, told: '' });
      write(actorId, rec);
      return { staff: 'Done. The ' + DISEASE[k].name + ' shows in ' + CAUGHT_MIN + ' minutes unless it is cured first.', them: '' };
    }
    if (what === 'agreed' || what === 'unagree') {
      var part = String(w[1] || '').toLowerCase();
      if (part !== 'hand' && part !== 'eye' && part !== 'scar') {
        return { staff: what === 'agreed' ? 'Agreed what? hand, eye, or scar <what people are told>.' : 'Which? hand, eye, or scar.', them: '' };
      }
      if (what === 'unagree') {
        if (!rec.agreed[part]) { return { staff: 'There is no agreed ' + part + ' on them.', them: '' }; }
        delete rec.agreed[part];
        write(actorId, rec);
        redraw(actorId);
        return { staff: 'Taken off the record.', them: 'Staff took the agreed ' + part + ' off your character.' };
      }
      // Drawn on other people's screens, so nothing in it can be markup.
      var text = w.slice(2).join(' ').replace(/[<>&"]/g, '').trim().slice(0, 200);
      if (part === 'scar' && !text) {
        return { staff: 'What is the scar? /hurt <person> agreed scar <what people are told when they look at you>.', them: '' };
      }
      rec.agreed[part] = { at: now, by: String(byName || ''), text: text };
      write(actorId, rec);
      redraw(actorId);
      var told = {
        hand: 'Your character has lost a hand, as you agreed. Work that takes two hands is closed to you.',
        eye: 'Your character has lost an eye, as you agreed. A bow or a spell does a fifth less damage.',
        scar: 'Your character carries a scar, as you agreed. People who look at you are told: ' + text
      };
      return { staff: 'Written down.', them: told[part] };
    }
    if (what === 'clear') {
      rec.wounds = []; rec.ills = []; rec.crooked = {}; rec.cold = 0; rec.ground = 0;
      write(actorId, rec);
      redraw(actorId);
      return { staff: 'Cleared. An agreed loss stays.', them: 'Staff cleared your wounds and sickness.' };
    }
    return { staff: 'That is not something /hurt knows. cut, bite, break arm, break leg, chill, food, ' +
                    'fouled, fever, bitesick, agreed, unagree, clear.', them: '' };
  }

  // ------------------------------------------------------- the screen --

  /*
    WHAT YOU HAVE, ON THE LEFT EDGE. An updateOwner script, like the needs
    bars, so it ships with the gamemode and needs no release. Edge triggered
    on the lines, because updateOwner runs every frame. Nothing is drawn while
    there is nothing to say. Left of the middle of the screen, because the
    corners are taken: the game's notifications top left, the chat and the
    needs bars bottom left, the voice mark top right.
  */
  function hudScript() {
    var CSS = 'position:fixed;left:18px;top:40%;z-index:2147483500;' +
              'pointer-events:none;font-family:Georgia,serif;font-size:20px;' +
              'letter-spacing:.04em;color:#e0a98f;' +
              'background:rgba(12,10,8,.62);border:2px solid rgba(0,0,0,.65);' +
              'border-radius:10px;padding:9px 16px 11px;' +
              'text-shadow:0 2px 4px rgba(0,0,0,.95)';
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    var st = ctx.state;',
      '    if (!st) { return; }',
      '    var show = (v && v.show && v.show.length) ? v.show : [];',
      '    var limbs = (v && v.limbs) ? v.limbs : {};',
      '    var sig = "hurt:" + show.join("|") + ((v && v.care) ? "|care" : "") +',
      '      (limbs.arm ? "|arm" : "") + (limbs.leg ? "|leg" : "");',
      '    if (st.thornswoodHurtHud === sig) { return; }',
      '    st.thornswoodHurtHud = sig;',
      // The front plugin offers Tend your wounds in the inventory while there
      // is something to tend (#1383). The globalThis a plugin sees; see the
      // note over thornswoodCatchFire.
      '    try { globalThis.thornswoodHurtCare = (v && v.care) ? 1 : 0; } catch (e) { }',
      // And whether a leg is broken (#1383): the plugin shuts the sprint gate.
      // A broken arm's dearer block is charged by the server (BLOCK.brokenArm).
      '    try { globalThis.thornswoodBrokenLimbs = { leg: limbs.leg ? 1 : 0 }; } catch (e) { }',
      '    var html = "";',
      '    for (var i = 0; i < show.length; i++) {',
      '      html += "<div>" + String(show[i]).replace(/[<>&]/g, "") + "</div>";',
      '    }',
      '    var src = "(function(){try{" +',
      '      "var d=document.getElementById(\'ts-hurt\');" +',
      '      "if(!d){d=document.createElement(\'div\');d.id=\'ts-hurt\';" +',
      '      "d.style.cssText=" + ' + JSON.stringify(JSON.stringify(CSS)) + ' + ";" +',
      '      "document.body.appendChild(d);}" +',
      '      "d.innerHTML=" + JSON.stringify(html) + ";" +',
      '      "d.style.display=" + JSON.stringify(html ? "" : "none") + ";" +',
      '      "}catch(e){}})();";',
      '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  try {
    mp.makeProperty(HURT_PROPERTY, {
      // The owner draws it. A neighbour is told only the scar, on the look prompt.
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: hudScript(),
      updateNeighbor: ''
    });
  } catch (e) {
    // Already made by a previous load. The script cannot change until a restart, which a deploy is.
  }

  /*
    THE TREATMENT PANEL'S VIEW, seen by its owner only, handed to the page the
    way the repair panel's is; game/ui/thornswood-treat.js draws it, and a
    view with open set opens it. at moves on every send, so the key pressed
    again draws the panel again even when nothing in it changed.
  */
  var treatScript = [
    '(function(){',
    '  try {',
    '    var v = ctx.value;',
    '    if (!v || typeof v !== "object") { return; }',
    '    var st = ctx.state;',
    '    if (!st) { return; }',
    '    if (st.thornswoodTreatAt === v.at) { return; }',
    '    st.thornswoodTreatAt = v.at;',
    '    var body = JSON.stringify(v);',
    '    var src = "(function(){try{" +',
    '      "var d=" + body + ";window.thornswoodTreatView=d;" +',
    '      "if(window.thornswoodTreat&&window.thornswoodTreat.setData){window.thornswoodTreat.setData(d);}" +',
    '      "}catch(e){}})();";',
    '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
    '  } catch (e) { }',
    '})();'
  ].join('\n');
  try {
    mp.makeProperty(TREAT_VIEW_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: treatScript, updateNeighbor: ''
    });
  } catch (e) {
    // Already made by a previous load. The script cannot change until a restart, which a deploy is.
  }

  /*
    A POTION DRUNK FROM THE PACK, heard for the potion of cure disease, and
    anything eaten or drunk, heard for the needs block. This is the engine's
    own record of the drink: it is raised only once the server has checked
    the pack holds the thing, and it is the same message that takes it out
    (MpActor::OnEquip). So nobody cures a disease, or fills a meter, by
    saying they drank something. It never refuses: the engine takes the
    thing whatever this answers.
  */
  mp.onEatItem = guard('onEatItem', function (actorId, baseId) {
    /*
      THE POTION WINDOW (#1382) goes first, because the engine applies the
      potion as soon as this returns. A second potion in the minute lands at
      half, a third at a quarter, a fourth at nothing (the sip of thirst still
      comes from the needs block). Nothing is taken back afterwards.
      eatItemScale is the engine's (skymp #62). An engine without it does not
      read it, and the potion lands whole, as it always has.
    */
    /*
      AND A FOOD'S OWN MAGIC (#2682): a food in FOOD_GROUPS.strip lands at
      nothing, so its vanilla regen boost is gone and only the needs block's
      hunger, thirst and meal help are left. effectScale answers both.
    */
    var needsApi = g.__thornswoodNeeds;
    if (needsApi && needsApi.effectScale) {
      try {
        var scale = needsApi.effectScale(actorId, Number(baseId) || 0);
        if (scale < 1) { mp.set(actorId, 'eatItemScale', scale); }
      } catch (e) { hlog('the eat scale threw:', e); }
    }
    try { tell(actorId, swallowed(actorId, Number(baseId) || 0)); } catch (e) { hlog('the drink threw:', e); }
    /*
      WHAT IT DOES TO HUNGER AND THIRST (#3136), the needs block's eaten(),
      from this event and from nothing the client says. Said in the chat
      only, the way a meal's line always was.
    */
    if (needsApi && needsApi.eaten) {
      try {
        var mealLine = needsApi.eaten(actorId, Number(baseId) || 0);
        if (mealLine) { say(actorId, mealLine); }
      } catch (e) { hlog('the meal threw:', e); }
    }
    // Withered (#1387), in the college block, on its own: five potions in an hour.
    var college = g.__thornswoodCollege;
    if (college && college.drank) {
      try { college.drank(actorId, Number(baseId) || 0); } catch (e) { hlog('withered threw:', e); }
    }
    // An ingredient tasted (#3134), in the alchemy block, on its own.
    var alchemy = g.__thornswoodAlchemy;
    if (alchemy && alchemy.ate) {
      try { alchemy.ate(actorId, Number(baseId) || 0); } catch (e) { hlog('the taste threw:', e); }
    }
  });

  /*
    EVERY SPELL CAST, heard for the healing spells above. The engine reads
    nothing this family answers (the list over mp.onTakeItem), so it answers
    nothing. A block that needs to hear casts as well adds its call here
    rather than a second handler, which would replace this one.
  */
  mp['onPapyrusEvent:OnSpellCast'] = guard('onPapyrusEvent:OnSpellCast', function (casterId, spell) {
    try { cast(casterId, spell); } catch (e) { hlog('the cast threw:', e); }
    // Restoration strain (#1387), in the college block, on its own.
    var college = g.__thornswoodCollege;
    if (college && college.cast) {
      try { college.cast(casterId, spell); } catch (e) { hlog('the strain threw:', e); }
    }
  });

  if (g.__thornswoodHurtTimer) { try { clearInterval(g.__thornswoodHurtTimer); } catch (e) { } }
  g.__thornswoodHurtTimer = setInterval(guard('hurtTick', function () { settleQuietFires(); tick(); }), TICK_MS);
  if (g.__thornswoodBleedTimer) { try { clearInterval(g.__thornswoodBleedTimer); } catch (e) { } }
  g.__thornswoodBleedTimer = setInterval(guard('bleedTick', bleedTick), BLEED_MS);

  g.__thornswoodHurt = {
    HURT: HURT, DISEASE: DISEASE, EXPOSED: EXPOSED, HEALING: HEALING, TWO_HANDS: TWO_HANDS,
    CURE_DISEASE: CURE_DISEASE, CAUGHT_MIN: CAUGHT_MIN, BAD_AFTER_MIN: BAD_AFTER_MIN,
    CURE_DISEASE_EFFECT: CURE_DISEASE_EFFECT, MEAL_GUARD: MEAL_GUARD, BREWS_MOST: BREWS_MOST,
    brewed: brewed, guarded: guarded, unguarded: unguarded, limbsOf: limbsOf,
    CHILL_AFTER_MIN: CHILL_AFTER_MIN,
    read: read, write: write, step: step, tick: tick, bleedTick: bleedTick, bleedRate: bleedRate,
    stageOf: stageOf, lines: lines, chanceFor: chanceFor,
    forNeeds: forNeeds, burntWear: burntWear, wound: wound, burning: burning, settleQuietFires: settleQuietFires,
    healed: healed, cast: cast, hit: hit, swallowed: swallowed, rite: rite,
    exposed: exposed, craftRefusal: craftRefusal, died: died, scarOf: scarOf, staff: staff,
    BITERS: BITERS, TREAT: TREAT, TREAT_REACH: TREAT_REACH,
    weaponKind: weaponKind, woundFrom: woundFrom, bitingRaces: bitingRaces, blow: blow, landed: landed,
    needsCare: needsCare, careOf: careOf, careChanged: careChanged, plan: plan, treat: treat, viewFor: viewFor, panel: panel
  };

  hlog('ready: wounds and the five diseases, every', TICK_MS / 1000, 'seconds, and the bleed every second');
})();
// ==== end thornswood injury and disease ====

