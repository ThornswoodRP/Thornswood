// ---------------------------------------------------------------------------
// event handlers
//
// Every event a client can raise, and what this file answers to each, is
// listed once, over mp.onTakeItem beside mp.onPutItem further down.
// ---------------------------------------------------------------------------

ensureProperties();
startChargenTimer();

/*
  HOW MANY PIECES ONE KILL IS WORTH TO A WARRIOR (#1386).

  docs/systems/professions/warrior.md, "How much one kill is worth": a chicken
  and a dragon are not the same fight, so the piece count follows how hard the
  thing was. Until this, every kill was one piece.

  BY THE RACE THE ENGINE SAYS THE BODY IS. Actor.GetRace in the fork follows
  the actor's own template chain, the one the engine rolled when it spawned,
  so it names the race the body really has (a bandit's base is often a
  levelled template, and the hunt table's build script measured over a
  thousand people whose own RNAM says fox). The race's editor id is read out
  of RACES, the table of every RACE record in the load order, and looked up in
  the lines below.

  THE STRENGTH TABLE WINS OVER THE HUNTER LIST. Patrick's answer on #1386, 4
  October: where the two disagree, the strength table is the one that counts.
  So a bull netch is a grown netch, 8, though the hunter list calls it
  advanced; a vale sabre cat and a snowy one are sabre cats, 2; an ice wolf is
  a wolf, 1; and Karhu is a bear, 4. The hunter list's own rank (novice 1,
  advanced 2, expert 4, master 8) counts only for a body on it whose race no
  line here names, which today is none: every race in the load order has a
  line, and the harness holds that.

  THE TWO HALVES OF THE LINES. kinds is the page's own two tables, the
  strength table and the person-shaped one, each word on the page with the
  races it is in Skyrim. unnamed is every body neither table names, placed
  against those lines by how hard it is in vanilla Skyrim (Patrick, 4 October:
  "use suggested bands"); the page lists the same words under "Bodies neither
  table names". A race nobody has placed yet, one a new plugin brings, is the
  novice line, 1, until somebody places it.

  A PERSON KILLED BY A PERSON IS STILL NOTHING. That test is in mp.onDeath and
  is not this function's: nothing here is asked about a person's body.
*/
const WARRIOR_KILL = {
  byRank: { novice: 1, advanced: 2, expert: 4, master: 8 },
  kinds: [
    // The strength table: novice, advanced, expert, master animal.
    ['chicken', 1, ['ChickenRace', 'EE_ChickenAnimalRace01', 'OR_ChickenRace']],
    ['rabbit', 1, ['HareRace']],
    ['fox', 1, ['FoxRace']],
    ['deer', 1, ['DeerRace', 'DLC1DeerGlowRace', 'ElkRace', 'WhiteStagRace']],
    ['wolf', 1, ['WolfRace', 'C06WolfSpiritRace', 'ccBGSSSE036_BoneWolfCompanionRace']],
    ['skeever', 1, ['SkeeverRace', 'SkeeverWhiteRace']],
    ['mudcrab', 1, ['MudcrabRace', 'DLC2MudcrabSolstheimRace', 'ZWJ_Polymorph68_GiantMudcrabRace']],
    ['goat', 1, ['GoatRace', 'GoatDomesticsRace', 'EE_GoatAnimalRace01']],
    ['cow', 1, ['CowRace', 'EE_CowAnimalRace01']],
    ['dog', 1, ['DogRace', 'DogCompanionRace', 'MG07DogRace', 'DA03BarbasDogRace', 'DLC1HuskyBareRace',
                'DLC1HuskyArmoredRace', 'DLC1HuskyBareCompanionRace', 'DLC1HuskyArmoredCompanionRace']],
    ['sabre cat', 2, ['SabreCatRace', 'SabreCatSnowyRace', 'DLC1SabreCatGlowRace']],
    ['troll', 2, ['TrollRace', 'TrollFrostRace', 'DLC1TrollRaceArmored', 'DLC1TrollFrostRaceArmored']],
    ['spider', 2, ['FrostbiteSpiderRace', 'FrostbiteSpiderRaceGiant', 'FrostbiteSpiderRaceLarge',
                   'DLC2ExpSpiderBaseRace', 'DLC2ExpSpiderPackmuleRace']],
    ['horse', 2, ['HorseRace', 'CartHorseRace']],
    ['horker', 2, ['HorkerRace']],
    ['netch calf', 2, ['DLC2NetchCalfRace']],
    ['bear', 4, ['BearBlackRace', 'BearBrownRace', 'BearSnowRace']],
    ['chaurus', 4, ['ChaurusRace', 'ChaurusReaperRace', 'DLC1_BF_ChaurusRace', 'DLC1ChaurusHunterRace']],
    ['mammoth', 8, ['MammothRace']],
    ['a grown netch', 8, ['DLC2NetchRace']],
    // The person-shaped table. A bandit, a guard and a forsworn are all the
    // people's races, a vampire and a child of them included.
    ['bandit, guard, forsworn', 2, ['ArgonianRace', 'ArgonianRaceVampire', 'BretonRace', 'BretonRaceChild',
      'BretonRaceChildVampire', 'BretonRaceVampire', 'DarkElfRace', 'DarkElfRaceVampire', 'DLC1NordRace',
      'ElderRace', 'ElderRaceVampire', 'HighElfRace', 'HighElfRaceVampire', 'ImperialRace', 'ImperialRaceChild',
      'ImperialRaceVampire', 'KhajiitRace', 'KhajiitRaceVampire', 'NordRace', 'NordRaceAstrid', 'NordRaceChild',
      'NordRaceVampire', 'OrcRace', 'OrcRaceVampire', 'RedguardRace', 'RedguardRaceChild', 'RedguardRaceVampire',
      'WoodElfRace', 'WoodElfRaceVampire']],
    ['skeleton', 2, ['SkeletonRace', 'SkeletonArmorRace', 'SkeletonNecroRace', 'SkeletonNecroPriestRace',
      'DLC1BlackSkeletonRace', 'DLC1SoulCairnSkeletonArmorRace', 'DLC1SoulCairnSkeletonNecroRace',
      'RigidSkeletonRace', 'DLC2RigidSkeletonRace']],
    ['draugr', 4, ['DraugrRace', 'DraugrMagicRace', 'DLC2HulkingDraugrRace', 'testDraugrRace']],
    ['falmer', 4, ['FalmerRace', 'FalmerFrozenVampRace']],
    ['hagraven', 4, ['HagravenRace']],
    ['giant', 8, ['GiantRace', 'C00GiantOutsideWhiterunRace', 'DLC2GhostFrostGiantRace']],
    ['dragon priest', 8, ['DragonPriestRace', 'DLC2AcolyteDragonPriestRace']],
    ['centurion', 8, ['DwarvenCenturionRace', 'DLC1LD_ForgemasterRace']],
    ['lurker', 8, ['DLC2LurkerRace']],
    ['dragon', 16, ['AlduinRace', 'DragonRace', 'DragonBlackRace', 'DLC2DragonBlackRace', 'UndeadDragonRace',
      'DLC1UndeadDragonRace', 'dlc2SpectralDragonRace', 'DragonRaceLokjun']]
  ],
  unnamed: [
    // With the novice line.
    ['riekling of Solstheim', 1, ['DLC2RieklingRace', 'DLC2ThirskRieklingRace']],
    ['ash hopper', 1, ['DLC2AshHopperRace']],
    ['slaughterfish', 1, ['SlaughterfishRace']],
    ['nix-hound', 1, ['ccBGSSSE035_NixHoundCompanionRace']],
    ['shade', 1, ['WispShadeRace']],
    ['witchlight', 1, ['WitchlightRace']],
    ['soul wisp', 1, ['DLC1SoulCairnSoulWispRace']],
    ['swarm', 1, ['SwarmRace', 'SprigganSwarmRace']],
    ['mannequin', 1, ['ManakinRace']],
    ['a creature a spell conjures', 1, [
      'ODN_Con_Daedra_Race_ConjureClannfear', 'ODN_Con_Daedra_Race_ConjureClannroth',
      'ODN_Con_Daedra_Race_ConjureDaedroth', 'ODN_Con_Daedra_Race_ConjureXivilai',
      'ODN_Con_Undead_Race_ConjureDreadShade', 'ODN_Con_Undead_Race_ConjureGloomWraith',
      'ODN_Con_Undead_Race_ConjureSanctifiedWraith', 'TVR_Demon_Race_ConjureGremlin',
      'TVR_Demon_Race_ConjureLeviathan', 'TVR_Demon_Race_ConjureOathbreaker', 'TVR_Demon_Race_ConjureRavagor',
      'TVR_Demon_Race_ConjureTempleGrim', 'TVR_Primal_Race_CallHoundOfHircine', 'TVR_Primal_Race_CallRaven',
      'TVR_Primal_Race_CallSnakes', 'TVR_Primal_Race_CallSnowLeopard', 'TVR_Primal_Race_CallWolf',
      'TVR_Totem_Race_EyesInTheSky', 'TVR_Totem_Race_Totem', 'TVR_Verdant_Race_ForceOfNature',
      'TVR_Verdant_Race_Wildshape', 'TVR_Warrior_Race_Fylgja', 'TVR_Warrior_Race_FylgjaStorm',
      'WB_ConjureBearTotem_Race', 'WB_ConjureCatTotem_Race', 'WB_ConjureCraftlord_Race',
      'WB_ConjureDeadeyeCaptain_Race', 'WB_ConjureKyrkrim_Race', 'WB_FeralSpirit_Race', 'WB_Lich_Race',
      'WB_NetherLich_Race', 'WB_Skinwalker_Race', '0_CombatBlue', '0_JarBOMBA', '0_PuppetmanRace',
      '0_SkeleGiantRace']],
    ['a race that is not a creature', 1, ['DefaultRace', 'TestRace', 'InvisibleRace', 'dunMiddenEmptyRace',
      'DLC2FakeCoffinRace', 'DLC2dunInstrumentsRace']],
    // With the advanced line and the people's line.
    ['spriggan', 2, ['SprigganRace', 'DLC2SprigganBurntRace']],
    ['dwarven spider', 2, ['DwarvenSpiderRace']],
    ['ice wraith', 2, ['IceWraithRace', 'DLC2dunKarstaagIceWraithRace']],
    ['death hound', 2, ['DLC1DeathHoundRace', 'DLC1DeathHoundCompanionRace']],
    ['bristleback', 2, ['DLC2BoarRace', '1BoarRideRace']],
    ['riekling on a bristleback', 2, ['DLC2MountedRieklingRace']],
    ['ash spawn', 2, ['DLC2AshSpawnRace']],
    ['magic anomaly', 2, ['MagicAnomalyRace']],
    ['boneman', 2, ['DLC01SoulCairnBonemanRace']],
    ['the afflicted', 2, ['DA13AfflictedRace']],
    ['a riekling of the riekling people', 2, ['1RieklingBlueRace', '1RieklingBlueRaceVampire',
      '1RieklingPurpleRace', '1RieklingPurpleRaceVampire', '1NpcRieklingBlueRace', '1NpcRieklingBlueRace2',
      '1NpcRieklingBlueRaceVampire', '1NpcRieklingPurpleRace', '1NpcRieklingPurpleRace2',
      '1NpcRieklingPurpleRaceVampire']],
    // With the expert line, beside the draugr and the falmer.
    ['atronach', 4, ['AtronachFlameRace', 'AtronachFrostRace', 'AtronachStormRace']],
    ['dwarven sphere', 4, ['DwarvenSphereRace']],
    ['dwarven ballista', 4, ['DLC2DwarvenBallistaRace']],
    ['gargoyle', 4, ['DLC1GargoyleRace', 'DLC1GargoyleVariantGreenRace', 'DLC1GargoyleVariantBossRace']],
    ['dremora', 4, ['DremoraRace', 'DLC2DremoraRace']],
    ['snow elf', 4, ['SnowElfRace']],
    ['ash guardian', 4, ['dlc2AshGuardianRace']],
    ['seeker', 4, ['DLC2SeekerRace']],
    ['wispmother', 4, ['WispRace']],
    ['spriggan matron', 4, ['SprigganMatronRace', 'SprigganEarthMotherRace']],
    ['keeper', 4, ['DLC1SoulCairnKeeperRace']],
    // With the giants.
    ['werewolf', 8, ['WerewolfBeastRace']],
    ['werebear', 8, ['DLC2WerebearBeastRace']],
    ['vampire lord', 8, ['DLC1VampireBeastRace']],
    ['Miraak', 8, ['DLC2MiraakRace']]
  ],
  fallback: 1
};

