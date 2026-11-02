<#
  Build-HuntTable.ps1

  Builds game\data\hunts.json: the table the server needs to answer a carcass.
  Nothing in it is typed from memory. It is read out of the NPC_ records of
  this build on this machine.

  WHY THERE IS ANYTHING TO BUILD

  classes.md gives the hunter one verb: loot an animal body, and everyone else
  walks past the carcass. The server cannot do that today because it has no way
  to say which bodies are animals and no idea what a body is worth. Both of
  those are in the records and this reads them.

  What the server can already tell about a body was read out of the fork at
  C:\Thornswood-Dev\skymp rather than assumed:
    - mp.get(refrId, 'type') is the string 'MpActor' for anything that is an
      actor and 'MpObjectReference' for a chest, a door, a plant or an ore
      vein. See skymp5-server/cpp/addon/property_bindings/TypeBinding.cpp.
      That is how a body is told from a chest and from a door.
    - mp.get(refrId, 'isDead') is true for a corpse. IsDeadBinding does
      GetFormAt<MpActor>, which THROWS for anything that is not an actor, so
      the type has to be checked first and every read wrapped.
    - mp.get(refrId, 'baseDesc') gives the NPC_ record, which is the key of
      this table.
    - mp.get(refrId, 'inventory') gives what the body is carrying, and the
      pelt and the meat ARE in there. This said the opposite until 20
      September, when it was read instead of assumed: MpActor::Kill ends with
      AddDeathItem (MpActor.cpp:1348), which calls EvaluateDeathItem, which
      follows TPLT through espm::NPC_::UseTraits exactly as this script does,
      runs LeveledListUtils::EvaluateListRecurse on the INAM record and adds
      every result to the dead actor's own inventory. The server resolves the
      levelled list; the client does not.
    - Nobody can reach that inventory, which is why this table exists anyway.
      ProcessActivateNormal does nothing at all for an NPC_ base: it is not
      pickable, not a DOOR, not a CONT, not an ACTI and not a FURN, so it
      falls through every branch and no container is ever sent. The client
      blocks the press as well, in objectReferenceEx.ts, which calls
      blockActivation(true) for FormType.NPC. And RespawnWithDelay wipes the
      corpse inventory before it stands the animal back up. So the engine's
      roll is made and thrown away unseen, and the row this script writes is
      what actually reaches a hunter's pack. The gamemode's mp.onActivate
      fires first either way and returning false blocks the default.
    - Every dead actor stands back up. RespawnWithDelay is called for every
      death by DeathEvent::OnFireSuccess and waits ChangeForm().spawnDelay,
      which is 25.0f unless something sets it. gamemode.js sets it to
      HUNT_TUNING.bodySeconds for the bases in this table, so the window a
      hunter has to press a body is that number rather than twenty five
      seconds, and the same reference can be killed again after it.

  WHICH SUBRECORD NAMES THE RACE, AND HOW THAT WAS PROVED

  It is RNAM, four bytes, a form id. It was not taken on trust. Every
  subrecord of every NPC_ record in Skyrim.esm was counted first, the way
  Build-HarvestTable.ps1 counted PFIG. That is 5118 records, and six tags are
  on every one of them and are four bytes wide: RNAM, NAM6, NAM7, NAM8 and
  CNAM, with DATA on all 5118 at a length of zero. Of those:
    - RNAM resolves to a RACE record for all 8283 NPC_ records in this build,
      every time, with 179 distinct races used out of the 203 the load order
      defines.
    - CNAM resolves to a CLAS record 8283 times out of 8283 and to a RACE
      record not once, so CNAM is the class and not the race.
    - NAM6 and NAM7 are not form ids at all. Read as floats they are 1.0 on
      8054 records with a spread of 0.8 to 1.3, and 50, 10, 0, 1 and 100, which
      is height and weight.
    - NAM8 is 0 to 3, a small number rather than a form id.
  This run counts the same things again and fails if any of it stops being
  true, so the proof is in the run and not only in this header.

  THE TRAP IN RNAM, WHICH COST THE FIRST ATTEMPT AT THIS TABLE

  Reading RNAM straight off the record is wrong for more than a thousand of
  them. An NPC that takes its traits from a template carries an RNAM anyway and
  that RNAM is a placeholder: 1175 records in this build have RNAM pointing at
  FoxRace and 1164 of those are templated. Among them are GuardHjaalmarchSons
  and LvlBanditBoss, which a naive read calls foxes. Measured on this build,
  the naive read calls 1084 people animals that the traits chain does not.

  So the race is followed: ACBS holds a sixteen bit template flags field at
  offset 18 and its lowest bit is Use Traits. When that bit is set and TPLT is
  there, the race AND the death item both come from the template, because both
  sit on the Traits tab in the Creation Kit. A template can be another NPC_ or
  it can be an LVLN, a levelled list of NPCs, and an LVLN is followed to every
  leaf in it.

  WHICH NPCs ARE ANIMALS, AND HOW THE RULE WAS FOUND

  A hunter takes meat and hide off a carcass and does not skin a bandit, so
  the split has to be programmatic. Three candidates were tested on this build
  and two of them were thrown out on the numbers:
    - THE VOICE TYPE, VTCK. It separates nothing. Of the NPCs that are their
      own traits, 191 of 199 animals carry a voice type and 4552 of 4694
      people do.
    - THE NPC FLAGS in ACBS. Every one of the twenty bits in use was counted
      on both sides. The best of them, 0x10, is set on 160 of 199 animals and
      on 4044 of 4694 people. Not one bit tells them apart.
    - THE RACE'S OWN KEYWORDS, which do. Every RACE record carries KWDA, and
      the vocabulary in it is ActorTypeAnimal, ActorTypeCreature,
      ActorTypeNPC, ActorTypeUndead, ActorTypeDaedra, ActorTypeDragon,
      ActorTypeDwarven and ActorTypeTroll. 72 races carry ActorTypeAnimal and
      38 carry ActorTypeNPC, and NOT ONE RACE CARRIES BOTH. The split is a
      split, and this run fails if that ever stops being true.

  So an NPC is an animal when the race at the end of its traits chain carries
  ActorTypeAnimal. On this build that is 434 NPC_ records. Spot checked by
  name, the animal races are fox, wolf, deer and elk, dog and husky, horse,
  hare, chicken, skeever, mudcrab, chaurus and chaurus hunter, goat, frostbite
  spider, cow, troll and snow troll, slaughterfish, sabre cat and snowy sabre
  cat, mammoth, horker, bear, cave bear and snow bear, netch, boar and ash
  hopper. The people are the Nords, Imperials, Bretons, Redguards, elves,
  Argonians, Khajiit, Forsworn and the rest, and none of them are in the table.
  Draugr, dragons, dwarven automata, atronachs and daedra are not animals
  either: they carry ActorTypeUndead, ActorTypeDragon, ActorTypeDwarven or
  ActorTypeDaedra and no ActorTypeAnimal, so a hunter walks past them the same
  way everybody walks past a bandit.

  19 NPCs draw their traits from a list that mixes animals with people or with
  undead, so what they are cannot be known before they spawn. They are left out
  and listed in the json under skipped rather than guessed at.

  WHAT EACH ONE GIVES, AND WHAT HAD TO BE THROWN OUT TO GET IT

  The yield is INAM, the death item, a form id pointing at a levelled list.
  Every animal in this build points at one of 40 lists and every one of them is
  an LVLI, so the list has to be resolved rather than priced as a thing.

  Resolving it whole does not work, and that is measured rather than feared.
  DeathItemHorse holds Horse Meat and Horse Hide and then LootSmallTreasure10,
  which is the same treasure list a chest draws from: gold, garnets, amethysts,
  rubies, silver rings. Flattened whole, a horse is worth a 200 gold ruby and
  the table ranks it above a mammoth. Two ways of telling the treasure from the
  body were tried and thrown out: LootSmallTreasure10 is pointed at by 33
  lists and all 33 are death items, so the referrer count says nothing, and at
  the item level the death items of people reach 4918 items including every
  enchanted cuirass in the game, so that says nothing either.

  WHAT WORKS IS WHAT THE BODY GIVES FOR CERTAIN. A levelled list carries LVLD,
  one byte, the chance of giving nothing. A sublist with a chance of nothing in
  it is a chance and not a yield, so this follows the death item into its
  sublists only while that byte is zero. Every treasure list under an animal is
  gated: LootSmallTreasure10 gives nothing 90 times in a hundred, the boar's
  gold list 75, its potion list 85, LootImperialLuck and
  LootPerkGoldenTouchChange 100.

  The rule admits 50 distinct items across the 40 lists and every single one of
  them is part of a body: pelts and hides, meat and venison, tusks, chitin,
  claws, teeth, an eye, venom, jelly, fat, scales. Not one coin, gem, ring,
  potion or soul gem survives it. That is the check that says the rule is
  right, and this run prints the 50 every time so the next person can see it
  for themselves.

  Four things are lost to it and they are named here rather than buried: the
  antlers off a deer (LItemAntlersLarge50 and LItemAntlersSmall50, half the
  time), the horn off a goat (BYOHLItemHornGoat50, half the time), the eggs off
  a chaurus (DeathItemChaurusEggs25, a quarter of the time) and the whole of
  the Solstheim boar, whose death item is six sublists and no item at all, so
  the boar has nothing certain to give and is skipped. Every sublist dropped is
  printed with its chance, every run.

  Where the price sits in a record is read the way the harvest table reads it
  and for the same proved reasons: an INGR, MISC, ARMO, WEAP, SLGM or KEYM
  carries the value as the first four bytes of DATA, and an ALCH carries the
  weight in DATA and the value at the front of ENIT.

  WHEN A BASE CAN BE MORE THAN ONE BODY

  58 of the animals in the table take their traits from an LVLN and so could be
  one of several bodies. These are not an edge case: LvlAnimalForestPredator,
  LvlBearAll, LvlSabreCatAll, LvlElk, LvlMudcrab and the rest are what is
  actually standing in the world. The server cannot know which body a spawn
  became, because the base it reads is still the levelled record. The count is
  of race and death item PAIRS, so LvlElk is in it for being a male or a female
  elk even though both of them give venison and a deer hide; counted by the
  death item alone it is 48.

  So the row takes the LEAST of what that base can be, by the best thing the
  body gives. A base that can be a wolf or a bear is a wolf: the rank never
  asks more than the cheapest body on the list, so nobody is locked out of the
  commonest animals in Skyrim on the chance the spawn rolled a bear, and the
  produce never promises a bear pelt off a wolf. Every one of them is listed in
  the json with what else it could have been.

  The race and the death item are carried through the chain as PAIRS and not as
  two lists, so the row that takes the cheaper body takes that body's name with
  it. Kept apart, LvlBearAll would have been free to pick up the bear's name
  and the cave bear's pelt, which is two animals in one row.

  WHAT THE ANIMAL IS CALLED

  The NPC record's own FULL first, so Barbas, Karinda and Lord Tusk are called
  what they are called. 199 of the 361 animals in this build have no FULL at
  all, and they are not the obscure ones: EncWolf, EncBanditWolf_Indoor,
  WhiterunPlayerHorse and MQ101FrostbiteSpider are what somebody actually walks
  up to. Falling back to the editor id the way the harvest table does would put
  'Skinning the dunBloodletThrone_LvlWolf takes an Advanced Hunter' in front of
  a person, so the fallback is the RACE record's own FULL, which is read out of
  a record like everything else here and reads Wolf, Horse, Frostbite Spider,
  Deer, Rabbit. On this build that is every one of the 199 and the run fails if
  a row is ever left with an editor id where the name goes.

  WHAT IT COMES TO ON THIS BUILD

  336 animals in the table and 99 left out and listed: 43 that are not a body
  to dress (the spirits, the spell actors and the hidden actors NOT A BODY TO
  DRESS in the knobs reads off the records, and the test netch, issue #1808),
  50 with no death item anywhere in their traits chain, which is mostly the
  audio templates and the cut Dragonborn spiders, 5 boars and one Creation Club
  creature. The ranks come out 147 novice, 140 advanced, 43 expert and 6
  master. Measured on 5 October against the Main install's load order.

  Read only. It touches nothing in the game folder and nothing on the VPS, and
  it proves that by fingerprinting the game folder before and after and failing
  if anything moved.

  Usage:
    .\scripts\dev\Build-HuntTable.ps1
    .\scripts\dev\Build-HuntTable.ps1 -Data 'C:\Thornswood\Game\Data'
    .\scripts\dev\Build-HuntTable.ps1 -PluginList 'C:\Thornswood\Profile\OwnGame\plugins.txt'
    .\scripts\dev\Build-HuntTable.ps1 -NoInstall

  Exit code 1 if a plugin in the load order is missing, if a localised plugin
  has no string table, if an NPC_ record has no RNAM or an RNAM that is not
  four bytes, if an RNAM names no RACE record, if a race carries both the
  animal keyword and the person keyword, if no animals are found at all, if a
  yield item names no record in the build, if an item has no readable price, if
  the novice rung is empty, if a name in the NOT A BODY TO DRESS knobs is not in
  the load order or a base in LEFT_OUT is not an animal, if an animal's scripts
  cannot be read, or if the game folder changed underneath it.
  Nothing is written unless every check passed.
#>
param(
    # The build's Data folder. Read only.
    [string] $Data       = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    # The load order. The five Bethesda masters are always first and are never
    # in this file, so they are put in front of it.
    [string] $PluginList = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Profile\OwnGame\plugins.txt'),
    [string] $Out        = '',
    [string] $JsOut      = '',
    # Archives may be stored separately from a verified server plugin snapshot.
    [string] $StringsData = '',
    # Restrict dressing to the animal bases retained by the population policy.
    [string] $Population = '',
    # Print the table and leave game\gamemode-tables\HUNTS_BY_BASE.json alone.
    [switch] $NoInstall
)

$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
# Thornswood's own plugins are read from game\content, every other plugin
# from -Data (#2923, OwnPlugins.ps1).
. (Join-Path $PSScriptRoot 'OwnPlugins.ps1')

# ---------------------------------------------------------------- knobs ----
# classes.md is the rulebook. It gives the hunter the carcass and gives nobody
# else any part of it, and it sets four ranks and says what each rung means. It
# puts a number on none of it. These are the judgement calls this script makes
# and they are here, in one block, rather than buried in the code.
#
# LANGUAGE: which string table the names come from. classes.md says nothing
# about language; the server and the panel are English, so English.
$LANGUAGE = 'english'
#
# ANIMAL_KEYWORD and PERSON_KEYWORD: the rule for who may be skinned. Argued
# out in full in the header, on the counts. This is not a knob to turn on a
# hunch: widening it to ActorTypeCreature would hand the hunter every dwarven
# spider, atronach and wisp in the game, and dropping the person keyword would
# take away the check that the two never land on the same race.
$ANIMAL_KEYWORD = 'ActorTypeAnimal'
$PERSON_KEYWORD = 'ActorTypeNPC'
#
# USE_TRAITS_BIT: the lowest bit of the template flags field at offset 18 of
# ACBS. When it is set, the race and the death item both come from TPLT rather
# than from the record. Following it is the difference between 434 animals and
# 1518 of them, 1084 of which are people. The header has the case.
$USE_TRAITS_BIT = 0x0001
#
# USE_BASE_DATA_BIT: bit 0x0080 of the same field, and the one that carries the
# NAME. It is not a guess about which bit does what: the fork's own reader names
# every bit of this field in libespm/include/libespm/NPC_.h, where UseTraits is
# 0x01 and UseBaseData is 0x80 with the comment 'including name and short name'.
# When it is set the game ignores the record's own FULL and shows the template's,
# so a table that stops at the record's FULL is not reading the name anybody sees.
# The header has what that cost.
$USE_BASE_DATA_BIT = 0x0080
#
# USE_SPELL_LIST_BIT and USE_SCRIPT_BIT: bits 0x0008 and 0x0200 of the same
# field, named UseSpelllist and UseScript in the fork's NPC_.h. While one is
# set, the game takes the spell list or the scripts from TPLT and not from the
# record, so the ghost marks below are read where the game reads them.
$USE_SPELL_LIST_BIT = 0x0008
$USE_SCRIPT_BIT     = 0x0200
#
# NOT A BODY TO DRESS (issue #1808). The animal keyword says what a race is. It
# does not say whether the actor is an animal's body lying on the ground, and
# the table carried a spirit, two spell actors, a mod's storage actor and a
# netch that gave a mammoth's tusk until 5 October. Each rule below takes a base
# out of the table, lists it under skipped with the rule's own words, and is
# counted on every run. They are read off the records, the same as the rest of
# this script, except LEFT_OUT, which names records one by one.
#
# SUMMONABLE_BIT: ACBS flag 0x00004000, Summonable. A spell brings the actor and
# takes it away, so it is never a carcass: SummonFireStorm (Fire Storm), Odin's
# Flaming Thrall and its familiars, YokuWeapons' Jar Bomb. The fork's NPC_.h
# puts this flag under Use Base Data, so it is read through that chain.
$SUMMONABLE_BIT = 0x00004000
#
# GHOST_BIT: ACBS flag 0x20000000, Is Ghost. Nothing can strike an actor that
# carries it. The game puts it on its ghosts, and mods put it on the hidden
# actors they keep in the world: Odin's Buried Storage is a chest in the shape
# of a chicken, FishingInSkyrim's net is a slaughterfish. The fork does not say
# which template bit carries it, so it is read off the record itself.
$GHOST_BIT = 0x20000000
#
# GHOST_SCRIPT, GHOST_SPELLS and GHOST_DEATH_ITEM: the other marks the game
# gives a spirit. The ghost script, whose properties are the ghost's shaders,
# the ghost abilities that make it glow, and the death item a ghost leaves,
# which is ectoplasm and not an animal's parts. A spell named here that the load
# order does not have fails the run, so the list cannot go stale quietly.
$GHOST_SCRIPT     = 'defaultGhostScript'
$GHOST_SPELLS     = @('GhostAbility', 'GhostAbilityFire', 'GhostAbilityFireNoAlpha', 'GhostAbilityFrost',
                      'GhostAbilityNew', 'GhostAbilityStorm', 'GhostAbilityViolet')
$GHOST_DEATH_ITEM = 'DeathItemGhost'
#
# SPIRIT_RACES: a race that is a spirit's although nothing on its actors says
# so. Keyed by the race's editor id, each with the reason, which is printed. A
# race named here that the load order does not have fails the run.
$SPIRIT_RACES = [ordered]@{
    'C06WolfSpiritRace' = 'the race of the wolf spirits of Kodlak, Farkas and Vilkas: their own records carry no ghost mark the game reads (the ghost script on three of them is replaced by their template''s, because Use Script is set)'
}
#
# LEFT_OUT: a base taken out by name, because no rule above reaches it and the
# reason is in the record. Keyed by the base, with the reason, which is printed
# and written under skipped. A base named here that is not an animal in this
# load order fails the run, so an entry cannot outlive its record quietly.
$LEFT_OUT = [ordered]@{
    '2173b:Dragonborn.esm' = 'DLC2EncNetchTest, a test netch Bethesda left in Dragonborn.esm: no record in the load order refers to it, so no levelled list names it and nothing in the world places it, and its death item is the mammoth''s, so it would hand a hunter a mammoth''s tusk and snout off a netch'
}
#
# VALUE_RULES: where the gold value sits in each kind of record. Proved in the
# header of Build-HarvestTable.ps1, against the prices these items actually
# have in the game, and the same rules are used here so that a pelt and a
# flower are priced the same way. An item of a type that is not in here fails
# the run, because a rank guessed without a price is worse than no entry.
$VALUE_RULES = @{
    'INGR' = 'DATA0'   # DATA: value uint32, then weight float
    'MISC' = 'DATA0'   # same shape
    'SLGM' = 'DATA0'   # same shape
    'KEYM' = 'DATA0'   # same shape
    'ARMO' = 'DATA0'   # same shape
    'AMMO' = 'DATA0'   # same shape
    'WEAP' = 'DATA0'   # DATA: value uint32, weight float, damage uint16
    'ALCH' = 'ENIT0'   # DATA is the weight alone; ENIT starts with the value
}
#
# RANK_BANDS: the gold value of the best thing the body gives, at or below
# which an animal is that rank. INVENTED. classes.md sets four ranks and says
# what each rung is for, and it does not put a number on any of them, so the
# measure is the one number the records already carry, the same one the ore
# table ranks by: what the thing is worth.
#
# The cuts sit in the gaps this build actually has rather than on round numbers
# pulled out of the air. The whole spread, printed every run, is 2, 3, 5, 7,
# 10, 15, 20, 21, 25, 40, 50, 60, 75, 150 and 300 gold and nothing in between,
# so 10 to 15, 25 to 40 and 75 to 150 are empty and a threshold anywhere in one
# of them moves nothing.
#
#   novice     up to 10   'The basics of your half, and not much of it.' The
#                         rabbit, the chicken, the dog, the skeever, the
#                         mudcrab, the slaughterfish, the fox, the goat, the
#                         snow fox, the wolf, the deer and the cow. Meat and a
#                         torn hide off the animals anybody walks past on the
#                         road, which is exactly where a hunter has to be able
#                         to start.
#   advanced   up to 25   'The everyday work. Most of what a hold actually
#                         needs.' The horse, the ice wolf, the troll, the
#                         horker, the netch, the ash hopper, the frostbite
#                         spider and the sabre cat. A whole hide, a tusk and
#                         the first of the things worth carrying home.
#   expert     up to 75   'The things people come looking for you specifically
#                         to get.' The snowy sabre cat, the chaurus, the bear,
#                         the cave bear and the snow bear.
#   master     over that  'The short list.' The mammoth, for its tusk at 150
#                         gold, and Karhu in Windhelm, whose pelt is 300.
#
# The last band has no upper bound on purpose: a mod that adds a richer animal
# lands at master rather than falling out of the table.
$RANK_BANDS = @(
    @{ Rank = 'novice';   UpTo = 10 },
    @{ Rank = 'advanced'; UpTo = 25 },
    @{ Rank = 'expert';   UpTo = 75 },
    @{ Rank = 'master';   UpTo = [int]::MaxValue }
)
#
# WHAT A CARCASS GIVES. The same shape the ore table and the salt quarry use,
# because a hunter standing over a body is doing what a miner at a seam is
# doing: mineSalt hands out randInt(1, 1 + tier) with tier 1 at novice through
# 4 at master, so the floor is one and the ceiling climbs a rank at a time.
# Each row carries four pairs, novice first, and the pair is how many of EACH
# thing the body gives the hunter takes, so a master gets more off the same
# animal than a novice does. A pair of zeroes means that rank may not work that
# body at all, because classes.md says rank decides which source somebody may
# work AT ALL.
$YIELD_FLOOR    = 1
$YIELD_PER_RANK = 1     # the ceiling is $YIELD_FLOOR + tier * $YIELD_PER_RANK
$RANK_ORDER     = @('novice', 'advanced', 'expert', 'master')

if (-not $Out) { $Out = Join-Path $PSScriptRoot '..\..\game\data\hunts.json' }

# Update.esm's own Creation Club records (#479). Every Special Edition has
# them, but their art comes with the Creation Club files Thornswood leaves out,
# so a creature that is one is left out of the table (and so out of /spawn) and
# listed under skipped with the reason. scripts\mods\Check-CreationForms.js
# --write keeps the list, and tests\test-special-edition-only.js holds the
# gamemode to it.
$creation = @{}
$creationList = Join-Path $PSScriptRoot '..\..\records\update-creation-club.json'
foreach ($c in ([IO.File]::ReadAllText($creationList) | ConvertFrom-Json).records.PSObject.Properties) {
    $creation[[string]$c.Name + ':Update.esm'] = $true
}

$fail = 0
function Ok  ($m) { Write-Host "  ok    $m" -ForegroundColor Green }
function Bad ($m) { Write-Host "  FAIL  $m" -ForegroundColor Red; $script:fail++ }
function Note($m) { Write-Host "        $m" -ForegroundColor DarkGray }

# ------------------------------------------------------------ the pieces ----

# A record's data is zlib when flag 0x00040000 is set: four bytes of
# decompressed size, then the stream. DeflateStream wants the two byte zlib
# header gone, hence the +2.
function Expand-RecordData([byte[]]$src, [int]$offset, [int]$outLen) {
    $ms = New-Object System.IO.MemoryStream(, $src)
    $ms.Position = $offset + 2
    $ds = New-Object System.IO.Compression.DeflateStream($ms, [System.IO.Compression.CompressionMode]::Decompress)
    $out = New-Object byte[] $outLen
    $got = 0
    while ($got -lt $outLen) {
        $n = $ds.Read($out, $got, $outLen - $got)
        if ($n -le 0) { break }
        $got += $n
    }
    $ds.Dispose()
    $ms.Dispose()
    if ($got -ne $outLen) { throw "a compressed record unpacked to $got bytes, not $outLen" }
    return $out
}

# Pulls every .STRINGS file out of a BSA, by name, uncompressed. Version 105
# (Skyrim Special Edition): 24 byte folder records, a name block after them.
function Get-BsaStringFiles([string]$bsaPath) {
    $b = [System.IO.File]::ReadAllBytes($bsaPath)
    if ([System.Text.Encoding]::ASCII.GetString($b, 0, 3) -ne 'BSA') { throw "not a BSA: $bsaPath" }
    $version   = [BitConverter]::ToUInt32($b, 4)
    $folderOff = [BitConverter]::ToUInt32($b, 8)
    $archFlags = [BitConverter]::ToUInt32($b, 12)
    $folderCnt = [BitConverter]::ToUInt32($b, 16)
    $fileCnt   = [BitConverter]::ToUInt32($b, 20)
    $totFileN  = [BitConverter]::ToUInt32($b, 28)
    if ($version -ne 105) { throw "BSA version $version is not the Special Edition's 105: $bsaPath" }
    # 0x4 would mean every file in it is compressed, and in a version 105
    # archive that compression is LZ4, which this cannot unpack
    if ($archFlags -band 0x4) { throw "the archive is compressed throughout and cannot be read here: $bsaPath" }

    $sizes  = New-Object 'System.Collections.Generic.List[uint32]'
    $starts = New-Object 'System.Collections.Generic.List[uint32]'
    $nameBlock = 0
    for ($f = 0; $f -lt $folderCnt; $f++) {
        $o = [int]$folderOff + $f * 24
        $cnt      = [int][BitConverter]::ToUInt32($b, $o + 8)
        $blockOff = [BitConverter]::ToUInt64($b, $o + 16)
        # the folder record's offset counts the file name block in, so take it out
        $q = [int]($blockOff - $totFileN)
        $q += 1 + $b[$q]        # the folder's own name, a length byte then the text
        for ($i = 0; $i -lt $cnt; $i++) {
            $sizes.Add([BitConverter]::ToUInt32($b, $q + $i * 16 + 8))
            $starts.Add([BitConverter]::ToUInt32($b, $q + $i * 16 + 12))
        }
        $end = $q + $cnt * 16
        if ($end -gt $nameBlock) { $nameBlock = $end }
    }

    $out = @{}
    $q = $nameBlock
    for ($i = 0; $i -lt $fileCnt; $i++) {
        $s = $q
        while ($b[$q] -ne 0) { $q++ }
        $name = [System.Text.Encoding]::ASCII.GetString($b, $s, $q - $s).ToLowerInvariant()
        $q++
        if (-not $name.EndsWith('.strings')) { continue }
        $size = $sizes[$i]
        if ($size -band 0x40000000) {
            # the archive's default is uncompressed (flags 0x3); a file that
            # flips that would be LZ4 and this cannot read it
            Note "skipped a compressed strings file in the archive: $name"
            continue
        }
        $bytes = New-Object byte[] ([int]$size)
        [Array]::Copy($b, [int]$starts[$i], $bytes, 0, [int]$size)
        $out[$name] = $bytes
    }
    return $out
}

# A .STRINGS file: a count, a size, then count pairs of (string id, offset),
# then the text. Each string is zero terminated and has no length in front of
# it, which is what separates .STRINGS from .ILSTRINGS and .DLSTRINGS.
function Read-StringTable([byte[]]$bytes) {
    $count = [int][BitConverter]::ToUInt32($bytes, 0)
    $dataStart = 8 + $count * 8
    $t = @{}
    for ($i = 0; $i -lt $count; $i++) {
        $id  = [BitConverter]::ToUInt32($bytes, 8 + $i * 8)
        $off = [int][BitConverter]::ToUInt32($bytes, 8 + $i * 8 + 4)
        $p = $dataStart + $off
        $s = $p
        while ($bytes[$p] -ne 0) { $p++ }
        $t[$id] = [System.Text.Encoding]::GetEncoding(1252).GetString($bytes, $s, $p - $s)
    }
    return $t
}

# The masters a plugin declares, in order. A record's form id carries the index
# of the file it really belongs to in its top byte, so a Dawnguard.esm record
# with 00 up there is a Skyrim.esm record being overridden and the desc has to
# say Skyrim.esm.
function Get-PluginMasters([byte[]]$b, [int]$headerSize) {
    $masters = New-Object 'System.Collections.Generic.List[string]'
    $p = 24
    $end = 24 + $headerSize
    while ($p + 6 -le $end) {
        $t = [System.Text.Encoding]::ASCII.GetString($b, $p, 4)
        $sz = [int][BitConverter]::ToUInt16($b, $p + 4)
        if ($t -eq 'MAST') {
            $masters.Add([System.Text.Encoding]::GetEncoding(1252).GetString($b, $p + 6, $sz - 1))
        }
        $p += 6 + $sz
    }
    # ',' on purpose. A bare 'return $masters' is unrolled on the way out, and a
    # plugin with exactly one master then comes back as the bare string
    # 'Skyrim.esm' instead of a list of one. Its .Count still reads 1, so
    # nothing complains, but $masters[0] indexes the STRING and hands back the
    # character 'S', and every overridden record in Update.esm, Dawnguard.esm,
    # HearthFires.esm and Dragonborn.esm gets a desc ending in ':S'. Those four
    # have exactly one master each, so this is the common case, not the odd one.
    return ,$masters.ToArray()
}

# form id -> '<hex>:<the plugin that really owns it>', the shape the server's
# espm descs take.
function Desc-Of([uint32]$formId, $masters, [string]$pl) {
    $mi = [int]($formId -shr 24)
    $owner = $pl
    if ($mi -lt $masters.Count) { $owner = $masters[$mi] }
    return ('{0:x}' -f ($formId -band 0xFFFFFF)) + ':' + $owner
}

# One json string, quoted and escaped. Written here rather than reached for
# with ConvertTo-Json so the file comes out the same on 5.1 and on 7.
function JsonStr($s) {
    $t = [string]$s
    $t = $t.Replace('\', '\\')
    $t = $t.Replace('"', '\"')
    $t = $t.Replace("`r", '\r')
    $t = $t.Replace("`n", '\n')
    $t = $t.Replace("`t", '\t')
    return '"' + $t + '"'
}

# Every table and gamemode block this writes is joined with LF, the ending
# .gitattributes gives these files on every checkout (#3029). Until then each
# run took the ending of the file it found, because a checkout with autocrlf
# held them CRLF and the agents' VM and the runners' clones LF (#1622, #1787,
# #1828), so a run on One rewrote every table it touched.
$Eol = "`n"

# Everything sitting directly in the game folder, with its size and its last
# write. Taken before the work and again after it, so 'read only' is something
# the run proves rather than something the header claims. Only the top level:
# every file this script opens is a plugin or a BSA sitting right there.
function Get-FolderFingerprint([string]$dir) {
    $lines = New-Object 'System.Collections.Generic.List[string]'
    foreach ($p in ([System.IO.Directory]::GetFileSystemEntries($dir) | Sort-Object)) {
        $fi = New-Object System.IO.FileInfo $p
        if ($fi.Exists) {
            $lines.Add($fi.Name + '|' + $fi.Length + '|' + $fi.LastWriteTimeUtc.Ticks)
        } else {
            $di = New-Object System.IO.DirectoryInfo $p
            $lines.Add($di.Name + '|dir|' + $di.LastWriteTimeUtc.Ticks)
        }
    }
    return ,$lines.ToArray()   # ',' for the same reason as Get-PluginMasters
}

# Every subrecord of a record, in order. XXXX carries the real size of the
# subrecord after it, for anything bigger than two bytes can say.
function Split-Subrecords([byte[]]$rec) {
    $out = New-Object 'System.Collections.Generic.List[object]'
    $k = 0
    $over = 0
    while ($k + 6 -le $rec.Length) {
        $sub = [System.Text.Encoding]::ASCII.GetString($rec, $k, 4)
        $sz  = [int][BitConverter]::ToUInt16($rec, $k + 4)
        $k += 6
        if ($over -gt 0) { $sz = $over; $over = 0 }
        if ($sub -eq 'XXXX') { $over = [int][BitConverter]::ToUInt32($rec, $k); $k += $sz; continue }
        if ($k + $sz -gt $rec.Length) { break }
        $bytes = New-Object byte[] $sz
        [Array]::Copy($rec, $k, $bytes, 0, $sz)
        $out.Add(@{ Tag = $sub; Bytes = $bytes })
        $k += $sz
    }
    return $out
}

# The names of the scripts in a VMAD, in order. The layout is the one
# Build-OreTable.ps1 reads a vein's ore out of: a version (2 to 5; 4 and up put
# a status byte after a script name and after a property's type), an object
# format, a count of scripts, then per script its name, its properties and
# each property's value, whose length the type decides. The values are stepped
# over; only the names are kept. Throws on anything it cannot step over,
# because a half read VMAD would say a ghost has no ghost script.
function Read-VmadScripts([byte[]]$v) {
    $names = New-Object 'System.Collections.Generic.List[string]'
    if ($v.Length -lt 6) { throw "a VMAD of $($v.Length) bytes is too short to hold a header" }
    $version = [BitConverter]::ToInt16($v, 0)
    if ($version -lt 2 -or $version -gt 5) { throw "VMAD version $version is not one this can read" }
    $count = [int][BitConverter]::ToUInt16($v, 4)
    $p = 6
    for ($s = 0; $s -lt $count; $s++) {
        $nl = [int][BitConverter]::ToUInt16($v, $p); $p += 2
        $names.Add([System.Text.Encoding]::GetEncoding(1252).GetString($v, $p, $nl)); $p += $nl
        if ($version -ge 4) { $p += 1 }
        $pc = [int][BitConverter]::ToUInt16($v, $p); $p += 2
        for ($q = 0; $q -lt $pc; $q++) {
            $pl = [int][BitConverter]::ToUInt16($v, $p); $p += 2 + $pl
            $pt = [int]$v[$p]; $p += 1
            if ($version -ge 4) { $p += 1 }
            switch ($pt) {
                1  { $p += 8 }
                2  { $sl = [int][BitConverter]::ToUInt16($v, $p); $p += 2 + $sl }
                3  { $p += 4 }
                4  { $p += 4 }
                5  { $p += 1 }
                11 { $n2 = [int][BitConverter]::ToUInt32($v, $p); $p += 4 + $n2 * 8 }
                12 { $n2 = [int][BitConverter]::ToUInt32($v, $p); $p += 4
                     for ($z = 0; $z -lt $n2; $z++) { $sl = [int][BitConverter]::ToUInt16($v, $p); $p += 2 + $sl } }
                13 { $n2 = [int][BitConverter]::ToUInt32($v, $p); $p += 4 + $n2 * 4 }
                14 { $n2 = [int][BitConverter]::ToUInt32($v, $p); $p += 4 + $n2 * 4 }
                15 { $n2 = [int][BitConverter]::ToUInt32($v, $p); $p += 4 + $n2 }
                default { throw ("a property on script {0} has type {1}, which this cannot step over" -f $names[$names.Count - 1], $pt) }
            }
            if ($p -gt $v.Length) { throw ("script {0} ran past the end of the VMAD" -f $names[$names.Count - 1]) }
        }
    }
    return ,$names.ToArray()   # ',' for the same reason as Get-PluginMasters
}

function Rank-For([long]$value) {
    foreach ($band in $RANK_BANDS) {
        if ($value -le [long]$band.UpTo) { return [string]$band.Rank }
    }
    return [string]$RANK_BANDS[$RANK_BANDS.Count - 1].Rank
}

# The yield pairs, novice first. Below the animal's own rank a body gives
# nothing, because rank decides which source somebody may work at all.
function Yield-For([string]$rank) {
    $need = [array]::IndexOf($RANK_ORDER, $rank)
    $pairs = New-Object 'System.Collections.Generic.List[string]'
    for ($t = 0; $t -lt $RANK_ORDER.Count; $t++) {
        if ($t -lt $need) { $pairs.Add('[0, 0]') }
        # the whole -f goes in brackets of its own: inside .Add(...) a comma is
        # the next argument to Add, not the next thing to format
        else { $pairs.Add(('[{0}, {1}]' -f $YIELD_FLOOR, ($YIELD_FLOOR + ($t + 1) * $YIELD_PER_RANK))) }
    }
    return '[' + ($pairs -join ', ') + ']'
}

# ------------------------------------------------------- the game folder ----

Write-Host ''
Write-Host 'the game folder' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $Data)) { throw "not found: $Data" }
$fingerBefore = Get-FolderFingerprint $Data
Ok ("{0}: {1} entries before" -f $Data, $fingerBefore.Count)

