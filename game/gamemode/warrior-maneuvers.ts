// ==== thornswood warrior maneuvers ====
/*
  A WARRIOR'S MANEUVERS (#1386).

  docs/systems/professions/warrior.md, "Maneuvers", is the table, and the two
  half pages name the rows: Set, Plant, Cover and Wall hold a line, Rush,
  Heavy, Break and Wreck break one. Until this nothing in combat read the word
  Bulwark or Berserker at all. The rows here are the page's rows and no more:
  the stamina, how long each lasts and the wait before it again.

  WHO HOLDS WHICH ROW. The page: "You have the rows at your rank and below, on
  your half." The sister half has its novice row only, and only once a Warlord
  has taken you on. An outside trade, novice combat a Warlord taught somebody
  who is not a warrior, is the novice row and no further. held() is that, and
  nothing else decides it.

  STAMINA IS SPENT WHEN THE MANEUVER STARTS, AND WITHOUT IT NOTHING HAPPENS.
  15 stamina is 15 of the person's real most, the skill tree's Endurance
  included (Patrick, 4 October: "it should scale"). spend() says how that is
  worked out.

  NOBODY TYPES ONE. Patrick, 4 October: no chat commands for anything people
  do. The maneuver key opens a panel the front plugin draws
  (game/ui/thornswood-maneuvers.js), and a pick there sends /maneuver <name>
  through the same relay the trade and party keys use. That line is internal:
  no help text names it. view() is what the panel draws from, folded into the
  character panel's view the way effects() is.

  WHAT THE SERVER APPLIES, AND WHAT IT CANNOT. Everything here is the server's
  own: the stamina, the clocks, the refusals, and health through the engine's
  percentages. Some of the rows are the game's to do on somebody's own machine
  and the server cannot reach them from here. Each start line says which, so
  nobody is told an effect is on when it is not, and the issue lists them:
    Set     a block costs half the stamina for 8 seconds. Applied here: a
            block costs stamina only because this block charges it (A BLOCK
            COSTS STAMINA, beside hit), and Set halves that charge.
    Plant   not being staggered. A stagger is an animation on the machine that
            animates you, so the server refuses the staggers it sends itself
            (Break and Wreck), and the front plugin refuses every other one
            on the person's own machine while the view says Plant is on
            (the row's on, below): it blanks staggerStart for your own
            character, the same hook skymp5-client's deathService uses to
            keep staggers off other people's characters.
    Cover   20% less damage for one person while you block. Applied here, by
            giving back a fifth of what each hit took. The block is read from
            the animation events the engine is sent (blockStart, blockStop),
            sampled ten times a second.
    Wall    20% less damage for you and your party within 3 metres. Applied
            here, the same way.
    Rush    +4 speed for 5 seconds. Sent through the map the client's skill
            tree hand already sets (thornswood-front.js, treeApplyNow), so no
            client change is needed for it.
    Heavy   25% more on the next power attack within 8 seconds. Applied here,
            by taking a quarter again of what that hit took.
    Break   the next hit within 8 seconds staggers. Sent to a person's own
            game with Debug.SendAnimationEvent; a creature is animated by
            whoever hosts it and the server cannot reach that machine, so a
            creature takes no stagger yet.
    Wreck   50% more on the next power attack within 8 seconds, and it
            staggers, both as above.

  A BLOW THAT KILLS OUTRIGHT IS NOT SOFTENED. The engine applies a hit's
  damage after the OnHit event and kills on the spot when that takes health
  to nothing, so a fifth cannot be given back to somebody already dead. Exact
  damage would need the engine's damage formula to ask, which is an engine
  change.

  THE CLOCKS LIVE IN MEMORY, on globalThis so a hot reload keeps them. A
  restart clears every wait and every armed blow, which at three minutes at
  most is nothing worth a property write. It ends a running Rush too, and the
  view a person gets when they come back is worked out then (arrival in the
  character block, #1642), so the speed is not on them.
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var P = g.__thornswoodProgression;
  if (!P) { console.log('[thornswood maneuvers] the rules block is missing, nothing registered'); return; }

  function mlog() {
    var a = Array.prototype.slice.call(arguments);
    console.log('[thornswood maneuvers] ' + a.join(' '));
  }

  var RANKS = ['novice', 'advanced', 'expert', 'master'];

  /*
    The table on the page, row for row. seconds is how long it lasts. Break
    and Wreck wait for the blow they name for 8 seconds, the window Heavy has
    (Patrick's answer on #1386, 4 October).
  */
  var MANEUVERS = {
    set:     { name: 'Set',   half: 'bulwark',   rank: 'novice',   stamina: 15, cooldown: 45,  seconds: 8 },
    plant:   { name: 'Plant', half: 'bulwark',   rank: 'advanced', stamina: 20, cooldown: 60,  seconds: 8 },
    cover:   { name: 'Cover', half: 'bulwark',   rank: 'expert',   stamina: 25, cooldown: 90,  seconds: 8,  less: 0.2, metres: 3 },
    wall:    { name: 'Wall',  half: 'bulwark',   rank: 'master',   stamina: 40, cooldown: 180, seconds: 10, less: 0.2, metres: 3 },
    rush:    { name: 'Rush',  half: 'berserker', rank: 'novice',   stamina: 15, cooldown: 30,  seconds: 5,  speed: 4 },
    heavy:   { name: 'Heavy', half: 'berserker', rank: 'advanced', stamina: 20, cooldown: 45,  seconds: 8,  more: 0.25 },
    'break': { name: 'Break', half: 'berserker', rank: 'expert',   stamina: 25, cooldown: 60,  seconds: 8 },
    wreck:   { name: 'Wreck', half: 'berserker', rank: 'master',   stamina: 40, cooldown: 120, seconds: 8,  more: 0.5 }
  };
  var ORDER = ['set', 'plant', 'cover', 'wall', 'rush', 'heavy', 'break', 'wreck'];
  var HALF_NAME = { bulwark: 'Bulwark', berserker: 'Berserker' };

  // Seventy units to a metre, the party strip's measure (see MOLD_REACH).
  var UNITS_PER_METRE = 70;

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function rankAt(r) { return RANKS.indexOf(r); }
  function aRank(r) {
    var w = String(r || 'novice');
    return (/^[aeiou]/.test(w) ? 'an ' : 'a ') + w;
  }
  function noviceOf(half) {
    for (var i = 0; i < ORDER.length; i++) {
      var m = MANEUVERS[ORDER[i]];
      if (m.half === half && m.rank === 'novice') { return m.name; }
    }
    return '';
  }

  // -------------------------------------------------------------- the rules --
  /*
    HAS A WARLORD TAKEN YOU ON FOR YOUR SISTER HALF. /apprentice records it
    (#1388), and the character block's masterFor says whether that Master's
    own record still stands. A sister half already past novice counts as
    well: rankUp only lets it climb under a Master of it, and the ranks
    earned under one stay after it ends (apprenticeship.md).
  */
  function takenOn(s, actorId) {
    if (!s || s.prof !== 'warrior' || !s.half) { return false; }
    var sister = P.sisterOf('warrior', s.half);
    if (!sister) { return false; }
    var r = P.rankOf(s, sister);
    if (r && rankAt(r) > 0) { return true; }
    var ch = g.__thornswoodCharacter;
    try { return !!(actorId && ch && ch.masterFor && ch.masterFor(actorId, s, sister)); } catch (e) { return false; }
  }

  /** Every row this character holds, as { key: true }. Pure. */
  function held(s, sisterTaken) {
    var out = {};
    if (!s) { return out; }
    for (var i = 0; i < ORDER.length; i++) {
      var key = ORDER[i];
      var m = MANEUVERS[key];
      var rank = P.rankOf(s, m.half);
      if (!rank) { continue; }
      if (s.prof === 'warrior' && s.half === m.half) {
        if (rankAt(m.rank) <= rankAt(rank)) { out[key] = true; }
        continue;
      }
      if (m.rank !== 'novice') { continue; }
      if (s.prof === 'warrior' && P.sisterOf('warrior', s.half) === m.half) {
        if (sisterTaken) { out[key] = true; }
        continue;
      }
      if ((s.taught || []).indexOf(m.half) !== -1) { out[key] = true; }
    }
    return out;
  }

  /** Why this character does not hold that row, in one sentence. */
  function whyNot(s, key) {
    var m = MANEUVERS[key];
    var halfName = HALF_NAME[m.half];
    var rank = s ? P.rankOf(s, m.half) : null;
    if (s && s.prof === 'warrior' && s.half === m.half) {
      return m.name + ' is for ' + aRank(m.rank) + ' ' + halfName + '. You are ' +
             aRank(rank) + ' ' + halfName + '.';
    }
    if (s && s.prof === 'warrior' && s.half && P.sisterOf('warrior', s.half) === m.half) {
      if (m.rank !== 'novice') {
        return halfName + ' is your sister half, and a sister half has its novice row and no more: ' +
               noviceOf(m.half) + '.';
      }
      return halfName + ' is your sister half. Its novice maneuver opens when a Warlord takes you on.';
    }
    if (rank && s && (s.taught || []).indexOf(m.half) !== -1) {
      return halfName + ' was taught to you as an outside trade, and that is its novice row and no further: ' +
             noviceOf(m.half) + '.';
    }
    return m.name + ' is a ' + halfName + ' maneuver. It belongs to a warrior, and a Warlord can teach ' +
           'novice combat to somebody who is not one.';
  }

  // ------------------------------------------------------------ the world --
  /*
    cool  actor -> { key: when it is ready again }
    on    actor -> what is running or armed: a window's end for set, plant,
          wall, rush, heavy, break and wreck; { until, who } for cover
    block actor -> whether that bulwark is blocking, as last seen
    blow  actor -> { by, at }: who landed the server's own last blow on it
  */
  var ST = g.__thornswoodManeuverState;
  if (!ST || typeof ST !== 'object') {
    ST = g.__thornswoodManeuverState = { cool: {}, on: {}, block: {}, blow: {} };
  }

  function now() { return Date.now(); }
  function selfOf(id) { return { type: 'form', desc: mp.getDescFromId(id) }; }
  function personOf(id) {
    try { return Number(mp.get(id, 'profileId')) > 0; } catch (e) { return false; }
  }
  function deadOf(id) {
    try { return !!mp.get(id, 'isDead'); } catch (e) { return true; }
  }
  function onlineOf(id) {
    try { return !!mp.get(id, 'isOnline'); } catch (e) { return false; }
  }
  function share(id, which) {
    try {
      var p = mp.get(id, 'percentages');
      var v = p ? Number(p[which]) : NaN;
      return isNaN(v) ? -1 : v;
    } catch (e) { return -1; }
  }
  function near(a, b, metres) {
    try {
      if (String(mp.get(a, 'worldOrCellDesc') || '') !== String(mp.get(b, 'worldOrCellDesc') || '')) { return false; }
      var p = mp.get(a, 'pos');
      var q = mp.get(b, 'pos');
      var dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
      var r = metres * UNITS_PER_METRE;
      return dx * dx + dy * dy + dz * dz <= r * r;
    } catch (e) { return false; }
  }
  function onOf(id, make) {
    if (!has(ST.on, id)) {
      if (!make) { return null; }
      ST.on[id] = {};
    }
    return ST.on[id];
  }
  function readyAt(id, key) {
    return (has(ST.cool, id) && has(ST.cool[id], key)) ? ST.cool[id][key] : 0;
  }
  function seconds(ms) {
    var n = Math.max(1, Math.ceil(ms / 1000));
    return n + (n === 1 ? ' second' : ' seconds');
  }
  function nameOf(id) {
    var soc = g.__thornswoodSocial;
    try { if (soc && soc.nameOfPerson) { return soc.nameOfPerson(id) || 'them'; } } catch (e) { }
    return 'them';
  }

  /*
    STAMINA, SPENT WHEN THE MANEUVER STARTS, AS A SHARE OF THE PERSON'S REAL
    MOST. Patrick's answer on #1386, 4 October: the cost "should scale" with
    the skill tree. Measured in the fork before this was written:

      The engine holds stamina only as a share, 0 to 1, of a most it works out
      from the records (GetBaseActorValues.cpp): the race's starting stamina,
      RACE DATA at byte 44, plus the person's NPC_ stamina offset, ACBS at
      byte 6, and 100 when that comes to nothing. The client is handed that
      same number as its base stamina when it spawns (remoteServer.ts).

      The skill tree hand then SETS the base to that plus the map the
      character panel sends (thornswood-front.js, treeApplyNow): Endurance's
      +10 a point, less what hunger, thirst, tiredness and cold take off. The
      share the client reports back, and the share a server write moves it to
      (setActorValuePercentage in actorvalues.ts), are both of that bigger
      most.

    So Actor.DamageActorValue, which divides by the engine's most, took 15 of
    the race's stamina: on a character with Endurance that was more than 15
    off the bar they see. Here the most is the engine's own from the same two
    records, plus the stamina in the map the client applies, and the cost is
    the amount over that, written as a share. Without that much nothing is
    written and false comes back; the old code took the stamina first and put
    it back after. A record that cannot be read answers null and starts
    nothing, with a line in the log.

    Stamina a potion or an enchanted piece of gear adds is not counted: the
    server does not see the effects running on somebody's character.
  */
  function fieldOf(id, type) {
    var res = null;
    try { res = id ? mp.lookupEspmRecordById(id) : null; } catch (e) { return null; }
    var fields = (res && res.record && res.record.fields) || [];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i] && fields[i].type === type && fields[i].data) { return Buffer.from(fields[i].data); }
    }
    return null;
  }

  /*
    WHERE EACH MOST IS READ FROM, as GetBaseActorValues.cpp in the fork reads
    them (RACE.cpp and NPC_.cpp give the bytes): the race's starting value, a
    float in RACE DATA, plus the base's offset, a short in NPC_ ACBS. A most
    that comes to nothing is 100, except magicka, which may be 0 and is 100
    only below it. Health and magicka for withered (#1387, the college block).
  */
  var ENGINE_MOST = {
    health: { race: 36, npc: 20, floorAtZero: true },
    magicka: { race: 40, npc: 4, floorAtZero: false },
    stamina: { race: 44, npc: 6, floorAtZero: true }
  };

  /** The engine's own most, the way GetBaseActorValues works it out for a
      person: their race and their base, which for a person is the NPC_ record
      every character is made from (0x7) and carries no template. 0 when the
      records cannot be read. */
  function engineStamina(actorId) { return engineMost(actorId, 'stamina'); }

  function engineMost(actorId, which) {
    var at = Object.prototype.hasOwnProperty.call(ENGINE_MOST, which) ? ENGINE_MOST[which] : null;
    if (!at) { return 0; }
    var raceId = 0, baseId = 0;
    try {
      var r = mp.callPapyrusFunction('method', 'Actor', 'GetRace', selfOf(actorId), []);
      raceId = (r && r.desc) ? (Number(mp.getIdFromDesc(String(r.desc))) || 0) : 0;
      baseId = Number(mp.getIdFromDesc(String(mp.get(actorId, 'baseDesc') || ''))) || 0;
    } catch (e) {
      mlog('could not ask the race and base of', actorId.toString(16) + ':', e);
      return 0;
    }
    var race = fieldOf(raceId, 'DATA');
    var npc = fieldOf(baseId, 'ACBS');
    if (!race || race.length < 48 || !npc || npc.length < 22) {
      mlog('no RACE DATA or NPC_ ACBS for', actorId.toString(16), '(race', raceId.toString(16) + ', base', baseId.toString(16) + ')');
      return 0;
    }
    var most = race.readFloatLE(at.race) + npc.readInt16LE(at.npc);
    if (at.floorAtZero) { return most > 0 ? most : 100; }
    return most >= 0 ? most : 100;
  }

  /** The person's real most stamina: the engine's, plus what the map the
      client applies adds to it or takes off. NaN when it cannot be read. */
  function mostStamina(actorId) {
    var base = engineStamina(actorId);
    if (!(base > 0)) { return NaN; }
    var ch = g.__thornswoodCharacter;
    if (!ch || !ch.effectsOf) { return NaN; }
    var map = null;
    try { map = ch.effectsOf(actorId); } catch (e) {
      mlog('could not read the skill tree map of', actorId.toString(16) + ':', e);
      return NaN;
    }
    return base + ((map && typeof map.stamina === 'number') ? map.stamina : 0);
  }

  /** true when spent, false when there is not that much, null when the
      stamina cannot be read. */
  function spend(actorId, amount) {
    var p = null;
    try { p = mp.get(actorId, 'percentages'); } catch (e) { p = null; }
    var before = p ? Number(p.stamina) : NaN;
    if (!(before >= 0)) { return null; }
    var most = mostStamina(actorId);
    if (isNaN(most)) { return null; }
    // Hunger, thirst, tiredness and cold together can take the whole of it.
    if (!(most > 0)) { return false; }
    var cost = amount / most;
    if (before < cost) { return false; }
    try {
      mp.set(actorId, 'percentages', { health: Number(p.health), magicka: Number(p.magicka), stamina: before - cost });
    } catch (e) {
      mlog('could not take stamina from', actorId.toString(16) + ':', e);
      return null;
    }
    return true;
  }

  /* The one person Cover is for: the nearest within 3 metres, not yourself. */
  function coverWho(actorId) {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return 0; }
    var best = 0, bestD = Infinity;
    var mine = null;
    try { mine = mp.get(actorId, 'pos'); } catch (e) { return 0; }
    for (var i = 0; i < online.length; i++) {
      var id = online[i];
      if (id === actorId || deadOf(id) || !near(actorId, id, MANEUVERS.cover.metres)) { continue; }
      var q = null;
      try { q = mp.get(id, 'pos'); } catch (e) { continue; }
      var d = (q[0] - mine[0]) * (q[0] - mine[0]) + (q[1] - mine[1]) * (q[1] - mine[1]) + (q[2] - mine[2]) * (q[2] - mine[2]);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  /*
    The client's skill tree hand sets the effects map on the panel view, and
    the map is rebuilt from the state on every write. A redraw is the one way
    to send Rush's speed and to take it off again.
  */
  function push(actorId) {
    var ch = g.__thornswoodCharacter;
    if (!ch || !ch.writeState || !ch.stateOf) { return; }
    try { ch.writeState(actorId, ch.stateOf(actorId), true); } catch (e) { mlog('could not redraw', actorId.toString(16) + ':', e); }
  }

  /** What a running maneuver adds to the client's map: Rush's speed. */
  function effects(actorId) {
    var rec = onOf(actorId, false);
    if (!rec || !rec.rush || rec.rush <= now()) { return null; }
    return { speedMult: MANEUVERS.rush.speed };
  }

  /*
    WHAT THE MANEUVER KEY DRAWS: the rows this character holds, in the page's
    order, each with its stamina and whether its wait is over. Null for
    somebody who holds none, so the view carries nothing for them. ready is
    the only part that moves, and it moves twice a use: a start redraws the
    panel (push in use) and so does the end of the wait (tick), so the view
    never changes with the clock and a counter's write still redraws nothing.
  */
  function view(actorId, s) {
    if (!s) { return null; }
    var mine = held(s, takenOn(s, actorId));
    var t = now();
    var out = [];
    for (var i = 0; i < ORDER.length; i++) {
      var key = ORDER[i];
      if (!mine[key]) { continue; }
      var m = MANEUVERS[key];
      var row = { key: key, name: m.name, stamina: m.stamina, cooldown: m.cooldown, ready: !(readyAt(actorId, key) > t) };
      /*
        PLANT IS ON, for the front plugin, which refuses every stagger on
        the person's own machine while it is (#1386). on moves twice a use,
        like ready: the start redraws (push in use) and so does the end
        (tick). seconds never moves; it is how long the front holds it if
        the end never reaches it.
      */
      if (key === 'plant') {
        var rec = onOf(actorId, false);
        row.seconds = m.seconds;
        if (rec && rec.plant && rec.plant > t) { row.on = true; }
      }
      out.push(row);
    }
    return out.length ? out : null;
  }

  var STARTED = {
    set: 'Set, for 8 seconds. A block costs you half the stamina.',
    plant: 'Plant, for 8 seconds. Nothing staggers you.',
    wall: 'Wall, for 10 seconds. You, and your party within 3 metres of you, take 20% less damage.',
    rush: 'Rush: +4 speed for 5 seconds.',
    heavy: 'Heavy. Your next power attack in the next 8 seconds deals 25% more.',
    'break': 'Break. Your next hit in the next 8 seconds staggers a person. Staggering a creature is not in the game yet.',
    wreck: 'Wreck. Your next power attack in the next 8 seconds deals 50% more, and staggers a person. Staggering a creature is not in the game yet.'
  };

  /** What you hold and when each is ready, for a /maneuver with no name. */
  function listLine(actorId, mine) {
    var bits = [];
    var t = now();
    for (var i = 0; i < ORDER.length; i++) {
      var key = ORDER[i];
      if (!mine[key]) { continue; }
      var m = MANEUVERS[key];
      var ready = readyAt(actorId, key);
      bits.push(m.name + ' (' + m.stamina + ' stamina, ' + (ready > t ? 'ready in ' + seconds(ready - t) : 'ready') + ')');
    }
    if (!bits.length) {
      return 'You have no maneuvers. They are a warrior\'s, on the half you picked, at your rank and below. ' +
             'A Warlord can teach the novice row to somebody who is not a warrior.';
    }
    return 'Your maneuvers: ' + bits.join(', ') + '.';
  }

  /** /maneuver <name>, as the maneuver panel sends it. Answers the line to
      say, always. */
  function use(actorId, word) {
    var key = String(word || '').trim().toLowerCase();
    var ch = g.__thornswoodCharacter;
    if (!ch || !ch.stateOf) { return 'Maneuvers are not running on this server right now. Say so in the dev channel.'; }
    var s = ch.stateOf(actorId);
    var mine = held(s, takenOn(s, actorId));
    if (!key || key === 'list') { return listLine(actorId, mine); }
    if (!has(MANEUVERS, key)) {
      return 'There is no maneuver by that name. There are eight: Set, Plant, Cover, Wall, Rush, Heavy, Break and Wreck.';
    }
    var m = MANEUVERS[key];
    if (!mine[key]) { return whyNot(s, key); }
    if (deadOf(actorId)) { return 'Not while you are down.'; }
    var t = now();
    var ready = readyAt(actorId, key);
    if (ready > t) { return m.name + ' is ready again in ' + seconds(ready - t) + '.'; }
    var who = 0;
    if (key === 'cover') {
      who = coverWho(actorId);
      if (!who) { return 'Cover is for one person within 3 metres of you, and nobody is.'; }
    }
    var paid = spend(actorId, m.stamina);
    if (paid === null) {
      return 'Your stamina could not be read just now, so ' + m.name + ' did not start. Say so in the dev channel.';
    }
    if (!paid) {
      return m.name + ' takes ' + m.stamina + ' stamina, and you do not have it. Nothing happens.';
    }
    if (!has(ST.cool, actorId)) { ST.cool[actorId] = {}; }
    ST.cool[actorId][key] = t + m.cooldown * 1000;
    var rec = onOf(actorId, true);
    if (key === 'cover') {
      rec.cover = { until: t + m.seconds * 1000, who: who };
      ST.block[actorId] = false;
      mlog(actorId.toString(16), 'Cover on', who.toString(16));
      push(actorId);
      return 'Cover on ' + nameOf(who) + ', for 8 seconds. While you block within 3 metres of them, they take 20% less damage.';
    }
    rec[key] = t + m.seconds * 1000;
    mlog(actorId.toString(16), m.name);
    // The panel's row turns to waiting, and Rush's speed goes on.
    push(actorId);
    if (key === 'rush') {
      setTimeout(function () { push(actorId); }, m.seconds * 1000 + 50);
    }
    return STARTED[key];
  }

  // -------------------------------------------------------------- the hits --
  /*
    WHAT A HIT TOOK, MEASURED RATHER THAN GUESSED. OnHit fires before the
    engine works out the damage (ActionListener::OnWeaponHit sends it first,
    then CalculateDamage and NetSetPercentages, in the same call). So the
    target's health is read at the event, and read again once the engine is
    done: at the next hit on the same target, or on the next turn of the event
    loop, whichever is first. The difference is what that one hit took, and
    the maneuver works on that: a fifth given back, a quarter or a half taken
    again. A hit the engine then threw away (too fast, a splash) took nothing,
    so nothing is changed and a Heavy or a Wreck it would have spent is armed
    again.
  */
  var pending = {};
  var queued = false;

  function idOfForm(v) {
    if (typeof v === 'number') { return v; }
    if (v && v.desc) {
      try { return Number(mp.getIdFromDesc(String(v.desc))) || 0; } catch (e) { return 0; }
    }
    return 0;
  }
  function isSpell(v) {
    if (!v || !v.desc) { return false; }
    try {
      var r = mp.lookupEspmRecordById(mp.getIdFromDesc(String(v.desc)));
      return !!(r && r.record && String(r.record.type) === 'SPEL');
    } catch (e) { return false; }
  }

  /* Whether that bulwark is blocking, from the last animation event the
     engine was sent. Moving clears that event, so what was last seen holds. */
  function blocking(holder) {
    var ev = '';
    try { ev = String(mp.get(holder, 'lastAnimEvent') || '').toLowerCase(); } catch (e) { ev = ''; }
    if (ev === 'blockstart') { ST.block[holder] = true; }
    else if (ev === 'blockstop') { ST.block[holder] = false; }
    return !!ST.block[holder];
  }

  function samePartyNear(holder, target) {
    var soc = g.__thornswoodSocial;
    if (!soc || !soc.partyOf || !soc.profileOf) { return false; }
    var mine = soc.profileOf(holder);
    var theirs = soc.profileOf(target);
    if (!mine || !theirs) { return false; }
    var p = soc.partyOf(mine);
    if (!p || !p.members || p.members.indexOf(theirs) === -1) { return false; }
    return near(holder, target, MANEUVERS.wall.metres);
  }

  /* 20% less for this target, from a Wall or a Cover. Two of them on one
     person is still 20%: the rows say less damage, not less again. */
  function shielded(target, t) {
    for (var k in ST.on) {
      if (!has(ST.on, k)) { continue; }
      var holder = Number(k);
      var rec = ST.on[k];
      if (rec.wall && rec.wall > t && !deadOf(holder)) {
        if (holder === target || samePartyNear(holder, target)) { return MANEUVERS.wall.less; }
      }
      if (rec.cover && rec.cover.until > t && rec.cover.who === target && !deadOf(holder) &&
          blocking(holder) && near(holder, target, MANEUVERS.cover.metres)) {
        return MANEUVERS.cover.less;
      }
    }
    return 0;
  }

  /*
    MASTER WEAVER'S HIDDEN ARMOUR (#1398). docs/systems/professions/tailor.md:
    a master tailor's garment carries hidden armour or keeps the weather off.
    Patrick's answer on #1398, 4 October: the tailor picks one per garment,
    and armour "gives back 10% of each hit, the way the warrior's Wall does
    it". So it is this path: the hit is measured like a Wall's, and less is
    what flush() gives back. The gamemode cannot reach a garment's armour
    rating (the server's damage is the fork's TES5DamageFormula), and this
    adds no weight, which is the page's "still weighs what clothing weighs".

    mark is what the craft writes in front of the garment's name (wovenOutput,
    beside mp.onCraft), the way the weather half writes NEEDS.wear.woven.mark.
    The two marks differ, so a garment carries one half and never both: the
    needs block reads only its own. One worn is enough and two do not give
    back 20%. A piece with an enchantment on it is not one, for the reason
    the needs block gives: anybody can name a piece at the enchanting table,
    and the engine only enchants a plain one, which a woven garment is not.
    Only a person's clothes count, the way only a person's gear wears.
  */
  var WOVEN = { mark: 'Master-Lined ', less: 0.1 };

  function wornBy(id) {
    try {
      var eq = mp.get(id, 'equipment');
      var ee = eq && ((eq.inv && eq.inv.entries) || eq.entries);
      if (ee) { return ee; }
    } catch (e) { }
    try {
      var inv = mp.get(id, 'inventory');
      return (inv && inv.entries) || [];
    } catch (e2) { return []; }
  }

  function wovenArmour(target) {
    if (!personOf(target)) { return 0; }
    var worn = wornBy(target);
    for (var i = 0; i < worn.length; i++) {
      var e = worn[i];
      if (!e || !e.worn || e.enchantmentId) { continue; }
      if (typeof e.name === 'string' && e.name.indexOf(WOVEN.mark) === 0) { return WOVEN.less; }
    }
    return 0;
  }

  function anyOn() {
    for (var k in ST.on) { if (has(ST.on, k)) { return true; } }
    return false;
  }

  /*
    A BLOCK COSTS STAMINA (#1386). Patrick's A of 12 October: "blocking costs
    stamina, charged by the server, and Set halves it". Measured on 11
    October, nothing took stamina for a block: the engine decides a block and
    writes health and nothing else (ActionListener::OnWeaponHit), and on a
    person's own machine nobody else's blow does damage (skymp5-client
    formView.ts sets attackDamageMult 0), so the game's own charge there comes
    to nothing.

    So it is charged here, by the game's own rule: fStaminaBlockBase (0) plus
    fStaminaBlockDmgMult (0.25) times the damage the block stopped (Skyrim.esm,
    overridden by nothing in the load order). What the block stopped is
    measured like every other hit in this block: the health share the hit
    took, times the engine's own most health (the most the engine divided the
    damage by, CalculateCurrentHealthPercentage), is what came through, and
    the engine lets a blocked hit through at a tenth (TES5DamageFormula,
    damage *= 0.1), so the block stopped nine times that. A hit the engine
    threw away took nothing and costs nothing. The stamina comes off the
    person's real most, the way spend() takes a maneuver's, and stops at
    nothing: a block with no stamina left still blocks, as in the game. Set
    halves the charge for a hit that lands while it runs. A broken arm
    doubles it while the break lasts, splinted or set (docs/systems/injury.md,
    #1383): the injury block's record says which limb is broken (limbsOf), so
    the charge is decided here with the rest of it, never measured off the
    client's stamina afterwards.

    A person's block only, which is what was decided ("when a hit lands
    blocked on a person"). A spell is not one: the engine's spell damage
    (OnSpellHit) has no block in it. blocked is the flag the OnHit event
    carries. The engine decides the block before it sends the event (fork PR
    84, in the pin since #1386), so the flag is the server's own decision,
    and a block only the server saw, which is every block against a server
    NPC, costs stamina like any other.
  */
  var BLOCK = { base: 0, perStopped: 0.25, through: 0.1, set: 0.5, brokenArm: 2 };

  /** The stamina a blocked hit costs, in points: took is the health share it
      took, mult 1, or Set's half. NaN when the most health cannot be read. */
  function blockCost(target, took, mult) {
    var most = engineMost(target, 'health');
    if (!(most > 0)) { return NaN; }
    var stopped = took * most * (1 - BLOCK.through) / BLOCK.through;
    return (BLOCK.base + BLOCK.perStopped * stopped) * mult;
  }

  /** Takes that many points of stamina off a person, down to nothing. */
  function tire(target, points) {
    if (!(points > 0) || deadOf(target)) { return; }
    var most = mostStamina(target);
    if (isNaN(most)) { mlog('no most stamina for', target.toString(16) + ', so a block cost nothing'); return; }
    // Hunger, thirst, tiredness and cold together can take the whole of it.
    if (!(most > 0)) { return; }
    try {
      var p = mp.get(target, 'percentages');
      var before = Number(p.stamina);
      if (!(before > 0)) { return; }
      mp.set(target, 'percentages', { health: Number(p.health), magicka: Number(p.magicka),
                                      stamina: Math.max(0, before - points / most) });
    } catch (e) {
      mlog('could not take a block\'s stamina from', target.toString(16) + ':', e);
    }
  }

  function hit(targetId, aggressor, source, power, blocked) {
    var target = Number(targetId) || 0;
    if (!target) { return; }
    // A hit on a target with a blow still open closes that blow first.
    var open = pending[target];
    if (open && open.length && open[open.length - 1].after === null) {
      open[open.length - 1].after = share(target, 'health');
    }
    var lined = wovenArmour(target);
    var guarded = !!blocked && personOf(target) && !isSpell(source);
    if (!lined && !guarded && !anyOn()) { return; }
    var t = now();
    var by = idOfForm(aggressor);
    // A bulwark's own blocked hit is a block seen.
    if (blocked && has(ST.on, target) && ST.on[target].cover) { ST.block[target] = true; }

    var identity = by ? MERCHANT_TRADING.actorIdentity(mp, by) : null;
    var e = { before: -1, after: null, by: by, identity: identity, more: 0, less: 0, stagger: false, used: [], block: 0 };
    if (guarded) {
      var mine = has(ST.on, target) ? ST.on[target] : null;
      e.block = (mine && mine.set && mine.set > t) ? BLOCK.set : 1;
      var hurt = globalThis.__thornswoodHurt;
      if (hurt && hurt.limbsOf(hurt.read(target)).arm) { e.block *= BLOCK.brokenArm; }
    }
    var a = (identity && has(ST.on, by)) ? ST.on[by] : null;
    if (a && !isSpell(source)) {
      if (power && a.wreck && a.wreck > t) {
        e.more = MANEUVERS.wreck.more; e.stagger = true;
        e.used.push({ key: 'wreck', v: a.wreck }); delete a.wreck;
      } else if (power && a.heavy && a.heavy > t) {
        e.more = MANEUVERS.heavy.more;
        e.used.push({ key: 'heavy', v: a.heavy }); delete a.heavy;
      }
      if (!e.stagger && a['break'] && a['break'] > t) {
        e.stagger = true;
        e.used.push({ key: 'break', v: a['break'] }); delete a['break'];
      }
    }
    // A woven garment's 10% is on top of a Wall's or a Cover's 20%: the two
    // add, 30% back (the question to Patrick on #1398).
    e.less = shielded(target, t) + lined;
    if (!e.more && !e.less && !e.stagger && !e.block) { return; }
    e.target = targetLife(target);
    e.before = share(target, 'health');
    if (!(e.before > 0)) { rearm(e); return; }
    if (!pending[target]) { pending[target] = []; }
    pending[target].push(e);
    if (!queued) {
      queued = true;
      setTimeout(guard('maneuverHits', flush), 0);
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

  /* A blow that took nothing gives back what it would have spent, while its
     window is still open. */
  function rearm(e) {
    if (!e.by || !e.used.length) { return; }
    if (!e.identity || MERCHANT_TRADING.actorIdentity(mp, e.by) !== e.identity) { return; }
    var rec = onOf(e.by, true);
    for (var i = 0; i < e.used.length; i++) {
      var u = e.used[i];
      if (u.v <= now()) { continue; }
      if (!rec[u.key]) { rec[u.key] = u.v; }
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
    try {
      var p = mp.get(target, 'percentages');
      mp.set(target, 'percentages', { health: next, magicka: Number(p.magicka), stamina: Number(p.stamina) });
    } catch (e) {
      mlog('could not write the health of', target.toString(16) + ':', e);
    }
  }

  /*
    A STAGGER IS AN ANIMATION, AND THE SERVER CAN SEND ONE ONLY TO A PERSON.
    Debug.SendAnimationEvent in the fork runs on the machine of the actor it
    names, and only when that actor is somebody's own character
    (SpSnippet::Execute returns for anything else). A person hit by Break or
    Wreck staggers in their own game; a creature does not yet. Plant refuses
    this stagger, and so does Unshakeable while the person blocks (#1385).
  */
  function staggerOf(target) {
    if (!personOf(target) || deadOf(target)) { return; }
    var rec = onOf(target, false);
    if (rec && rec.plant && rec.plant > now()) { return; }
    if (unshaken(target)) { return; }
    try {
      mp.callPapyrusFunction('global', 'Debug', 'SendAnimationEvent', null, [selfOf(target), 'staggerStart']);
    } catch (e) {
      mlog('could not stagger', target.toString(16) + ':', e);
    }
  }

  /*
    UNSHAKEABLE (#1385): nothing staggers somebody who holds it while they
    block. The block is the IsBlocking their own game sends with every
    movement (skymp5-client movementGet.ts, kept by the engine in
    ActionListener's movement handler), asked through the engine's own
    ObjectReference.GetAnimationVariableBool. The front plugin refuses every
    other stagger on that person's own machine the same way.
  */
  function unshaken(target) {
    var pk = g.__thornswoodPerks;
    if (!pk || !pk.holds || !pk.holds(target, 'unshakeable')) { return false; }
    try {
      if (!mp.callPapyrusFunction('method', 'ObjectReference', 'GetAnimationVariableBool',
                                  selfOf(target), ['IsBlocking'])) { return false; }
    } catch (e) {
      mlog('could not ask whether', target.toString(16), 'blocks:', e);
      return false;
    }
    // The perks block's own line, "perks: Unshakeable fired for <actor>".
    if (pk.fired) { pk.fired(target, 'unshakeable', '(a Break or Wreck, while blocking)'); }
    return true;
  }

  function flush() {
    queued = false;
    var all = pending;
    pending = {};
    for (var k in all) {
      if (!has(all, k)) { continue; }
      var target = Number(k);
      // A blow for a replaced target lands on nobody: what it spent comes back.
      var list = all[k].filter(function (q) { if (sameTarget(target, q.target)) { return true; } rearm(q); return false; });
      if (!list.length) { continue; }
      var h = share(target, 'health');
      if (list.length && list[list.length - 1].after === null) { list[list.length - 1].after = h; }
      var change = 0, killer = 0, stagger = false, tired = 0;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        var took = e.before - e.after;
        if (!(e.after >= 0) || !(took > 0)) { rearm(e); continue; }
        if (e.less) { change += took * e.less; }
        // The block's stamina is the defender's, like the reduction.
        if (e.block) {
          var cost = blockCost(target, took, e.block);
          if (cost > 0) { tired += cost; }
          else if (isNaN(cost)) { mlog('no most health for', target.toString(16) + ', so a block cost nothing'); }
        }
        // The reduction belongs to the defender, regardless of who now owns
        // the attacker's ID. Only the attacker's effects need this identity.
        if (!e.identity || MERCHANT_TRADING.actorIdentity(mp, e.by) !== e.identity) { continue; }
        if (e.more) { change -= took * e.more; killer = e; }
        if (e.stagger) { stagger = true; }
      }
      if (h > 0 && change !== 0) { setHealth(target, h, change, killer); }
      if (tired > 0) { tire(target, tired); }
      if (stagger) { staggerOf(target); }
    }
  }

  /** Whose blow it was, when the server's own write was the killing one. */
  function killerOf(target) {
    var b = has(ST.blow, target) ? ST.blow[target] : null;
    if (!b) { return 0; }
    if (!sameTarget(target, b.target)) { delete ST.blow[target]; return 0; }
    delete ST.blow[target];
    return (now() - b.at) < 2000 && b.identity && MERCHANT_TRADING.actorIdentity(mp, b.by) === b.identity ? b.by : 0;
  }

  // -------------------------------------------------------------- the tick --
  /* Ten times a second while anything runs: a Cover's block is watched, and
     what has run out is taken off. A wait that ends redraws the panel, so the
     maneuver key shows that row ready again. Nothing to do costs one empty
     loop. */
  function tick() {
    var t = now();
    for (var c in ST.cool) {
      if (!has(ST.cool, c)) { continue; }
      var ended = false, waiting = false;
      for (var w in ST.cool[c]) {
        if (!has(ST.cool[c], w)) { continue; }
        if (ST.cool[c][w] <= t) { delete ST.cool[c][w]; ended = true; } else { waiting = true; }
      }
      if (!waiting) { delete ST.cool[c]; }
      if (ended && onlineOf(Number(c))) { push(Number(c)); }
    }
    for (var k in ST.on) {
      if (!has(ST.on, k)) { continue; }
      var holder = Number(k);
      var rec = ST.on[k];
      if (rec.cover && rec.cover.until > t) { blocking(holder); }
      if (rec.cover && rec.cover.until <= t) { delete rec.cover; delete ST.block[holder]; }
      var timed = ['set', 'plant', 'wall', 'rush', 'heavy', 'break', 'wreck'];
      for (var i = 0; i < timed.length; i++) {
        if (rec[timed[i]] && rec[timed[i]] <= t) {
          delete rec[timed[i]];
          // The view's on for Plant goes off, so the front stops refusing
          // staggers the moment the server's window ends. See view.
          if (timed[i] === 'plant' && onlineOf(holder)) { push(holder); }
        }
      }
      var left = false;
      for (var f in rec) { if (has(rec, f)) { left = true; break; } }
      if (!left) { delete ST.on[k]; }
    }
    for (var b in ST.blow) {
      if (has(ST.blow, b) && t - ST.blow[b].at > 5000) { delete ST.blow[b]; }
    }
  }

  if (g.__thornswoodManeuverTimer) { try { clearInterval(g.__thornswoodManeuverTimer); } catch (e) { } }
  g.__thornswoodManeuverTimer = setInterval(guard('maneuverTick', tick), 100);

  g.__thornswoodManeuvers = {
    MANEUVERS: MANEUVERS, ORDER: ORDER, WOVEN: WOVEN, wovenArmour: wovenArmour, BLOCK: BLOCK,
    held: held, takenOn: takenOn, whyNot: whyNot, mostStamina: mostStamina, engineMost: engineMost,
    use: use, effects: effects, view: view, hit: hit, flush: flush, killerOf: killerOf, tick: tick,
    state: ST
  };
  mlog('ready:', ORDER.length, 'maneuvers');
})();

/*
  Every hit the engine takes, heard for the maneuvers above (#1386). It never
  answers false: the engine does not read what this family answers, and the
  list over mp.onTakeItem says why nothing here may try.
*/
mp['onPapyrusEvent:OnHit'] = guard('onPapyrusEvent:OnHit', function (targetId, aggressor, source, projectile, power, sneak, bash, blocked) {
  // The wear and the break chance at 0% (#1384), in the durability block.
  // First and on its own, so neither half can stop the other.
  var wear = globalThis.__thornswoodDurability;
  if (wear && wear.onHit) {
    try { wear.onHit(targetId, aggressor, source, blocked); } catch (e) { log('durability: the hit threw:', e); }
  }
  // The filled skill perks (#1385), before the maneuvers: each measures the
  // blow on the next turn, and this way round the perks block reads it first.
  var pk = globalThis.__thornswoodPerks;
  if (pk && pk.hit) {
    try { pk.hit(targetId, aggressor, source, power, bash); } catch (e) { log('perks: the hit threw:', e); }
  }
  // A reanimate spell on a person's body (#1387), in the college block,
  // on its own for the same reason.
  var college = globalThis.__thornswoodCollege;
  if (college && college.hit) {
    try { college.hit(targetId, aggressor, source); } catch (e) { log('college: the hit threw:', e); }
  }
  var mv = globalThis.__thornswoodManeuvers;
  if (mv && mv.hit) { mv.hit(targetId, aggressor, source, power, blocked); }
  // A healing spell landing on somebody's wounds (#1383), in the injury and
  // disease block. On its own, so the two above cannot stop it.
  var hurt = globalThis.__thornswoodHurt;
  if (hurt && hurt.hit) {
    try { hurt.hit(targetId, aggressor, source); } catch (e) { log('injury: the hit threw:', e); }
  }
  // A blow that opens a cut, a break or a bite (#1383), measured on the next
  // turn in the same block. On its own as well.
  if (hurt && hurt.blow) {
    try { hurt.blow(targetId, aggressor, source, projectile, power, sneak, bash, blocked); }
    catch (e) { log('injury: the blow threw:', e); }
  }
});
// ==== end thornswood warrior maneuvers ====