/** The line a race is on: its pieces, or 0 when no line names it. The lookup
 *  is built once, by lower case editor id. */
function warriorRaceBand(raceEdid) {
  if (!WARRIOR_KILL.byRace) {
    const map = {};
    const all = WARRIOR_KILL.kinds.concat(WARRIOR_KILL.unnamed);
    for (let i = 0; i < all.length; i++) {
      for (let j = 0; j < all[i][2].length; j++) { map[all[i][2][j].toLowerCase()] = all[i][1]; }
    }
    WARRIOR_KILL.byRace = map;
  }
  const race = String(raceEdid || '').toLowerCase();
  return (race && Object.prototype.hasOwnProperty.call(WARRIOR_KILL.byRace, race)) ? WARRIOR_KILL.byRace[race] : 0;
}

/** The pieces one kill is worth: the race's line, else the hunter list's rank
 *  for a base on it, else the novice line. Pure, so the harness can ask it
 *  about any body. */
function warriorPieces(baseDesc, raceEdid) {
  const band = warriorRaceBand(raceEdid);
  if (band) { return band; }
  const base = String(baseDesc || '');
  if (base && Object.prototype.hasOwnProperty.call(HUNTS_BY_BASE, base)) {
    const rank = HUNTS_BY_BASE[base].rank;
    if (Object.prototype.hasOwnProperty.call(WARRIOR_KILL.byRank, rank)) {
      return WARRIOR_KILL.byRank[rank];
    }
  }
  return WARRIOR_KILL.fallback;
}