# ------------------------------------------------------- the load order -----

Write-Host ''
Write-Host 'the load order' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $PluginList)) { throw "not found: $PluginList" }
# The five masters, then each '*' line; a line with no '*' is a plugin
# switched off, which the game does not load (OwnPlugins.ps1, #1712, #2976).
$order = Get-LoadOrder $PluginList
$offCount = (Get-SwitchedOff $PluginList).Count
Ok ("{0} plugins: the 5 masters and {1} from {2}" -f $order.Count, ($order.Count - 5), $PluginList)
if ($offCount -gt 0) { Note "$offCount line(s) in that list are switched off and were left out" }

$missing = New-Object 'System.Collections.Generic.List[string]'
foreach ($pl in $order) { if (-not (Test-Path -LiteralPath (Get-PluginPath $Data $pl))) { $missing.Add($pl) } }
if ($missing.Count -gt 0) {
    Bad ("{0} plugin(s) the list enables are not in {1}: {2}" -f $missing.Count, $Data, ($missing -join ', '))
} else {
    Ok 'every one of them is in the game folder'
}

# ------------------------------------------------------- the string tables --

Write-Host ''
Write-Host 'names' -ForegroundColor Cyan
# A localised plugin keeps its names in a string table instead of in the
# record. The five masters are localised and their English tables live inside
# Skyrim - Interface.bsa on this machine rather than loose in Data\Strings. A
# mod plugin that is localised keeps its table loose or in its own BSA.
$tables    = @{}
$bsaCache  = @{}
$localised = @{}
$stringsRoot = if ($StringsData) { $StringsData } else { $Data }
$looseDir  = Join-Path $stringsRoot 'Strings'

