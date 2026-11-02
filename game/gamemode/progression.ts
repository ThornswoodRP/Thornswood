// ==== thornswood progression ====
/*
  The rulebook, as data and as rules. Patrick, 20 September.

  This block owns what a character IS: their class, their profession and the
  half of it they work, their rank in each thing they know, their spell points,
  and their attribute tree. Nothing else in the gamemode decides any of that,
  and nothing on the client does either. The client draws the table this block
  sends it and sends back what was picked; every yes and every no is decided
  here, because a client that decided any of it would be a client anybody
  could edit.

  Two halves. TABLE is the rulebook transcribed, and it is the one copy: the
  client's panel carries a default of the same shape only so it draws
  something before the server has spoken, and setData replaces it wholesale.
  RULES is a set of pure functions over a character's state. They take a state
  and an action and hand back either a new state or a reason, and they touch
  nothing else, which is what makes them testable by lifting them out.

  WHAT ARRIVED ON 20 SEPTEMBER, for the dev server. The rules used to answer
  what somebody may pick and nothing else: canDo had no callers, no work was
  counted anywhere, nothing raised a rank except a Master teaching, and no
  spell could be chosen at all. So creditWork counts the work and raises the
  rank through rankUp, every rank now gives a skill tree point because nothing
  else in the game gives one, and pickSpell spends a spell point out of the
  book below. The numbers none of that had, because the rulebook does not set
  them, are together in TUNING.

  ON THE FLAT SIXTEEN. The old CHARGEN table had sixteen trades with a kit
  each. Five of them, bard, merchant, priest, scholar and thief, have no
  home in the rulebook as Class or Profession. Patrick decided on 26
  September 2026: they are RP-only. You may roleplay as one; you do not pick
  them as a class or a profession, and they grant no class or profession
  privileges. RP_ONLY names them so migrate and the harnesses can tell a
  retired trade from an unknown one. Gatherer and Tailor stay.
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  // ------------------------------------------------------------ the table --
  var RANKS = ['novice', 'advanced', 'expert', 'master'];

  var CLASSES = {
    hunter:   { name: 'Hunter',   only: 'loot an animal body' },
    fisher:   { name: 'Fisher',   only: 'catch fish' },
    gatherer: { name: 'Gatherer', only: 'harvest flora and materials out of the world' },
    miner:    { name: 'Miner',    only: 'mine ore veins' },
    farmer:   { name: 'Farmer',   only: 'plant and harvest crops' }
  };

  /*
    Old chargen trades that are not Class or Profession. Roleplay only:
    no pick, no verb, no craft half, no instrument privilege. migrate()
    clears them off a character so they re-pick from CLASSES / PROFESSIONS.
    Do not add them back to either table.
  */
  var RP_ONLY = {
    bard:     { name: 'Bard' },
    merchant: { name: 'Merchant' },
    priest:   { name: 'Priest' },
    scholar:  { name: 'Scholar' },
    thief:    { name: 'Thief' }
  };

  var SCHOOLS = ['destruction', 'restoration', 'alteration', 'conjuration', 'illusion'];

  var PROFESSIONS = {
    warrior:    { name: 'Warrior',    halves: { bulwark: 'Bulwark', berserker: 'Berserker' },
                  perk: { key: 'warlord', name: 'Warlord' } },
    mage:       { name: 'Mage',       halves: null, schools: 2, mastered: 3,
                  perk: { key: 'archmage', name: 'Archmage' } },
    alchemist:  { name: 'Alchemist',  halves: { blightbrewer: 'Blightbrewer', physicker: 'Physicker' },
                  perk: { key: 'masterchemist', name: 'Master Chemist' } },
    cook:       { name: 'Cook',       halves: { hearthcook: 'Hearthcook', confectioner: 'Confectioner' },
                  perk: { key: 'grandchef', name: 'Grand Chef' } },
    smith:      { name: 'Smith',      halves: { platewright: 'Platewright', edgewright: 'Edgewright' },
                  perk: { key: 'mastercraft', name: 'Mastercraft' } },
    enchanter:  { name: 'Enchanter',  halves: { bladebinder: 'Bladebinder', wardweaver: 'Wardweaver' },
                  perk: { key: 'twinsouls', name: 'Twin Souls' } },
    tailor:     { name: 'Tailor',     halves: { liverywright: 'Liverywright', haberdasher: 'Haberdasher' },
                  perk: { key: 'masterweaver', name: 'Master Weaver' } },
    woodworker: { name: 'Woodworker', halves: { charburner: 'Charburner', woodwright: 'Woodwright' },
                  perk: { key: 'mastercarver', name: 'Master Carver' } }
  };

  var TREE = {
    health:  { name: 'Health',  skills: {
      vitality:   { name: 'Vitality',   perk: 'cheatdeath' },
      fortitude:  { name: 'Fortitude',  perk: 'trollsblood' },
      might:      { name: 'Might',      perk: 'devastatingblow' },
      resilience: { name: 'Resilience', perk: 'unshakeable' },
      toughness:  { name: 'Toughness',  perk: 'purifiedblood' } } },
    magicka: { name: 'Magicka', skills: {
      capacity:   { name: 'Capacity',   perk: 'archmagesvessel' },
      clarity:    { name: 'Clarity',    perk: 'leylineattunement' },
      potency:    { name: 'Potency',    perk: 'overcharge' },
      ward:       { name: 'Ward',       perk: 'spellbreaker' },
      efficiency: { name: 'Efficiency', perk: 'fontofmagic' } } },
    stamina: { name: 'Stamina', skills: {
      endurance:  { name: 'Endurance',  perk: 'tireless' },
      vigor:      { name: 'Vigor',      perk: 'secondwind' },
      agility:    { name: 'Agility',    perk: 'windwalker' },
      burden:     { name: 'Burden',     perk: 'packmule' },
      precision:  { name: 'Precision',  perk: 'lethalaim' } } }
  };

  /*
    Numbers the rulebook gives, and one it does not.

    SKILL_CAP is how many points fill a sub-skill and grant its perk. The
    rulebook says "maxing out" and no number, so this is a placeholder to be
    set by Patrick; every rule below reads it from here and nowhere else.
  */
  var LIMITS = {
    secondaries: 2,       // novice in at most two other professions' halves
    mageStartSpells: 2,   // spell points a mage begins with
    mageMasterSpells: 2,  // more at Master, alongside the third school
    collegeSemester: 2,   // points a mage earns per semester at the College
    outsiderSemester: 1,  // points a non-mage earns per semester, novice only
    semesterHours: 24,    // a semester is a day of real time (magic.md, #1387)
    outsiderSpells: 2,    // the most spells a non-mage can ever hold
    // An Enchanter's staff spells, built the way a mage's spells are (#1128):
    enchanterStartStaff: 2,   // staff spell points an Enchanter begins with
    enchanterMasterStaff: 2,  // more at Master Bladebinder, as a mage's at Master
    skillCap: 5           // NOT IN THE RULEBOOK. Placeholder, see above.
  };

  /*
    THE HALF THAT MAKES STAVES, and the rank an Enchanter's staff spells climb
    on (#1128). Staves are Bladebinder work: the craft gate asks this half's
    rank before a staff is made, so the staff spells ask the same one. A
    Bladebinder climbs it as their own half; a Wardweaver holds it as the
    sister half, at Novice until a Master Bladebinder takes them on.
  */
  var STAFF_HALF = 'bladebinder';

  /*
    The spell book, school by school and rank by rank.

    Copied from the client's own book, tools\ts-ui\thornswood-skills.js
    (DATA.spells.schools), so the two agree about what exists and what rank it
    is. The server's copy is the one that decides: the client draws a page and
    the page can be edited, this cannot. Skyrim's Apprentice and Adept tiers
    both sit under Advanced, which is the client's sorting and is kept.
  */
  var SPELLS = {
    destruction: {
      novice: ['Flames', 'Frostbite', 'Sparks'],
      advanced: ['Firebolt', 'Ice Spike', 'Lightning Bolt', 'Fireball', 'Ice Storm', 'Chain Lightning', 'Flame Cloak', 'Frost Cloak', 'Lightning Cloak'],
      expert: ['Incinerate', 'Icy Spear', 'Thunderbolt', 'Wall of Flames', 'Wall of Frost', 'Wall of Storms'],
      master: ['Fire Storm', 'Blizzard', 'Lightning Storm']
    },
    restoration: {
      novice: ['Healing', 'Lesser Ward'],
      advanced: ['Healing Hands', 'Fast Healing', 'Steadfast Ward', 'Turn Undead', 'Close Wounds', 'Heal Other', 'Greater Ward', 'Repel Lesser Undead'],
      expert: ['Grand Healing', 'Circle of Protection', 'Repel Undead', 'Turn Greater Undead'],
      master: ['Guardian Circle', 'Bane of the Undead']
    },
    alteration: {
      novice: ['Candlelight', 'Oakflesh'],
      advanced: ['Magelight', 'Stoneflesh', 'Detect Life', 'Ironflesh', 'Telekinesis', 'Waterbreathing'],
      expert: ['Ebonyflesh', 'Paralyze', 'Detect Dead'],
      master: ['Dragonhide', 'Mass Paralysis']
    },
    conjuration: {
      novice: ['Conjure Familiar', 'Raise Zombie', 'Bound Sword'],
      advanced: ['Conjure Flame Atronach', 'Reanimate Corpse', 'Bound Battleaxe', 'Soul Trap', 'Conjure Frost Atronach', 'Banish Daedra', 'Revenant', 'Bound Bow'],
      expert: ['Conjure Storm Atronach', 'Dread Zombie', 'Conjure Dremora Lord', 'Expel Daedra', 'Command Daedra'],
      master: ['Dead Thrall', 'Flame Thrall', 'Frost Thrall', 'Storm Thrall']
    },
    illusion: {
      novice: ['Courage', 'Clairvoyance', 'Fury'],
      advanced: ['Calm', 'Fear', 'Muffle', 'Frenzy', 'Rally', 'Invisibility'],
      expert: ['Pacify', 'Rout', 'Call to Arms'],
      master: ['Harmony', 'Hysteria', 'Mayhem']
    }
  };

  /*
    Spell name -> the form id desc Actor.AddSpell takes, the same shape the
    shrines use ('fb988:Skyrim.esm').

    Read out of the SPEL records of the load order, name for name against the
    book above, by scripts\dev\Build-SpellTable.ps1, which writes it into
    game\gamemode-tables\SPELL_IDS.json (#5191): a form id guessed from memory
    is a spell handed to somebody that is not the spell they asked for. The
    keys are the spell names exactly as SPELLS spells them and the values are
    the descs Actor.AddSpell takes. A spell picked here whose name is not in it
    is known and simply not granted in the game. Nothing throws over a missing
    id: the rules do not look at this table at all, and the granting side
    treats a name that is not in it as "not yet".
  */
  var SPELL_IDS = table('SPELL_IDS');

  /*
    HOW MUCH WORK A RANK TAKES, AND WHAT A RANK GIVES. The tuning knob.

    THE RULEBOOK DOES NOT SET THESE. classes.md says rank comes from doing the
    work and nothing else moves it, and then says nothing about how much work,
    how often, or what a rank hands you outside the mage's spell points. Every
    number that had to be invented for progression to run at all is here, in
    one block, so changing the pace is one edit in one place and nobody has to
    dig a threshold out of a salt quarry.

    These are first numbers for the dev server, not a decision. What they
    should be is a thing to watch testers hit and then argue about.
  */
  var TUNING = {
    /*
      Yields handed out to climb into each rank, counted from the rank below
      and reset on arrival. So novice -> advanced is 100 pieces of work done,
      and the count starts again at 0 against the 250 for expert.

      FIVE VEINS TO ADVANCED, ASKED FOR BY PATRICK ON 21 SEPTEMBER: "it should
      be like 5 veins per rank one is wayy to fast een 5 might be too quick",
      and then "make sure the others don't level up that quickly".

      A vein holds twenty, so the arithmetic is the whole of this line:

        advanced  100 = 5 veins
        expert    250 = 12 and a half
        master    600 = 30
        all the way up          47 and a half veins

      These were 20, 50 and 120, which is one vein to Advanced. That number was
      never wrong on purpose: it was picked when a vein handed over its whole
      yield in one press, so twenty yields meant twenty SEAMS. Once a swing
      became the unit, the same number meant one seam, and nobody moved it. The
      ratio between the three is kept exactly, because the shape of the ladder
      was not what was wrong with it.

      ONE LADDER, EVERY CLASS, which is what makes the second half of Patrick's
      instruction free: workPerRank is not per class, so this slows the
      gatherer, the farmer, the hunter and the fisher by the same five.

      WHAT IT DOES NOT DO, and this is worth being exact about rather than
      claiming more than it earns. It equalises the COUNT, not the PACE. Mining
      is bounded by a vein that holds twenty and comes back in ten or thirty
      minutes, so five veins is real time whatever anybody does. Picking
      flowers is bounded by how many flowers are in front of you. So if the
      gatherer still climbs faster than the miner after this, that is not this
      number, it is the absence of anything like a vein on the gathering side,
      and it wants watching before it wants another guess.

      AND IT IS TOOLS. TOOL_USES is 50 (the plan's number, #1381), so the
      whole climb now costs about nineteen tools rather than two. That is a
      far bigger standing order for the smiths than the ladder had when the
      tool was first counted, and it is the next number to look at if the
      tool stops feeling like stock and starts feeling like a toll.
    */
    workPerRank: { advanced: 100, expert: 250, master: 600 },
    /*
      Skill tree points a rank gives. Nothing anywhere else awards one, so
      without this the fifteen sub-skills on the K panel can never be spent
      into and the whole tree is a picture. Free points: they go wherever the
      person wants, which is what Patrick asked for on 20 September.
    */
    treePointsPerRank: 1,

    /*
      WHAT A SCHOOL CLIMBS ON. NOT IN THE RULEBOOK.

      Nothing here counts a spell being cast. The engine does raise one,
      onPapyrusEvent:OnSpellCast (the list over mp.onTakeItem says what it
      carries), but no handler in this file listens to it, there is no
      magic-effect event, and the only magic the server performs itself is
      Actor.AddSpell. So casting is not counted, and until now nothing else
      counted either:
      a mage held two novice spells for good, because a spell costs a point,
      a point comes with a rank, and a rank came from work a mage had no way
      to do. That circle is the defect. Two things the server does see break
      it, and both go through creditWork, so every ceiling still holds.

        perSpell  a spell learned is this much work in its own school.
        perRank   a rank gained anywhere else, a class at the quarry or the
                  other school, is this much work in every school a mage
                  holds, so hours at the seam and hours at the desk are the
                  same hours. One step only: the work a raise feeds out never
                  feeds again, so nothing can run away.

      classes.md does not set any of these, and it does not mention the
      College or a semester at all; LIMITS.collegeSemester came from
      somewhere else and is about spell points, not rank.
    */
    study: { perSpell: 5, perRank: 10 },

    /*
      THE STARTING ALLOCATION. NOT IN THE RULEBOOK. Patrick, 20 September:
      'you should start off with points into specific things based on the
      profession/sub/class you choose'.

      These points are PLACED, not spent: they land in named sub-skills the
      moment the pick is made, they are recorded in s.placed as well as
      s.tree so the panel can draw them as placed, and they cannot be moved.
      They read like the thing they are: a smith places in Might and Burden,
      a mage in Capacity and Clarity, a hunter in Precision.

      Kept small on purpose. classes.md: 'Everybody has the same fifteen, and
      nobody fills more than a few of them.' A class places 1, a profession
      2, a half 1 and each school of a mage 1, so nobody starts with more
      than four placed and no single sub-skill can start anywhere near the
      cap of five.
    */
    placed: {
      classes: {
        hunter:   { precision: 1 },
        fisher:   { vigor: 1 },
        gatherer: { burden: 1 },
        miner:    { might: 1 },
        farmer:   { endurance: 1 }
      },
      professions: {
        warrior:    { vitality: 1, might: 1 },
        mage:       { capacity: 1, clarity: 1 },
        alchemist:  { toughness: 1, clarity: 1 },
        cook:       { fortitude: 1, endurance: 1 },
        smith:      { might: 1, burden: 1 },
        enchanter:  { capacity: 1, ward: 1 },
        tailor:     { agility: 1, efficiency: 1 },
        woodworker: { endurance: 1, burden: 1 }
      },
      halves: {
        bulwark: { resilience: 1 },   berserker: { might: 1 },
        blightbrewer: { potency: 1 }, physicker: { clarity: 1 },
        hearthcook: { vitality: 1 },  confectioner: { fortitude: 1 },
        platewright: { resilience: 1 }, edgewright: { precision: 1 },
        bladebinder: { potency: 1 },  wardweaver: { ward: 1 },
        liverywright: { efficiency: 1 }, haberdasher: { agility: 1 },
        charburner: { toughness: 1 }, woodwright: { precision: 1 }
      },
      schools: {
        destruction: { potency: 1 },  restoration: { clarity: 1 },
        alteration: { ward: 1 },      conjuration: { capacity: 1 },
        illusion: { efficiency: 1 }
      }
    },

    /*
      WHAT ONE POINT IN A SUB-SKILL IS WORTH. NOT IN THE RULEBOOK.

      classes.md says what each sub-skill raises and never says by how much.
      The server cannot set any of it: GetBaseActorValues computes health,
      magicka, stamina and the rest from the race record, so a base value
      written here is overwritten the next time the client works them out.
      So the server sends the total and the client applies it. treeApplies
      adds this up over s.tree and sends only what is not zero, under the
      names below; what a name means on the client is the client's half of
      the job and is not decided here.

      TWO OF THESE NAMES WERE NOT ACTOR VALUES AND NEVER HAVE BEEN, and the
      two sub-skills that sent them have been doing nothing at all since the
      tree was built. Measured on 20 September, twice over: the 149 AVIF records
      in Skyrim.esm were read, and then, because an AVIF record is not proof
      either way, the fork's own libespm ActorValue.h. healRateMult,
      magickaRateMult, staminaRateMult and diseaseResist ARE real engine actor
      values that happen to share an index with a differently named AVIF record,
      so those four are right and the AVIF list alone would have condemned them
      wrongly. spellPowerMult and spellCostMult are not on either list. So
      treeApplyNow in thornswood-front.js logged 'the game had no number for
      that' and moved on, every time, and a point in Potency or Efficiency
      bought nothing.

      They are still spelled that way HERE, because this table is what one point
      is worth and the rulebook says Potency raises spell damage and duration
      full stop. What changed is that treeApplies no longer sends either name:
      it spreads the total across the schools that character actually holds,
      under the real actor values in schoolValues below. See that block and
      treeApplies for why it has to be that way round and what somebody with no
      school gets.

      EFFICIENCY'S MINUS IS READ HERE AND TURNED OVER ON THE WAY OUT. Under the
      name spellCostMult a minus is right: the cost falls. The value it ends up
      on is the school's skill, where up is what makes a spell cheaper, so
      spreadOverSchools carries sign: -1 for that half and treeApplies applies
      it. Nothing in this table needs changing to read it; the turn is one line
      and it is documented where it happens.

      critChance is the one name left with nothing behind it. It is sent because
      the rulebook promises it and the client decides how to land it.
    */
    perPoint: {
      vitality:   { health: 10 },
      fortitude:  { healRateMult: 10 },
      /*
        A FRACTION, BECAUSE THIS ONE IS A MULTIPLIER AND NOT A POINTS TOTAL.

        It was 5, and the client adds the total onto the value it reads, so one
        point took attackDamageMult from its base of 1 to 6 and a filled Might
        took it to 26. That is six times melee damage for one point. The
        client's own code sets this value to 0 to make an actor deal no damage
        at all, which is what settles that it scales rather than adds.

        0.05 a point, so five points is a quarter more damage and a filled Might
        is a quarter again on top. The unit is said here because every other
        entry in this table IS a flat amount and this one is not.

        Found by the audit of 21 September. A tester can check it in one go:
        player.getav attackdamagemult before and after spending a point.
      */
      might:      { attackDamageMult: 0.05 },
      resilience: { damageResist: 10 },
      toughness:  { poisonResist: 10, diseaseResist: 10 },
      capacity:   { magicka: 10 },
      clarity:    { magickaRateMult: 10 },
      potency:    { spellPowerMult: 5 },
      ward:       { magicResist: 5 },
      efficiency: { spellCostMult: -3 },
      endurance:  { stamina: 10 },
      vigor:      { staminaRateMult: 10 },
      agility:    { speedMult: 2 },
      burden:     { carryWeight: 15 },
      precision:  { critChance: 2 }
    },

    /*
      THE REAL ACTOR VALUES BEHIND POTENCY AND EFFICIENCY, PER SCHOOL.

      Skyrim has no one value for 'spell damage' and none for 'what spells
      cost'. It has ten, two per school:

        <School>PowerMod   how hard that school's spells land
        <School>Mod        the skill the game works that school's cost out from

      AND NOT ONE OF THEM HAS AN 'AV' IN FRONT OF IT. The first draft of this
      table wrote all ten with that prefix, and it would have left Potency and
      Efficiency buying exactly as little as they bought before the table
      existed. The prefix belongs to the AVIF records in Skyrim.esm, which is
      what that pass read, and an AVIF editor id is not what the client looks a
      value up by. thornswood-front.js calls getBaseActorValue and setActorValue
      with the engine's own name for the value. The fork's own
      libespm\include\libespm\ActorValue.h is the list of those names and was
      read again on 21 September: AlterationMod, ConjurationMod, DestructionMod,
      IllusionMod and RestorationMod on lines 117 to 121, and
      AlterationPowerMod through RestorationPowerMod on lines 156 to 160. No
      prefix on any of the 164 entries. The client's own generated
      Data\Platform\Modules\skyrimPlatform.ts says the same from the other side:
      DestructionModifier = 110, DestructionPowerModifier = 149, and no
      AV-prefixed name anywhere in the file. Every name in perPoint above that
      already worked is unprefixed for the same reason, health and carryWeight
      and the rest, while the AVIF editor ids for those two are AVHealth and
      AVCarryWeight.

      The prefix would also have been a lie about one of the ten. All 149 AVIF
      records in Skyrim.esm were dumped on 21 September and there is no
      AVDestructionPowerMod among them: 0x63a AVAlterationPowerMod, 0x63b
      AVConjurationPowerMod, then 0x63d AVIllusionPowerMod with nothing at
      0x63c. So the claim that the ten AV names were confirmed AVIF names was
      wrong on its own terms as well as pointing at the wrong list.

      It matters which way a wrong name fails, and this one failed quietly.
      Papyrus GetBaseActorValue answers 0 for a name it cannot resolve rather
      than refusing, so the !isFinite guard in treeApplyNow would not have
      caught it and the log would have read 'the server's totals are on the
      character: AVDestructionPowerMod +5 (5)' while nothing had been set.

      So a point in Potency has to be spent somewhere, and the only somewhere
      the game offers is a school. This table is the map from the school to the
      two names, and spreadOverSchools below is which of the two each sub-skill
      goes to.

      THE RULEBOOK SETS NONE OF THIS. classes.md says Potency raises 'spell
      damage and duration' and Efficiency 'what spells cost', and says nothing
      about schools, because as far as a person reading that page is concerned
      there is one magicka and one spell. The split is the game's shape showing
      through, and it is why treeApplies splits the total rather than handing
      the whole of it to each school: five schools each getting the full amount
      would make one point in Potency five times the point it says it is.
    */
    schoolValues: {
      destruction: { power: 'DestructionPowerMod', cost: 'DestructionMod' },
      restoration: { power: 'RestorationPowerMod', cost: 'RestorationMod' },
      alteration:  { power: 'AlterationPowerMod',  cost: 'AlterationMod' },
      conjuration: { power: 'ConjurationPowerMod', cost: 'ConjurationMod' },
      illusion:    { power: 'IllusionPowerMod',    cost: 'IllusionMod' }
    },

    /*
      Which name out of perPoint is spread over the schools, which half of
      schoolValues it lands in, and WHICH WAY ROUND IT GOES. Nothing else in
      perPoint is touched: the other thirteen sub-skills name values every
      character has whatever they do for a living, and a point in Vitality is
      health for a smith the same as for a mage.

      THE COST HALF RUNS THE OTHER WAY, which is the whole reason sign is here.
      perPoint has efficiency at spellCostMult: -3, and under that name the
      minus is right: what a spell costs goes down. But <School>Mod is not a
      cost multiplier. It is the additive modifier on the school's SKILL, and
      the game works the cost of a spell out from the skill, so more of it is
      cheaper. Handing -3 through unturned would have taken three levels off
      the character's Destruction and put the price of every Destruction spell
      UP, which is the opposite of what the page sells them, with nothing in any
      log to say so.

      Measured in Skyrim.esm on 21 September rather than reasoned about. Four
      MGEF records carry one of the two Destruction values: MG02FortifyDestruc-
      tion, EnchFortifyDestructionConstantSelf and
      EnchRobesFortifyDestructionConstantSelf on DestructionMod, and
      AlchFortifyDestruction on DestructionPowerMod. 31 enchantments, potions
      and spells use those four between them. Every single magnitude is
      POSITIVE: 27 on DestructionMod running 3 through 25, including
      EnchRobesFortifyDestruction01 at 12 and MGArchMageRobeHoodedEnchant at 15
      and EnchRobesCollegeDestruction05 at 22, all of which read 'Destruction
      spells cost X% less' in front of a person; and 4 on DestructionPowerMod at
      20, 30, 40 and 50, which read 'spells are X% stronger'. Not one negative
      among the 31. So up is cheaper on the cost half and up is stronger on the
      power half, and only the cost half needs turning over.

      THE TWO HALVES ARE NOT COUNTED IN THE SAME UNIT AND THE RULEBOOK SETS
      NEITHER. perPoint's 3 was written as a percentage of cost, and
      <School>Mod is counted in skill levels, so a point in Efficiency is worth
      three levels of each school held rather than three percent off the price.
      That is not a rounding of the intent, it is a different unit, and it is
      said here so the next person does not read the table as percentages.
      classes.md sets no number for either sub-skill, the whole of perPoint is
      invented and says so above, and three levels a point sits inside the range
      the game's own robes use. A first number for the dev server, like the
      rest of them.
    */
    spreadOverSchools: {
      spellPowerMult: { half: 'power', sign: 1 },
      spellCostMult:  { half: 'cost',  sign: -1 }
    },

    /*
      WHAT A FILLED PERK PUTS ON THE SAME MAP (#1385). docs/systems/skill-tree.md.

      Two of the fifteen perks are a number the client already knows how to
      set, so they ride the totals treeApplies sends, on top of the points that
      filled them. Everything else a filled perk does is in the skill perks
      block, after the character block, because it is something that happens
      rather than a number that stands. Font of Magic rides the same map for
      its 15 seconds, but out of that block (withPerks in the character
      block), because it is a number that stands only while it runs.

        windwalker     Windwalker, +4 speed. add: on top of Agility's own.
        purifiedblood  Purified Blood: disease does not take, and poison deals
                       25%. The game's own resistances, brought UP TO what the
                       page says: DiseaseResist 100 is no disease at all, and
                       PoisonResist 75 is poison dealing a quarter. upTo, not
                       add, so Toughness's own five points are not counted a
                       second time and the per point numbers above stay the
                       only per point numbers. What the race already resists
                       still comes on top, as far as the game lets it.
    */
    perkApplies: {
      windwalker:    { add: { speedMult: 4 } },
      purifiedblood: { upTo: { diseaseResist: 100, poisonResist: 75 } }
    },

    /*
      FARMING, AND EVERY ONE OF THESE NUMBERS IS INVENTED.

      Patrick, 20 September: 'there is no system for claiming plots for farming,
      planting things, and then things growing ... I want it so you can't just
      farm infinitely like you usually can and have it so you actually have to
      plant and replant and wait you know'.

      WHAT THE RULEBOOK NOW SETS, and it is more than it set this morning.
      site\data\site\classes.md has a Farming section as of
      20 September. It says plots start empty; that a farmer claims one farm at a
      time and a claim lapses if the farm is left unworked; that the crop is its
      own seed; that a higher rank shortens the wait; that what you bring in is
      MORE than the one you put in the ground; that rank gates the crop, Novice
      the common field crops through to Master everything; and that a farmer
      starts with a few crops in their pack. Every one of those is a rule and
      every one of them is enforced in the farming block below.

      What it does not set is a single number, and it says so in its own words:
      'How long a crop takes to come up, how much a harvest gives back, and how
      long a claim survives unworked are all set on the server rather than
      settled here.' So the numbers are invented, and they are here with the
      rest of the invented numbers rather than scattered through the farming
      block, for the same reason workPerRank is here rather than in a salt
      quarry. Which crop sits on which rung is invented too, and that one lives
      beside the crops, in CROP_RULES near the top of the file. These are first
      numbers for the dev server, not a decision.

        growByRank     what a Farmer's rank does to the wait, by rank step with
                       novice first. A Master waits a little over half as long
                       as a Novice, which is enough to be worth the climb and
                       not enough to make the wait stop mattering. The base
                       minutes are per crop, in CROP_RULES near the top of the
                       file. The multiplier is applied once, at sowing, and the
                       answer is kept on the plot: see writePlot.
        yieldByRank    how many come off one plot, by the same four steps. Every
                       rung is above the one crop sowing costs, because
                       classes.md promises exactly that: 'What you bring in is
                       more than the one you put in the ground, so a farm that is
                       worked grows and a farm that nobody works stops.' It used
                       to read [1, 1, 2, 3], which made a Novice and an Advanced
                       Farmer break even on every plot and the first profitable
                       bring-in the 71st, counting workPerRank above. A farm that
                       cannot grow until the 71st harvest is not the farm the
                       site describes. One more per rung keeps the ladder
                       readable. Nothing here compounds by itself: the ceiling is
                       one plot, one sowing, one wait.
        reach          how far /plant, /plot and /claim look for a plot, in game
                       units. Skyrim activates at about 150, so this is that plus
                       a step and no more: a reach that crossed a garden would
                       sow the plot behind you and tell you it had sown the one
                       in front.
        claimRadius    how far a claim reaches from the plot it was made at, in
                       game units, so a farm is a circle of ground around one of
                       its own plots. It was a 4096 unit grid square until
                       20 September, keyed by the square the claimer was standing
                       in, and that was wrong twice over. A Skyrim farm is
                       roughly 1500 to 3000 units across and a 4096 grid cuts
                       most of them in half, so the half across the line belonged
                       to nobody and could be sown and picked by anybody; and one
                       word took every crop in 4096 by 4096 units of ground,
                       neighbouring farms included. 1200 is a circle 2400 across,
                       which covers a farm from one of its rows and not the
                       village behind it. Claims are kept from overlapping, so no
                       plot is ever in two of them.
        claimLapseDays a claim with nothing done on it for this long is gone.
                       Fourteen days because a closed playtest is exactly where
                       somebody claims a farm, stops testing, and locks that
                       ground for everybody after them. It is refreshed every
                       time the holder sows or brings something in, so it counts
                       days of neglect and not days since the claim.
        startingSeeds  how many of each starting crop a Farmer is handed.
                       Three is enough for three plots and a mistake.
        startingCrops  which ones: Cabbage, Leek and Potato, all three of them
                       plain vegetables on Skyrim.esm and all three on the novice
                       rung, because a first sowing should not depend on standing
                       near an apple tree or on a JK plugin being in the load
                       order.
        seedAgainHours how long before a Farmer whose pack holds no crop at all
                       can be handed seed again. Twelve hours. It is not a
                       generosity, it is the only way back: seed used to be
                       handed out once, at the class pick, so a Farmer who lost
                       their crops was a Farmer who could never farm again, and
                       every Farmer who picked the class before this release was
                       born in that state. It cannot be worked for profit: it
                       asks for an empty pack and pays about nine gold, while one
                       plot pays more than that in half an hour.
        compostGrow    what one spoiled food worked into a sown plot does to
                       the wait that is on it. Patrick, 26 October 2026, on his
                       report page (#3526, A): a quarter less time to ripen.
        compostExtra   how many more that plot gives when it is brought in.
                       The same answer (#3526, B): one more. Once per sowing;
                       see compost in the farming block.
    */
    farming: {
      growByRank: [1, 0.85, 0.7, 0.55],
      yieldByRank: [2, 3, 4, 5],
      reach: 200,
      claimRadius: 1200,
      claimLapseDays: 14,
      startingSeeds: 3,
      startingCrops: ['bcf48:Skyrim.esm', 'bb952:Skyrim.esm', 'bcf47:Skyrim.esm'],
      seedAgainHours: 12,
      compostGrow: 0.75,
      compostExtra: 1
    }
  };

  var TABLE = { ranks: RANKS, classes: CLASSES, schools: SCHOOLS,
                professions: PROFESSIONS, tree: TREE, limits: LIMITS,
                spells: SPELLS, tuning: TUNING, rpOnly: RP_ONLY };

  // ------------------------------------------------------------ the state --
  /*
    What is stored on the actor. Every field optional; a missing one means
    "not yet". Kept flat and JSON-plain because it goes through mp.set.

      cls        'hunter' | ...                 set once
      prof       'smith' | ...                  set once
      half       'platewright' | ...            set once; a mage has none
      schools    ['destruction','restoration']  a mage's chosen schools
      ranks      { platewright: 'advanced', edgewright: 'novice', ... }
                 every half this character has any standing in, own or taught.
                 The sister half is added at novice the moment half is chosen.
      taught     ['hearthcook']                 halves learned from a Master
                 of another profession, novice only, at most LIMITS.secondaries
      untaught   ['hearthcook']                 outside trades a Master ended.
                 Still counted: two in a life, and ending one does not open a
                 third (#1388)
      masters    { platewright: { id, name, at } }  who took this character
                 on, by the half: the sister half past novice, or an outside
                 trade they taught. id is the Master's actor (#1388)
      apprentices [{ id, name, half, kind, at }]  the people this Master took
                 on, a row per person and half; kind is 'sister' or
                 'outside' (#1388)
      spells     { points: 2, known: [...] }    a mage's spell points and spells
      staffSpells ['12fcd:Skyrim.esm', ...]     the staff spells unlocked, by the
                 spell's form id desc: what a staff may bind (#967, #1128)
      staffPoints 2                             an Enchanter's staff spell points,
                 written when they become one; a record without it holds
                 none (#3265).
      tree       { vitality: 3, ... }           points spent per sub-skill
      points     4                              unspent tree points
      work       { miner: 7, charburner: 2 }    yields handed out since the
                 last rank, under the same keys as ranks: a class where the
                 work is a class verb, a half where it is a profession's.
                 Reset to what is left over when a rank is reached.
      placed     { might: 1, burden: 1 }        the part of tree that was
                 placed by the class, profession and half at creation. It is
                 counted inside tree as well; this says how much of tree was
                 never anybody's to move.
  */
  function fresh() {
    return { cls: null, prof: null, half: null, schools: [],
             ranks: {}, taught: [], spells: null, tree: {}, points: 0,
             work: {}, placed: {} };
  }

  function clone(s) { return JSON.parse(JSON.stringify(s || fresh())); }

  function no(why) { return { ok: false, why: why }; }
  function yes(state) { return { ok: true, state: state }; }

  /*
    A LOOKUP THAT TAKES A WORD FROM A PERSON IS NEVER A BARE ONE.

    '/pick class __proto__' and '/pick class constructor' were both accepted,
    because CLASSES['__proto__'] and CLASSES['constructor'] find something on
    Object.prototype and a bare truth test cannot tell that from a class. The
    word was then stored as the class, no other class could be picked ever
    again, and the class gates refused gathering and mining for the life of
    that character with no command anywhere to clear it. '/spend constructor'
    was the same hole one floor down: the cap test passed against a function
    and 'have + 1' wrote a function's source text into the tree, which then
    travelled to the browser through the updateOwner script.

    grantSpell in the character block already did this properly. Every table
    below that is indexed by a word somebody typed goes through here now.
  */
  function own(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  function halvesOf(prof) {
    if (!own(PROFESSIONS, prof)) { return []; }
    var p = PROFESSIONS[prof];
    if (p.halves) { return Object.keys(p.halves); }
    return SCHOOLS.slice();
  }

  function sisterOf(prof, half) {
    var hs = halvesOf(prof);
    if (hs.length !== 2) { return null; }
    return hs[0] === half ? hs[1] : hs[0];
  }

  function rankIndex(r) { return RANKS.indexOf(r); }

  /** Standing in one class, half or school, or null. Never a bare lookup. */
  function rankOf(state, key) {
    var s = state || fresh();
    return (s.ranks && own(s.ranks, key)) ? s.ranks[key] : null;
  }

  /** The sub-skill by key, or null. The only reader of TREE by a loose name. */
  function treeSkill(skill) {
    for (var attr in TREE) {
      if (own(TREE[attr].skills, skill)) { return TREE[attr].skills[skill]; }
    }
    return null;
  }

  /*
    POINTS PLACED BY A PICK. Patrick, 20 September.

    A class, a profession, a half and each of a mage's schools put points
    into named sub-skills the moment they are taken. They go into tree,
    because that is what the tree is, and they are remembered in placed,
    because the panel draws them as placed rather than spent and spendPoint
    refuses to move them. s.points is not touched: a placed point was never
    anybody's to spend, and free points come from ranks and nowhere else.

    The cap is respected on the way in, so two picks that name the same
    sub-skill can never put it over LIMITS.skillCap.
  */
  function place(s, where, key) {
    var table = own(TUNING.placed, where) ? TUNING.placed[where] : null;
    if (!own(table, key)) { return; }
    var pts = table[key];
    if (!s.tree) { s.tree = {}; }
    if (!s.placed) { s.placed = {}; }
    for (var skill in pts) {
      if (!own(pts, skill) || !treeSkill(skill)) { continue; }
      var was = own(s.tree, skill) ? (s.tree[skill] || 0) : 0;
      var add = Math.min(pts[skill], LIMITS.skillCap - was);
      if (add <= 0) { continue; }
      s.tree[skill] = was + add;
      s.placed[skill] = (own(s.placed, skill) ? (s.placed[skill] || 0) : 0) + add;
    }
  }

  /** How much of a sub-skill was placed and cannot be moved. */
  function placedIn(state, skill) {
    var s = state || fresh();
    return (own(s.placed, skill) ? (s.placed[skill] || 0) : 0);
  }

  /*
    Whole numbers that add up to total exactly, n of them, the larger ones
    first. The remainder is handed out one at a time rather than rounded, so
    nothing is lost and nothing is invented: three points of Potency over two
    schools is 8 and 7, not 7 and 7 or 8 and 8. The sign is carried, because
    Efficiency's amount is negative.
  */
  function splitAcross(total, n) {
    var out = [];
    if (!n || n < 1) { return out; }
    var sign = total < 0 ? -1 : 1;
    var mag = Math.abs(total);
    var each = Math.floor(mag / n);
    var over = mag - (each * n);
    for (var i = 0; i < n; i++) { out.push(sign * (each + (i < over ? 1 : 0))); }
    return out;
  }

  /*
    What the tree adds up to, for the client to apply.

    The server cannot set any of this itself: GetBaseActorValues computes the
    base values from the race record, so anything written here is gone the
    next time the client works them out. So the totals are sent and the
    client applies them. Only what is not zero travels.

    POTENCY AND EFFICIENCY REACH THE SCHOOLS SOMEBODY HOLDS, OR THEY REACH
    NOBODY. Those two sub-skills add up under the names perPoint gives them,
    spellPowerMult and spellCostMult, and neither of those has ever been an
    actor value in this game. Measured 20 September against the fork's own
    libespm ActorValue.h: they are not on the list, and thornswood-front.js
    logged 'the game had no number for that' and moved on every single time. So
    the total is turned into the real per-school values here, out of
    TUNING.schoolValues, split across the schools the character actually holds.

    SOMEBODY HOLDING THOSE POINTS WITH NO SCHOOL GETS NOTHING FROM THEM, and
    that is said out loud rather than hidden. A warrior who spends four points
    in Potency has bought nothing, because there is no school for the game to
    put the number on and there is no such thing as spell damage in general.
    That is a real cost of the game's shape and not a defect in this function:
    the alternative is inventing a value the engine does not have, which is what
    was being sent before and is why neither sub-skill did anything. The panel
    on K says the same in its one line about each of them, which is where
    somebody reads it before they spend the point rather than after.

    schoolsOf is the reader, not s.schools, so a non-mage who was taught a
    school by a Master mage gets the benefit in that school. It holds their
    magic and the rulebook lets them have it.
  */
  function treeApplies(state) {
    var s = state || fresh();
    var out = {};
    for (var skill in (s.tree || {})) {
      if (!own(s.tree, skill) || !treeSkill(skill)) { continue; }
      var n = s.tree[skill];
      if (typeof n !== 'number' || !n) { continue; }
      var per = own(TUNING.perPoint, skill) ? TUNING.perPoint[skill] : null;
      for (var what in per) {
        if (!own(per, what)) { continue; }
        out[what] = (own(out, what) ? out[what] : 0) + per[what] * n;
      }
    }

    // What a filled perk adds (#1385), out of TUNING.perkApplies.
    var filled = perks(s);
    for (var f = 0; f < filled.length; f++) {
      var pa = own(TUNING.perkApplies, filled[f]) ? TUNING.perkApplies[filled[f]] : null;
      if (!pa) { continue; }
      for (var ak in (pa.add || {})) {
        if (own(pa.add, ak)) { out[ak] = (own(out, ak) ? out[ak] : 0) + pa.add[ak]; }
      }
      for (var uk in (pa.upTo || {})) {
        if (own(pa.upTo, uk) && !(out[uk] >= pa.upTo[uk])) { out[uk] = pa.upTo[uk]; }
      }
    }

    var held = schoolsOf(s);
    for (var name in TUNING.spreadOverSchools) {
      if (!own(TUNING.spreadOverSchools, name) || !own(out, name)) { continue; }
      var total = out[name];
      // The name the game has never had leaves either way, whether it was
      // spread over schools or dropped for want of one.
      delete out[name];
      if (!total || !held.length) { continue; }
      var how = TUNING.spreadOverSchools[name];
      var which = how.half;
      // The sign the table carries, applied before the split rather than after
      // it, so the remainder is handed out in the direction it will land in.
      // Efficiency's -3 a point means the price falls and the value it lands on
      // means the skill rises, which is the same thing said the other way up.
      // See spreadOverSchools for the 31 records that were read to settle it.
      var parts = splitAcross(total * how.sign, held.length);
      for (var i = 0; i < held.length; i++) {
        var pair = own(TUNING.schoolValues, held[i]) ? TUNING.schoolValues[held[i]] : null;
        if (!pair || !own(pair, which)) { continue; }
        var av = pair[which];
        out[av] = (own(out, av) ? out[av] : 0) + parts[i];
      }
    }

    for (var k in out) { if (own(out, k) && !out[k]) { delete out[k]; } }
    return out;
  }

  // ------------------------------------------------------------ the rules --

  /**
    One class, from the five, and it is never changed.

    The class gets standing at novice the moment it is taken, under its own
    key in ranks, because the class verb is work like any other and rank comes
    from doing the work. That is what lets creditWork below climb it through
    rankUp rather than around it. Nothing in the rulebook gives a class a
    Master perk and perks() does not look here, so a Master Miner is a Master
    Miner and nothing else.
  */
  function pickClass(state, cls) {
    var s = clone(state);
    if (!own(CLASSES, cls)) { return no('no such class'); }
    if (s.cls) { return no('you already have a class, and nobody has two'); }
    s.cls = cls;
    s.ranks[cls] = 'novice';
    place(s, 'classes', cls);
    return yes(s);
  }

  /**
    One profession and one half of it, in one step, because the half is not
    a flavour. A mage picks schools instead of a half, exactly two of them.
    The sister half arrives at novice for nothing; the chosen half starts at
    novice too, because everybody does.
  */
  function pickProfession(state, prof, halfOrSchools) {
    var s = clone(state);
    if (!own(PROFESSIONS, prof)) { return no('no such profession'); }
    var p = PROFESSIONS[prof];
    if (s.prof) { return no('you already have a profession, and nobody has two'); }

    if (prof === 'mage') {
      var sch = Array.isArray(halfOrSchools) ? halfOrSchools.slice() : [];
      if (sch.length !== p.schools) { return no('a mage picks ' + p.schools + ' schools'); }
      for (var i = 0; i < sch.length; i++) {
        if (SCHOOLS.indexOf(sch[i]) === -1) { return no('no such school: ' + sch[i]); }
        if (sch.indexOf(sch[i]) !== i) { return no('the same school twice'); }
      }
      s.prof = 'mage';
      s.half = null;
      s.schools = sch;
      for (var j = 0; j < sch.length; j++) { s.ranks[sch[j]] = 'novice'; }
      s.spells = { points: LIMITS.mageStartSpells, known: [] };
      place(s, 'professions', 'mage');
      for (var k = 0; k < sch.length; k++) { place(s, 'schools', sch[k]); }
      return yes(s);
    }

    var half = String(halfOrSchools || '');
    if (!own(p.halves, half)) { return no('no such half of ' + p.name); }
    s.prof = prof;
    s.half = half;
    s.ranks[half] = 'novice';
    var sister = sisterOf(prof, half);
    if (sister) { s.ranks[sister] = 'novice'; }
    // An Enchanter starts with staff spell points the way a mage starts with
    // spell points (#1128).
    if (prof === 'enchanter') { s.staffPoints = LIMITS.enchanterStartStaff; }
    place(s, 'professions', prof);
    place(s, 'halves', half);
    return yes(s);
  }

  /**
    A Master of a half teaches somebody from ANOTHER profession that half, at
    novice, and never further: an outside trade (apprenticeship.md). At most
    LIMITS.secondaries in a life. An outside trade a Master ended stays
    counted in untaught, so ending one never opens a third. The sister half
    does not count and cannot be taught this way, because it is already
    known; going past novice in it is takeOn below, and then rankUp.

    The reasons are written to the Master, because the Master is the one who
    asked: they are what /apprentice says back (#1388). who, when it is
    given, is the Master as the server records them, { id, name, at }, so the
    Master who taught it is the one who can end it.
  */
  function teach(state, teacherState, half, who) {
    var s = clone(state);
    if (!s.taught) { s.taught = []; }
    if (!s.prof) { return no('they have not picked a profession of their own yet, so there is nothing to teach onto'); }
    var tp = teacherState && teacherState.prof;
    if (!tp || halvesOf(tp).indexOf(half) === -1) { return no('you do not work that half'); }
    if (rankOf(teacherState, half) !== 'master') { return no('only a Master can teach, and you are not one in that half'); }
    if (halvesOf(s.prof).indexOf(half) !== -1) {
      return no('that is in their own profession, so it is not an outside trade: a Master of their own profession cannot use the outside trade rules on them');
    }
    if (s.taught.indexOf(half) !== -1) { return no('they already know that'); }
    if (s.taught.length + (s.untaught || []).length >= LIMITS.secondaries) {
      return no('they have had their ' + LIMITS.secondaries + ' outside trades, and that is all there is in a life');
    }
    s.taught.push(half);
    s.ranks[half] = 'novice';
    if (who) {
      if (!s.masters) { s.masters = {}; }
      s.masters[half] = who;
    }
    return yes(s);
  }

  /**
    A Master takes somebody on in their sister half (apprenticeship.md, "The
    sister half"). It costs nothing and it is not one of the two outside
    trades. Until it is recorded, work in that half counts and waits at the
    next threshold; while it stands, creditWork is handed the Master and the
    half climbs the whole ladder through rankUp. who is the Master as the
    server records them, { id, name, at }. The reasons are written to the
    Master, as teach's are.
  */
  function takeOn(state, masterState, half, who) {
    var s = clone(state);
    if (!s.prof) { return no('they have not picked a profession of their own yet'); }
    if (s.half === half || (s.schools || []).indexOf(half) !== -1) {
      return no('that is their own ' + (s.half === half ? 'half' : 'school') + ', and it climbs on their own work');
    }
    var sister = s.half ? sisterOf(s.prof, s.half) : null;
    if (!sister || sister !== half) { return no('that is not their sister half'); }
    if (rankOf(masterState, half) !== 'master') {
      return no('only a Master of that half can take somebody on in it, and you are not one');
    }
    if (rankOf(s, half) === 'master') { return no('they are a Master of it already'); }
    if (s.masters && own(s.masters, half)) { return no('they already have a Master in that'); }
    if (!s.masters) { s.masters = {}; }
    s.masters[half] = who || {};
    return yes(s);
  }

  /**
    The Master ends it (apprenticeship.md). The sister half keeps every rank
    already earned; further ranks stop and the count waits at the next
    threshold again, because creditWork is no longer handed a Master. An
    outside trade loses its novice list, and stays counted in untaught, so
    ending one does not open a third. masterId is whoever is ending it: only
    the Master on the record can. The answer carries ended, 'sister' or
    'outside', so the caller can say which.
  */
  function release(state, half, masterId) {
    var s = clone(state);
    var rec = (s.masters && own(s.masters, half)) ? s.masters[half] : null;
    if (!rec || (masterId !== undefined && masterId !== null && rec.id !== masterId)) {
      return no('they are not your apprentice in that');
    }
    delete s.masters[half];
    var out;
    var at = (s.taught || []).indexOf(half);
    if (at !== -1) {
      s.taught.splice(at, 1);
      if (own(s.ranks, half)) { delete s.ranks[half]; }
      if (s.work && own(s.work, half)) { delete s.work[half]; }
      if (!s.untaught) { s.untaught = []; }
      s.untaught.push(half);
      out = yes(s);
      out.ended = 'outside';
      return out;
    }
    out = yes(s);
    out.ended = 'sister';
    return out;
  }

  /**
    Rank goes up one step in a half. Only ever one step, only in a half the
    character has standing in. Three ceilings: a taught half never leaves
    novice; the sister half needs a Master of it to go past novice; and a
    mage's third school and extra points arrive with Master.

    Who is allowed to CALL this is the server's business, when the work has
    been done. This only says whether the step itself is legal.
  */
  function rankUp(state, half, masterState) {
    var s = clone(state);
    var cur = rankOf(s, half);
    if (!cur) { return no('no standing in that'); }
    if (cur === 'master') { return no('already a Master'); }
    if (s.taught.indexOf(half) !== -1) { return no('a trade learned from another profession never goes past novice'); }

    var mine = s.half === half || s.schools.indexOf(half) !== -1;
    var sister = s.prof && sisterOf(s.prof, s.half) === half;
    if (sister && !mine) {
      var ok = rankOf(masterState, half) === 'master';
      if (!ok) { return no('past novice in your sister half needs a Master of it to take you on'); }
    }

    var next = RANKS[rankIndex(cur) + 1];
    // What the Enchanter holds before the rank moves.
    var staffWas = (s.prof === 'enchanter' && half === STAFF_HALF) ? staffPoints(s) : null;
    s.ranks[half] = next;

    /*
      Every rank gives a skill tree point, wherever the rank came from: work
      done alone, or hours under a Master. The rulebook does not say how many
      (see TUNING), only that the tree is spent into, and nothing else in the
      game hands one out. One path in and one path out: everything that raises
      a rank comes through here, so nothing can raise one quietly.
    */
    s.points = (s.points || 0) + TUNING.treePointsPerRank;

    if (s.prof === 'mage' && mine && next === 'master') {
      s.spells.points += LIMITS.mageMasterSpells;
    } else if (s.prof === 'mage' && mine) {
      s.spells.points += 1;   // one more spell point with every rank
    }
    // The same for an Enchanter's staff spells (#1128): one more staff spell
    // point with every Bladebinder rank, and two at Master.
    if (staffWas !== null) {
      s.staffPoints = staffWas + (next === 'master' ? LIMITS.enchanterMasterStaff : 1);
    }
    return yes(s);
  }

  /** The class that owns a verb, or null when the verb is not a class's. */
  var VERBS = { loot: 'hunter', fish: 'fisher', harvest: 'gatherer', mine: 'miner', farm: 'farmer' };
  function classFor(verb) {
    return own(VERBS, verb) ? VERBS[verb] : null;
  }

  /** Yields still to hand out before the next rank, 0 for a Master. */
  function workNeeded(state, key) {
    var cur = rankOf(state, key);
    if (!cur) { return 0; }
    var next = RANKS[rankIndex(cur) + 1];
    if (!next) { return 0; }
    return own(TUNING.workPerRank, next) ? (TUNING.workPerRank[next] || 0) : 0;
  }

  /** Yields handed out since the last rank in that key. */
  function workDone(state, key) {
    var s = state || fresh();
    return (s.work && own(s.work, key) && s.work[key]) || 0;
  }

  /** The rank that key is climbing to, or null when it is not climbing. */
  function nextRank(state, key) {
    var s = state || fresh();
    var cur = rankOf(s, key);
    if (!cur) { return null; }
    if ((s.taught || []).indexOf(key) !== -1) { return null; }
    var next = RANKS[rankIndex(cur) + 1];
    return next || null;
  }

  /*
    The schools a mage's hours feed. Only a mage's own schools: a school
    taught to somebody outside the profession never leaves novice, so
    counting work against it would draw a ladder nobody can climb.
  */
  function schoolsFed(s) {
    if (!s || s.prof !== 'mage') { return []; }
    return (s.schools || []).slice();
  }

  /*
    n pieces of work under one key, on a state that is already ours to
    change. The one place a count is added and the one place a rank is
    raised from work. Returns the raise, or null.

    Nothing here writes s.ranks: the raise goes through rankUp, so a taught
    trade stays at novice, a sister half waits for its Master and a Master is
    done climbing, whichever door the work came in through.
  */
  function addWork(s, k, n, masterState) {
    if (!s.work) { s.work = {}; }
    s.work[k] = workDone(s, k) + n;

    var need = workNeeded(s, k);
    if (!need || s.work[k] < need) { return null; }

    var was = rankOf(s, k);
    var pointsWas = s.points || 0;
    var spellsWas = (s.spells && s.spells.points) || 0;
    var staffWas = staffPoints(s);
    var up = rankUp(s, k, masterState);
    if (!up.ok) {
      // Held at the ceiling. The count waits there rather than climbing
      // forever, so nothing is lost and nothing is banked.
      s.work[k] = need;
      return null;
    }
    up.state.work[k] = s.work[k] - need;
    // rankUp worked on a copy, so the answer is copied back onto the state
    // the caller is holding. One state in, one state out.
    for (var f in up.state) { if (own(up.state, f)) { s[f] = up.state[f]; } }
    return { key: k, from: was, to: rankOf(s, k),
             points: (s.points || 0) - pointsWas,
             spellPoints: ((s.spells && s.spells.points) || 0) - spellsWas,
             staffPoints: s.prof === 'enchanter' ? staffPoints(s) - staffWas : 0 };
  }

  /*
    A RANK GAINED ANYWHERE IS HOURS A MAGE CAN COUNT.

    The server sees no casting (see TUNING.study), so a mage's schools have
    to climb on something else it does see. A rank gained in anything else
    they hold, the class at the quarry or the other school, feeds every
    school they hold. One step only: what a raise feeds out never feeds
    again, so a chain of raises cannot run away from the thresholds.
  */
  function feedSchools(s, fromKey, out) {
    var fed = schoolsFed(s);
    for (var i = 0; i < fed.length; i++) {
      if (fed[i] === fromKey) { continue; }
      var also = addWork(s, fed[i], TUNING.study.perRank, null);
      if (also) { out.push(also); }
    }
  }

  /**
    Work done, counted, and the rank raised when the count is there.

    'Rank comes from doing the work. Nothing else moves it.' This is the only
    place in the server that counts the work, and it raises the rank by
    calling rankUp, never by writing s.ranks itself, so every ceiling rankUp
    holds is still held: a taught trade stays at novice, a sister half waits
    for a Master, a Master is done climbing. When rankUp says no, the count
    sits at the threshold rather than running away, so the moment the Master
    turns up the next piece of work is the one that lands.

    key is a class ('miner'), a half ('charburner') or a school, and it is
    also allowed to be the class verb ('mine'), which is resolved to its
    class here so a caller at a salt seam does not have to know the word.

    n is how many pieces of work this is, one when it is not given. A manual
    read is worth several at once and is still one write.

    Returns { ok, state, raised, also }: raised is null or what the rank
    gave, and also is the ranks a mage's schools took from that one.
  */
  function creditWork(state, key, masterState, n) {
    var k = classFor(key) || key;
    var s = clone(state);
    var pieces = (typeof n === 'number' && n > 0) ? Math.floor(n) : 1;
    /*
      A class taken before a class had standing.

      pickClass writes ranks[cls] now, and every character who chose one
      before it did has the class and no rank under it. They would work a
      seam forever and never be counted, silently, which is the worst shape
      a bug like this takes. Their standing starts here, at novice, the same
      place everybody else's did.
    */
    if (!rankOf(s, k) && s.cls === k) { s.ranks[k] = 'novice'; }
    if (!rankOf(s, k)) { return no('no standing in that'); }

    var out = { ok: true, state: s, raised: null, also: [] };
    out.raised = addWork(s, k, pieces, masterState);
    if (out.raised) { feedSchools(s, k, out.also); }
    return out;
  }

  /** A mage at Master picks the third school. Once. */
  function pickThirdSchool(state, school) {
    var s = clone(state);
    if (s.prof !== 'mage') { return no('not a mage'); }
    if (SCHOOLS.indexOf(school) === -1) { return no('no such school'); }
    if (s.schools.indexOf(school) !== -1) { return no('already one of yours'); }
    if (s.schools.length >= PROFESSIONS.mage.mastered) { return no('a mage holds ' + PROFESSIONS.mage.mastered + ' schools at most'); }
    var isMaster = false;
    for (var i = 0; i < s.schools.length; i++) { if (rankOf(s, s.schools[i]) === 'master') { isMaster = true; } }
    if (!isMaster) { return no('the third school comes with Master'); }
    s.schools.push(school);
    s.ranks[school] = 'novice';
    place(s, 'schools', school);
    return yes(s);
  }

  /*
    One point into one sub-skill. The perk is derived, not stored.

    ONE POINT IN, AND NOTHING EVER OUT. amount is read because the panel and
    the chat line both hand their words straight through, and '/spend might
    -1' used to spend a point INTO Might, the opposite of what was asked.
    Anything but one point in is refused, which is also what stops a placed
    point being moved: placed points are in tree, they count against the cap
    like any other, and there is no door here that takes one back out.
  */
  function spendPoint(state, skill, amount) {
    var s = clone(state);
    var found = treeSkill(skill);
    if (!found) { return no('no such sub-skill'); }
    if (amount !== undefined && amount !== null && Number(amount) !== 1) {
      return no('a point goes in one at a time, and a point already placed cannot be moved');
    }
    if (s.points <= 0) { return no('no points to spend'); }
    var have = own(s.tree, skill) ? (s.tree[skill] || 0) : 0;
    if (have >= LIMITS.skillCap) { return no('that one is full'); }
    s.tree[skill] = have + 1;
    s.points -= 1;
    return yes(s);
  }

  // ------------------------------------------------------------- the book --

  /** The spell by name, case and spacing as the person typed it, or null. */
  function spellAt(name) {
    var want = String(name || '').trim().toLowerCase();
    if (!want) { return null; }
    for (var school in SPELLS) {
      if (!own(SPELLS, school)) { continue; }
      for (var rank in SPELLS[school]) {
        if (!own(SPELLS[school], rank)) { continue; }
        var names = SPELLS[school][rank];
        for (var i = 0; i < names.length; i++) {
          if (names[i].toLowerCase() === want) {
            return { name: names[i], school: school, rank: rank };
          }
        }
      }
    }
    return null;
  }

  /**
    Does the book they already hold have anything of that rank in that school.
    Only the book's own spells count: a spell SPELLS does not list is never
    granted (#1387), and bookClean takes out any a tome taught before that.
  */
  function knowsRank(state, school, rank) {
    var s = state || fresh();
    var known = (s.spells && s.spells.known) || [];
    var book = own(SPELLS, school) ? SPELLS[school] : {};
    var names = (own(book, rank) && book[rank]) || [];
    for (var i = 0; i < known.length; i++) {
      for (var j = 0; j < names.length; j++) {
        if (known[i] === names[j]) { return true; }
      }
    }
    return false;
  }

  /** The schools this character may take a spell from: their own, or taught. */
  function schoolsOf(state) {
    var s = state || fresh();
    if (s.prof === 'mage') { return (s.schools || []).slice(); }
    var out = [];
    var taught = s.taught || [];
    for (var i = 0; i < taught.length; i++) {
      if (SCHOOLS.indexOf(taught[i]) !== -1) { out.push(taught[i]); }
    }
    return out;
  }

  /**
    Spell points to spend right now.

    A mage's are stored and earned: two at the start, one with every rank,
    two more at Master, and LIMITS.collegeSemester with every semester at
    the College (study).

    Somebody a Master mage taught earns theirs the one way the rulebook
    gives them, LIMITS.outsiderSemester with every semester at the College,
    and holds LIMITS.outsiderSpells spells at most: 'a cap on how many
    spells anyone can learn that way'. So what they can spend is the smaller
    of the points they hold and the places left under the cap, and the cap
    cannot be got round by holding points. Until #1387 applied the semester
    nothing gave them a point, and the places alone were what they spent.
    Patrick decided on 4 October that they need both (#1387, "Patrick's
    answers"): that is the Math.min below, and placesLeft(s) on its own
    would be the answer he did not choose.
  */
  function placesLeft(s) {
    var known = (s.spells && s.spells.known) || [];
    return Math.max(0, LIMITS.outsiderSpells - known.length);
  }

  function spellPoints(state) {
    var s = state || fresh();
    if (s.prof === 'mage') { return (s.spells && s.spells.points) || 0; }
    if (!schoolsOf(s).length) { return 0; }
    return Math.min(Number(s.spells && s.spells.points) || 0, placesLeft(s));
  }

  /**
    One spell into the book, and the point it costs.

    Five things have to be true, and the refusal says which one is not:
    magic is theirs at all, the school is one of theirs, they have a point,
    their rank in that school has reached the spell's rank, and they already
    hold something of the rank below it. Novice has nothing below it, which
    is where everybody starts.

    This records the spell. Putting it on the character in the game is the
    server's next step and not a rule; a spell with no form id yet is known
    here and simply not cast until it has one.
  */
  /*
    The master spell tomes. A mage who picks a master spell off the book has
    to be holding that spell's tome. The form ids are the books, not the spells.
  */
  var MASTER_TOMES = {
    'Fire Storm': 'a270c:Skyrim.esm',
    'Blizzard': 'a270d:Skyrim.esm',
    'Lightning Storm': 'a270e:Skyrim.esm',
    'Guardian Circle': 'fde7b:Skyrim.esm',
    'Bane of the Undead': 'dd647:Skyrim.esm',
    'Dragonhide': 'd2b4e:Skyrim.esm',
    'Mass Paralysis': 'dd646:Skyrim.esm',
    'Dead Thrall': 'a26f9:Skyrim.esm',
    'Flame Thrall': 'a26fa:Skyrim.esm',
    'Frost Thrall': 'a26fb:Skyrim.esm',
    'Storm Thrall': 'a26fc:Skyrim.esm',
    'Harmony': 'a271a:Skyrim.esm',
    'Hysteria': 'a271c:Skyrim.esm',
    'Mayhem': 'a2719:Skyrim.esm'
  };

  function masterTomeDesc(name) {
    var want = String(name || '').toLowerCase();
    for (var key in MASTER_TOMES) {
      if (Object.prototype.hasOwnProperty.call(MASTER_TOMES, key) && key.toLowerCase() === want) {
        return MASTER_TOMES[key];
      }
    }
    return '';
  }

  function pickSpell(state, name, holdsTome) {
    var s = clone(state);
    var spell = spellAt(name);
    if (!spell) { return no('no such spell'); }

    var mine = schoolsOf(s);
    if (!mine.length) {
      return no(s.prof === 'mage'
        ? 'pick your schools first'
        : 'magic is not yours yet: a Master mage has to take you on first');
    }
    /*
      Somebody a Master mage taught learns a spell only from its tome (#1149):
      "needs the spellbook AND a Master Mage willing to apprentice them" (the
      rulebook, #391), "learned from the tome" (magic.md, apprenticeship.md).
      The K panel draws the book for a mage only, but this is the line it
      sends, and typed by hand it took the spell with no tome at all. The
      tome is read through learnFromTome, which asks the same gates and a
      place under the cap.
    */
    if (s.prof !== 'mage') {
      return no('read the tome of ' + spell.name + ' to learn it, because somebody a Master mage taught ' +
                'learns spells from their tomes and only a Mage picks them on K');
    }
    if (mine.indexOf(spell.school) === -1) {
      return no(spell.school + ' is not one of your schools');
    }
    if (knowsSpell(s, spell.name)) { return no('you already know that one'); }
    if (spellPoints(s) <= 0) { return no('no spell point to spend'); }

    var have = rankOf(s, spell.school);
    if (!have || rankIndex(have) < rankIndex(spell.rank)) {
      return no(spell.rank + ' ' + spell.school + ' is above your rank in it');
    }
    var below = RANKS[rankIndex(spell.rank) - 1];
    if (below && !knowsRank(s, spell.school, below)) {
      return no('you need a ' + below + ' spell of ' + spell.school + ' first');
    }
    /*
      A master spell is not chosen off the book alone. The tome has to be in
      the pack, the rank has to be master, and a spell point has to be there.
      Reading the tome is the other door, and that book is already in hand.
    */
    if (spell.rank === 'master' && !holdsTome) {
      return no('a master spell needs its tome in the pack, master rank in that school, and a spell point');
    }
    return addToBook(s, spell);
  }

  /**
    The spell into a state the caller has already cloned and checked, and the
    point it costs: pickSpell and learnFromTome both end here, so a tome costs
    exactly what the panel does and counts as the same hours in its school.
  */
  function addToBook(s, spell) {
    if (!s.spells) { s.spells = { points: 0, known: [] }; }
    if (!s.spells.known) { s.spells.known = []; }
    // A stored point is spent, a mage's or a semester's (#1387), and the
    // push below takes one of the places under the cap of somebody a Master
    // mage taught. A taught school never leaves Novice and is their only
    // school, so a semester's point only ever buys a Novice spell of it.
    if ((Number(s.spells.points) || 0) > 0) { s.spells.points -= 1; }
    s.spells.known.push(spell.name);

    /*
      A SPELL LEARNED IS HOURS IN ITS SCHOOL, and it is half of what keeps a
      mage's ladder alive (see TUNING.study). It is counted through addWork
      like every other hour, so if it is the piece that reaches a threshold
      the rank goes up through rankUp and not around it. A school taught to
      somebody outside the profession is not counted: it never leaves novice,
      so a count against it would only draw a ladder nobody can climb.
    */
    var out = yes(s);
    out.raised = null;
    out.also = [];
    if ((s.taught || []).indexOf(spell.school) === -1 && rankOf(s, spell.school)) {
      out.raised = addWork(s, spell.school, TUNING.study.perSpell, null);
      if (out.raised) { feedSchools(s, spell.school, out.also); }
    }
    return out;
  }

  /** Is that spell already in their book. */
  function knowsSpell(state, name) {
    var s = state || fresh();
    var known = (s.spells && s.spells.known) || [];
    return known.indexOf(name) !== -1;
  }

  /*
    A SPELL TOME TEACHES UNDER THE SAME RULES AS THE PANEL. Patrick, 29
    September, on issue #1026: "No they still need the spell points, the
    level, and a spell from the level below."

    Until then the engine taught any tome's spell to anybody who read it
    (ReadBookEvent in the fork) and none of pickSpell's rules were asked, so a
    Smith could read Fireball and cast it. Now mp.onReadBook asks
    learnFromTome, and the tome teaches only when all three hold:
      points  a spell point to spend (spellPoints: a mage's stored points, or
              what is left under the cap for somebody a Master mage taught)
      level   their rank in the spell's school has reached the spell's rank
      below   they already know a spell of that school one rank down; Novice
              has nothing below it
    Otherwise nothing is learned, the tome is kept, and every one of the
    three that is missing is said. That is everybody, Enchanters included:
    a staff spell is learned from its tome only through these same rules.

    A tome's spell is the book's own entry when SPELL_IDS has its form id, so
    the rulebook decides a spell it lists. A spell it does not list (the magic
    mods' own) is refused, whatever school and rank the tomes block read out
    of the game's records: only the book is granted (magic.md, #1387). Until
    that rule such a spell was written into the book with its school and rank
    in spells.tomes; bookClean takes those back out.
  */

  /** Skyrim's minimum skill level to a rank: Apprentice and Adept are both Advanced, as SPELLS sorts them. */
  function rankForLevel(level) {
    var n = Number(level);
    if (!isFinite(n) || n < 0) { return null; }
    if (n >= 100) { return 'master'; }
    if (n >= 75) { return 'expert'; }
    if (n >= 25) { return 'advanced'; }
    return 'novice';
  }

  /** The book's entry for a spell by its form id desc ('1c789:Skyrim.esm'), or null. */
  function spellByDesc(desc) {
    var want = String(desc || '').toLowerCase();
    if (!want) { return null; }
    for (var name in SPELL_IDS) {
      if (own(SPELL_IDS, name) && String(SPELL_IDS[name]).toLowerCase() === want) {
        return spellAt(name);
      }
    }
    return null;
  }

  function word(key) { return String(key).charAt(0).toUpperCase() + String(key).slice(1); }

  /**
    Which of the three this character is missing for this spell, as
    { what: 'points' | 'level' | 'below', why: '<what is needed, and what they have>' }.
    Empty when nothing is missing. spell is { name, school, rank }.
  */
  function tomeMissing(state, spell) {
    var s = state || fresh();
    var out = [];
    var school = word(spell.school);
    if (spellPoints(s) <= 0) {
      var because = s.prof === 'mage'
        ? 'a mage earns one with every rank, and ' + LIMITS.collegeSemester + ' with a semester at the College'
        : (!schoolsOf(s).length
          ? 'magic is not yours until a Master mage takes you on'
          : (placesLeft(s) <= 0
            ? 'anybody who is not a Mage holds ' + LIMITS.outsiderSpells + ' spells at most'
            : 'anybody who is not a Mage earns one with a semester at the College'));
      out.push({ what: 'points', why: 'a spell point to spend, and you have none (' + because + ')' });
    }
    var have = rankOf(s, spell.school);
    if (!have || rankIndex(have) < rankIndex(spell.rank)) {
      out.push({ what: 'level', why: word(spell.rank) + ' rank in ' + school + ', and you ' +
                 (have ? 'are ' + word(have) + ' in it' : 'have no rank in it') });
    }
    var below = RANKS[rankIndex(spell.rank) - 1];
    if (below && !knowsRank(s, spell.school, below)) {
      out.push({ what: 'below', why: (/^[aeiou]/.test(below) ? 'an ' : 'a ') + word(below) + ' ' + school +
                 ' spell you already know, and you know none' });
    }
    return out;
  }

  /**
    Reading a tome of spell ({ name, school, rank }). Answers what pickSpell
    answers on a yes, or { ok: false, why, missing } with every one of the
    three that stands in the way. A spell already in the book is a no with
    why 'you already know that one' and nothing missing.
  */
  function learnFromTome(state, spell) {
    if (!spell || !spell.name || SCHOOLS.indexOf(spell.school) === -1 || rankIndex(spell.rank) < 0) {
      return no('that tome\'s spell has no school and rank the rules can read');
    }
    var s = clone(state);
    if (knowsSpell(s, spell.name)) { return no('you already know that one'); }
    var listed = spellAt(spell.name);
    if (!listed || listed.school !== spell.school || listed.rank !== spell.rank) {
      var off = no(OFF_BOOK);
      off.offBook = true;
      return off;
    }
    var missing = tomeMissing(s, spell);
    if (missing.length) {
      var r = no('missing ' + missing.map(function (m) { return m.what; }).join(', '));
      r.missing = missing;
      return r;
    }
    return addToBook(s, spell);
  }

  var OFF_BOOK = 'it is not in the College\'s book, and only the book\'s spells are granted here';

  /*
    ONLY THE BOOK IS GRANTED (#1387). A spell a tome taught before that rule
    (#1026 wrote a magic mod's spell into the book, its school and rank in
    spells.tomes) comes back out: the name leaves known and tomes, and a mage
    has the spell point it cost back. Somebody a Master mage taught has the
    place back, because the cap counts the names. The college block takes the
    spell itself off the character.
  */
  function bookClean(state) {
    var s = clone(state);
    var known = (s.spells && s.spells.known) || [];
    var keep = [], gone = [];
    for (var i = 0; i < known.length; i++) {
      if (spellAt(known[i])) { keep.push(known[i]); } else { gone.push(known[i]); }
    }
    var out = yes(s);
    out.removed = gone;
    if (!gone.length) { return out; }
    s.spells.known = keep;
    if (s.spells.tomes) {
      for (var j = 0; j < gone.length; j++) { delete s.spells.tomes[gone[j]]; }
      if (!Object.keys(s.spells.tomes).length) { delete s.spells.tomes; }
    }
    if (s.prof === 'mage') { s.spells.points = (Number(s.spells.points) || 0) + gone.length; }
    return out;
  }

  /*
    A SEMESTER AT THE COLLEGE (#1387). docs/systems/magic.md, "A semester".

    A semester is LIMITS.semesterHours of real time. Studying in the College
    hands a mage LIMITS.collegeSemester spell points, and somebody a Master
    mage took on (teach, /apprentice) LIMITS.outsiderSemester, which only
    buys a Novice spell of the school they were taught because that is the
    only school they have and it never leaves Novice. Nobody else is handed
    anything. It does not fire again until LIMITS.semesterHours have passed
    since the last one that did; studied is that moment, stored on the
    character, so logging out and a restart do not reset it. Where somebody
    stands is the college block's to say, not a rule: this is handed the
    time and answers from the state alone.

    Nothing here is typed. The College page on K sends it (Patrick, 4 Oct:
    no commands for things people do).
  */
  function semesterOpens(state) {
    var last = Number(state && state.studied) || 0;
    return last ? last + LIMITS.semesterHours * 3600000 : 0;
  }

  function hoursAndMinutes(ms) {
    var m = Math.max(1, Math.ceil((Number(ms) || 0) / 60000));
    var h = Math.floor(m / 60);
    m = m % 60;
    var parts = [];
    if (h) { parts.push(h + (h === 1 ? ' hour' : ' hours')); }
    if (m) { parts.push(m + (m === 1 ? ' minute' : ' minutes')); }
    return parts.join(' and ');
  }

  function study(state, now) {
    var s = clone(state);
    var t = Number(now) || 0;
    var mage = s.prof === 'mage';
    if (mage && !(s.schools || []).length) { return no('pick your schools first'); }
    if (!mage && !schoolsOf(s).length) {
      return no('the College hands spell points to a mage, or to somebody a Master mage has taken on, and magic is not yours yet');
    }
    var opens = semesterOpens(s);
    if (opens && t < opens) {
      var r = no('a semester is ' + LIMITS.semesterHours + ' hours, and your next one opens in ' +
                 hoursAndMinutes(Math.min(LIMITS.semesterHours * 3600000, opens - t)));
      r.wait = opens - t;
      return r;
    }
    if (!s.spells) { s.spells = { points: 0, known: [] }; }
    var gain = mage ? LIMITS.collegeSemester : LIMITS.outsiderSemester;
    s.spells.points = (Number(s.spells.points) || 0) + gain;
    s.studied = t;
    var out = yes(s);
    out.gained = gain;
    out.school = mage ? null : schoolsOf(s)[0];
    return out;
  }

  /*
    STAFF SPELLS, AN ENCHANTER'S OWN SPELL BOOK. Patrick, 29 September, on
    issue #1128: "Enchanters also get their own spell point and spell
    unlocking system like the Mages have, so they can actually learn staff
    spells: like Mages, they do not need the tomes; their Enchanter rank
    decides which ranks they can unlock", and "just like mages enchanters
    can't unlock a spell even if they are the correct rank and have the spell
    points, they must also have at least one spell of the level below".

    So it is the Mage's system, point for point, with the Bladebinder half in
    place of a school:
      points  staff spell points. An Enchanter starts with two
              (LIMITS.enchanterStartStaff), earns one with every Bladebinder
              rank and two at Master (rankUp), and spends one per spell, on
              K, with no tome (pickStaffSpell).
      level   the Enchanter's Bladebinder rank has reached the spell's rank.
      below   they have already unlocked a staff spell one rank down; Novice
              has nothing below it.
    What a staff binds is recorded in staffSpells, by the spell's form id
    desc, and the staff gate asks that list and nothing else.

    AND FOR EVERYBODY ELSE, THE NON-MAGE RULES. "A non-Enchanter taught by a
    Master Enchanter follows the same rules a non-Mage has for magic: needs
    the tome and an earned spell point, and can only learn Novice." A Master
    Bladebinder teaching them (teach, once, and it counts as one of their two
    other trades) is what gives them standing in the half, at Novice for good.
    They learn a staff spell only from its tome (learnStaffFromTome), and
    what they hold is places under the same cap a non-mage has for spells,
    LIMITS.outsiderSpells, never more.

    The staff table (STAFF_SPELLS) lives in the staff spells block further
    down, so these rules are handed the spell as { desc, name, rank } and a
    rankOfStaff(desc) that answers the rank of any staff spell, the way
    learnFromTome is handed its spell by the tomes block.
  */

  /** Is this character an Enchanter, whose staff spells are unlocked on K. */
  function isEnchanter(state) { return !!state && state.prof === 'enchanter'; }

  /** Taught the Bladebinder half by a Master Enchanter, and not an Enchanter. */
  function staffTaught(state) {
    var s = state || fresh();
    return !isEnchanter(s) && (s.taught || []).indexOf(STAFF_HALF) !== -1 && !!rankOf(s, STAFF_HALF);
  }

  /** The staff spells unlocked, as a fresh array of descs. */
  function staffKnown(state) {
    var list = state && state.staffSpells;
    return Array.isArray(list) ? list.slice() : [];
  }

  function knowsStaff(state, desc) { return staffKnown(state).indexOf(desc) !== -1; }

  /**
    Staff spell points to spend right now. An Enchanter's are stored, like a
    mage's, from the day they become one; a record with none stored holds
    none, and is not read as what the rank has given (#3265). Somebody a
    Master Enchanter taught has the places left under the non-mage cap.
    Anybody else has none.
  */
  function staffPoints(state) {
    var s = state || fresh();
    if (isEnchanter(s)) {
      return typeof s.staffPoints === 'number' ? s.staffPoints : 0;
    }
    if (!staffTaught(s)) { return 0; }
    return Math.max(0, LIMITS.outsiderSpells - staffKnown(s).length);
  }

  /** Has this character unlocked any staff spell of that rank. */
  function knowsStaffRank(state, rank, rankOfStaff) {
    var known = staffKnown(state);
    for (var i = 0; i < known.length; i++) {
      if (typeof rankOfStaff === 'function' && rankOfStaff(known[i]) === rank) { return true; }
    }
    return false;
  }

  /**
    Which of the three this character is missing for this staff spell, as
    { what: 'points' | 'level' | 'below', why }, the shape tomeMissing gives.
    Empty when nothing is missing. spell is { desc, name, rank }.
  */
  function staffMissing(state, spell, rankOfStaff) {
    var s = state || fresh();
    var out = [];
    if (staffPoints(s) <= 0) {
      var because = isEnchanter(s)
        ? 'an Enchanter earns one with every Bladebinder rank'
        : (staffTaught(s)
          ? 'somebody a Master Enchanter taught holds ' + LIMITS.outsiderSpells + ' staff spells at most'
          : 'staff spells are an Enchanter\'s, or taught by a Master Enchanter');
      out.push({ what: 'points', why: 'a staff spell point to spend, and you have none (' + because + ')' });
    }
    var have = rankOf(s, STAFF_HALF);
    if (!have || rankIndex(have) < rankIndex(spell.rank)) {
      out.push({ what: 'level', why: word(spell.rank) + ' rank as a Bladebinder, the half that makes staves, and you ' +
                 (have ? 'are ' + word(have) + (staffTaught(s) ? ', which a taught trade never goes past' : '')
                       : 'have no rank in it') });
    }
    var below = RANKS[rankIndex(spell.rank) - 1];
    if (below && !knowsStaffRank(s, below, rankOfStaff)) {
      out.push({ what: 'below', why: (/^[aeiou]/.test(below) ? 'an ' : 'a ') + word(below) +
                 ' staff spell you have already unlocked, and you have none' });
    }
    return out;
  }

  /** The refusal for a list of missing requirements, every one of them named. */
  function staffNeeds(spell, missing) {
    var needs = missing.map(function (m) { return m.why; });
    var list = needs.length === 1 ? needs[0]
      : needs.slice(0, -1).join('; ') + '; and ' + needs[needs.length - 1];
    return 'to unlock ' + spell.name + ' (' + word(spell.rank) + ') for staves you need ' + list;
  }

  /** The staff spell into a state already cloned and checked, and the point it costs. */
  function addStaff(s, spell) {
    // An Enchanter spends a stored point. Somebody a Master Enchanter taught
    // spends a place under the cap, which is the push below and nothing else.
    if (isEnchanter(s)) { s.staffPoints = staffPoints(s) - 1; }
    s.staffSpells = staffKnown(s);
    s.staffSpells.push(spell.desc);
    return yes(s);
  }

  function badStaff(spell) {
    return !spell || !spell.desc || !spell.name || rankIndex(spell.rank) < 0;
  }

  /**
    An Enchanter unlocks a staff spell on K, with no tome: pickSpell's rules
    over the Bladebinder rank. Answers { ok, state } or { ok: false, why,
    missing } with every one of the three that stands in the way.
  */
  function pickStaffSpell(state, spell, rankOfStaff) {
    if (badStaff(spell)) { return no('that is not a staff spell whose rank can be read'); }
    var s = clone(state);
    if (!isEnchanter(s)) {
      return no(staffTaught(s)
        ? 'somebody a Master Enchanter taught learns a staff spell from its tome, not here'
        : 'staff spells are unlocked by Enchanters');
    }
    if (knowsStaff(s, spell.desc)) { return no('you have already unlocked ' + spell.name + ' for staves'); }
    var missing = staffMissing(s, spell, rankOfStaff);
    if (missing.length) {
      var r = no(staffNeeds(spell, missing));
      r.missing = missing;
      return r;
    }
    return addStaff(s, spell);
  }

  /**
    Somebody a Master Enchanter taught reads the tome of a staff spell: the
    non-mage rules, a place under the cap and Novice only (the taught half
    never leaves Novice, so the level rule is what holds them there).
  */
  function learnStaffFromTome(state, spell, rankOfStaff) {
    if (badStaff(spell)) { return no('that tome\'s spell is not a staff spell whose rank can be read'); }
    var s = clone(state);
    if (!staffTaught(s)) {
      return no(isEnchanter(s)
        ? 'an Enchanter unlocks staff spells on K, with no tome'
        : 'staff spells are an Enchanter\'s, or taught by a Master Enchanter');
    }
    if (knowsStaff(s, spell.desc)) { return no('you have already unlocked ' + spell.name + ' for staves'); }
    var missing = staffMissing(s, spell, rankOfStaff);
    if (missing.length) {
      var r = no(staffNeeds(spell, missing));
      r.missing = missing;
      return r;
    }
    return addStaff(s, spell);
  }

  /** Every perk this character holds right now, from state alone. */
  function perks(state) {
    var out = [];
    var s = state || fresh();
    if (s.prof && s.ranks) {
      var p = own(PROFESSIONS, s.prof) ? PROFESSIONS[s.prof] : null;
      var mine = s.half ? [s.half] : (s.schools || []);
      for (var i = 0; i < mine.length; i++) {
        if (rankOf(s, mine[i]) === 'master' && p && p.perk) { out.push(p.perk.key); break; }
      }
    }
    for (var attr in TREE) {
      for (var k in TREE[attr].skills) {
        if ((s.tree && own(s.tree, k) && s.tree[k]) >= LIMITS.skillCap) { out.push(TREE[attr].skills[k].perk); }
      }
    }
    return out;
  }

  /**
    Can this character do this half's work at this rank. The one question
    every crafting and gathering gate asks. A taught half answers yes only at
    novice; anything they have no standing in answers no.
  */
  function canWork(state, half, rank) {
    var have = rankOf(state, half);
    if (!have) { return false; }
    return rankIndex(have) >= rankIndex(rank || 'novice');
  }

  /** The class verbs. The only question the five gates ask. */
  function canDo(state, verb) {
    var s = state || fresh();
    return !!s.cls && s.cls === classFor(verb);
  }

  g.__thornswoodProgression = {
    TABLE: TABLE, SPELLS: SPELLS, SPELL_IDS: SPELL_IDS, TUNING: TUNING,
    fresh: fresh, clone: clone,
    pickClass: pickClass, pickProfession: pickProfession, teach: teach,
    takeOn: takeOn, release: release,
    rankUp: rankUp, pickThirdSchool: pickThirdSchool, spendPoint: spendPoint,
    perks: perks, canWork: canWork, canDo: canDo,
    halvesOf: halvesOf, sisterOf: sisterOf, classFor: classFor,
    creditWork: creditWork, workDone: workDone, workNeeded: workNeeded,
    nextRank: nextRank, rankOf: rankOf, treeApplies: treeApplies,
    placedIn: placedIn, has: own,
    pickSpell: pickSpell, masterTomeDesc: masterTomeDesc, spellAt: spellAt, spellPoints: spellPoints,
    knowsSpell: knowsSpell, schoolsOf: schoolsOf,
    rankForLevel: rankForLevel, spellByDesc: spellByDesc,
    tomeMissing: tomeMissing, learnFromTome: learnFromTome,
    study: study, bookClean: bookClean, semesterOpens: semesterOpens, hoursAndMinutes: hoursAndMinutes,
    placesLeft: placesLeft, OFF_BOOK: OFF_BOOK,
    STAFF_HALF: STAFF_HALF, isEnchanter: isEnchanter, staffTaught: staffTaught,
    staffKnown: staffKnown, knowsStaff: knowsStaff, staffPoints: staffPoints,
    staffMissing: staffMissing, pickStaffSpell: pickStaffSpell,
    learnStaffFromTome: learnStaffFromTome
  };
})();
// ==== end thornswood progression ====