/** The editor id of the race the engine says this actor is, or '' when it
 *  cannot say. The descriptor is read as the engine writes it and, failing
 *  that, with its hex put the way RACES writes it. */
function raceEdidOf(actorId) {
  let desc = '';
  try {
    const r = mp.callPapyrusFunction('method', 'Actor', 'GetRace',
      { type: 'form', desc: mp.getDescFromId(actorId) }, []);
    desc = (r && r.desc) ? String(r.desc) : '';
  } catch (e) {
    return '';
  }
  const items = (typeof RACES !== 'undefined' && RACES && RACES.items) ? RACES.items : null;
  if (!desc || !items) { return ''; }
  let row = Object.prototype.hasOwnProperty.call(items, desc) ? items[desc] : null;
  if (!row) {
    const at = desc.indexOf(':');
    const hex = at > 0 ? parseInt(desc.slice(0, at), 16) : NaN;
    const again = isNaN(hex) ? '' : hex.toString(16) + desc.slice(at);
    row = (again && Object.prototype.hasOwnProperty.call(items, again)) ? items[again] : null;
  }
  return row ? String(row.e || '') : '';
}

/** How many pieces killing this actor is worth to a warrior. */
function killPieces(actorId) {
  let base = '';
  try { base = String(mp.get(actorId, 'baseDesc') || ''); } catch (e) { base = ''; }
  return warriorPieces(base, raceEdidOf(actorId));
}