function Get-BsaCached([string]$name) {
    if ($bsaCache.ContainsKey($name)) { return $bsaCache[$name] }
    $p = Join-Path $stringsRoot $name
    if (-not (Test-Path -LiteralPath $p)) { $bsaCache[$name] = $null; return $null }
    $got = $null
    try { $got = Get-BsaStringFiles $p } catch { Note ("could not read {0}: {1}" -f $name, $_.Exception.Message); $got = $null }
    $bsaCache[$name] = $got
    return $got
}

foreach ($pl in $order) {
    $path = Get-PluginPath $Data $pl
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $head = New-Object byte[] 12
    $fs = [System.IO.File]::OpenRead($path)
    [void]$fs.Read($head, 0, 12)
    $fs.Dispose()
    $localised[$pl] = [bool]([BitConverter]::ToUInt32($head, 8) -band 0x80)
    if (-not $localised[$pl]) { continue }

    $base = [System.IO.Path]::GetFileNameWithoutExtension($pl)
    $want = $base.ToLowerInvariant() + '_' + $LANGUAGE + '.strings'
    $loose = Join-Path $looseDir $want
    if (Test-Path -LiteralPath $loose) {
        $tables[$pl] = @{ Table = (Read-StringTable ([System.IO.File]::ReadAllBytes($loose))); Where = 'Data\Strings' }
        continue
    }
    foreach ($cand in @(($base + '.bsa'), ($base + ' - Interface.bsa'), 'Skyrim - Interface.bsa')) {
        $files = Get-BsaCached $cand
        if ($files -and $files.ContainsKey($want)) {
            $tables[$pl] = @{ Table = (Read-StringTable $files[$want]); Where = $cand }
            break
        }
    }
}
$locCount = 0
foreach ($pl in $order) { if ($localised.ContainsKey($pl) -and $localised[$pl]) { $locCount++ } }
Ok ("{0} of {1} plugins are localised; the rest keep their names in their own records" -f $locCount, $order.Count)
foreach ($pl in $order) {
    if (-not ($localised.ContainsKey($pl) -and $localised[$pl])) { continue }
    if ($tables.ContainsKey($pl)) { Note ("{0}: {1} strings, from {2}" -f $pl, $tables[$pl].Table.Count, $tables[$pl].Where) }
    else { Bad ("{0}: localised and no $LANGUAGE string table found; its names would fall back to editor ids" -f $pl) }
}

# --------------------------------------------------------------- the walk ---

Write-Host ''
Write-Host 'records' -ForegroundColor Cyan
# One walk of the whole load order. The NPC_ records are what the table is
# about; RACE and KYWD say which of them are animals; LVLN carries the levelled
# templates and LVLI the death items; the item groups are what a death item
# ends up naming and where the price is. A plugin later in the order that
# overrides a record replaces what an earlier one said about it, which is what
# the game does.
$ITEM_TYPES = @('MISC', 'INGR', 'ALCH', 'ARMO', 'WEAP', 'SLGM', 'KEYM', 'AMMO', 'BOOK', 'SCRL', 'LIGH')
$wantLabels = @{ 'NPC_' = $true; 'RACE' = $true; 'KYWD' = $true; 'LVLI' = $true; 'LVLN' = $true; 'SPEL' = $true }
foreach ($t in $ITEM_TYPES) { $wantLabels[$t] = $true }

$npcs  = New-Object System.Collections.Specialized.OrderedDictionary
$races = New-Object System.Collections.Specialized.OrderedDictionary
$kywds = @{}
# SPEL: only the editor id, for the ghost abilities (GHOST_SPELLS)
$spels = @{}
$lvli  = @{}
$lvln  = @{}
$items = @{}

# the subrecord census that proves RNAM is the race, counted again on every run
$npcCount      = 0
$rnamPresent   = 0
$rnamFourBytes = 0
$rnamTwice     = 0
$cnamPresent   = 0
$nam6Min = [double]::MaxValue; $nam6Max = [double]::MinValue
$nam7Min = [double]::MaxValue; $nam7Max = [double]::MinValue
$nam8Min = [long]::MaxValue;   $nam8Max = [long]::MinValue

foreach ($pl in $order) {
    $path = Get-PluginPath $Data $pl
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $b = [System.IO.File]::ReadAllBytes($path)
    if ([System.Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'TES4') { Bad "not a plugin: $path"; continue }
    $headerSize = [int][BitConverter]::ToUInt32($b, 4)
    $loc     = $localised[$pl]
    $masters = Get-PluginMasters $b $headerSize
    $strTable = $null
    if ($tables.ContainsKey($pl)) { $strTable = $tables[$pl].Table }

    $hereNpcs = 0
    $i = 24 + $headerSize
    while ($i + 24 -le $b.Length) {
        if ([System.Text.Encoding]::ASCII.GetString($b, $i, 4) -ne 'GRUP') { break }
        $groupSize = [int][BitConverter]::ToUInt32($b, $i + 4)
        if ($groupSize -lt 24) { break }
        $label = [System.Text.Encoding]::ASCII.GetString($b, $i + 8, 4)
        if ($wantLabels.ContainsKey($label)) {
            $j = $i + 24
            $groupEnd = $i + $groupSize
            while ($j + 24 -le $groupEnd) {
                $type     = [System.Text.Encoding]::ASCII.GetString($b, $j, 4)
                $dataSize = [int][BitConverter]::ToUInt32($b, $j + 4)
                # a nested GRUP counts its own 24 byte header in its size; a
                # record does not. These groups hold no nested groups, but a
                # walk that cannot tell the two apart runs off the end.
                if ($type -eq 'GRUP') { $j += $dataSize; continue }
                $recFlags = [BitConverter]::ToUInt32($b, $j + 8)
                $formId   = [BitConverter]::ToUInt32($b, $j + 12)
                if ($type -eq $label) {
                    if ($recFlags -band 0x00040000) {
                        $outLen = [int][BitConverter]::ToUInt32($b, $j + 24)
                        $rec = Expand-RecordData $b ($j + 28) $outLen
                    } else {
                        $rec = New-Object byte[] $dataSize
                        [Array]::Copy($b, $j + 24, $rec, 0, $dataSize)
                    }
                    $subs = Split-Subrecords $rec
                    $desc = Desc-Of $formId $masters $pl

                    $edid = ''
                    $full = ''
                    $fullFrom = ''
                    foreach ($s in $subs) {
                        if ($s.Tag -eq 'EDID' -and $s.Bytes.Length -gt 1) {
                            $edid = [System.Text.Encoding]::GetEncoding(1252).GetString($s.Bytes, 0, $s.Bytes.Length - 1)
                        } elseif ($s.Tag -eq 'FULL') {
                            if ($loc -and $s.Bytes.Length -eq 4) {
                                $sid = [BitConverter]::ToUInt32($s.Bytes, 0)
                                if ($strTable -and $strTable.ContainsKey($sid)) { $full = $strTable[$sid]; $fullFrom = 'string table' }
                            } elseif ($s.Bytes.Length -gt 1) {
                                $full = [System.Text.Encoding]::GetEncoding(1252).GetString($s.Bytes, 0, $s.Bytes.Length - 1)
                                $fullFrom = 'the record'
                            }
                        }
                    }

                    if ($type -eq 'KYWD') {
                        $kywds[$desc] = $edid
                    } elseif ($type -eq 'SPEL') {
                        $spels[$desc] = $edid
                    } elseif ($type -eq 'RACE') {
                        $kw = New-Object 'System.Collections.Generic.List[string]'
                        foreach ($s in $subs) {
                            if ($s.Tag -ne 'KWDA') { continue }
                            for ($z = 0; $z + 4 -le $s.Bytes.Length; $z += 4) {
                                $kw.Add((Desc-Of ([BitConverter]::ToUInt32($s.Bytes, $z)) $masters $pl))
                            }
                        }
                        $races[$desc] = [pscustomobject]@{ Desc = $desc; Edid = $edid; Full = $full; Kwda = $kw.ToArray(); SeenIn = $pl }
                    } elseif ($type -eq 'LVLI' -or $type -eq 'LVLN') {
                        # LVLO is twelve bytes: the level as a uint16, two
                        # unused, the form id, the count as a uint16 and two
                        # more unused. LVLD is one byte, the chance of the list
                        # handing over nothing at all, and it is the byte the
                        # certain yield rule turns on.
                        $ent = New-Object 'System.Collections.Generic.List[object]'
                        $chanceNone = 0
                        foreach ($s in $subs) {
                            if ($s.Tag -eq 'LVLO' -and $s.Bytes.Length -ge 12) {
                                $ent.Add(@{
                                    Desc  = (Desc-Of ([BitConverter]::ToUInt32($s.Bytes, 4)) $masters $pl)
                                    Count = [int][BitConverter]::ToUInt16($s.Bytes, 8)
                                })
                            } elseif ($s.Tag -eq 'LVLD' -and $s.Bytes.Length -ge 1) {
                                $chanceNone = [int]$s.Bytes[0]
                            }
                        }
                        $row = [pscustomobject]@{ Desc = $desc; Edid = $edid; Entries = $ent.ToArray(); ChanceNone = $chanceNone; SeenIn = $pl }
                        if ($type -eq 'LVLI') { $lvli[$desc] = $row } else { $lvln[$desc] = $row }
                    } elseif ($type -eq 'NPC_') {
                        $script:npcCount++
                        $rnam = ''; $inam = ''; $tplt = ''; $tmpl = 0; $cnam = ''
                        # what NOT A BODY TO DRESS reads: the ACBS flags, the
                        # spell list and the scripts, kept raw and read only
                        # for the animals
                        $acbsFlags = [uint32]0; $splo = New-Object 'System.Collections.Generic.List[string]'; $vmad = $null
                        $seenRnam = 0
                        foreach ($s in $subs) {
                            if ($s.Tag -eq 'RNAM') {
                                $seenRnam++
                                if ($s.Bytes.Length -eq 4) {
                                    $script:rnamFourBytes++
                                    $rnam = Desc-Of ([BitConverter]::ToUInt32($s.Bytes, 0)) $masters $pl
                                }
                            } elseif ($s.Tag -eq 'INAM' -and $s.Bytes.Length -eq 4) {
                                $inam = Desc-Of ([BitConverter]::ToUInt32($s.Bytes, 0)) $masters $pl
                            } elseif ($s.Tag -eq 'TPLT' -and $s.Bytes.Length -eq 4) {
                                $tplt = Desc-Of ([BitConverter]::ToUInt32($s.Bytes, 0)) $masters $pl
                            } elseif ($s.Tag -eq 'ACBS' -and $s.Bytes.Length -ge 24) {
                                $acbsFlags = [BitConverter]::ToUInt32($s.Bytes, 0)
                                $tmpl = [int][BitConverter]::ToUInt16($s.Bytes, 18)
                            } elseif ($s.Tag -eq 'SPLO' -and $s.Bytes.Length -eq 4) {
                                $splo.Add((Desc-Of ([BitConverter]::ToUInt32($s.Bytes, 0)) $masters $pl))
                            } elseif ($s.Tag -eq 'VMAD') {
                                $vmad = $s.Bytes
                            } elseif ($s.Tag -eq 'CNAM' -and $s.Bytes.Length -eq 4) {
                                $script:cnamPresent++
                                $cnam = Desc-Of ([BitConverter]::ToUInt32($s.Bytes, 0)) $masters $pl
                            } elseif ($s.Tag -eq 'NAM6' -and $s.Bytes.Length -eq 4) {
                                $v = [double][BitConverter]::ToSingle($s.Bytes, 0)
                                if ($v -lt $script:nam6Min) { $script:nam6Min = $v }
                                if ($v -gt $script:nam6Max) { $script:nam6Max = $v }
                            } elseif ($s.Tag -eq 'NAM7' -and $s.Bytes.Length -eq 4) {
                                $v = [double][BitConverter]::ToSingle($s.Bytes, 0)
                                if ($v -lt $script:nam7Min) { $script:nam7Min = $v }
                                if ($v -gt $script:nam7Max) { $script:nam7Max = $v }
                            } elseif ($s.Tag -eq 'NAM8' -and $s.Bytes.Length -eq 4) {
                                $v = [long][BitConverter]::ToUInt32($s.Bytes, 0)
                                if ($v -lt $script:nam8Min) { $script:nam8Min = $v }
                                if ($v -gt $script:nam8Max) { $script:nam8Max = $v }
                            }
                        }
                        if ($seenRnam -ge 1) { $script:rnamPresent++ }
                        if ($seenRnam -gt 1) { $script:rnamTwice++ }
                        if (-not $full) { $full = $edid; $fullFrom = 'the editor id' }
                        $npcs[$desc] = [pscustomobject]@{
                            Desc = $desc; Edid = $edid; Full = $full; FullFrom = $fullFrom
                            Rnam = $rnam; Inam = $inam; Tplt = $tplt; Cnam = $cnam; TemplateFlags = $tmpl; SeenIn = $pl
                            Flags = $acbsFlags; Splo = $splo.ToArray(); Vmad = $vmad
                        }
                        $hereNpcs++
                    } else {
                        # an item: what it is and what it is worth
                        $value = -1
                        $rule = ''
                        if ($VALUE_RULES.ContainsKey($type)) { $rule = $VALUE_RULES[$type] }
                        foreach ($s in $subs) {
                            if ($rule -eq 'DATA0' -and $s.Tag -eq 'DATA' -and $s.Bytes.Length -ge 4) {
                                $value = [long][BitConverter]::ToUInt32($s.Bytes, 0)
                            } elseif ($rule -eq 'ENIT0' -and $s.Tag -eq 'ENIT' -and $s.Bytes.Length -ge 4) {
                                $value = [long][BitConverter]::ToUInt32($s.Bytes, 0)
                            }
                        }
                        if (-not $full) { $full = $edid; $fullFrom = 'the editor id' }
                        $items[$desc] = [pscustomobject]@{
                            Desc = $desc; Type = $type; Edid = $edid; Full = $full; FullFrom = $fullFrom
                            Value = $value; SeenIn = $pl
                        }
                    }
                }
                $j += 24 + $dataSize
            }
        }
        $i += $groupSize
    }
    if ($hereNpcs -gt 0) { Note ("{0}: {1} NPC_ records" -f $pl, $hereNpcs) }
}
Ok ("{0} NPC_ records after overrides, {1} races, {2} keywords, {3} levelled item lists, {4} levelled NPC lists, {5} items" -f `
    $npcs.Count, $races.Count, $kywds.Count, $lvli.Count, $lvln.Count, $items.Count)

# ------------------------------------------- the subrecord that names the race

Write-Host ''
Write-Host 'the subrecord that names the race' -ForegroundColor Cyan
# The same census the header argues from, counted again here so the proof is in
# the run. If a build ever turns up where RNAM is not on every NPC, or is not
# four bytes, or does not resolve to a RACE record, this stops rather than
# writing a table built on a subrecord that means something else.
# The census counts every NPC_ record read, which is more than the table holds:
# a record overridden by a plugin later in the load order is read once per
# plugin and folded to one afterwards. Both numbers are said out loud so that
# the two lines below cannot be read as disagreeing with each other.
if ($rnamPresent -ne $npcCount) {
    Bad ("RNAM is on {0} of the {1} NPC_ records read; the race cannot be read off the ones without it" -f $rnamPresent, $npcCount)
} else {
    Ok ("RNAM is on every one of the {0} NPC_ records read, which is {1} distinct records and {2} overrides of them" -f `
        $npcCount, $npcs.Count, ($npcCount - $npcs.Count))
}
if ($rnamFourBytes -ne $rnamPresent) {
    Bad ("{0} RNAM subrecords are not four bytes, so they are not a form id" -f ($rnamPresent - $rnamFourBytes))
} else {
    Ok 'every RNAM is four bytes, which is a form id'
}
if ($rnamTwice -gt 0) {
    Bad ("{0} records carry RNAM more than once, so which one is the race is not decided" -f $rnamTwice)
} else {
    Ok 'no record carries RNAM twice'
}
$rnamToRace = 0
$rnamToNothing = New-Object 'System.Collections.Generic.List[string]'
$cnamToRace = 0
foreach ($d in $npcs.Keys) {
    if ($races.Contains([string]$npcs[$d].Rnam)) { $rnamToRace++ }
    else { $rnamToNothing.Add([string]$npcs[$d].Edid + ' -> ' + [string]$npcs[$d].Rnam) }
    if ($races.Contains([string]$npcs[$d].Cnam)) { $cnamToRace++ }
}
if ($rnamToNothing.Count -gt 0) {
    Bad ("{0} RNAM form ids name no RACE record in this build, first few: {1}" -f `
        $rnamToNothing.Count, (($rnamToNothing | Select-Object -First 5) -join ', '))
} else {
    Ok ("all {0} of the distinct ones resolve to a RACE record, out of {1} races in the build" -f $rnamToRace, $races.Count)
}
# The other four byte subrecords on every NPC, so that the choice of RNAM is
# something this run rules out the alternatives for rather than asserts.
Note ("CNAM is on {0} of the records read and names a RACE record {1} times, so it is the class and not the race" -f $cnamPresent, $cnamToRace)
Note ("NAM6 read as a float runs {0} to {1} and NAM7 runs {2} to {3}, which is height and weight, not form ids" -f `
    $nam6Min, $nam6Max, $nam7Min, $nam7Max)
Note ("NAM8 runs {0} to {1}, a small number rather than a form id" -f $nam8Min, $nam8Max)

# --------------------------------------------------- which races are animals -

Write-Host ''
Write-Host 'animals and people' -ForegroundColor Cyan
# A race is an animal when its KWDA carries the animal keyword, and a person
# when it carries the person keyword. The header has the case for reading it
# off the race rather than off the NPC, and the check below is the one that
# would catch the day a mod puts both on one race and the split stops being a
# split.
$animalRaces = @{}
$personRaces = @{}
$bothRaces   = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $races.Keys) {
    $r = $races[$d]
    $isAnimal = $false
    $isPerson = $false
    foreach ($k in $r.Kwda) {
        if (-not $kywds.ContainsKey($k)) { continue }
        if ($kywds[$k] -eq $ANIMAL_KEYWORD) { $isAnimal = $true }
        if ($kywds[$k] -eq $PERSON_KEYWORD) { $isPerson = $true }
    }
    if ($isAnimal) { $animalRaces[$d] = $r }
    if ($isPerson) { $personRaces[$d] = $r }
    if ($isAnimal -and $isPerson) { $bothRaces.Add($r.Edid) }
}
if ($animalRaces.Count -eq 0) {
    Bad ("no race in this build carries {0}, so the rule that says who may be skinned found nothing" -f $ANIMAL_KEYWORD)
} else {
    Ok ("{0} races carry {1} and {2} carry {3}" -f $animalRaces.Count, $ANIMAL_KEYWORD, $personRaces.Count, $PERSON_KEYWORD)
}
if ($bothRaces.Count -gt 0) {
    Bad ("{0} race(s) carry both keywords, so the split is not a split: {1}" -f $bothRaces.Count, ($bothRaces -join ', '))
} else {
    Ok 'no race carries both, so nothing is an animal and a person at once'
}