/**
 * ASKED BEFORE A DEATH (#1626). The engine raises onDying when a write is about
 * to take somebody's health to nothing (a blow, a spell, a bleed, or a write of
 * this file's own), before the zero or the death is sent to any machine
 * (MpActor::NetSetPercentages and SetPercentage in the fork, skymp #101).
 * false refuses the death: nothing of it is sent, mp.onDeath is not raised, and
 * the engine keeps them alive at dyingHealth, a share of their most like
 * percentages, which only this handler can write. Anything else lets the death
 * go on to mp.onDeath below.
 *
 * Cheat Death answers first (#1385). Going down (#2681, docs/systems/injury.md)
 * is the second answer and is not built yet. Nothing here may ask
 * cheatDeath() about anything but this death: it spends its day when it says
 * yes.
 */
mp.onDying = guard('onDying', function (actorId) {
  const perks = globalThis.__thornswoodPerks;
  if (!perks || !perks.cheatDeath) { return undefined; }
  const kept = perks.cheatDeath(actorId);
  if (!(kept > 0)) { return undefined; }
  mp.set(actorId, 'dyingHealth', kept);
  return false;
});

/**
 * Set the arrival point at the moment of death, while we still know where the
 * body fell. The engine reads spawnPoint when the respawn timer expires.
 *
 * And, for an animal the hunt table answers for, set how long the body lies
 * there before the engine stands it back up. That half runs before the people
 * only test below, because it is the half that is about everything which is not
 * a person.
 */