# --------------------------------------------------- the traits of each NPC --

# The race and the death item, followed through the template while the Use
# Traits bit is set, and through an LVLN to every leaf in it. What comes back
# is a set rather than one answer, because an LVLN really can be several
# animals and the server cannot know which one a spawn became.
#
# The two travel TOGETHER, as pairs, rather than as two lists that happen to be
# the same length. They have to: LvlBearAll is a bear or a cave bear, and a
# pair keeps 'the bear's race' with 'the bear's death item' so that the row
# which takes the cheaper body also takes that body's name. Kept apart, the
# table would be free to call a cave bear a bear and hand over a bear's pelt,
# which is two different animals in one row.
$traitCache = @{}
function Traits-Of([string]$desc, [int]$depth) {
    if ($depth -gt 10) { return @{ Pairs = @{} } }
    if ($traitCache.ContainsKey($desc)) { return $traitCache[$desc] }
    $pairs = @{}
    if ($npcs.Contains($desc)) {
        $n = $npcs[$desc]
        $useTraits = (([int]$n.TemplateFlags) -band $USE_TRAITS_BIT) -ne 0
        if ($useTraits -and [string]$n.Tplt) {
            $sub = Traits-Of ([string]$n.Tplt) ($depth + 1)
            foreach ($k in $sub.Pairs.Keys) { $pairs[$k] = $sub.Pairs[$k] }
        } elseif ([string]$n.Rnam) {
            $pairs[([string]$n.Rnam + '|' + [string]$n.Inam)] = @{ Race = [string]$n.Rnam; Item = [string]$n.Inam }
        }
    } elseif ($lvln.ContainsKey($desc)) {
        foreach ($e in $lvln[$desc].Entries) {
            if ([string]$e.Desc -eq $desc) { continue }
            $sub = Traits-Of ([string]$e.Desc) ($depth + 1)
            foreach ($k in $sub.Pairs.Keys) { $pairs[$k] = $sub.Pairs[$k] }
        }
    }
    $res = @{ Pairs = $pairs }
    # the last hop is not cached, because a chain cut short by the depth limit
    # would otherwise be remembered as the whole answer
    if ($depth -lt 9) { $traitCache[$desc] = $res }
    return $res
}

# THE NAME, FOLLOWED THROUGH THE TEMPLATE THE WAY THE GAME FOLLOWS IT.
#
# Added 20 September, after the table was found calling chickens rabbits. The
# name used to be the NPC record's own FULL and then, if it had none, the RACE
# record's FULL. Both of those are read here; the hop between them was missing.
#
# WHAT IT COST, read out of the records rather than off a wiki:
# SnowShodFarmChicken (fa6d9:Skyrim.esm) has no FULL of its own, template flags
# 0x1f9f, which has 0x0080 set, and TPLT 0a91a0, EncChicken, whose FULL is
# 'Chicken'. dunTransmogrifyChicken (10929f:Skyrim.esm) is the same at 0x1fbf.
# Vanilla ChickenRace (a919d:Skyrim.esm) carries a FULL of its own and that FULL
# is the string 'Rabbit', which was read out of Skyrim.esm and the string table
# in Skyrim - Interface.bsa. So the race fallback answered for both records and
# the built table said 'Rabbit', along with GraniteHillChicken
# (e0c0:aaaGraniteHill.esp) and ZWJ_Polymorph17_Chicken
# (ea865:ZIA_Complete Pack.esp). A hunter over a dead farm chicken read 'You take
# 1 Chicken Breast off the Rabbit.' The nameless check further down never caught
# it, because the race did supply a name; it only catches a row with no name
# anywhere.
#
# The walk is the base data bit's own and is separate from the traits walk above,
# because they are separate bits that happen to point at the same TPLT: a record
# may take its race and death item from a template and keep its own name, or keep
# its own race and take the name. Each is followed on its own bit.
#
# AN LVLN ONLY ANSWERS WHEN ITS LEAVES AGREE. A template can be a levelled list
# of NPCs, and what the spawn became is not knowable here, so a list whose leaves
# are called two different things gives no name at all and the record falls
# through to its own FULL and then to the race, which is the same 'the least this
# can be' rule the yield is picked under. A list of chickens still answers
# 'Chicken'.
$nameCache = @{}
function Name-Of([string]$desc, [int]$depth) {
    if ($depth -gt 10) { return '' }
    if ($nameCache.ContainsKey($desc)) { return $nameCache[$desc] }
    $answer = ''
    if ($npcs.Contains($desc)) {
        $n = $npcs[$desc]
        $useBaseData = (([int]$n.TemplateFlags) -band $USE_BASE_DATA_BIT) -ne 0
        if ($useBaseData -and [string]$n.Tplt) {
            $answer = [string](Name-Of ([string]$n.Tplt) ($depth + 1))
        }
        # its own name only if it has one. FullFrom says 'the editor id' for the
        # records that have no FULL at all, and an editor id is not a name.
        if (-not $answer -and [string]$n.FullFrom -ne 'the editor id') {
            $answer = [string]$n.Full
        }
    } elseif ($lvln.ContainsKey($desc)) {
        $leaves = @{}
        foreach ($e in $lvln[$desc].Entries) {
            if ([string]$e.Desc -eq $desc) { continue }
            $leaf = [string](Name-Of ([string]$e.Desc) ($depth + 1))
            if ($leaf) { $leaves[$leaf] = $true }
        }
        if ($leaves.Count -eq 1) {
            foreach ($k in $leaves.Keys) { $answer = [string]$k }
        }
    }
    # the last hop is not cached, for the reason the traits walk above says
    if ($depth -lt 9) { $nameCache[$desc] = $answer }
    return $answer
}

$animals = New-Object System.Collections.Specialized.OrderedDictionary
$mixed   = New-Object 'System.Collections.Generic.List[object]'
$naiveAnimals = 0
$naiveWrong   = 0
foreach ($d in $npcs.Keys) {
    $t = Traits-Of ([string]$d) 0
    $isAnimal = $false
    $isOther  = $false
    foreach ($k in $t.Pairs.Keys) {
        if ($animalRaces.ContainsKey([string]$t.Pairs[$k].Race)) { $isAnimal = $true } else { $isOther = $true }
    }
    # the naive read, kept only so the run can say how wrong it would have been
    if ($animalRaces.ContainsKey([string]$npcs[$d].Rnam)) {
        $naiveAnimals++
        if (-not $isAnimal -or $isOther) { $naiveWrong++ }
    }
    if (-not $isAnimal) { continue }
    if ($isOther) {
        $mixed.Add([pscustomobject]@{ Desc = $d; Edid = $npcs[$d].Edid })
        continue
    }
    $pairs = New-Object 'System.Collections.Generic.List[object]'
    foreach ($k in ($t.Pairs.Keys | Sort-Object)) { $pairs.Add($t.Pairs[$k]) }
    $animals[$d] = [pscustomobject]@{ Desc = $d; Npc = $npcs[$d]; Pairs = $pairs.ToArray() }
}
Ok ("{0} NPC_ records are animals once the traits chain is followed" -f $animals.Count)
Note ("reading RNAM straight off the record would have called {0} of them animals, {1} of which are not" -f $naiveAnimals, $naiveWrong)
if ($mixed.Count -gt 0) {
    Note ("{0} more draw their traits from a list that mixes animals with something else, so what they are cannot be known before they spawn:" -f $mixed.Count)
    foreach ($m in $mixed) { Note ('  ' + $m.Edid + '  ' + $m.Desc) }
}

# ------------------------------------------------- not a body to dress ------

Write-Host ''
Write-Host 'not a body to dress' -ForegroundColor Cyan
# The rules over NOT A BODY TO DRESS at the top. Each mark is read where the
# game reads it: the Summonable flag through Use Base Data, the scripts through
# Use Script, the spell list through Use Spell List, the death item and the
# race off the traits pairs the table already follows. A base whose template is
# an LVLN is marked only when every NPC the list can be carries the mark, so a
# list that is partly real animals keeps its row for them, the same least-of
# rule the yield is picked under.

# The NPC records the game reads one tab of a base off: the record itself while
# that tab's template bit is clear, the template while it is set, and every NPC
# in it when the template is an LVLN.
$leafCache = @{}
function Leaves-Through([string]$desc, [int]$bit, [int]$depth) {
    if ($depth -gt 10) { return ,@() }
    $key = [string]$bit + '|' + $desc
    if ($leafCache.ContainsKey($key)) { return ,$leafCache[$key] }
    $out = New-Object 'System.Collections.Generic.List[string]'
    if ($npcs.Contains($desc)) {
        $n = $npcs[$desc]
        if (((([int]$n.TemplateFlags) -band $bit) -ne 0) -and [string]$n.Tplt) {
            foreach ($x in (Leaves-Through ([string]$n.Tplt) $bit ($depth + 1))) { if (-not $out.Contains($x)) { $out.Add($x) } }
        } else {
            $out.Add($desc)
        }
    } elseif ($lvln.ContainsKey($desc)) {
        foreach ($e in $lvln[$desc].Entries) {
            if ([string]$e.Desc -eq $desc) { continue }
            foreach ($x in (Leaves-Through ([string]$e.Desc) $bit ($depth + 1))) { if (-not $out.Contains($x)) { $out.Add($x) } }
        }
    }
    $arr = $out.ToArray()
    # the last hop is not cached, for the reason the traits walk says
    if ($depth -lt 9) { $leafCache[$key] = $arr }
    return ,$arr
}

# the names the knobs use, found in this load order. A name that is not here
# fails the run rather than quietly marking nothing.
$ghostSpellDescs = @{}
foreach ($e in $GHOST_SPELLS) {
    $hit = @($spels.Keys | Where-Object { [string]$spels[$_] -eq $e })
    if ($hit.Count -eq 0) { Bad ("{0} is named in GHOST_SPELLS and no SPEL record in this build carries that editor id" -f $e) }
    foreach ($h in $hit) { $ghostSpellDescs[[string]$h] = $e }
}
$ghostItem = @($lvli.Keys | Where-Object { [string]$lvli[$_].Edid -eq $GHOST_DEATH_ITEM })
if ($ghostItem.Count -ne 1) { Bad ("{0} is GHOST_DEATH_ITEM and {1} levelled lists in this build carry that editor id, not one" -f $GHOST_DEATH_ITEM, $ghostItem.Count) }
$spiritRaceDescs = @{}
foreach ($e in $SPIRIT_RACES.Keys) {
    $hit = @($races.Keys | Where-Object { [string]$races[$_].Edid -eq $e })
    if ($hit.Count -eq 0) { Bad ("{0} is named in SPIRIT_RACES and no RACE record in this build carries that editor id" -f $e) }
    foreach ($h in $hit) { $spiritRaceDescs[[string]$h] = $e }
}
foreach ($k in $LEFT_OUT.Keys) {
    if (-not $animals.Contains($k)) { Bad ("{0} is named in LEFT_OUT and is not an animal in this build" -f $k) }
}

$vmadCache = @{}
function Scripts-Of([string]$desc) {
    if ($vmadCache.ContainsKey($desc)) { return ,$vmadCache[$desc] }
    $names = @()
    if ($null -ne $npcs[$desc].Vmad) {
        try { $names = Read-VmadScripts $npcs[$desc].Vmad }
        catch { Bad ("the scripts on {0} ({1}) could not be read, so whether it is a spirit is not known: {2}" -f $desc, $npcs[$desc].Edid, $_.Exception.Message) }
    }
    $vmadCache[$desc] = $names
    return ,$names
}
function All-Leaves([string]$desc, [int]$bit, [scriptblock]$test) {
    $leaves = Leaves-Through $desc $bit 0
    if ($leaves.Count -eq 0) { return $false }
    foreach ($l in $leaves) { if (-not (& $test $l)) { return $false } }
    return $true
}

$notABody = New-Object System.Collections.Specialized.OrderedDictionary
$byRule = [ordered]@{ 'LEFT_OUT' = 0; 'SUMMONABLE_BIT' = 0; 'GHOST_BIT' = 0; 'GHOST_SCRIPT' = 0; 'GHOST_SPELLS' = 0; 'GHOST_DEATH_ITEM' = 0; 'SPIRIT_RACES' = 0 }
foreach ($d in $animals.Keys) {
    $a = $animals[$d]
    $why = New-Object 'System.Collections.Generic.List[string]'
    if ($LEFT_OUT.Contains([string]$d)) {
        $why.Add([string]$LEFT_OUT[[string]$d]); $byRule['LEFT_OUT']++
    }
    if (All-Leaves $d $USE_BASE_DATA_BIT { param($l) ([uint32]$npcs[$l].Flags -band $SUMMONABLE_BIT) -ne 0 }) {
        $why.Add('it is Summonable (ACBS flag 0x4000, read through Use Base Data): a spell brings it and takes it away, so it never lies as a carcass'); $byRule['SUMMONABLE_BIT']++
    }
    if (([uint32]$a.Npc.Flags -band $GHOST_BIT) -ne 0) {
        $why.Add('it is a ghost (ACBS flag 0x20000000, Is Ghost): nothing can strike it, so it never lies as a carcass'); $byRule['GHOST_BIT']++
    }
    if (All-Leaves $d $USE_SCRIPT_BIT { param($l) (Scripts-Of $l) -contains $GHOST_SCRIPT }) {
        $why.Add('it carries ' + $GHOST_SCRIPT + ' (read through Use Script), the script the game gives its spirits'); $byRule['GHOST_SCRIPT']++
    }
    if (All-Leaves $d $USE_SPELL_LIST_BIT { param($l) @($npcs[$l].Splo | Where-Object { $ghostSpellDescs.ContainsKey([string]$_) }).Count -gt 0 }) {
        $why.Add('its spell list (read through Use Spell List) carries a ghost ability, which the game gives its spirits'); $byRule['GHOST_SPELLS']++
    }
    if ($ghostItem.Count -eq 1 -and @($a.Pairs | Where-Object { [string]$_.Item -ne [string]$ghostItem[0] }).Count -eq 0) {
        $why.Add('its death item is ' + $GHOST_DEATH_ITEM + ', the ectoplasm a spirit leaves, not an animal''s parts'); $byRule['GHOST_DEATH_ITEM']++
    }
    if (@($a.Pairs | Where-Object { -not $spiritRaceDescs.ContainsKey([string]$_.Race) }).Count -eq 0) {
        $r = [string]$spiritRaceDescs[[string]$a.Pairs[0].Race]
        $why.Add('its race is ' + $r + ', ' + [string]$SPIRIT_RACES[$r]); $byRule['SPIRIT_RACES']++
    }
    if ($why.Count -gt 0) { $notABody[$d] = ($why -join '; ') }
}
Ok ("{0} of the animals are not a body to dress, and are left out and listed under skipped" -f $notABody.Count)
foreach ($r in $byRule.Keys) { Note ("{0,-17} {1}" -f $r, $byRule[$r]) }
foreach ($d in $notABody.Keys) { Note ("  {0,-40} {1}" -f $animals[$d].Npc.Edid, $d) }

# ------------------------------------------------------------- the yield ----

Write-Host ''
Write-Host 'what a body gives' -ForegroundColor Cyan
# The certain yield of a levelled list: the items in it, following a sublist
# only while that sublist's chance of nothing is zero. The case for it, and
# what it throws out, is in the header. The count on an entry multiplies
# through, so two of a list that holds one item is two of that item.
$droppedLists = @{}
function Certain-Yield([string]$desc, [int]$mult, $acc, $seen, [int]$depth) {
    if ($depth -gt 8) { return }
    if (-not $lvli.ContainsKey($desc)) {
        if (-not $acc.ContainsKey($desc)) { $acc[$desc] = 0 }
        if ($mult -gt $acc[$desc]) { $acc[$desc] = $mult }
        return
    }
    if ($seen.ContainsKey($desc)) { return }
    $seen[$desc] = $true
    foreach ($e in $lvli[$desc].Entries) {
        $sub = [string]$e.Desc
        $cnt = [int]$e.Count
        if ($cnt -lt 1) { $cnt = 1 }
        if ($lvli.ContainsKey($sub) -and [int]$lvli[$sub].ChanceNone -ne 0) {
            $script:droppedLists[$sub] = $lvli[$sub]
            continue
        }
        Certain-Yield $sub ($mult * $cnt) $acc $seen ($depth + 1)
    }
    $seen.Remove($desc)
}

# every death item any animal in the build points at, resolved once
$deathItems = @{}
foreach ($d in $animals.Keys) {
    foreach ($p in $animals[$d].Pairs) { if ([string]$p.Item) { $deathItems[[string]$p.Item] = $true } }
}
Ok ("{0} distinct death items across the animals" -f $deathItems.Count)