mp.onDeath = guard('onDeath', function (actorId, killerId) {
  /*
    A BLOW THE SERVER LANDED ITSELF STILL HAS A KILLER (#1386). The extra
    damage of a warrior's Heavy or Wreck is written by the maneuvers block
    after the engine's own hit, and the engine kills with no killer when a
    write takes health to nothing. The maneuvers block remembers whose blow
    that was for a moment, and it is asked here, before anything reads the
    killer.
  */
  if (!killerId) {
    try {
      var blowBy = globalThis.__thornswoodManeuvers;
      if (blowBy && blowBy.killerOf) { killerId = blowBy.killerOf(actorId) || killerId; }
      // The same for a skill perk's extra blow (#1385).
      var perkBy = globalThis.__thornswoodPerks;
      if (!killerId && perkBy && perkBy.killerOf) { killerId = perkBy.killerOf(actorId) || killerId; }
    } catch (eBlow) { }
  }
  let npcDeath = false;
  try { npcDeath = !(Number(mp.get(actorId, 'profileId')) > 0); } catch (e) { return; }
  /*
    HOW LONG THE BODY LIES THERE, FOR AN ANIMAL A HUNTER CAN WORK.

    Read out of the fork on 20 September rather than assumed. Every actor that
    dies is stood back up: DeathEvent::OnFireSuccess calls
    MpActor::RespawnWithDelay, which sets a timer of ChangeForm().spawnDelay, and
    spawnDelay is 25.0f unless something sets it (MpChangeForms.h:109). Nothing
    here ever set it, so a carcass was pressable for twenty five seconds and a
    hunter who finished the fight and walked over found a live animal and got
    silence. The number this writes is HUNT_TUNING.bodySeconds and the case for
    it is written over that block.

    THE ORDER IS WHAT MAKES THIS WORK, and it is the engine's rather than
    anything this file arranges: GameModeEvent::Fire runs every listener, which
    is this function, and only then calls OnFireSuccess, which is the line that
    starts the respawn timer. GetRespawnTime is read inside that timer's setup,
    so a spawnDelay written here is the one that death uses. Written on every
    death rather than once, because it costs one property write and a table
    rebuild that adds an animal must not need a hand edit anywhere else.

    Animals in the table and nothing else. A bandit, a guard, a draugr and a
    dragon keep the engine's twenty five seconds, because no hunter has a verb
    for any of them and nothing else on this server reads spawnDelay.

    Wrapped, and a throw is not a failure worth a line in the log: baseDesc
    throws for a reference the world does not have any more, and spawnDelay
    throws for anything that is not an MpActor, which a death event should never
    hand us but is not this function's to prove.
  */
  try {
    const dying = mp.get(actorId, 'baseDesc');
    if (npcDeath) {
      const population = globalThis.__thornswoodNpcPopulation;
      /*
        A TEMPORARY SPAWN'S BODY LIES THE NORMAL TIME (#2623). Djinn, 17
        October: "leave the normal body time", so a hunter can still skin
        and loot it. The 45 minutes in a spawn's rule is how long a kept one
        waits before it stands up again, which is not a body time, so a
        temporary one skips it and gets what the same creature gets in the
        wild: an animal a hunter can work lies HUNT_TUNING.bodySeconds,
        anything else the engine's twenty five seconds. mp.onRespawn removes
        it when that time is up, instead of letting it stand.
      */
      const minutes = !isTemporarySpawn(actorId) && population && population.returnMinutes(actorId);
      if (Number.isInteger(minutes) && minutes > 0 && minutes <= 1440) {
        mp.set(actorId, 'spawnDelay', minutes * 60);
      } else if (isCarcass(dying)) {
        mp.set(actorId, 'spawnDelay', HUNT_TUNING.bodySeconds);
      }
      const stock = globalThis.__thornswoodResourceStock;
      if (stock) stock.recordDeath(actorId);
    }
  } catch (e) {
    /* not a reference this server can read any more, so there is no body to
       leave lying and nothing to say about it */
  }

  if (npcDeath) {
    try {
      var bodyLoot = globalThis.__thornswoodDungeonLoot;
      if (bodyLoot && bodyLoot.onDeath) bodyLoot.onDeath(actorId);
    } catch (eBody) { /* a body roll must not block the rest of death */ }
  }
  if (npcDeath && killerId) {
    try {
      var questKill = globalThis.__thornswoodQuests;
      if (questKill && questKill.noteKill) questKill.noteKill(killerId, actorId);
    } catch (eQuestKill) { /* a quest kill must not block death */ }
  }

  /*
    AND THE WARRIOR'S WORK IS THE FIGHT.

    THE CIRCLE. A Warrior holds bulwark or berserker. Neither owns a recipe,
    because a warrior does not make things, and until now nothing anywhere
    credited either of them: not the recipe gate, not a station, not a verb.
    creditWork is the only road to addWork and addWork is the only road to
    rankUp, so a Warrior could play for a month and stay a novice for ever
    while a miner two feet away climbed. Audit-Systems calls it "OWNS NO
    RECIPE AT ALL, so somebody can pick it and make nothing", which is the
    symptom; the fault is that there was no way for them to climb at all.

    THIS IS THE SAME SHAPE THE MAGE HAD and the same answer. The note over
    treePointsPerRank says it: nothing here counts a spell being cast, and a
    mage was stuck holding two novice spells for good until two other things
    the server sees were made to count. The
    server does see a death, with its killer, and that is the warrior's.

    THE RULES, and each one is there to stop something.
      A PERSON KILLED BY A PERSON COUNTS FOR NOTHING. The dead actor is
      checked for a profileId below and the credit is above that check on
      purpose: only an NPC, an animal or a draugr pays. Paying for a kill
      between people is a bounty on the people this server is for.
      THE KILLER HAS TO BE A PERSON, for the same reason a bandit killing a
      chicken is not work.
      NOT YOURSELF. killerId equal to actorId is a fall or a fire, not a
      fight.
      ONLY A WARRIOR. Every other profession has a verb of its own and
      crediting them here as well would make killing the fastest way to be a
      tailor.

    It goes through creditWork like every other verb, so the tiredness drain
    and the party bonus apply and every ceiling in the rulebook still holds.
  */
  try {
    var kid = Number(killerId) || 0;
    if (kid && kid !== actorId) {
      var deadIsPerson = 0;
      try { deadIsPerson = Number(mp.get(actorId, 'profileId')) > 0; } catch (e) { deadIsPerson = false; }
      var killerIsPerson = 0;
      try { killerIsPerson = Number(mp.get(kid, 'profileId')) > 0; } catch (e) { killerIsPerson = false; }
      if (!deadIsPerson && killerIsPerson) {
        var ch = globalThis.__thornswoodCharacter;
        var st = (ch && ch.stateOf) ? ch.stateOf(kid) : null;
        if (st && st.prof === 'warrior' && st.half) {
          // As many pieces as the body was hard (killPieces, over this
          // handler, #1386): a chicken is 1 and a dragon 16. Whatever the
          // body carried staying in the pack is the hunt, not a piece more.
          var raised = creditWork(kid, st.half, killPieces(actorId));
          if (raised) {
            notify(kid, raised);
            say(kid, raised);
          }
        }
      }
    }
  } catch (e) {
    log('could not count a kill for', (killerId || 0).toString(16) + ':', e);
  }

  /*
    People only.

    This fires for every MpActor the server owns, which is every bandit, wolf
    and chicken anybody kills. Each one was having a temple spawnPoint written
    onto it, which is meaningless at best and, if SkyMP ever honours it on an
    NPC respawn, puts dead bandits back on their feet inside temples.

    A profileId is what tells a person from the rest of Skyrim. Nothing else
    on the server has one.
  */
  let pid = 0;
  try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
  if (!(pid > 0)) { return; }

  /*
    THE WOUNDS COME WITH YOU (#1383, death.md): the record stays as it was,
    and only the bleed stops, in the injury and disease block's died().
  */
  try {
    const hurt = globalThis.__thornswoodHurt;
    if (hurt && hurt.died) { hurt.died(actorId); }
  } catch (eHurt) { log('injury: a death threw:', eHurt); }

  const site = {
    desc: mp.get(actorId, 'worldOrCellDesc'),
    pos: mp.get(actorId, 'pos'),
    cameIn: cameInOf(actorId),
  };
  const arrival = resolveArrival(site);
  if (!arrival) {
    log('onDeath', actorId, 'no arrival resolved for', site.desc, '- leaving default spawn point');
    return;
  }
  mp.set(actorId, 'spawnPoint', {
    cellOrWorldDesc: arrival.desc,
    pos: arrival.pos,
    rot: arrival.rot,
  });
  log('death', actorId, 'in', site.desc,
      '-> ' + arrival.cell + ' (' + arrival.slot + ')',
      'hold=' + arrival.hold + '(' + arrival.via + ')',
      'ground=' + arrival.reason,
      // The door they came in by, when a worldspace of its own sent them to
      // its hold or could not (#1909).
      /^(came-in-by|own-world-no-)/.test(String(arrival.via))
        ? 'came-in=' + JSON.stringify(site.cameIn || null) : '',
      killerId ? 'killer=' + killerId : '');
});