$yieldOf = @{}
$unpriced = New-Object 'System.Collections.Generic.List[string]'
$unresolved = New-Object 'System.Collections.Generic.List[string]'
foreach ($i in ($deathItems.Keys | Sort-Object)) {
    $acc = @{}
    Certain-Yield $i 1 $acc (@{}) 0
    $gives = New-Object 'System.Collections.Generic.List[object]'
    $best = [long]0
    foreach ($k in ($acc.Keys | Sort-Object)) {
        if (-not $items.ContainsKey($k)) {
            $unresolved.Add(($k + ', named by ' + $(if ($lvli.ContainsKey($i)) { $lvli[$i].Edid } else { $i })))
            continue
        }
        $it = $items[$k]
        if (-not $VALUE_RULES.ContainsKey([string]$it.Type)) {
            $unpriced.Add(($it.Full + ' is a ' + $it.Type + ' and nothing here knows where the price sits in one'))
            continue
        }
        if ([long]$it.Value -lt 0) {
            $unpriced.Add(($it.Full + ' is a ' + $it.Type + ' with no readable price'))
            continue
        }
        if ([long]$it.Value -gt $best) { $best = [long]$it.Value }
        $gives.Add([pscustomobject]@{ Desc = $k; Name = $it.Full; Type = $it.Type; Value = [long]$it.Value; Count = [int]$acc[$k] })
    }
    $yieldOf[$i] = [pscustomobject]@{
        Desc  = $i
        Edid  = $(if ($lvli.ContainsKey($i)) { $lvli[$i].Edid } else { '' })
        Gives = $gives.ToArray()
        Best  = $best
    }
}
if ($unresolved.Count -gt 0) {
    Bad ("{0} thing(s) a death item names are in no record in this build: {1}" -f $unresolved.Count, ($unresolved -join '; '))
} else {
    Ok 'every item a death item can give resolves to a record in this build'
}
if ($unpriced.Count -gt 0) {
    Bad ("{0} thing(s) a body gives have no readable price, so nothing ranks the animals that give them: {1}" -f `
        $unpriced.Count, ($unpriced -join '; '))
} else {
    Ok 'every one of them has a price in its own record'
}

Write-Host ''
Write-Host ("  {0,-34} {1,5}  {2}" -f 'the death item', 'best', 'what the body gives for certain')
foreach ($i in ($yieldOf.Keys | Sort-Object { -$yieldOf[$_].Best })) {
    $y = $yieldOf[$i]
    $parts = New-Object 'System.Collections.Generic.List[string]'
    foreach ($g in $y.Gives) { $parts.Add(('x' + $g.Count + ' ' + $g.Name + ' ' + $g.Value + 'g')) }
    Write-Host ("  {0,-34} {1,4}g  {2}" -f $y.Edid, $y.Best, ($parts -join ' + '))
}
Write-Host ''
if ($droppedLists.Count -gt 0) {
    Note ("{0} sublist(s) under a death item were left out because they may give nothing at all:" -f $droppedLists.Count)
    foreach ($k in ($droppedLists.Keys | Sort-Object { $droppedLists[$_].Edid })) {
        Note ("  {0,-38} gives nothing {1}% of the time" -f $droppedLists[$k].Edid, $droppedLists[$k].ChanceNone)
    }
}
# The whole list of what got through, printed every run. This is the check that
# says the certain yield rule is still picking bodies and not treasure: if a
# coin, a gem, a ring or a soul gem ever turns up in here, the rule has stopped
# working and the table is about to rank a horse by somebody's ruby.
$kept = @{}
foreach ($i in $yieldOf.Keys) {
    foreach ($g in $yieldOf[$i].Gives) { $kept[$g.Desc] = $g }
}
Note ("{0} distinct things come off a body, and every one of them should be a part of one:" -f $kept.Count)
foreach ($k in ($kept.Keys | Sort-Object { $kept[$_].Name })) {
    Note ("  {0,-34} {1,5}g  {2}" -f $kept[$k].Name, $kept[$k].Value, $kept[$k].Type)
}

# ------------------------------------------------------------- the ranking --

Write-Host ''
Write-Host 'the rank' -ForegroundColor Cyan
$table   = New-Object System.Collections.Specialized.OrderedDictionary
$detail  = New-Object System.Collections.Specialized.OrderedDictionary
$skipped = New-Object 'System.Collections.Generic.List[object]'
$several = 0
# bases that can spawn something whose death item gives nothing for certain, and
# something else that does. The pick is the cheapest of the ones that do, and
# this counts how often that rule is what kept the base in the table at all.
$partlyCertain = 0

$namedByRace = 0
$namedByTemplate = 0
$namedByEdid = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $animals.Keys) {
    $a = $animals[$d]
    if ($creation.ContainsKey([string]$d)) {
        $skipped.Add([pscustomobject]@{ Desc = $d; Edid = $a.Npc.Edid; Why = 'a Creation Club creature: every Special Edition has the record, but its art comes with the Creation Club files Thornswood leaves out' })
        continue
    }
    # not a body to dress (#1808): the rules and their counts are above
    if ($notABody.Contains([string]$d)) {
        $skipped.Add([pscustomobject]@{ Desc = $d; Edid = $a.Npc.Edid; Why = [string]$notABody[[string]$d] })
        continue
    }
    $withItem = @($a.Pairs | Where-Object { [string]$_.Item -and $yieldOf.ContainsKey([string]$_.Item) })
    if ($withItem.Count -eq 0) {
        $skipped.Add([pscustomobject]@{ Desc = $d; Edid = $a.Npc.Edid; Why = 'nothing in its traits chain names a death item, so its body gives nothing' })
        continue
    }
    # The least of what this base can be. The case is in the header: the rank
    # must not lock a hunter out of the commonest animals in Skyrim on the
    # chance a levelled spawn rolled a bear, and the produce must not promise a
    # bear pelt off a wolf. The race comes off the same pair as the body, so the
    # row is one animal throughout rather than one animal's name over another's
    # pelt.
    #
    # THE LEAST OF WHAT IT CAN BE, AMONG THE BODIES THAT GIVE ANYTHING AT ALL.
    # Corrected 20 September. Best is the gold value of the best thing a death
    # item gives FOR CERTAIN, so a death item that is nothing but chance sublists
    # has a Best of 0, and 0 wins a cheapest-of test against every real animal in
    # the list. The base was then thrown out by the emptiness test below, which is
    # the whole base gone because one leaf of it gives nothing.
    #
    # Measured in the run before this change: DLC2LvlAnimalForestPredator
    # (3a9c2:Dragonborn.esm) templates from LVLN DLC2LCharAnimalForestPredator,
    # 26 leaves, of which 8 are cave bears at 60g, 5 are bears at 50g and 5 are
    # wolves, and 4 are DLC2EncBoarWild, whose DLC2DeathItemBoar gives nothing for
    # certain. The boar won the pick at 0g and hunts.json skipped the base, so
    # every bear, cave bear and wolf spawned from it in the Solstheim woods was
    # not in the table, isCarcass answered false and a hunter standing over one
    # got no yield, no refusal and no message at all.
    #
    # So a leaf with no certain yield is not a candidate for the pick. It stays in
    # couldAlsoBe, because it is still one of the things this base can spawn and
    # the row's rank is deliberately the least of the rest. A base ALL of whose
    # leaves give nothing for certain is still skipped, and the reason now names
    # every one of them rather than the cheapest.
    $pick = $null
    $pickRace = ''
    $couldBe = New-Object 'System.Collections.Generic.List[string]'
    $noCertainYield = New-Object 'System.Collections.Generic.List[string]'
    foreach ($p in $withItem) {
        $y = $yieldOf[[string]$p.Item]
        $couldBe.Add($y.Edid)
        if ($y.Gives.Count -eq 0) {
            $noCertainYield.Add($(if ([string]$y.Edid) { [string]$y.Edid } else { [string]$y.Desc }))
            continue
        }
        if ($null -eq $pick -or $y.Best -lt $pick.Best) { $pick = $y; $pickRace = [string]$p.Race }
    }
    if ($null -eq $pick) {
        $named = (($noCertainYield | Sort-Object -Unique) -join ', ')
        $why = 'every death item its traits chain can spawn (' + $named + ') is nothing but sublists that may each give nothing, so there is nothing the body gives for certain'
        $skipped.Add([pscustomobject]@{ Desc = $d; Edid = $a.Npc.Edid; Why = $why })
        continue
    }
    if ($noCertainYield.Count -gt 0) { $partlyCertain++ }
    if ($withItem.Count -gt 1) { $several++ }

    # THE NAME A PERSON READS. The NPC record's own FULL first, because a named
    # animal has one and Barbas and Karinda should be called what they are
    # called. 199 of the 361 animals in this build have no FULL at all, and
    # those are not obscure: EncWolf, EncBanditWolf_Indoor, WhiterunPlayerHorse
    # and MQ101FrostbiteSpider are what is standing in the world. Falling back
    # to the editor id the way the harvest table does would put
    # 'dunBloodletThrone_LvlWolf' in front of somebody, so the fallback is the
    # RACE record's own FULL, which is read out of a record like everything else
    # here and reads Wolf, Horse, Frostbite Spider, Deer. Only if the race has no
    # name either does the editor id show up, and that is counted and reported.
    #
    # THE TEMPLATE COMES BETWEEN THOSE TWO, and it did not until 20 September.
    # Name-Of above follows TPLT while the Use Base Data bit is set, which is
    # what the game does and what the record means, and it answers before the
    # race so that a templated chicken is called a Chicken rather than whatever
    # its race record happens to be called. The case, and the four rows it was
    # measured on, are written over Name-Of.
    $name = [string]$a.Npc.Full
    $nameFrom = [string]$a.Npc.FullFrom
    $throughTemplate = [string](Name-Of ([string]$d) 0)
    if ($throughTemplate -and ($throughTemplate -cne [string]$a.Npc.Full -or $nameFrom -eq 'the editor id')) {
        $name = $throughTemplate
        $nameFrom = 'the record its Use Base Data bit points at, which is where the game reads this one'
        $namedByTemplate++
    } elseif ($nameFrom -eq 'the editor id' -and $animalRaces.ContainsKey($pickRace) -and [string]$animalRaces[$pickRace].Full) {
        $name = [string]$animalRaces[$pickRace].Full
        $nameFrom = 'the race record, because neither the NPC record nor its template chain has a name of its own'
        $namedByRace++
    }
    if ($nameFrom -eq 'the editor id') { $namedByEdid.Add([string]$a.Npc.Edid) }

    $rank = Rank-For $pick.Best
    $table[$d] = [pscustomobject]@{
        Name  = $name
        Rank  = $rank
        Yield = (Yield-For $rank)
        Gives = $pick.Gives
    }
    $detail[$d] = [ordered]@{
        editorId   = $a.Npc.Edid
        name       = $name
        nameFrom   = $nameFrom
        plugin     = ([string]$d).Substring(([string]$d).IndexOf(':') + 1)
        definedIn  = $a.Npc.SeenIn
        race       = $(if ($animalRaces.ContainsKey($pickRace)) { $animalRaces[$pickRace].Edid } else { $pickRace })
        deathItem  = $pick.Desc
        deathEdid  = $pick.Edid
        bestValue  = [long]$pick.Best
        rank       = $rank
        couldAlsoBe = (($couldBe | Where-Object { $_ -ne $pick.Edid } | Sort-Object -Unique) -join ', ')
        readFrom   = 'the race at the end of the traits chain, and the INAM that came with it'
    }
}

Ok ("{0} animals in the table, {1} left out and listed" -f $table.Count, $skipped.Count)
if ($several -gt 0) {
    Note ("{0} of them take their traits from a levelled list and could be one of several bodies; each row is the least of what it can be" -f $several)
}
if ($partlyCertain -gt 0) {
    Note ("{0} of those lists can also spawn a body whose death item gives nothing for certain; the row is the least of the ones that do give something, and before 20 September every one of these bases was dropped from the table altogether" -f $partlyCertain)
}
Note ("{0} of them are called what the record their Use Base Data bit points at is called, which is the name the game shows over them" -f $namedByTemplate)
Note ("{0} of them have no name of their own or in their template chain and are called what their race record calls them" -f $namedByRace)
if ($skipped.Count -gt 0) {
    foreach ($s in $skipped) { Note ("  left out: {0,-40} {1}" -f $s.Edid, $s.Why) }
}

# the whole spread, so the bands above can be moved against real numbers
$values = @{}
foreach ($d in $table.Keys) {
    $v = [long]$detail[$d].bestValue
    if (-not $values.ContainsKey($v)) { $values[$v] = 0 }
    $values[$v] = $values[$v] + 1
}
$spreadLine = New-Object 'System.Collections.Generic.List[string]'
foreach ($v in ($values.Keys | Sort-Object)) { $spreadLine.Add(("{0}g x{1}" -f $v, $values[$v])) }
Note ('the whole spread of what a body is worth: ' + ($spreadLine -join ', '))

$perRank = New-Object System.Collections.Specialized.OrderedDictionary
foreach ($r in $RANK_ORDER) { $perRank[$r] = 0 }
foreach ($d in $table.Keys) { $perRank[[string]$table[$d].Rank] = $perRank[[string]$table[$d].Rank] + 1 }
Write-Host ''
foreach ($band in $RANK_BANDS) {
    $upTo = 'anything above the band before it'
    if ([long]$band.UpTo -ne [long][int]::MaxValue) { $upTo = 'up to ' + $band.UpTo + 'g' }
    Note ("{0,-9} {1,-34} {2} animal(s)" -f $band.Rank, $upTo, $perRank[[string]$band.Rank])
}

# a named sample, so a run can be read rather than taken on trust
Write-Host ''
Note 'twenty of them by name, spread across the table:'
$keys = @($table.Keys)
$step = [int]([Math]::Max(1, [Math]::Floor($keys.Count / 20)))
$shown = 0
for ($i = 0; $i -lt $keys.Count -and $shown -lt 20; $i += $step) {
    $d = $keys[$i]
    $g = $table[$d].Gives
    $what = New-Object 'System.Collections.Generic.List[string]'
    foreach ($x in $g) { $what.Add($x.Name) }
    Note ("  {0,-42} {1,-22} {2,-9} {3}" -f $detail[$d].editorId, $table[$d].Name, $table[$d].Rank, ($what -join ', '))
    $shown++
}

# ------------------------------------------------------------- the checks ---

Write-Host ''
Write-Host 'checks' -ForegroundColor Cyan

if ($table.Count -eq 0) { Bad 'no animals at all, so there is nothing to write' }
else { Ok ("{0} animals in the table" -f $table.Count) }

# duplicates: an OrderedDictionary cannot hold one key twice, so this is really
# a check that nothing built a key two different ways
$seen = @{}
$dupes = 0
foreach ($d in $table.Keys) {
    if ($seen.ContainsKey([string]$d)) { Bad ("{0} is in the table twice" -f $d); $dupes++ }
    $seen[[string]$d] = $true
}
if ($dupes -eq 0) { Ok 'no animal is in the table twice' }

# the ids: hex digits and a plugin named, on the base and on everything it
# gives. Four hex digits is a real length here, not a fault: gamemode.js
# already carries 9456:PlayFluteLuteDrum.esp.
$shape = '^[0-9a-f]{1,8}:[^:]+\.es[mpl]$'
$odd = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $table.Keys) {
    if ([string]$d -cnotmatch $shape) { $odd.Add(("the animal {0}" -f $d)) }
    foreach ($g in $table[$d].Gives) {
        if ([string]$g.Desc -cnotmatch $shape) { $odd.Add(("something {0} gives: {1}" -f $d, $g.Desc)) }
    }
}
if ($odd.Count -gt 0) { foreach ($o in $odd) { Bad ("an id that does not look right: {0}" -f $o) } }
else { Ok 'every desc on both sides is hex digits and a plugin' }

# a row with no name is a message that reads 'You take the hide off the .'
$nameless = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $table.Keys) {
    if (-not [string]$table[$d].Name) { $nameless.Add([string]$d) }
    foreach ($g in $table[$d].Gives) { if (-not [string]$g.Name) { $nameless.Add([string]$d + ' gives an unnamed thing') } }
}
if ($nameless.Count -gt 0) { Bad ("{0} entries have nothing to call the animal or what it gives: {1}" -f $nameless.Count, ($nameless -join ', ')) }
else { Ok 'every entry names the animal and everything it gives' }

# and the name has to be a name. An editor id in a row is a refusal that reads
# 'Skinning the dunBloodletThrone_LvlWolf takes an Advanced Hunter', which is
# the same fault the harvest table fails on, and here it would be the common
# case rather than the odd one if the race were not read as well.
if ($namedByEdid.Count -gt 0) {
    Bad ("{0} entries would show an editor id where the animal's name goes, and neither the NPC record nor its race has a name: {1}" -f `
        $namedByEdid.Count, (($namedByEdid | Select-Object -First 10) -join ', '))
} else {
    Ok 'every animal is called something a person can read, out of its own record or its race'
}

# an entry that gives nothing is a hunter standing over a body with a message
# and an empty pack
$empty = @($table.Keys | Where-Object { $table[$_].Gives.Count -eq 0 })
if ($empty.Count -gt 0) { Bad ("{0} entries hand over nothing at all" -f $empty.Count) }
else { Ok 'every entry hands over at least one thing' }

# every rank is one of classes.md's four
$oddRank = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $table.Keys) { if ($RANK_ORDER -notcontains [string]$table[$d].Rank) { $oddRank.Add([string]$d) } }
if ($oddRank.Count -gt 0) { Bad ("{0} entries have a rank that is not one of the four in classes.md" -f $oddRank.Count) }
else { Ok "every rank is one of classes.md's four" }

# THE NOVICE RUNG MUST NOT BE EMPTY. This circle has now bitten this repo twice,
# once in farming and once in gathering, and both times it meant a new character
# could do nothing at all: every source ranked advanced or above means a novice
# has no work to do, and no work means no way to the rank that would let them
# start. A hunter with no body they may touch is not a hunter. This fails the
# run outright rather than reporting it, because a table that ships with an
# empty bottom rung is a class nobody can play.
$noviceAnimals = @($table.Keys | Where-Object { [string]$table[$_].Rank -eq 'novice' })
if ($noviceAnimals.Count -eq 0) {
    Bad 'no animal asks for novice, so a new hunter may touch nothing and can never do the work that earns the next rank'
} else {
    Ok ("{0} animal(s) a novice hunter may work on their first day" -f $noviceAnimals.Count)
}

# and the rungs above it, reported rather than failed: a build may simply have
# no animal in a band, and the thresholds are a knob at the top of this file
$emptyRanks = @($RANK_ORDER | Where-Object { $perRank[$_] -eq 0 })
if ($emptyRanks.Count -gt 0) {
    Note ("no animal lands at: {0}. The thresholds are in the knobs at the top of this file." -f ($emptyRanks -join ', '))
} else {
    Ok 'all four ranks have animals'
}

$fingerAfter = Get-FolderFingerprint $Data
$moved = New-Object 'System.Collections.Generic.List[string]'
if ($fingerAfter.Count -ne $fingerBefore.Count) {
    $moved.Add(("{0} entries before, {1} after" -f $fingerBefore.Count, $fingerAfter.Count))
} else {
    for ($i = 0; $i -lt $fingerBefore.Count; $i++) {
        if ($fingerBefore[$i] -ne $fingerAfter[$i]) { $moved.Add(("{0} -> {1}" -f $fingerBefore[$i], $fingerAfter[$i])) }
    }
}
if ($moved.Count -gt 0) {
    Bad ("the game folder changed while this ran, which it must not: {0}" -f ($moved -join '; '))
} else {
    Ok ("the game folder is untouched: {0} entries, same names, sizes and timestamps before and after" -f $fingerAfter.Count)
}

if ($Population) {
    $populationData = Get-Content -LiteralPath $Population -Raw | ConvertFrom-Json
    $retainedBases = @{}
    foreach ($row in $populationData.npcs) {
        if ($row.keep -and $row.role -eq 'animal') { $retainedBases[[string]$row.base] = $true }
    }
    foreach ($base in @($table.Keys)) {
        if (-not $retainedBases.ContainsKey([string]$base)) { $table.Remove($base) }
    }
    if ($table.Count -eq 0) { throw 'The population policy retained no dressable animal bases' }
    $noviceAnimals = @($table.Keys | Where-Object { $table[$_].Rank -eq 'novice' })
    if ($noviceAnimals.Count -eq 0) { throw 'The retained population has no novice hunting source' }
}

# ------------------------------------------------------------- the writing -

Write-Host ''
Write-Host 'writing' -ForegroundColor Cyan
# The json is written out by hand rather than with ConvertTo-Json, and there is
# no timestamp in it, so that the same game files give byte for byte the same
# file: ConvertTo-Json lays out Windows PowerShell 5.1 and PowerShell 7
# differently, and a rebuild that changed nothing would be a whole-file diff.
# It is joined with LF, as everything this writes is.
$jsonEol = $Eol
function Gives-Json($gives) {
    $parts = New-Object 'System.Collections.Generic.List[string]'
    foreach ($g in $gives) {
        $parts.Add('{ "item": ' + (JsonStr ([string]$g.Desc)) + ', "name": ' + (JsonStr ([string]$g.Name)) +
                   ', "count": ' + [int]$g.Count + ' }')
    }
    return '[' + ($parts -join ', ') + ']'
}

$docLines = New-Object 'System.Collections.Generic.List[string]'
$docLines.Add('{')
$docLines.Add('  "builtBy": ' + (JsonStr 'scripts\dev\Build-HuntTable.ps1') + ',')
$docLines.Add('  "source": ' + (JsonStr ('the winning NPC_ records of ' + $order.Count + ' plugins in the recorded load order')) + ',')
$docLines.Add('  "language": ' + (JsonStr $LANGUAGE) + ',')
$docLines.Add('  "animalsAre": ' + (JsonStr ('an NPC whose race, followed through the template while the Use Traits bit is set, carries the keyword ' +
    $ANIMAL_KEYWORD + '. No race in this build carries that and ' + $PERSON_KEYWORD + ' both. Reading RNAM straight off the record instead would call ' +
    $naiveAnimals + ' records animals, ' + $naiveWrong + ' of which are not.')) + ',')
$docLines.Add('  "yieldIs": ' + (JsonStr ('what the death item list in INAM gives for certain: its items, following a sublist only while that sublist' +
    "'" + 's chance of giving nothing, LVLD, is zero. A sublist with a chance in it is a chance and not a yield, which is what keeps the treasure lists a chest draws from out of the table.')) + ',')
$docLines.Add('  "rankedBy": ' + (JsonStr 'the gold value of the best thing the body gives, the thresholds in RANK_BANDS at the top of the script') + ',')
$docLines.Add('  "yield": ' + (JsonStr ('four pairs, novice first: the least and the most of EACH thing the body gives that a hunter of that rank takes. ' +
    'A pair of zeroes means that rank may not work that body at all. The same shape as the ore table and the salt quarry, which gives randInt(1, 1 + tier).')) + ',')
$docLines.Add('  "ranks": {')
$rn = 0
foreach ($band in $RANK_BANDS) {
    $rn++
    $comma = ','
    if ($rn -eq $RANK_BANDS.Count) { $comma = '' }
    if ([long]$band.UpTo -eq [long][int]::MaxValue) {
        $docLines.Add('    ' + (JsonStr ([string]$band.Rank)) + ': ' + (JsonStr 'anything above the band before it') + $comma)
    } else {
        $docLines.Add('    ' + (JsonStr ([string]$band.Rank)) + ': ' + (JsonStr ('a body whose best part is worth up to ' + $band.UpTo + ' gold')) + $comma)
    }
}
$docLines.Add('  },')
$docLines.Add('  "count": ' + $table.Count + ',')
$docLines.Add('  "hunts": {')
$n = 0
foreach ($d in $table.Keys) {
    $n++
    $comma = ','
    if ($n -eq $table.Count) { $comma = '' }
    $e = $table[$d]
    $docLines.Add('    ' + (JsonStr ([string]$d)) + ': { "name": ' + (JsonStr ([string]$e.Name)) +
                  ', "rank": ' + (JsonStr ([string]$e.Rank)) + ', "yield": ' + $e.Yield +
                  ', "gives": ' + (Gives-Json $e.Gives) + ' }' + $comma)
}
$docLines.Add('  },')
$docLines.Add('  "skipped": [')
$n = 0
foreach ($s in $skipped) {
    $n++
    $comma = ','
    if ($n -eq $skipped.Count) { $comma = '' }
    $docLines.Add('    { "desc": ' + (JsonStr ([string]$s.Desc)) + ', "editorId": ' + (JsonStr ([string]$s.Edid)) +
                  ', "why": ' + (JsonStr ([string]$s.Why)) + ' }' + $comma)
}
$docLines.Add('  ],')
$docLines.Add('  "mixed": [')
$n = 0
foreach ($m in $mixed) {
    $n++
    $comma = ','
    if ($n -eq $mixed.Count) { $comma = '' }
    $docLines.Add('    { "desc": ' + (JsonStr ([string]$m.Desc)) + ', "editorId": ' + (JsonStr ([string]$m.Edid)) +
                  ', "why": ' + (JsonStr 'its traits come from a list that mixes animals with something else, so what it is cannot be known before it spawns') + ' }' + $comma)
}
$docLines.Add('  ],')
$docLines.Add('  "detail": {')
$n = 0
foreach ($d in $detail.Keys) {
    $n++
    $comma = ','
    if ($n -eq $detail.Count) { $comma = '' }
    $v = $detail[$d]
    $docLines.Add('    ' + (JsonStr ([string]$d)) + ': {')
    $fields = New-Object 'System.Collections.Generic.List[string]'
    foreach ($f in $v.Keys) {
        if ($f -eq 'bestValue') { $fields.Add('      "' + $f + '": ' + [long]$v[$f]) }
        else { $fields.Add('      "' + $f + '": ' + (JsonStr ([string]$v[$f]))) }
    }
    $docLines.Add(($fields -join (',' + $jsonEol)))
    $docLines.Add('    }' + $comma)
}
$docLines.Add('  }')
$docLines.Add('}')
$json = ($docLines -join $jsonEol) + $jsonEol

# A run that failed leaves the table it could not rebuild exactly as it was.
# Nothing is written until every check above has passed: pointing -Data at a
# folder that is not there, or at a build with half its plugins missing, must
# not quietly replace a good table with a short one.
if ($fail -gt 0) {
    Bad ("{0} check(s) failed, so {1} was left exactly as it was" -f $fail, $Out)
} else {
    [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
    Ok ("wrote {0} ({1} animals, {2} bytes)" -f $Out, $table.Count, $json.Length)
}

# ----------------------------------------------------------- the literal ---

$lines = New-Object 'System.Collections.Generic.List[string]'
$lines.Add('/* Built by scripts\dev\Build-HuntTable.ps1 out of the NPC_ records of this build.')
$lines.Add('     ' + $table.Count + ' animals, the same table as game\data\hunts.json.')
$lines.Add('     The key is the body''s base record, which is what mp.get(refrId, ''baseDesc'')')
$lines.Add('     hands back for a dead actor. A base that is not in here is not an animal and')
$lines.Add('     the hunter walks past it, the same as everybody else.')
$lines.Add('     gives is what comes off the body, because the pelt and the meat are NOT in the')
$lines.Add('     body''s inventory: they come from a levelled list the client resolves, so the')
$lines.Add('     server hands them over itself. yield is four pairs, novice first: the least and')
$lines.Add('     the most of EACH of those things a hunter of that rank takes, and a pair of')
$lines.Add('     zeroes is a rank that may not work that body at all.')
$lines.Add('     The gamemode reads it from game\gamemode-tables\HUNTS_BY_BASE.json. Do not hand edit. */')
$lines.Add('  var HUNTS_BY_BASE = {')
$n = 0
foreach ($d in $table.Keys) {
    $n++
    $comma = ','
    if ($n -eq $table.Count) { $comma = '' }
    $e = $table[$d]
    # double quoted, the same as the installed block, so what is printed here
    # and what is written into the gamemode are the same text. Plenty of these
    # names carry an apostrophe and a single quoted literal would be one
    # backslash away from broken.
    $lines.Add('    ' + (JsonStr ([string]$d)) + ': { "name": ' + (JsonStr ([string]$e.Name)) +
               ', "rank": ' + (JsonStr ([string]$e.Rank)) + ', "yield": ' + $e.Yield +
               ', "gives": ' + (Gives-Json $e.Gives) + ' }' + $comma)
}
$lines.Add('  };')
$literal = $lines -join [Environment]::NewLine

# ---------------------------------------------------------------- install --
#
# The gamemode reads the table from game\gamemode-tables\HUNTS_BY_BASE.json
# when it loads (#5191): until then this wrote it between markers in
# gamemode.js, and every content change rewrote the same lines there.
# -NoInstall prints it and leaves the file alone.
#
if (-not $NoInstall -and $fail -eq 0) {
    . (Join-Path $PSScriptRoot 'GamemodeTables.ps1')
    $rows = New-Object 'System.Collections.Generic.List[string]'
    foreach ($d in $table.Keys) {
        $e = $table[$d]
        $rows.Add((JsonStr ([string]$d)) + ':{"name":' + (JsonStr ([string]$e.Name)) +
                  ',"rank":' + (JsonStr ([string]$e.Rank)) + ',"yield":' + $e.Yield +
                  ',"gives":' + (Gives-Json $e.Gives) + '}')
    }
    $changed = Write-GamemodeTable 'HUNTS_BY_BASE' ('{' + ($rows -join ',') + '}')
    if ($changed) { Ok ("wrote {0} animals into {1}" -f $table.Count, (Get-GamemodeTableFile 'HUNTS_BY_BASE')) }
    else { Ok ("{0} already holds these {1} animals" -f (Get-GamemodeTableFile 'HUNTS_BY_BASE'), $table.Count) }
}

Write-Host ''
Write-Host 'the same table, as JavaScript (the gamemode reads its file in game\gamemode-tables):' -ForegroundColor Cyan
Write-Host $literal
if ($JsOut) {
    [System.IO.File]::WriteAllText($JsOut, $literal, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ''
    Ok "wrote $JsOut"
}

Write-Host ''
if ($fail) {
    Write-Host "$fail check(s) failed. Read those before the table ships." -ForegroundColor Red
    exit 1
}
Write-Host ("the table is complete: {0} animals, every one with a race read off its own traits chain, a yield read off its death item and a rank read off what that yield is worth." -f $table.Count) -ForegroundColor Green
Write-Host ("the bottom rung is not empty: {0} of them a novice hunter may work." -f $noviceAnimals.Count) -ForegroundColor Green