mp.onRespawn = guard('onRespawn', function (actorId) {
  /*
    A TEMPORARY SPAWN DOES NOT STAND UP AGAIN (#2623). Its body has lain the
    normal time (mp.onDeath above), and this is the moment the engine would
    stand it up where it was made. Read out of the fork at the commit
    engine\skymp pins: MpActor::Respawn fires this event, and false from a
    listener makes GameModeEvent::Fire call OnFireBlocked, which for
    RespawnEvent does nothing, so the actor stays dead and nothing is sent.
    Then removeSpawned takes it out of the world, on the next turn of the
    event loop because the engine is still inside the event here.
  */
  let temporary = false;
  try { temporary = !(Number(mp.get(actorId, 'profileId')) > 0) && isTemporarySpawn(actorId); }
  catch (eTemp) { log('onRespawn', actorId.toString(16), 'could not check for a temporary spawn:', eTemp); }
  if (temporary) {
    try {
      var bodyGone = globalThis.__thornswoodDungeonLoot;
      if (bodyGone && bodyGone.onStand) bodyGone.onStand(actorId);
    } catch (eGone) { /* the body's loot record goes with the body either way */ }
    setTimeout(function () { removeSpawned(actorId); }, 0);
    log('respawn', actorId, 'refused: a temporary spawn, removed instead');
    return false;
  }
  const sp = mp.get(actorId, 'spawnPoint');
  log('respawn', actorId, 'at', sp && sp.cellOrWorldDesc);
  if (!(Number(mp.get(actorId, 'profileId')) > 0)) {
    try {
      var bodyLoot = globalThis.__thornswoodDungeonLoot;
      if (bodyLoot && bodyLoot.onStand) bodyLoot.onStand(actorId);
    } catch (eBody) { /* standing up still happens if the pile cannot be cleared */ }
    // Native OnFireSuccess clears isDead after this event returns.
    setTimeout(function () {
      try {
        const stock = globalThis.__thornswoodResourceStock;
        if (stock) stock.recordRespawn(actorId);
      } catch (e) { log('could not reset NPC resource stock:', actorId, e); }
    }, 0);
  }
});

// No book moves anybody's rank. Patrick, 21 September: rank comes from working
// the trade and from nothing else. The manuals are gone from the plugin and a
// book in this world is a book. The one book event here, mp.onReadBook at the
// end of THE STAFF SPELLS, holds a spell tome to the Mage rules (#1026) and
// records a staff's spell when somebody who makes staves reads its
// tome (#967), and never touches a rank.


