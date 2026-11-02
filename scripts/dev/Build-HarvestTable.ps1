<#
  Build-HarvestTable.ps1

  Builds game\data\harvests.json: the table the server needs to say who may pick
  which plant. Nothing in it is typed from memory. It is read out of the
  plugins of this build on this machine.

  WHY THE SERVER CAN DO THIS AT ALL

  SkyMP already picks plants by itself. MpObjectReference::ProcessActivate
  treats a FLOR or TREE base record as pickable: it reads the produce out of
  the record, gives it to whoever activated it, marks the reference harvested
  and schedules its regrowth. The gamemode's mp.onActivate is asked first and
  returning false blocks it. So the gate for gathering is already in place for
  every plant in the game, and the one thing the server lacks is a list of
  which base records are plants and what each one is worth. This builds that
  list.

  WHICH SUBRECORD IS THE PRODUCE, AND HOW THAT WAS PROVED

  It is PFIG, four bytes, a form id. It was not guessed. Every subrecord of
  every FLOR and TREE record in Skyrim.esm was counted first, which gives
  FLOR: EDID OBND FULL MODL MODT MODS PNAM RNAM FNAM PFIG SNAM PFPC
  TREE: EDID OBND MODL MODT PFIG SNAM PFPC FULL CNAM
  Of the four-byte candidates, SNAM is shared by whole families of plants
  (every mushroom in the game carries the same one, so it is the harvest
  sound), RNAM and FULL resolve through the string table to text, PNAM is on
  all 86 FLOR records including the ones that yield nothing, and PFPC is four
  separate bytes reading 100,100,100,100 on plants that yield and 0,0,0,0 on
  the ones that do not, so it is the per-season chance. PFIG is the only one
  left, it is present on exactly the records that yield something (83 of 86
  FLOR, 32 of 154 TREE, and the 32 TREEs with a PFIG are the same 32 with a
  FULL), and resolving it lands on the right item every time:
      TreeFloraMountainFlower01Blue -> MountainFlower01Blue, Blue Mountain Flower
      TreeFloraWheat01              -> Wheat
      TreeFloraTundraCotton01       -> TundraCotton, Tundra Cotton
      FloraMushroom01               -> Mushroom01, Fly Amanita

  WHERE THE GOLD VALUE IS, AND HOW THAT WAS PROVED

  An INGR record carries DATA, eight bytes: the value as a uint32, then the
  weight as a float. Read that way the numbers come out as the prices these
  ingredients actually have (Blue Mountain Flower 2, Nightshade 8, Blisterwort
  12, White Cap 0, Chaurus Eggs 10) and the weights come out as 0.1, 0.2,
  0.25, 0.3 and 0.5, which is what they weigh. The other candidate, the uint32
  at the front of ENIT, reads 23 for a Thistle Branch that sells for 1, so it
  is not a price and is not used. An ALCH record is laid out the other way
  round: DATA is four bytes and is the weight on its own, and the value is the
  uint32 at the front of ENIT (Potato 1, Salmon Meat 3, Cabbage 2).

  WHAT A FARM CROP IS, AND WHY THE SERVER OWNS THE RULE AND NOT THE LOOK

  The second pass writes the farm crop table: the plants somebody works a plot
  of, rather than the ones anybody finds in the wild. It reads the same records
  the same way and sorts them by what was measured in the SkyMP fork at
  C:\Thornswood-Dev\skymp.

  MpObjectReference::Activate fires the gamemode's ActivateEvent first, and
  returning false from mp.onActivate blocks ProcessActivateNormal outright, so
  the server can refuse any pick. That is where a crop rule can live at all.

  MpObjectReference::GetRelootTime hardcodes std::chrono::hours(1) for FLOR and
  TREE, so the engine regrows a picked plant an hour later whatever the server
  thinks of it. That hour is the free endless farming this table exists to stop.

  The gamemode cannot set isHarvested and cannot set a reloot time on one
  reference. Neither is among the bindings in
  skymp5-server/cpp/addon/property_bindings/PropertyBindingFactory.cpp, so
  there is no call to make. The server therefore owns the RULE and the engine
  owns the LOOK: a crop the server still counts as growing is a plant standing
  there looking ready to pick, and all the server can do is refuse the pick and
  say why. That is why the grow times below start at the engine's own hour and
  never go under it: the rule must not call a crop ripe while the model is
  still the picked one. The state of a plot belongs on the reference itself,
  through mp.makeProperty and mp.set, which survives a restart in the world
  save; this script writes none of that and only says which bases are crops.

  A GATHERER GATHERS REAGENTS, AND FOOD IS SOMEBODY ELSE'S

  PATRICK, 21 SEPTEMBER: 'The farmer grows the crops? Those crops should be
  used to make food, why is a gatherer giving them all the food ingredients
  when they gather herbs and things.' And on the shape he wants: 'the farmer
  would supply the cook, gatherer would supply tailor and alchemist, miner
  smith, hunter tailor and smith and so on.'

  He is right and the table said otherwise. Measured in game\data\harvests.json on
  21 September, over the 131 rows of the harvests map, which is the gatherer's
  table: 106 of them produce an INGR, which is an alchemy reagent and is the
  gatherer's work exactly as he describes it. 24 produce an ALCH and 1 a MISC.
  Counted the same day over game\data\recipes.json, the gatherer supplied the Cook
  225 of that profession's inputs and the farmer supplied the Cook none at all,
  and the biggest of them were Butter 46, Leek 12, Potato 8, Cabbage 6, Carrot
  6, Gourd 4, Tomato 4, Ash Yam 4, Red Apple 4, Green Apple 4 and Pheasant
  Breast 4. A cabbage and a hanging pheasant were a gatherer's to pick.

  So the rule this script sorts by is written on the produce and not on the
  plant: A PLANT WHOSE PRODUCE IS AN ALCHEMY REAGENT IS THE GATHERER'S, AND A
  PLANT WHOSE PRODUCE IS FOOD IS NOT. Food is read off the record rather than
  off a list of names. An ALCH record's ENIT is the value in gold as a uint32
  and then a flag word, and bit 0x00000002 of that flag word is the food bit.
  That is proved in the header of scripts\dev\Build-RecipeTable.ps1 against the five
  masters, where the flag word takes exactly five values and every record
  carrying 0x00000002 is something eaten, and this script reads the same
  subrecord the same way rather than inventing a second test. Measured here on
  21 September: all 15 produce records the 24 food rows point at carry the food
  bit, from FoodCabbage to FoodCharredSkeeverMeat.

  WHERE THE FOOD GOES, WHICH IS THE OTHER HALF OF THE RULE

  Taking food off the gatherer says nothing about whose it is, and a row that
  leaves one table and joins none is work that left the game. Every one of the
  24 goes somewhere and the run says which:

    A GROWN CROP IS THE FARMER'S, thirteen rows. Both apple trees and both
    apples again in JK's Whiterun's Outskirts, both carrots, the tomato, the
    ash yam, leek, potato, cabbage and gourd cluster. They join the crops map.

    HANGING GAME IS THE HUNTER'S, seven rows. HangingPheasant01 and 02,
    HangingRabbit01 and 02, the two giant-skewer charred skeevers and
    CharredSkeever03. They join a game map of their own, beside the fish,
    because the hunter's carcass table is built out of NPC_ records and a
    hanging pheasant is a FLOR somebody presses E on rather than an animal
    anybody killed.

    A PROP IS IN NO TABLE HERE, two rows. MammothCheese01 and BYOHButterChurn
    are neither a plant nor an animal, so no pass in this script writes them
    anywhere: they are left out and reported by name every run, the same way
    the planter sacks and the coin purses are. The cheese is nobody's, which is
    what Patrick asked for, and a base in no table falls through to the engine.
    The churn is the farmer's: Patrick, 21 September, "give milk and butter to
    farmers", so churn() in game\gamemode.js answers it with the farm verb as
    of 24 September, and Build-RecipeTable.ps1 reads that verb, so BUTTER, 46 OF
    THE COOK'S INPUTS, is a farmer's to supply.

    THE SOUL HUSK STAYS THE GATHERER'S, two rows, and it is the one judgement
    in the four. DLC01SoulHusk01 and 02 carry the food bit like the rest, so
    the rule alone would send them to the farmer. Two things were measured
    before that was refused. They grow in the Soul Cairn, a plane of Oblivion
    behind the Dawnguard questline, so nobody sows them and nothing bled for
    them, and a farmer's crop list with a plot in Oblivion on it is a worse
    answer than the one being fixed. And searched across game\data\recipes.json the
    same day, Soul Husk is an input to no recipe in this build at all, so the
    thing Patrick is complaining about, the gatherer handing the Cook their
    shopping list, does not touch it. It is named in FOOD_STAYS_THE_GATHERERS
    below and the run says so.

  WHICH PLANTS ARE CROPS, AND WHY THE RULE COULD ONLY BE WIDENED NOW

  A farm crop was a TREE record whose produce is an ALCH, and that record type
  test is gone. It was there because FLOR plus ALCH dragged in every meat rack,
  clam, cheese bowl and butter churn in the game, and it cost four crops: JKs
  Skyrim.esp and JK's Whiterun's Outskirts.esp ship FLOR copies of their apple
  and carrot beside the TREE ones, and the FLOR copies were left in the
  gatherer's table. A cabbage is a cabbage whichever record type it is.

  Every one of the things the old rule was guarding against now has a name and
  a home. The salmon and the clams are taken by the fish pass before this one
  runs. The meat racks are the seven game rows. The cheese bowl and the churn
  are the two props. So the crop rule is now the food rule with those three
  lists subtracted: a plant, of either record type, whose produce carries the
  food bit and which is not game, not a prop and not named as staying the
  gatherer's. On this build that is 13 records, and one field crop gives an
  INGR rather than a food, so no rule reaches it and it is named one at a
  time in CROP_BY_EDITOR_ID below: wheat. Tundra cotton (#626) stays the
  gatherer's, like the other flowers and mushrooms. 14 crops in all.

  The name in the table is the produce's name, the same as in the harvests
  table, because that is what somebody is handed. It is what the record says
  and not what the editor id suggests: XJKcarrotplant in JKs Skyrim.esp points
  its PFIG at the leek, so the table reads Leek. That is JK's own data and
  correcting it here would make the table disagree with what the pick gives.

  What it does, in order:
    - works out the load order: the five masters, then every plugin the
      reference plugin list enables
    - walks the FLOR and TREE top groups of each, in that order, so a plugin
      that overrides a plant wins over the one that defined it
    - keeps every record that carries a PFIG, and resolves that form id to the
      record it names, for its own name, its record type, its gold value and,
      when it is an ALCH, the food bit out of its ENIT flag word
    - takes the water produce out of them first, by the list of names in the
      fish knobs below, so the plant table never carries a record that is the
      fisher's work rather than the gatherer's
    - then takes the food out of them, by the food bit, and routes each row to
      the farmer, to the hunter's game table or to the excluded list, except
      the ones named as staying the gatherer's
    - then takes the farmyard out, by name (FARMYARD_BY_EDITOR_ID): a plant
      whose produce is a reagent and which is still the farmer's, the chicken
      nest (#628), which collectEgg() in game\gamemode.js answers
    - sorts each plant that is left into one of classes.md's four ranks by what
      its produce is worth (see the knobs below)
    - runs the crops pass over the rows it routed to the farmer, gives each one
      the rank the farm ladder names and a grow time worked out from the price
    - writes game\data\harvests.json, the crops, the fish and the game beside the
      harvests in it, and prints all four tables as JavaScript object literals,
      because the server ships as one file and cannot read the json

  THE FISHER'S RECORDS, AND WHY THEY NEEDED NO NEW ONES

  Skyrim's own fishing is a Creation Club system this build does not have, so
  the fisher's verb looked like a thing somebody had to place records for.
  Measured in game\data\harvests.json on 20 September, before any of this was
  written: sixteen records already standing in every river and on every shore
  are water produce, and every one of them was a row in the plant table, gated
  on the Gatherer. The salmon, the clams, the pearl oysters, the butchered
  horker on Solstheim and the slaughterfish egg nest. So the fisher's verb is
  the water that was already there, and the sixteenth, the clam at Oar's Rest
  whose produce is a fake coin worth nothing, is the one left out.

  Nothing on those records says water. They are FLOR records like a flower is
  and their produce is an ALCH or an INGR like a flower's is, so they are named
  one at a time in FISH_BY_EDITOR_ID below rather than found by a rule, and a
  name in that list that no plugin carries stops the run.

  Read only. It touches nothing in the game folder and nothing on the VPS, and
  it proves that by fingerprinting the game folder before and after and failing
  if anything moved.

  Usage:
    .\scripts\dev\Build-HarvestTable.ps1
    .\scripts\dev\Build-HarvestTable.ps1 -Data 'C:\Thornswood\Game\Data'
    .\scripts\dev\Build-HarvestTable.ps1 -PluginList 'C:\Thornswood\Profile\OwnGame\plugins.txt'
    .\scripts\dev\Build-HarvestTable.ps1 -NoInstall

  Exit code 1 if a plugin in the load order is missing, if a localised plugin
  has no string table, if the stations file this server places its own bases
  from is missing or does not parse, if a plant's produce names no record in
  the build, if two plants land on the same key, if a crop has no produce or no
  price, if two crops land on the same key, if a record named as water produce
  is in no plugin in this build or has no Fisher rank set for it, if no water
  record is a novice's, if a record named as hanging game is in no plugin in
  this build or has no Hunter rank set for it, if no game record is a novice's,
  if a row the food rule routed to the farmer did not reach the crops table, if
  a food row is left in the gatherer's table without being named as staying
  there, if a name in FARMYARD_BY_EDITOR_ID is carried by no plant in this
  build, if the first rung of the gatherer's ladder or the farmer's is empty,
  or if the game folder changed underneath it.
#>
param(
    [string] $Data       = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    [string] $PluginList = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Profile\OwnGame\plugins.txt'),
    [string] $Out        = '',
    [string] $JsOut      = '',
    # Print the table and leave its file in game\gamemode-tables alone.
    [switch] $NoInstall
)

$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
# Thornswood's own plugins are read from game\content, every other plugin
# from -Data (#2923, OwnPlugins.ps1).
. (Join-Path $PSScriptRoot 'OwnPlugins.ps1')

# ---------------------------------------------------------------- knobs ----
# classes.md is the rulebook. It says a gatherer harvests flora and loose
# material, that four ranks climb by doing the work, and that rank decides
# which source somebody may work at all and how much it gives. It does not put
# a number on any of that. These are the judgement calls this script makes and
# they are here, in one block, rather than buried in the code.
#
# LANGUAGE: which string table the names come from. classes.md says nothing
# about language; the server and the panel are English, so English.
$LANGUAGE = 'english'
#
# RANK_MAX_VALUE: the gold value of the produce, at or below which a plant is
# that rank. This is THE KNOB. classes.md does not set these numbers and
# nothing in the game files ranks a plant, so the value of what it gives is
# the measure, because it is the one number the records already carry and it
# is what the world already agrees a thing is worth. Read top to bottom: the
# first rank whose ceiling the value fits is the rank.
#
# The spread this build actually has is printed every run, under 'ranking', so
# these can be moved against real numbers rather than against a guess. As it
# stands the values are 0, 1, 2, 3, 4, 5, 6, 8, 10, 12 and 20 gold and nothing
# in between, so a threshold anywhere in a gap moves nothing: 12 through 19
# all split the same way. The four below were chosen to sit on the gaps and to
# land where classes.md already says each rank should land.
#
# THE NOVICE CEILING WAS 0g UNTIL 20 SEPTEMBER, AND THAT RUNG WAS EMPTY IN THE
# OPEN WORLD. Measured that day against the table this script had just written:
# 50 rows ranked novice, and 33 of them were the planter sacks below, 1 was the
# clam at Oar's Rest and 1 the tree in the Ancestor Glade. The 15 that were
# left were every one of them a FloraMushroom03, 04 or 05, which is white cap,
# imp stool and namira's rot in a cave, because those three are the only
# ingredients in this build the records price at nothing. Everything a person
# walks past above ground was refused to a new Gatherer: lavender and thistle
# at 1g, the mountain flowers at 2g, snowberries and deathbell at 4g, all of
# them 'takes an Advanced Gatherer'. workPerRank.advanced in the gamemode is 20
# pieces of work, so the only road onto the second rung was twenty cave
# mushrooms. A ceiling of 1g puts the 1g ingredients on the rung with them and
# leaves advanced the biggest rank, which is the shape classes.md asks for.
#   novice   up to 1g. 'The basics of your half, and not much of it.' 57 rows
#            of the 147 in the table: white cap, imp stool, namira's rot,
#            lavender, thistle, creep cluster, juniper berries, jazbay grapes,
#            hanging moss and the rest of the 1g ingredients, plus ten crops
#            that a gatherer is refused anyway because a crop is the farming
#            block's.
#   advanced up to 5g. 'The everyday work. Most of what a hold actually
#            needs.' 61 rows: every mountain flower, snowberries, deathbell,
#            the eggs, wheat, the food crops. The biggest rank, which is what
#            that line asks for.
#   expert   up to 12g. 'The things people come looking for you specifically
#            to get.' 24 rows: nightshade, bleeding crown, nirnroot,
#            blisterwort.
#   master   everything above. 'The short list.' Five plants in this build:
#            ash creep cluster and the three from Update.esm.
$RANK_MAX_VALUE = @(
    @{ Rank = 'novice';   Max = 1 },
    @{ Rank = 'advanced'; Max = 5 },
    @{ Rank = 'expert';   Max = 12 },
    @{ Rank = 'master';   Max = 2147483647 }
)
#
# VALUE_RULES: where the gold value sits in each kind of record. Proved in the
# header. A produce record of a type that is not in here is reported and its
# plants go in the json's 'unranked' list instead of the table, because a rank
# guessed without a price is worse than no entry at all.
$VALUE_RULES = @{
    'INGR' = 'DATA0'   # DATA: value uint32, then weight float
    'MISC' = 'DATA0'   # same shape
    'SLGM' = 'DATA0'   # same shape
    'KEYM' = 'DATA0'   # same shape
    'ARMO' = 'DATA0'   # same shape
    'WEAP' = 'DATA0'   # DATA: value uint32, weight float, damage uint16
    'ALCH' = 'ENIT0'   # DATA is the weight alone; ENIT starts with the value
}
#
# ALCH_FLAG_FOOD: the bit in an ALCH record's ENIT flag word that says the
# thing is eaten rather than drunk for its effects. NOT A KNOB and not a
# judgement: it is a fact about the record layout, and it is here beside
# VALUE_RULES because it is read out of the same subrecord in the same pass.
#
# It is not proved a second time here on purpose. scripts\dev\Build-RecipeTable.ps1
# proves it in its own header, by counting the flag word over the five masters:
# it takes exactly five values, 0x00000000 is 205 potions, 0x00000001 is 7
# potions with the no-auto-calc bit, 0x00000002 is 8 foods, 0x00000003 is 107
# foods with that same no-auto-calc bit and 0x00020000 is 80 poisons. That
# script gates the whole Cook and Alchemist split on it, so a second reading
# invented here would be a second answer able to disagree with the first about
# the same record. ENIT on an ALCH is the value in gold as a uint32 and then
# this word, which is why VALUE_RULES already reads the first four bytes of it.
#
# Measured here on 21 September against this build: all 15 produce records the
# 24 food rows of the harvests table point at carry it, including Soul Husk,
# whose editor id is DLC1FoodSoulHusk and whose flag word is 0x00000003.
$ALCH_FLAG_FOOD = 0x00000002
#
# PRODUCE_WITHOUT_A_PRICE: kinds of record that are a real answer to "what does
# this give" but carry no single item and no price. LVLI is the one this build
# has: six coin purse lists, sitting on flora that is loot rather than
# gathering. They are reported by name every run and listed in the json under
# 'unranked'. They are left out of the table on purpose, so the server does not
# gate picking up a purse behind a gatherer's rank.
$PRODUCE_WITHOUT_A_PRICE = @('LVLI', 'FLST', 'LVLN')
#
# PRODUCE_NOT_GATHERED: kinds of record that are a real item with a real price
# and still are not material anybody gathers. KEYM is the kind: Elysium
# Estate 4.3.5 (ElysiumEstateSSE.esp, until #690) hung the key to the house on
# a FLOR record, and 5.0.1 does not, but a key on flora is never gathering. Rank
# decides who may work a source at all, so leaving that in the table would
# mean only a gatherer could ever pick up their own front door key. They are
# reported by name every run and listed in the json under 'unranked'.
$PRODUCE_NOT_GATHERED = @('KEYM')
#
# PRODUCE_A_SCRIPT_MUST_OPEN: produce that is a sack rather than a thing. The
# HearthFires planters and the mead barrel in a built homestead give a MISC
# named for what is inside it and how many, 'Nightshade (3)' or
# 'Nord Mead (5)', which a Papyrus script opens into that many of the real
# item. This server does not run Papyrus, for the two reasons written out over
# the scripted activators in the gamemode, so the sack goes into a pack and
# stays a sack.
#
# They were in the table until 20 September and they did two things wrong at
# once. The records price a sack at nothing, so it ranked at the bottom while
# the same ingredient picked in the wild ranked where its price puts it: the
# planter of 'Nightshade (3)' was a novice plant and wild nightshade, which is
# the same nightshade at 8g, was refused to the same person as an expert's.
# Measured on 20 September, 29 ingredients sat at two ranks at once for that
# reason. And harvest() in the gamemode hands over one of whatever the row
# names, so the count in the name was thrown away before it could matter.
#
# Matched on the produce being a MISC whose name ends in a bracketed count,
# which on this build is exactly the 33 sacks and nothing else: every MISC
# produce that is a real item, the clam's fake coin and the Ancestor Glade's
# canticle bark, carries no count. They are reported by name every run and
# listed in the json under 'unranked'.
$PRODUCE_A_SCRIPT_MUST_OPEN = ' \(\d+\)$'
#
# OUR_STATIONS: the bases this server places in the world itself, read out of
# game\data\stations.json, which Install-GamemodeConsts.js also installs into
# the gamemode's STATIONS line. A record Thornswood put in the world is
# answered by the station code written for it, never by a sweep of the load
# order, and neither pass may claim one.
#
# Measured on 20 September: Thornswood-Content.esp's beehive is a FLOR with an
# INGR produce like any other, so this pass read it and wrote it into the table
# as a wild plant worth 5g and therefore an advanced one. The day the gamemode
# started answering the table, pressing this server's own hive ran the gatherer
# class gate and then 'Picking Honeycomb takes an Advanced Gatherer', and
# because onActivate returns false for anything it answers, the engine's own
# handover was blocked as well: a Woodworker got nothing at all from a hive
# Thornswood placed for them. Nobody decided that. This is the check that stops
# the next FLOR or TREE this server places from being reclassified the same
# quiet way.
$STATIONS_FILE = Join-Path $PSScriptRoot '..\..\game\data\stations.json'
#
# ------------------------------------------------------ the fish knobs ------
#
# FISH_BY_EDITOR_ID: the records that are water produce and therefore the
# fisher's, named one at a time. These come out of the harvests table and go
# into a table of their own, so the gatherer stops being handed the fisher's
# work and the fisher stops walking past it.
#
# WHY THERE IS A RULE HERE AT ALL, AND WHY IT IS A LIST OF NAMES. Skyrim's own
# fishing is a Creation Club system this build does not have, so the fisher's
# verb looked like a thing somebody had to place records for. Measured in
# game\data\harvests.json on 20 September: sixteen records already standing in
# every river and on every shore are water produce, and every one of them was
# in the plant table gated on the Gatherer. So the fisher's verb needs no new
# record and no Creation Kit work at all.
#
# A rule written on the records themselves cannot find them. They are FLOR
# records like a flower is, their produce is an ALCH or an INGR like a flower's
# is, and nothing in a salmon's record says water. Naming sixteen is honest;
# every rule tried against them took in meat racks and cheese wheels as well.
# A name in this list that no plugin in the build carries is a failure and
# stops the run, because a record that has been renamed out from under this is
# exactly the quiet way the fisher would lose half their work again.
$FISH_BY_EDITOR_ID = @(
    'FXAmbWaterSalmon01A', 'FXAmbWaterSalmon01B', 'FXAmbWaterSalmon02A', 'FXAmbWaterSalmon02B',
    'DeadSalmon01', 'DeadSalmon02', 'DeadSalmon01NoNail', 'DeadSalmon02NoNail',
    'Clam01', 'ClamThin01', 'ClamLarge01',
    'DLC2PearlOysterLarge01', 'DLC2PearlOysterThin01',
    'DLC2HorkerMeat01', 'SlaughterfishEggNest01',
    'OR_Clam',
    'ThornswoodFishHistcarp', 'ThornswoodFishRiverBetty',
    'ThornswoodFishSlaughterfishScales', 'ThornswoodFishSilversidePerch',
    'ThornswoodFishCyrodilicSpadetail', 'ThornswoodFishAbeceanLongfin'
)
#
# FISH_NOT_A_CATCH: the ones in that list that are water produce and still are
# not a catch. OR_Clam is the clam at Oar's Rest, from OarsRest.esp, and what it
# gives is OR_Clam's own MISC record, a Fake Dwemer Coin the record prices at 0
# gold. It is a joke somebody put on a beach, not a thing a fisher works for. It
# is reported by name every run and goes in the json's unranked list, the same
# way the planter sacks and the coin purses do, rather than being dropped
# without a trace.
$FISH_NOT_A_CATCH = @('OR_Clam')
#
# FISH_RANK_BY_EDITOR_ID: which Fisher rank each record asks for. INVENTED, and
# named one at a time rather than worked out, for the same reason the crops are.
# The gold rule that ranks a plant cannot rank these: measured on 20 September,
# all fifteen produce records in this build are priced at 2 or 3 gold, so every
# threshold puts every one of them on the same rung and the ladder does nothing.
#
# THE SALMON AND THE CLAMS ARE NOVICE AND NOTHING MOVES THEM. Eleven of the
# fifteen, and the whole of a new fisher's work. A first rung with nothing on it
# is the circle this script has already been rewritten over twice, once when 33
# of the 50 novice plants were planter sacks nobody could open and once when the
# gold rule put ten of eleven crops on one rung. A fisher who cannot fish cannot
# climb.
#
# The four above it are the ones somebody has to go looking for. The horker meat
# and the small pearls are on Solstheim; the pearls are under the water there;
# the slaughterfish egg nest sits underwater in water that has slaughterfish in
# it, which is the one record here that can kill somebody working it.
$FISH_RANK_BY_EDITOR_ID = @{
    'FXAmbWaterSalmon01A'    = 'novice'
    'FXAmbWaterSalmon01B'    = 'novice'
    'FXAmbWaterSalmon02A'    = 'novice'
    'FXAmbWaterSalmon02B'    = 'novice'
    'DeadSalmon01'           = 'novice'
    'DeadSalmon02'           = 'novice'
    'DeadSalmon01NoNail'     = 'novice'
    'DeadSalmon02NoNail'     = 'novice'
    'Clam01'                 = 'novice'
    'ClamThin01'             = 'novice'
    'ClamLarge01'            = 'novice'
    'DLC2HorkerMeat01'       = 'advanced'
    'DLC2PearlOysterThin01'  = 'advanced'
    'DLC2PearlOysterLarge01' = 'expert'
    'SlaughterfishEggNest01' = 'master'
    'ThornswoodFishHistcarp' = 'advanced'
    'ThornswoodFishRiverBetty' = 'advanced'
    'ThornswoodFishSlaughterfishScales' = 'advanced'
    'ThornswoodFishSilversidePerch' = 'expert'
    'ThornswoodFishCyrodilicSpadetail' = 'expert'
    'ThornswoodFishAbeceanLongfin' = 'master'
}
#
# ------------------------------------------------------ the food knobs ------
#
# THE RULE ITSELF IS NOT A KNOB. A plant whose produce is an alchemy reagent is
# the gatherer's and a plant whose produce is food is not, food is the ALCH
# food bit above, and that is read off the records every run. The whole of
# Patrick's 21 September correction is that one sentence and it is written out
# in the header. What is below is only WHERE each food row goes, because the
# rule can say a hanging pheasant is not a flower and it cannot say whose it is.
#
# All three lists are matched on the editor id exactly, the way the fish are and
# for the same reason: a record renamed out from under this is the quiet way a
# class loses half its work again, so every name in them is checked against the
# build and a name nothing carries stops the run.
#
# GAME_BY_EDITOR_ID: hanging game, which is the hunter's. Seven records on this
# build, read out of game\data\harvests.json on 21 September rather than listed from
# memory: every row in the harvests map whose produce carried the food bit and
# was an animal. Two pheasants hanging by the feet, two rabbits, two charred
# skeevers on a giant's skewer and a third charred skeever on its own.
#
# WHY THEY ARE NOT ROWS IN game\data\hunts.json, which was the other place they
# could have gone. That table is built by scripts\dev\Build-HuntTable.ps1 out of NPC_
# records and the death item levelled lists they point at, and loot() in the
# gamemode answers it only after reading the reference itself: mp.get type must
# say MpActor and mp.get isDead must say true. A hanging pheasant is a FLOR
# record standing in a hunter's camp. It is not an actor, it never died on this
# server and neither of those reads would ever answer for it, so a row in
# hunts.json would be a row nothing could reach.
#
# What they are is a press on a FLOR whose produce the engine hands over, which
# is the same shape as the water produce, and the fish pass on 20 September
# solved that problem once already: its own map in game\data\harvests.json, its own
# generated block in the gamemode, its own verb gated on its own class. This
# follows it line for line rather than inventing a second arrangement.
$GAME_BY_EDITOR_ID = @(
    'HangingPheasant01', 'HangingPheasant02',
    'HangingRabbit01', 'HangingRabbit02',
    'GiantSkewer01CharredSkeever01', 'GiantSkewer01CharredSkeever02',
    'CharredSkeever03'
)
#
# GAME_RANK_BY_EDITOR_ID: which Hunter rank each of them asks for. INVENTED,
# and named one at a time rather than worked out, for the same reason the fish
# and the crops are. classes.md sets no number here. The gold rule that ranks a
# plant cannot rank these either: measured on 21 September, the three produce
# records are priced at 2, 3 and 4 gold, so every threshold in RANK_MAX_VALUE
# puts all seven on one rung and the ladder does nothing.
#
# So the measure is where the thing hangs, which is the only question a hunter's
# ladder can ask about a carcass somebody else strung up, and the editor ids say
# it plainly enough to rank on:
#
#   novice    the rabbits and the pheasants, four of the seven. They hang
#             outside farmhouses and at hunters' camps all over the province,
#             which is where a new hunter already is. THE FIRST RUNG CARRIES THE
#             MAJORITY AND NOTHING MOVES IT: an empty bottom rung is the circle
#             this repo has now been rewritten over three times, at the plants
#             where 33 of 50 novice rows were planter sacks, at the crops where
#             the gold rule put ten of eleven on one rung, and at the fish. A
#             hunter who cannot work a body cannot climb.
#   advanced  CharredSkeever03, the plain charred skeever, which is cooking in
#             bandit and forsworn camps rather than hanging at a farm.
#   expert    the two on GiantSkewer01, which is a giant's own spit, and the
#             giant is standing next to it.
#   master    nothing yet, left open on purpose the way the farm ladder's top
#             rung is. A record added here later lands on a rung somebody chose
#             rather than on the highest one by default.
$GAME_RANK_BY_EDITOR_ID = @{
    'HangingRabbit01'               = 'novice'
    'HangingRabbit02'               = 'novice'
    'HangingPheasant01'             = 'novice'
    'HangingPheasant02'             = 'novice'
    'CharredSkeever03'              = 'advanced'
    'GiantSkewer01CharredSkeever01' = 'expert'
    'GiantSkewer01CharredSkeever02' = 'expert'
}
#
# FOOD_PROP_BY_EDITOR_ID: food that is neither a plant anybody grows nor an
# animal anybody took, so no class verb in classes.md reaches it. Two records
# here and both are furniture somebody put a FLOR on:
#   MammothCheese01  a bowl of mammoth cheese in a giant's camp. Nobody sowed
#                    it and nothing was hunted for it.
#   BYOHButterChurn  the churn in a HearthFires homestead. A churn is worked,
#                    not picked, so it is a station and not a crop.
# They are excluded and reported by name every run, and they go in the json's
# unranked list, the same way the planter sacks, the coin purses and the clam at
# Oar's Rest do, rather than being dropped without a trace.
#
# THE CHURN IS THE FARMER'S, AND IT IS NOT THIS SCRIPT THAT SAYS SO. Counted over
# game\data\recipes.json on 21 September, Butter is 46 of the Cook's inputs, the
# single biggest of them, and this list left it with no producer. Patrick settled
# where it goes the same day: "give milk and butter to farmers". It still stays
# out of every table here, because a churn is not a crop and writing it into the
# crops map would make every churn in Skyrim a plot somebody sows. churn() in
# game\gamemode.js answers it instead, with the farm verb, and
# Build-RecipeTable.ps1 reads that verb out of the gamemode the way it reads the
# salt quarry and the chopping blocks.
$FOOD_PROP_BY_EDITOR_ID = @('MammothCheese01', 'BYOHButterChurn')
#
# FOOD_STAYS_THE_GATHERERS: the food rows that stay in the plant table anyway.
# This is the one judgement in the routing and it is deliberately a short list,
# because every name on it is the rule being overruled.
#
# DLC01SoulHusk01 and DLC01SoulHusk02 are the two. Their produce is
# DLC1FoodSoulHusk, measured on 21 September at flag word 0x00000003, so the
# food bit is set and the rule on its own would make them the farmer's. Two
# things were measured before that was refused. They grow in the Soul Cairn, a
# plane of Oblivion reached through the Dawnguard questline: nobody sows one,
# nothing bled for one, and a novice farmer's crop list with a plot in Oblivion
# on it is a worse answer than the one this change is fixing. And Soul Husk is
# an input to no recipe in this build at all, searched across game\data\recipes.json
# the same day, so the thing Patrick is correcting, the gatherer handing the
# Cook their shopping list, does not touch it either way.
#
# It is a wild plant somebody picks. That is the gatherer's verb, and the food
# bit on it is the record saying it can be eaten rather than that it was farmed.
$FOOD_STAYS_THE_GATHERERS = @('DLC01SoulHusk01', 'DLC01SoulHusk02')
#
# FARMYARD_BY_EDITOR_ID: plants whose produce is a reagent, so the food rule
# above never sees them, and which are still not the gatherer's. Issue #628,
# "Gather can get eggs": ChickenNest gives Chicken's Egg, which is an INGR, so
# it was ranked into the gatherer's table like a flower, and a gatherer pressing
# a nest in a farmyard was handed the egg the Cook's bread and pies ask for.
# A nest is kept, not found in the wild: it is the farmer's, the same way the
# churn and the living cow are. collectEgg() in game\gamemode.js answers it with
# the farm verb, and Build-RecipeTable.ps1 reads that verb, so Chicken's Egg is
# a farmer's to supply. It is not a crop either (nobody sows a nest), so it goes
# in the json's unranked list with the reason, the way the churn does, and in no
# table here. Wild bird nests (pine thrush, rock warbler, hawk) are found in the
# wild and stay the gatherer's, which is why this is a name and not a rule.
$FARMYARD_BY_EDITOR_ID = @('ChickenNest')
#
# ------------------------------------------------------ the crop knobs ------
#
# THERE IS NO CROP RULE OF ITS OWN ANY MORE, and that is the change of
# 21 September rather than something left undone.
#
# It was $CROP_RECORD_TYPE = 'TREE' and $CROP_PRODUCE_TYPE = 'ALCH': a farm crop
# was a TREE record whose produce was a food. The record type half of that was
# never about farming. It was a guard, and the comment that stood here said so:
# FLOR plus ALCH 'drags in every meat rack and clam in the game'. It cost four
# crops to do it. JKs Skyrim.esp and JK's Whiterun's Outskirts.esp each ship a
# FLOR copy of their apple and their carrot beside the TREE one, and measured on
# 21 September all four FLOR copies were sitting in the gatherer's table as wild
# plants. A cabbage is a cabbage whichever record type Bethesda or JK wrote it
# as, and a pass that can only see one of the two is guessing.
#
# The guard is not needed now because everything it was guarding against has a
# name and a home. The salmon and the clams are taken by the fish pass before
# this one runs. The meat racks are GAME_BY_EDITOR_ID. The cheese bowl and the
# butter churn are FOOD_PROP_BY_EDITOR_ID. So a crop is what the food rule at
# the top routed to the farmer: a plant of either record type whose produce
# carries the food bit and which is none of those three things. On this build
# that is 13 records where the old rule found 9.
#
# CROP_BY_EDITOR_ID: the crops the rule cannot reach. Wheat is grown in fields
# all over Skyrim and is a TREE record like the rest, but its produce is an INGR
# and not a food, so no rule written on the record types finds it. Naming one
# record is honest; widening the rule to INGR to catch it would take in every
# mountain flower, mushroom and hanging moss in the game, which is gathering and
# not farming. Tundra cotton used to sit here too; #626 moved it to gatherers
# (reagent flora with put-back), matching flowers and mushrooms. Matched on the
# editor id exactly, so the HearthFires planter BYOHHouseIngrdWheat01 is not
# caught by it.
$CROP_BY_EDITOR_ID = @('TreeFloraWheat01')
#
# CROP_NOT_A_PLOT_PREFIX: the HearthFires planters. These are Skyrim's own
# plant-and-grow system for a homestead garden: somebody puts a seed in the
# planter and the game grows it. They are TREE records and they give a MISC
# bundle, 'Cabbage (2)' or 'Nightshade (3)', which is a sack a Papyrus script
# turns into that many of the real thing. The server does not run Papyrus, so
# the sack would never open. They are not farm plots and are excluded by editor
# id prefix, which is 33 records on this build. The produce type rule already
# skips them, because a MISC is not an ALCH, but they are named here so that
# the reason is written down where somebody widening the rule will read it.
$CROP_NOT_A_PLOT_PREFIX = @('BYOHHouseFlora', 'BYOHHouseIngrd')
#
# CROP_GROW_MINUTES_*: how long a picked plot takes to come back. INVENTED, and
# the one real knob in this block. classes.md does not set it and nothing in
# the game files says it, so it is worked out from the one number the records
# already carry, the same number the ranks use: what the produce is worth.
#
#     minutes = BASE + produce value in gold * PER_GOLD, capped at MAX
#
# A cheap crop comes back fast and a dear one takes its time, so a plot of
# something worth having is worth waiting for. BASE is the engine's own hour
# and is a floor, not a guess: GetRelootTime hardcodes one hour for FLOR and
# TREE, the gamemode cannot change it and cannot set isHarvested, so an hour
# after a pick the plant looks ready whatever the server says. Anything under
# BASE would have the rule call a crop ripe while the model was still the
# picked one, and a grow time at or above BASE only ever means the plant looks
# ready a while before it is, which the server can explain when it refuses.
# MAX keeps one repriced ingredient in some future mod from putting a plot out
# of reach for a day.
#
# On this build the spread is nearly flat, because ten of the eleven crops give
# something the records price at one gold: ten at 75 minutes and wheat, at 5
# gold, at 135. It is worked out rather than typed so that a mod repricing a
# crop moves its grow time on its own, the same way it already moves its rank.
#
# CROP_RANK_BY_EDITOR_ID: which Farmer rank a crop asks for. INVENTED, and it
# deliberately does NOT use the gold value the rest of this script ranks by.
#
# PATRICK, 20 September: 'they cant grow them if they dont have the rank, they
# cant get the rank if they dont level up from growing them, they cant get the
# crops from anywhere so like how would do that'. He is right, and the gold rule
# is what made it a circle. RANK_MAX_VALUE ranks a plant by what its produce
# sells for, which is the GATHERER's ladder: it answers 'how valuable is this
# thing to find', and a rare flower deep in a cave should be worth more than one
# by the road. Applied to a farm it answers the wrong question entirely. Every
# one of the eleven crops produces something worth at least one gold, so every
# one of them came out Advanced, and a new Farmer is a Novice. Nothing to sow,
# so nothing to bring in, so no farming work, so no way to the Advanced they
# would need. The seeds handed out at creation were unplantable the day they
# arrived.
#
# So a crop is ranked by HOW HARD IT IS TO GROW, which is the only question a
# farm ladder should be asking, and that is a judgement and has to be written
# down rather than computed. The shape of it is the one classes.md publishes:
#
#   Novice    the common field crops. Cabbage, leek, potato, gourd, carrot.
#             These grow in rows outside every hold capital, they are in barrels
#             and on tables all over Skyrim, and a Novice can work them on their
#             first day. This is the rung the whole ladder stands on: unless a
#             beginner can both FIND and GROW something, farming cannot start.
#   Advanced  the ones that take a season. Wheat, ash yam, tomato.
#   Expert    the orchard. Apples, because a tree is the longest thing anybody
#             here plants.
#   Master    nothing yet. Left open on purpose for whatever is added next.
#
# A crop this list does not name falls back to the gold rule, so a mod adding a
# crop still gets a rank rather than an error, and the fallback is reported.
#
# THE SERVER DOES NOT READ THIS. game\gamemode.js carries its own CROP_RULES
# and that is what gates a plot, because the generated block in that file is
# overwritten by this script and a judgement written into it would be lost. This
# list exists so that game\data\harvests.json does not sit there stating a different
# rank from the one the server enforces. THE TWO MUST AGREE: change one, change
# the other, and the names on each rung are the same names in both.
#
# THE FOUR ADDED ON 21 SEPTEMBER are the FLOR copies the old record type rule
# could not see: XJKcarrotplantflora and XJKWOCarrotPlant are the same carrot as
# XJKcarrotplant and go on the same rung, and XJKWOTreeAppleRed and
# XJKWOTreeAppleGreen are the same orchard as the two JKs Skyrim apple trees and
# go on theirs. Every one of the four is already ranked exactly that way in
# CROP_RULES in game\gamemode.js, which is the list the server actually gates a
# plot on, so this is the two lists being made to agree rather than a new
# judgement: they were written there by hand when the pass could not reach them.
$CROP_RANK_BY_EDITOR_ID = @{
    'TreeFloraCabbage01'          = 'novice'
    'TreeFloraLeek01'             = 'novice'
    'XJKcarrotplant'              = 'novice'
    'XJKcarrotplantflora'         = 'novice'
    'XJKWOCarrotPlant'            = 'novice'
    'TreeFloraPotatoPlant01'      = 'novice'
    'TreeGourdCluster01'          = 'novice'
    'TreeFloraWheat01'            = 'advanced'
    'XJKWOTreeFloraTomatoPlant01' = 'advanced'
    'DLC2TreeFloraAshYam01'       = 'advanced'
    'XJKappleGreentree'           = 'expert'
    'XJKappleredtree'             = 'expert'
    'XJKWOTreeAppleRed'           = 'expert'
    'XJKWOTreeAppleGreen'         = 'expert'
}
#
$CROP_GROW_MINUTES_BASE     = 60
$CROP_GROW_MINUTES_PER_GOLD = 15
$CROP_GROW_MINUTES_MAX      = 360

if (-not $Out) { $Out = Join-Path $PSScriptRoot '..\..\game\data\harvests.json' }

# Update.esm's own Creation Club records (#479). Every Special Edition has
# them, but their art comes with the Creation Club files Thornswood leaves out,
# so a plant that is one, or whose produce is one, is nobody's to pick: it goes
# in the unranked list with the reason. scripts\mods\Check-CreationForms.js
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

# The masters a plugin declares, in order. A record's form id carries the
# index of the file it really belongs to in its top byte, so a JKs Skyrim.esp
# record with 00 up there is a Skyrim.esm record being overridden and the desc
# has to say Skyrim.esm.
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
    # ',' on purpose. A bare 'return $masters' is unrolled on the way out, and
    # a plugin with exactly one master then comes back as the bare string
    # 'Skyrim.esm' instead of a list of one. Its .Count still reads 1, so
    # nothing complains, but $masters[0] indexes the STRING and hands back the
    # character 'S', and every overridden record in Update.esm, Dawnguard.esm,
    # HearthFires.esm and Dragonborn.esm gets the desc '77e1c:S'. Those four
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

function Rank-For([int]$value) {
    foreach ($r in $RANK_MAX_VALUE) {
        if ($value -le [int]$r.Max) { return [string]$r.Rank }
    }
    return [string]$RANK_MAX_VALUE[$RANK_MAX_VALUE.Count - 1].Rank
}

# The grow time of a crop, in minutes, out of what its produce is worth. The
# formula and every number in it are in the crop knobs at the top.
function Grow-Minutes([int]$value) {
    $m = $CROP_GROW_MINUTES_BASE + $value * $CROP_GROW_MINUTES_PER_GOLD
    if ($m -gt $CROP_GROW_MINUTES_MAX) { $m = $CROP_GROW_MINUTES_MAX }
    if ($m -lt $CROP_GROW_MINUTES_BASE) { $m = $CROP_GROW_MINUTES_BASE }
    return [int]$m
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
$tables   = @{}
$bsaCache = @{}
$looseDir = Join-Path $Data 'Strings'

function Get-BsaCached([string]$name) {
    if ($bsaCache.ContainsKey($name)) { return $bsaCache[$name] }
    $p = Join-Path $Data $name
    if (-not (Test-Path -LiteralPath $p)) { $bsaCache[$name] = $null; return $null }
    $got = $null
    try { $got = Get-BsaStringFiles $p } catch { Note ("could not read {0}: {1}" -f $name, $_.Exception.Message); $got = $null }
    $bsaCache[$name] = $got
    return $got
}

$localised = @{}
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

# ------------------------------------------------ the bases that are ours ---

Write-Host ''
Write-Host 'the stations this server places' -ForegroundColor Cyan
# Read before the plants are, so that a missing or broken stations file stops
# the run here rather than after a table has been built that cannot tell a
# station from a flower. The case for the check is over OUR_STATIONS at the top.
$ourStations = New-Object 'System.Collections.Generic.HashSet[string]'
if (-not (Test-Path -LiteralPath $STATIONS_FILE)) {
    Bad ("{0} is not there, so this run cannot tell a base this server placed from a wild plant" -f $STATIONS_FILE)
} else {
    $stationsJson = $null
    try { $stationsJson = (Get-Content -LiteralPath $STATIONS_FILE -Raw) | ConvertFrom-Json }
    catch { Bad ("{0} does not parse as json: {1}" -f $STATIONS_FILE, $_.Exception.Message) }
    if ($stationsJson) {
        foreach ($s in $stationsJson.PSObject.Properties) {
            [void]$ourStations.Add([string]$s.Value)
            Note ("{0,-14} {1}" -f $s.Name, $s.Value)
        }
        Ok ("{0} bases this server places itself, read from {1}" -f $ourStations.Count, $STATIONS_FILE)
    }
}

# --------------------------------------------------- the FLOR/TREE records --

Write-Host ''
Write-Host 'plants' -ForegroundColor Cyan
# desc -> the plant, the load order winner. A plugin later in the order that
# overrides a plant replaces what an earlier one said about it, which is what
# the game does.
$plants  = New-Object System.Collections.Specialized.OrderedDictionary
$noYield = 0
$fromEdid = New-Object 'System.Collections.Generic.List[string]'
$overrides = 0

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

    $here = 0
    $i = 24 + $headerSize
    while ($i + 24 -le $b.Length) {
        if ([System.Text.Encoding]::ASCII.GetString($b, $i, 4) -ne 'GRUP') { break }
        $groupSize = [int][BitConverter]::ToUInt32($b, $i + 4)
        if ($groupSize -lt 24) { break }
        $label = [System.Text.Encoding]::ASCII.GetString($b, $i + 8, 4)
        if ($label -eq 'FLOR' -or $label -eq 'TREE') {
            $j = $i + 24
            $groupEnd = $i + $groupSize
            while ($j + 24 -le $groupEnd) {
                $type     = [System.Text.Encoding]::ASCII.GetString($b, $j, 4)
                $dataSize = [int][BitConverter]::ToUInt32($b, $j + 4)
                # a nested GRUP counts its own 24 byte header in its size; a
                # record does not. FLOR and TREE groups hold no nested groups,
                # but a walk that cannot tell the two apart runs off the end.
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
                    $k = 0; $over = 0
                    $edid = ''; $full = ''; $fullFrom = ''
                    $pfig = [uint32]0
                    $seasons = ''
                    while ($k + 6 -le $rec.Length) {
                        $sub = [System.Text.Encoding]::ASCII.GetString($rec, $k, 4)
                        $sz  = [int][BitConverter]::ToUInt16($rec, $k + 4)
                        $k += 6
                        # XXXX carries the real size of the subrecord after it,
                        # for anything bigger than two bytes can say
                        if ($over -gt 0) { $sz = $over; $over = 0 }
                        if ($sub -eq 'XXXX') { $over = [int][BitConverter]::ToUInt32($rec, $k); $k += $sz; continue }
                        if ($sub -eq 'EDID' -and $sz -gt 1) {
                            $edid = [System.Text.Encoding]::GetEncoding(1252).GetString($rec, $k, $sz - 1)
                        } elseif ($sub -eq 'FULL') {
                            if ($loc -and $sz -eq 4) {
                                $sid = [BitConverter]::ToUInt32($rec, $k)
                                if ($strTable -and $strTable.ContainsKey($sid)) { $full = $strTable[$sid]; $fullFrom = 'string table' }
                            } elseif ($sz -gt 1) {
                                $full = [System.Text.Encoding]::GetEncoding(1252).GetString($rec, $k, $sz - 1)
                                $fullFrom = 'the record'
                            }
                        } elseif ($sub -eq 'PFIG' -and $sz -eq 4) {
                            $pfig = [BitConverter]::ToUInt32($rec, $k)
                        } elseif ($sub -eq 'PFPC' -and $sz -eq 4) {
                            # the chance of a yield in spring, summer, autumn, winter
                            $seasons = ('{0},{1},{2},{3}' -f $rec[$k], $rec[$k+1], $rec[$k+2], $rec[$k+3])
                        }
                        $k += $sz
                    }

                    $desc = Desc-Of $formId $masters $pl
                    if ($pfig -eq 0) {
                        # a tree, a shrub, a stump: pickable in the engine's
                        # eyes but it gives nothing, so it is not a source
                        if ($plants.Contains($desc)) { $plants.Remove($desc) }
                        $noYield++
                    } else {
                        if (-not $full) { $full = $edid; $fullFrom = 'the editor id'; $fromEdid.Add($desc) }
                        if ($plants.Contains($desc)) { $overrides++ }
                        $plants[$desc] = [pscustomobject]@{
                            Desc        = $desc
                            Kind        = $label
                            Edid        = $edid
                            Full        = $full
                            FullFrom    = $fullFrom
                            Plugin      = $desc.Substring($desc.IndexOf(':') + 1)
                            SeenIn      = $pl
                            Seasons     = $seasons
                            ProduceForm = $pfig
                            ProduceDesc = (Desc-Of $pfig $masters $pl)
                        }
                        $here++
                    }
                }
                $j += 24 + $dataSize
            }
        }
        $i += $groupSize
    }
    if ($here -gt 0) { Note ("{0}: {1} FLOR/TREE records that yield something" -f $pl, $here) }
}
Ok ("{0} plants that yield something, across {1} plugins" -f $plants.Count, (($plants.Values | ForEach-Object { $_.SeenIn } | Sort-Object -Unique).Count))
Note ("{0} FLOR/TREE records carry no produce and are not sources" -f $noYield)
if ($overrides -gt 0) { Note "$overrides of them were overridden by a plugin later in the load order" }
if ($fromEdid.Count -gt 0) { Note ("{0} had no readable name and fell back to their editor id" -f $fromEdid.Count) }

# ------------------------------------------------------------ the produce ---

Write-Host ''
Write-Host 'produce' -ForegroundColor Cyan
$wanted = @{}
foreach ($d in $plants.Keys) { $wanted[$plants[$d].ProduceDesc] = $true }
Ok ("{0} distinct produce records to resolve" -f $wanted.Count)

# Walk every top group of every plugin, but only unpack a record we want.
# Rather than build a desc for every record in the build and compare strings,
# each wanted desc is turned back into the raw form id it would have inside
# THIS plugin, once, before the walk. Then the test in the inner loop is one
# lookup on a number. That is the difference between seconds and minutes.
# CELL, WRLD and DIAL are skipped: they hold references, cells and dialogue,
# and a base item is never in one.
$produce = @{}
foreach ($pl in $order) {
    $path = Get-PluginPath $Data $pl
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $b = [System.IO.File]::ReadAllBytes($path)
    if ([System.Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'TES4') { continue }
    $headerSize = [int][BitConverter]::ToUInt32($b, 4)
    $loc     = $localised[$pl]
    $masters = Get-PluginMasters $b $headerSize
    $strTable = $null
    if ($tables.ContainsKey($pl)) { $strTable = $tables[$pl].Table }

    # owning plugin -> the index this plugin's records use for it. Its own
    # records use the index one past the last master.
    $indexOf = @{}
    for ($mi = 0; $mi -lt $masters.Count; $mi++) { $indexOf[$masters[$mi].ToLowerInvariant()] = $mi }
    $indexOf[$pl.ToLowerInvariant()] = $masters.Count
    $here = @{}
    foreach ($w in $wanted.Keys) {
        $cut   = [string]$w
        $at    = $cut.IndexOf(':')
        $local = [Convert]::ToUInt32($cut.Substring(0, $at), 16)
        $owner = $cut.Substring($at + 1).ToLowerInvariant()
        if (-not $indexOf.ContainsKey($owner)) { continue }
        $here[[uint32](([uint32]$indexOf[$owner] -shl 24) -bor $local)] = $cut
    }
    if ($here.Count -eq 0) { continue }

    $i = 24 + $headerSize
    while ($i + 24 -le $b.Length) {
        if ([System.Text.Encoding]::ASCII.GetString($b, $i, 4) -ne 'GRUP') { break }
        $groupSize = [int][BitConverter]::ToUInt32($b, $i + 4)
        if ($groupSize -lt 24) { break }
        $label = [System.Text.Encoding]::ASCII.GetString($b, $i + 8, 4)
        if ($label -ne 'CELL' -and $label -ne 'WRLD' -and $label -ne 'DIAL') {
            $j = $i + 24
            $groupEnd = $i + $groupSize
            while ($j + 24 -le $groupEnd) {
                $type     = [System.Text.Encoding]::ASCII.GetString($b, $j, 4)
                $dataSize = [int][BitConverter]::ToUInt32($b, $j + 4)
                if ($type -eq 'GRUP') { $j += $dataSize; continue }
                $formId   = [BitConverter]::ToUInt32($b, $j + 12)
                if ($here.ContainsKey($formId)) {
                    $desc = $here[$formId]
                    $recFlags = [BitConverter]::ToUInt32($b, $j + 8)
                    if ($recFlags -band 0x00040000) {
                        $outLen = [int][BitConverter]::ToUInt32($b, $j + 24)
                        $rec = Expand-RecordData $b ($j + 28) $outLen
                    } else {
                        $rec = New-Object byte[] $dataSize
                        [Array]::Copy($b, $j + 24, $rec, 0, $dataSize)
                    }
                    $k = 0; $over = 0
                    $edid = ''; $full = ''; $fullFrom = ''
                    $value = -1
                    # 0 rather than -1: a record with no ENIT at all carries no
                    # bits, and nothing here may read 'we did not look' as 'food'.
                    $alchFlags = 0
                    $rule = ''
                    if ($VALUE_RULES.ContainsKey($type)) { $rule = $VALUE_RULES[$type] }
                    while ($k + 6 -le $rec.Length) {
                        $sub = [System.Text.Encoding]::ASCII.GetString($rec, $k, 4)
                        $sz  = [int][BitConverter]::ToUInt16($rec, $k + 4)
                        $k += 6
                        if ($over -gt 0) { $sz = $over; $over = 0 }
                        if ($sub -eq 'XXXX') { $over = [int][BitConverter]::ToUInt32($rec, $k); $k += $sz; continue }
                        if ($sub -eq 'EDID' -and $sz -gt 1) {
                            $edid = [System.Text.Encoding]::GetEncoding(1252).GetString($rec, $k, $sz - 1)
                        } elseif ($sub -eq 'FULL') {
                            if ($loc -and $sz -eq 4) {
                                $sid = [BitConverter]::ToUInt32($rec, $k)
                                if ($strTable -and $strTable.ContainsKey($sid)) { $full = $strTable[$sid]; $fullFrom = 'string table' }
                            } elseif ($sz -gt 1) {
                                $full = [System.Text.Encoding]::GetEncoding(1252).GetString($rec, $k, $sz - 1)
                                $fullFrom = 'the record'
                            }
                        } elseif ($rule -eq 'DATA0' -and $sub -eq 'DATA' -and $sz -ge 4) {
                            $value = [int][BitConverter]::ToUInt32($rec, $k)
                        } elseif ($rule -eq 'ENIT0' -and $sub -eq 'ENIT' -and $sz -ge 4) {
                            $value = [int][BitConverter]::ToUInt32($rec, $k)
                            # AND THE FLAG WORD BEHIND THE VALUE, which is what
                            # tells a cabbage from a mountain flower. ENIT on an
                            # ALCH is the value in gold and then this, and bit
                            # ALCH_FLAG_FOOD in it is the food bit, proved in
                            # scripts\dev\Build-RecipeTable.ps1 and quoted over that
                            # knob at the top. Read in the same pass as the
                            # value, off the same four bytes further along, so
                            # there is no second walk of these records able to
                            # come back with a different answer about one.
                            if ($sz -ge 8) { $alchFlags = [int][BitConverter]::ToUInt32($rec, $k + 4) }
                        }
                        $k += $sz
                    }
                    if (-not $full) { $full = $edid; $fullFrom = 'the editor id' }
                    # what the plugin that DEFINED this item said it was
                    # worth, kept so a later plugin repricing it is visible
                    $firstValue  = $value
                    $firstSeenIn = $pl
                    if ($produce.ContainsKey($desc)) {
                        $firstValue  = $produce[$desc].FirstValue
                        $firstSeenIn = $produce[$desc].FirstSeenIn
                    }
                    $produce[$desc] = [pscustomobject]@{
                        Desc        = $desc
                        Type        = $type
                        Edid        = $edid
                        Full        = $full
                        FullFrom    = $fullFrom
                        Value       = $value
                        AlchFlags   = $alchFlags
                        IsFood      = [bool](($type -eq 'ALCH') -and ($alchFlags -band $ALCH_FLAG_FOOD))
                        SeenIn      = $pl
                        FirstValue  = $firstValue
                        FirstSeenIn = $firstSeenIn
                    }
                }
                $j += 24 + $dataSize
            }
        }
        $i += $groupSize
    }
}

$unresolved = New-Object 'System.Collections.Generic.List[string]'
foreach ($w in ($wanted.Keys | Sort-Object)) { if (-not $produce.ContainsKey($w)) { $unresolved.Add($w) } }
if ($unresolved.Count -gt 0) {
    Bad ("{0} produce form id(s) name no record in this build: {1}" -f $unresolved.Count, ($unresolved -join ', '))
    foreach ($u in $unresolved) {
        foreach ($d in $plants.Keys) {
            if ($plants[$d].ProduceDesc -eq $u) { Note ("  wanted by {0} {1} ({2})" -f $d, $plants[$d].Edid, $plants[$d].Full) }
        }
    }
} else {
    Ok ("all {0} resolved" -f $produce.Count)
}
$byType = @{}
foreach ($d in $produce.Keys) {
    $t = $produce[$d].Type
    if (-not $byType.ContainsKey($t)) { $byType[$t] = 0 }
    $byType[$t] = $byType[$t] + 1
}
foreach ($t in ($byType.Keys | Sort-Object)) { Note ("{0}: {1}" -f $t, $byType[$t]) }

# A mod later in the load order that reprices an item moves the rank of every
# plant that grows it, which is the load order doing its job and is worth
# seeing rather than guessing at.
$repriced = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in ($produce.Keys | Sort-Object)) {
    $q = $produce[$d]
    if ($q.SeenIn -ne $q.FirstSeenIn -and $q.Value -ne $q.FirstValue) {
        $repriced.Add(("{0} {1}g in {2}, {3}g in {4}" -f $q.Full, $q.FirstValue, $q.FirstSeenIn, $q.Value, $q.SeenIn))
    }
}
if ($repriced.Count -gt 0) {
    Note ("{0} of them are repriced by a plugin later in the load order, and the later price is the one used:" -f $repriced.Count)
    foreach ($r in $repriced) { Note ('  ' + $r) }
}

# ------------------------------------------------------------- the ranking --

Write-Host ''
Write-Host 'ranking' -ForegroundColor Cyan
$table    = New-Object System.Collections.Specialized.OrderedDictionary
$detail   = New-Object System.Collections.Specialized.OrderedDictionary
$unranked = New-Object System.Collections.Specialized.OrderedDictionary
$values   = New-Object 'System.Collections.Generic.List[int]'
$fish     = New-Object System.Collections.Specialized.OrderedDictionary
$fishSeen = @{}
# the hunter's hanging game, and the rows the food rule sends to the farmer.
# forFarmer is a set of descs rather than a table of its own: the crops pass
# below already knows how to price a crop and time it, and this only has to say
# which plants reached it. Every desc in here is checked against the crops table
# afterwards, because a row that left the gatherer and joined nothing is work
# that left the game, which is the whole failure this change is undoing.
$game      = New-Object System.Collections.Specialized.OrderedDictionary
$gameSeen  = @{}
$forFarmer = New-Object System.Collections.Specialized.OrderedDictionary
$foodRows  = 0
$stayed    = New-Object 'System.Collections.Generic.List[string]'

foreach ($d in ($plants.Keys | Sort-Object)) {
    $p = $plants[$d]
    if (-not $produce.ContainsKey($p.ProduceDesc)) { continue }
    $q = $produce[$p.ProduceDesc]

    # The fisher's records come out here, before anything ranks them, so the
    # plant table never carries one. The case for the list and for every rank
    # in it is in the fish knobs at the top.
    if ($FISH_BY_EDITOR_ID -contains [string]$p.Edid) {
        $fishSeen[[string]$p.Edid] = $true
        if ($FISH_NOT_A_CATCH -contains [string]$p.Edid) {
            $unranked[$d] = [ordered]@{
                editorId    = $p.Edid
                name        = $p.Full
                produce     = $q.Desc
                produceName = $q.Full
                produceType = $q.Type
                why         = 'it is water produce, so it is the fisher''s and not the gatherer''s, and it is named in FISH_NOT_A_CATCH at the top of this script as one that is not a catch either'
            }
            continue
        }
        if (-not $FISH_RANK_BY_EDITOR_ID.ContainsKey([string]$p.Edid)) {
            Bad ("{0} is named as water produce and no rank is set for it in FISH_RANK_BY_EDITOR_ID" -f $p.Edid)
            continue
        }
        $fish[$d] = [pscustomobject]@{
            Produce = $q.Desc
            Name    = $q.Full
            From    = $p.Full
            Rank    = [string]$FISH_RANK_BY_EDITOR_ID[[string]$p.Edid]
        }
        continue
    }

    # ---------------------------------------------------------------------
    # AND THEN THE FOOD COMES OUT, which is Patrick's correction of
    # 21 September and is the one rule this pass sorts by that is not a price.
    #
    # A GATHERER GATHERS REAGENTS. A plant whose produce is an alchemy reagent
    # is theirs and a plant whose produce is food is not, and food is the ALCH
    # food bit read off the record in the produce pass above, never a list of
    # names. The whole argument is in the header and over ALCH_FLAG_FOOD.
    #
    # It sits here, after the fish and before anything is ranked, for the same
    # reason the fish branch does: a row that is not the gatherer's must never
    # be priced, ranked and written into the gatherer's table at all, rather
    # than written and then taken out again somewhere downstream.
    #
    # Four ways out and every row takes one of them. The run prints the count on
    # each and the checks below prove the sum, because the failure to fear here
    # is not a row in the wrong table, it is a row in no table.
    if ($q.IsFood) {
        $foodRows++
        if ($FOOD_STAYS_THE_GATHERERS -contains [string]$p.Edid) {
            # The Soul Husk, and nothing else on this build. Named, argued for
            # over FOOD_STAYS_THE_GATHERERS, and it falls through to the ranking
            # below exactly as if the food bit had not been set. Reported by
            # name every run because this is the rule being overruled.
            $stayed.Add([string]$p.Edid)
        } elseif ($GAME_BY_EDITOR_ID -contains [string]$p.Edid) {
            $gameSeen[[string]$p.Edid] = $true
            if (-not $GAME_RANK_BY_EDITOR_ID.ContainsKey([string]$p.Edid)) {
                Bad ("{0} is named as hanging game and no rank is set for it in GAME_RANK_BY_EDITOR_ID" -f $p.Edid)
                continue
            }
            $game[$d] = [pscustomobject]@{
                Produce = $q.Desc
                Name    = $q.Full
                From    = $p.Full
                Rank    = [string]$GAME_RANK_BY_EDITOR_ID[[string]$p.Edid]
            }
            continue
        } elseif ($FOOD_PROP_BY_EDITOR_ID -contains [string]$p.Edid) {
            $unranked[$d] = [ordered]@{
                editorId    = $p.Edid
                name        = $p.Full
                produce     = $q.Desc
                produceName = $q.Full
                produceType = $q.Type
                why         = 'its produce is food, so it is not the gatherer''s, and it is named in FOOD_PROP_BY_EDITOR_ID at the top of this script as a prop that is neither a plant anybody grows nor an animal anybody took, so it is in none of the tables this script writes'
            }
            continue
        } else {
            # A grown crop. It is not written into a table here: the crops pass
            # below reads the same plants again, and this only records that the
            # food rule sent this one to the farmer, so the check afterwards can
            # prove the crops pass picked every one of them up.
            $forFarmer[$d] = [string]$p.Edid
            continue
        }
    }

    # A farmyard plant whose produce is a reagent (issue #628): out before it
    # is ranked, for the same reason as the fish and the food. The argument is
    # over FARMYARD_BY_EDITOR_ID at the top.
    if ($FARMYARD_BY_EDITOR_ID -contains [string]$p.Edid) {
        $unranked[$d] = [ordered]@{
            editorId    = $p.Edid
            name        = $p.Full
            produce     = $q.Desc
            produceName = $q.Full
            produceType = $q.Type
            why         = 'it is kept in a farmyard rather than found in the wild, so it is the farmer''s and not the gatherer''s, and it is named in FARMYARD_BY_EDITOR_ID at the top of this script: collectEgg() in game\gamemode.js answers it with the farm verb, so it is in none of the tables this script writes'
        }
        continue
    }

    $why = ''
    if ($creation.ContainsKey([string]$d) -or $creation.ContainsKey([string]$q.Desc)) {
        $why = 'it or its produce is a Creation Club record: every Special Edition has it, but its art comes with the Creation Club files Thornswood leaves out, so nobody is handed one'
    } elseif ($ourStations.Contains([string]$d)) {
        $why = 'this server places this one itself and answers it with the station code written for it, so it is not a plant for this pass to rank'
    } elseif ($PRODUCE_WITHOUT_A_PRICE -contains $q.Type) {
        $why = 'its produce is a ' + $q.Type + ', which is a list of things rather than one thing, and carries no price'
    } elseif ($PRODUCE_NOT_GATHERED -contains $q.Type) {
        $why = 'its produce is a ' + $q.Type + ', which is not material anybody gathers'
    } elseif ([string]$q.Type -eq 'MISC' -and ([string]$q.Full) -match $PRODUCE_A_SCRIPT_MUST_OPEN) {
        $why = 'its produce is a sack, ' + $q.Full + ', that only a Papyrus script opens, and this server does not run Papyrus'
    } elseif (-not $VALUE_RULES.ContainsKey($q.Type)) {
        $why = 'nothing here knows where the price sits in a ' + $q.Type + ' record'
    } elseif ($q.Value -lt 0) {
        $why = 'its produce is a ' + $q.Type + ' with no readable price'
    }
    if ($why) {
        $unranked[$d] = [ordered]@{
            editorId    = $p.Edid
            name        = $p.Full
            produce     = $q.Desc
            produceName = $q.Full
            produceType = $q.Type
            why         = $why
        }
        continue
    }
    $values.Add([int]$q.Value)
    $rank = Rank-For ([int]$q.Value)
    $table[$d] = [pscustomobject]@{ Produce = $q.Desc; Name = $q.Full; Rank = $rank }
    $detail[$d] = [ordered]@{
        rank         = $rank
        produce      = $q.Desc
        produceName  = $q.Full
        produceType  = $q.Type
        produceValue = [int]$q.Value
        produceFrom  = $q.SeenIn
        name         = $p.Full
        editorId     = $p.Edid
        recordType   = $p.Kind
        plugin       = $p.Plugin
        definedIn    = $p.SeenIn
        formId       = '0x' + ('{0:X6}' -f ([Convert]::ToUInt32($d.Substring(0, $d.IndexOf(':')), 16)))
        seasons      = $p.Seasons
        nameFrom     = $p.FullFrom
    }
}

if ($values.Count -gt 0) {
    $arr = $values.ToArray()
    [Array]::Sort($arr)
    $sum = 0
    foreach ($v in $arr) { $sum += $v }
    Ok ("{0} plants ranked; produce values run {1} to {2}, median {3}, mean {4:n1}" -f `
        $arr.Length, $arr[0], $arr[$arr.Length - 1], $arr[[int]($arr.Length / 2)], ($sum / $arr.Length))
    $spread = @{}
    foreach ($v in $arr) { if (-not $spread.ContainsKey($v)) { $spread[$v] = 0 }; $spread[$v] = $spread[$v] + 1 }
    $line = New-Object 'System.Collections.Generic.List[string]'
    foreach ($v in ($spread.Keys | Sort-Object)) { $line.Add(("{0}g x{1}" -f $v, $spread[$v])) }
    Note ('the whole spread: ' + ($line -join ', '))
}
$perRank = New-Object System.Collections.Specialized.OrderedDictionary
foreach ($r in $RANK_MAX_VALUE) { $perRank[[string]$r.Rank] = 0 }
foreach ($d in $table.Keys) { $perRank[[string]$table[$d].Rank] = $perRank[[string]$table[$d].Rank] + 1 }
foreach ($r in $RANK_MAX_VALUE) {
    Note ("{0,-9} value up to {1,-10} {2} plants" -f $r.Rank, $r.Max, $perRank[[string]$r.Rank])
}
# What the records price at nothing, now that the sacks are out of the table:
# white cap, imp stool and namira's rot, which really are worth nothing, the
# fake coin in the clam at Oar's Rest and the canticle bark in the Ancestor
# Glade. They land on the first rung together and that is the right place for
# them. This still reports them every run, because a produce record repriced to
# 0 by a plugin later in the order is how a dear ingredient would quietly
# become a novice pick, and the line below is the only place that would show it.
$freeOnes = @{}
foreach ($d in $table.Keys) {
    $q = $produce[$plants[$d].ProduceDesc]
    if ([int]$q.Value -eq 0) { $freeOnes[$q.Desc] = $q }
}
if ($freeOnes.Count -gt 0) {
    Note ("{0} of the produce records are priced at 0 gold, so every plant that grows one is the lowest rank:" -f $freeOnes.Count)
    foreach ($k in ($freeOnes.Keys | Sort-Object { $freeOnes[$_].Full })) {
        Note ("  {0,-30} {1} {2}" -f $freeOnes[$k].Full, $freeOnes[$k].Type, $k)
    }
}

if ($unranked.Count -gt 0) {
    Note ("{0} plants have no usable price and are in the json's unranked list, not the table:" -f $unranked.Count)
    foreach ($d in $unranked.Keys) {
        Note ("  {0} {1} -> {2} {3}" -f $d, $unranked[$d].editorId, $unranked[$d].produceType, $unranked[$d].produce)
    }
}

# --------------------------------------------------------------- the food ---
#
# What the food rule did, said out loud every run. This is the line somebody
# reads when they want to know whether a plant moved and where it went, and the
# four counts below have to add up to the number of food rows the records carry,
# which is the arithmetic the checks make again further down.
#
Write-Host ''
Write-Host 'food' -ForegroundColor Cyan
Ok ("{0} of the plants give food, read off the ALCH food bit rather than off a list of names" -f $foodRows)
Note ("{0,3} are a grown crop and go to the farmer" -f $forFarmer.Count)
Note ("{0,3} are hanging game and go to the hunter" -f $game.Count)
$propRows = 0
foreach ($e in $FOOD_PROP_BY_EDITOR_ID) {
    foreach ($d in $unranked.Keys) { if ([string]$unranked[$d].editorId -eq [string]$e) { $propRows++ } }
}
Note ("{0,3} are a prop that is neither a plant nor an animal and are in none of these tables: {1}" -f $propRows, ($FOOD_PROP_BY_EDITOR_ID -join ', '))
Note ("{0,3} are named in FOOD_STAYS_THE_GATHERERS and stay in the plant table: {1}" -f $stayed.Count, ($stayed -join ', '))
if ($forFarmer.Count -gt 0) {
    Note 'the rows the food rule sent to the farmer, which the crops pass below has to pick up every one of:'
    foreach ($d in $forFarmer.Keys) { Note ("  {0,-30} {1}" -f $forFarmer[$d], $d) }
}
# A name nobody carries in either routing list is the same fault the fish list
# fails on: a record renamed out from under this takes work off a class quietly.
# The game list is checked against the build below with the rest of the game
# pass; the prop list and the stay list are checked here because neither has a
# pass of its own.
foreach ($e in $FOOD_PROP_BY_EDITOR_ID) {
    $found = $false
    foreach ($d in $plants.Keys) { if ([string]$plants[$d].Edid -eq [string]$e) { $found = $true } }
    if (-not $found) { Bad ("{0} is named in FOOD_PROP_BY_EDITOR_ID and no plant in this build carries that editor id" -f $e) }
}
foreach ($e in $FOOD_STAYS_THE_GATHERERS) {
    $found = $false
    foreach ($d in $plants.Keys) { if ([string]$plants[$d].Edid -eq [string]$e) { $found = $true } }
    if (-not $found) { Bad ("{0} is named in FOOD_STAYS_THE_GATHERERS and no plant in this build carries that editor id" -f $e) }
}
# The farmyard list (#628) is checked the same way, and said out loud: a nest
# renamed out from under it would drop back into the gatherer's table quietly.
$farmyardRows = 0
foreach ($e in $FARMYARD_BY_EDITOR_ID) {
    $found = $false
    foreach ($d in $plants.Keys) { if ([string]$plants[$d].Edid -eq [string]$e) { $found = $true } }
    if (-not $found) { Bad ("{0} is named in FARMYARD_BY_EDITOR_ID and no plant in this build carries that editor id" -f $e) }
    foreach ($d in $unranked.Keys) { if ([string]$unranked[$d].editorId -eq [string]$e) { $farmyardRows++ } }
}
Note ("{0,3} give a reagent and are the farmer's farmyard, in none of these tables: {1}" -f $farmyardRows, ($FARMYARD_BY_EDITOR_ID -join ', '))

# --------------------------------------------------------------- the fish ---
#
# The water produce, pulled out of the plants above and ranked by name rather
# than by price. The case for all of it is in the fish knobs at the top.
#
Write-Host ''
Write-Host 'fish' -ForegroundColor Cyan
$missingFish = New-Object 'System.Collections.Generic.List[string]'
foreach ($e in $FISH_BY_EDITOR_ID) {
    if (-not $fishSeen.ContainsKey([string]$e)) { $missingFish.Add([string]$e) }
}
if ($missingFish.Count -gt 0) {
    # A named record that no plugin in this build carries is a failure, not a
    # note. Either the build lost a plugin or a record was renamed, and both of
    # those take work off the fisher quietly, which is the thing this list was
    # written to stop happening a second time.
    Bad ("{0} of the records named in FISH_BY_EDITOR_ID are in no plugin in this build: {1}" -f `
        $missingFish.Count, ($missingFish -join ', '))
} else {
    Ok ("all {0} records named as water produce were found" -f $FISH_BY_EDITOR_ID.Count)
}
foreach ($e in $FISH_RANK_BY_EDITOR_ID.Keys) {
    if (-not ($FISH_BY_EDITOR_ID -contains [string]$e)) {
        Bad ("{0} has a Fisher rank set for it and is not named in FISH_BY_EDITOR_ID, so nothing reads that rank" -f $e)
    }
}
# AND THE RANK HAS TO BE ONE OF THE FOUR. Added 20 September, after a read of
# fish() in game\gamemode.js showed that a rank it does not know used to take
# the gate away instead of closing it: the ladder test there is
# RANK_LADDER.indexOf(rank), which answers -1 for anything that is not one of
# the four, and -1 is not greater than 0, so the test was skipped and the record
# was handed to a novice. Measured against the real fish() with one row in the
# table: writing 'Expert' with a capital E here instead of 'expert' gave a novice
# fisher 'You take 1 Pearl out of the Pearl Oyster.' with no refusal anywhere.
# The pass above only asked ContainsKey, so the run said nothing and installed
# the typo. These knobs are typed by hand one record at a time, which is exactly
# the place a one character difference gets in.
#
# gamemode.js now treats an unknown rank as the strictest rank rather than none,
# so the door has two locks; this is the one that says which knob is wrong and
# stops the table being written at all, and it is the same check
# Build-HuntTable.ps1 already fails its run on.
$fishRankNames = New-Object 'System.Collections.Generic.List[string]'
foreach ($r in $RANK_MAX_VALUE) { $fishRankNames.Add([string]$r.Rank) }
$oddFishRank = 0
foreach ($e in $FISH_RANK_BY_EDITOR_ID.Keys) {
    $r = [string]$FISH_RANK_BY_EDITOR_ID[[string]$e]
    if (-not ($fishRankNames -ccontains $r)) {
        $oddFishRank++
        Bad ("{0} is set to the Fisher rank '{1}', which is not one of the four classes.md names ({2}). The gate in fish() is the rank string, so a rank nothing recognises is a rank nothing enforces." -f `
            $e, $r, ($fishRankNames -join ', '))
    }
}
if ($oddFishRank -eq 0) {
    Ok "every Fisher rank named in FISH_RANK_BY_EDITOR_ID is one of classes.md's four, spelled the way fish() reads them"
}
$fishPerRank = New-Object System.Collections.Specialized.OrderedDictionary
foreach ($r in $RANK_MAX_VALUE) { $fishPerRank[[string]$r.Rank] = 0 }
foreach ($d in $fish.Keys) { $fishPerRank[[string]$fish[$d].Rank] = $fishPerRank[[string]$fish[$d].Rank] + 1 }
Ok ("{0} water records are the fisher's and are out of the plant table" -f $fish.Count)
foreach ($r in $RANK_MAX_VALUE) {
    Note ("{0,-9} {1} records" -f $r.Rank, $fishPerRank[[string]$r.Rank])
}
foreach ($d in $fish.Keys) {
    Note ("  {0,-24} {1,-22} -> {2,-20} {3}" -f $d, $fish[$d].From, $fish[$d].Name, $fish[$d].Rank)
}
# The first rung is what a new fisher has, and a fisher who cannot fish cannot
# climb. This is the line that would show it emptying.
if ($fishPerRank['novice'] -lt 1) {
    Bad "not one water record is a novice's, so a new fisher has nothing to work and can never leave the first rank"
}

# --------------------------------------------------------------- the game ---
#
# The hanging game, pulled out of the plants by the food rule above and ranked
# by name rather than by price. The case for the list and for every rank in it
# is in the food knobs at the top, and every check below is the one the fish
# pass already makes, for the reason it already makes it.
#
Write-Host ''
Write-Host 'game' -ForegroundColor Cyan
$missingGame = New-Object 'System.Collections.Generic.List[string]'
foreach ($e in $GAME_BY_EDITOR_ID) {
    if (-not $gameSeen.ContainsKey([string]$e)) { $missingGame.Add([string]$e) }
}
if ($missingGame.Count -gt 0) {
    # A named record that no plugin in this build carries, or one whose produce
    # has stopped reading as food, is a failure and not a note. Either the build
    # lost a plugin or a record was renamed or repriced, and every one of those
    # takes work off the hunter quietly, which is the thing this list exists to
    # stop happening a second time. The same check the fish list fails on.
    Bad ("{0} of the records named in GAME_BY_EDITOR_ID are in no plugin in this build, or their produce no longer reads as food: {1}" -f `
        $missingGame.Count, ($missingGame -join ', '))
} else {
    Ok ("all {0} records named as hanging game were found and their produce reads as food" -f $GAME_BY_EDITOR_ID.Count)
}
foreach ($e in $GAME_RANK_BY_EDITOR_ID.Keys) {
    if (-not ($GAME_BY_EDITOR_ID -contains [string]$e)) {
        Bad ("{0} has a Hunter rank set for it and is not named in GAME_BY_EDITOR_ID, so nothing reads that rank" -f $e)
    }
}
# AND THE RANK HAS TO BE ONE OF THE FOUR, spelled the way the gamemode reads
# them. The whole of the case is written over the same check in the fish pass
# above: the ladder test in the gamemode is RANK_LADDER.indexOf(rank), a rank
# that is not one of the four answers -1, and until 20 September -1 took the
# gate away instead of closing it. game() now treats an unknown rank as the
# strictest rank, the way fish() does, so this is the second lock on that door
# and the one that says which knob is wrong.
$gameRankNames = New-Object 'System.Collections.Generic.List[string]'
foreach ($r in $RANK_MAX_VALUE) { $gameRankNames.Add([string]$r.Rank) }
$oddGameRank = 0
foreach ($e in $GAME_RANK_BY_EDITOR_ID.Keys) {
    $r = [string]$GAME_RANK_BY_EDITOR_ID[[string]$e]
    if (-not ($gameRankNames -ccontains $r)) {
        $oddGameRank++
        Bad ("{0} is set to the Hunter rank '{1}', which is not one of the four classes.md names ({2}). The gate in game() is the rank string, so a rank nothing recognises is a rank nothing enforces." -f `
            $e, $r, ($gameRankNames -join ', '))
    }
}
if ($oddGameRank -eq 0) {
    Ok "every Hunter rank named in GAME_RANK_BY_EDITOR_ID is one of classes.md's four, spelled the way game() reads them"
}
$gamePerRank = New-Object System.Collections.Specialized.OrderedDictionary
foreach ($r in $RANK_MAX_VALUE) { $gamePerRank[[string]$r.Rank] = 0 }
foreach ($d in $game.Keys) { $gamePerRank[[string]$game[$d].Rank] = $gamePerRank[[string]$game[$d].Rank] + 1 }
Ok ("{0} hanging game records are the hunter's and are out of the plant table" -f $game.Count)
foreach ($r in $RANK_MAX_VALUE) {
    Note ("{0,-9} {1} records" -f $r.Rank, $gamePerRank[[string]$r.Rank])
}
foreach ($d in $game.Keys) {
    Note ("  {0,-24} {1,-22} -> {2,-20} {3}" -f $d, $game[$d].From, $game[$d].Name, $game[$d].Rank)
}
# The first rung is what a new hunter has, and a hunter who cannot work a body
# cannot climb. This is the line that would show it emptying.
if ($gamePerRank['novice'] -lt 1) {
    Bad "not one hanging game record is a novice's, so a new hunter has nothing here to work and can never leave the first rank"
}

# -------------------------------------------------------------- the crops ---
#
# The same plants again, this time asking which of them is a plot somebody
# farms. The rule and every exclusion are in the crop knobs at the top and the
# case for them is in the header. This pass invents no records: a crop is one
# of the plants the pass above already read, with a rank off the same price and
# a grow time worked out from it.
#
Write-Host ''
Write-Host 'crops' -ForegroundColor Cyan
$crops    = New-Object System.Collections.Specialized.OrderedDictionary
$cropWhy  = New-Object System.Collections.Specialized.OrderedDictionary
$planters = New-Object 'System.Collections.Generic.List[string]'
$byName   = 0

foreach ($d in ($plants.Keys | Sort-Object)) {
    $p = $plants[$d]

    # the HearthFires planters first, so a planter can never be picked up by
    # the rule or by a name below it
    $isPlanter = $false
    foreach ($pre in $CROP_NOT_A_PLOT_PREFIX) {
        if ([string]$p.Edid -like ($pre + '*')) { $isPlanter = $true }
    }
    if ($isPlanter) { $planters.Add([string]$p.Edid); continue }

    # and a base this server places itself is never a plot either, for the
    # reason written over OUR_STATIONS at the top: it is answered by the
    # station code and not by a table built out of a sweep of the load order.
    if ($ourStations.Contains([string]$d)) { continue }

    # nor is a piece of water produce, nor hanging game. The food rule above
    # already sent those somewhere else and forFarmer carries neither, so this
    # catches nothing today. It is kept, and game is added to it, because the
    # only line standing between this pass and a salmon or a hanging pheasant
    # sown in a field is the routing above, and a crop these two lists would
    # have caught is a crop somebody widened the rule into by accident.
    if ($FISH_BY_EDITOR_ID -contains [string]$p.Edid) { continue }
    if ($GAME_BY_EDITOR_ID -contains [string]$p.Edid) { continue }

    $named = ($CROP_BY_EDITOR_ID -contains [string]$p.Edid)

    # A plant whose produce names no record in this build is already a failed
    # check above, and there is nothing here to rank or to time. It is failed
    # again by name when it is one of the crops named by hand, because that
    # list is written against this build and a name in it that resolves to
    # nothing means the list is now wrong.
    if (-not $produce.ContainsKey($p.ProduceDesc)) {
        if ($named) {
            Bad ("the named crop {0} ({1}) has produce {2}, which names no record in this build" -f $p.Edid, $d, $p.ProduceDesc)
        }
        continue
    }
    $q = $produce[$p.ProduceDesc]

    # A crop is what the food rule above routed to the farmer, and this asks
    # forFarmer rather than re-deciding it. The two passes read the same plants
    # and a rule written out twice is two rules able to disagree about one
    # record, which is exactly how the FLOR apples ended up in the gatherer's
    # table while the TREE apples were crops. One rule, one place, one answer.
    $byRule = $forFarmer.Contains([string]$d)
    if (-not $byRule -and -not $named) { continue }

    # No price, no rank and no grow time, and a crop is not something to leave
    # half filled in: rank decides who may work a plot at all and the grow time
    # decides when it comes back, so an entry missing either would be a plot
    # anybody could strip. This fails the run rather than writing a guess.
    if (-not $VALUE_RULES.ContainsKey([string]$q.Type)) {
        Bad ("the crop {0} ({1}) gives a {2} and nothing here knows where the price sits in one" -f $p.Edid, $d, $q.Type)
        continue
    }
    if ([int]$q.Value -lt 0) {
        Bad ("the crop {0} ({1}) gives {2}, a {3} with no readable price, so it has no rank and no grow time" -f $p.Edid, $d, $q.Full, $q.Type)
        continue
    }

    if ($named -and -not $byRule) { $byName++ }
    $crops[$d] = [pscustomobject]@{
        Produce = $q.Desc
        Name    = $q.Full
        Rank    = $(if ($CROP_RANK_BY_EDITOR_ID.ContainsKey([string]$p.Edid)) {
                        $CROP_RANK_BY_EDITOR_ID[[string]$p.Edid]
                    } else {
                        # Not on the farm ladder, so the gold rule is all there
                        # is. Reported below rather than passed over in silence.
                        Rank-For ([int]$q.Value)
                    })
        RankFrom = $(if ($CROP_RANK_BY_EDITOR_ID.ContainsKey([string]$p.Edid)) { 'the farm ladder' } else { 'the gold rule, because the farm ladder does not name it' })
        Grow    = (Grow-Minutes ([int]$q.Value))
    }
    $how = 'a ' + $p.Kind + ' whose produce carries the ALCH food bit'
    if ($named -and -not $byRule) { $how = 'named in CROP_BY_EDITOR_ID, its produce type is ' + $q.Type }
    $cropWhy[$d] = $how
}

Ok ("{0} farm crops: {1} by the food rule and {2} named by hand" -f $crops.Count, ($crops.Count - $byName), $byName)
foreach ($d in $crops.Keys) {
    $c = $crops[$d]
    Note ("  {0,-34} {1,-22} {2,-9} {3,4} min   {4}" -f $plants[$d].Edid, $c.Name, $c.Rank, $c.Grow, $cropWhy[$d])
}
Note ("grow time is {0} + value x {1} minutes, capped at {2}; the {0} is the engine's own reloot hour and is a floor" -f `
    $CROP_GROW_MINUTES_BASE, $CROP_GROW_MINUTES_PER_GOLD, $CROP_GROW_MINUTES_MAX)
if ($planters.Count -gt 0) {
    Note ("{0} HearthFires planter records were left out: they are Skyrim's own plant-and-grow system and their MISC bundle only opens in a Papyrus script the server does not run" -f $planters.Count)
}

# ------------------------------------------------------------- the checks ---

Write-Host ''
Write-Host 'checks' -ForegroundColor Cyan

if ($table.Count -eq 0) { Bad 'no plants at all, so there is nothing to write' }
else { Ok ("{0} plants in the table" -f $table.Count) }

# duplicates: an OrderedDictionary cannot hold one key twice, so this is
# really a check that nothing built a key two different ways
$seen = @{}
$dupes = 0
foreach ($d in $table.Keys) {
    $key = [string]$d
    if ($seen.ContainsKey($key)) { Bad ("{0} is in the table twice" -f $key); $dupes++ }
    $seen[$key] = $true
}
if ($dupes -eq 0) { Ok 'no plant is in the table twice' }

# the ids: hex digits and a plugin named, on both sides of every entry. Four
# hex digits is a real length here, not a fault: gamemode.js already carries
# 9456:PlayFluteLuteDrum.esp.
$shape = '^[0-9a-f]{1,8}:[^:]+\.es[mpl]$'
$odd = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $table.Keys) {
    if ([string]$d -cnotmatch $shape) { $odd.Add(("the plant {0}" -f $d)) }
    if ([string]$table[$d].Produce -cnotmatch $shape) { $odd.Add(("the produce of {0}: {1}" -f $d, $table[$d].Produce)) }
}
if ($odd.Count -gt 0) { foreach ($o in $odd) { Bad ("an id that does not look right: {0}" -f $o) } }
else { Ok 'every desc on both sides is hex digits and a plugin' }

# a plant with no name is a message that reads 'You pick the .'
$nameless = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $table.Keys) { if (-not [string]$table[$d].Name) { $nameless.Add([string]$d) } }
if ($nameless.Count -gt 0) { Bad ("{0} entries have no name for their produce: {1}" -f $nameless.Count, ($nameless -join ', ')) }
else { Ok 'every entry names what it gives' }

# every rank is one of classes.md's four
$ranks = @('novice', 'advanced', 'expert', 'master')
$oddRank = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $table.Keys) { if ($ranks -notcontains [string]$table[$d].Rank) { $oddRank.Add([string]$d) } }
if ($oddRank.Count -gt 0) { Bad ("{0} entries have a rank that is not one of the four in classes.md" -f $oddRank.Count) }
else { Ok "every rank is one of classes.md's four" }

# the crops, checked the same way and for the same reasons. A crop table with a
# hole in it is worse than none: the server would gate a plot on a rank that is
# not a rank, or hand back a grow time of nothing and let the plot be stripped.
if ($crops.Count -eq 0) { Bad 'no farm crops at all, so the rule found nothing and the crops block would go out empty' }
else { Ok ("{0} crops in the crops table" -f $crops.Count) }

$seenCrop = @{}
$cropDupes = 0
foreach ($d in $crops.Keys) {
    $key = [string]$d
    if ($seenCrop.ContainsKey($key)) { Bad ("{0} is in the crops table twice" -f $key); $cropDupes++ }
    $seenCrop[$key] = $true
}
if ($cropDupes -eq 0) { Ok 'no crop is in the crops table twice' }

$oddCrop = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $crops.Keys) {
    if ([string]$d -cnotmatch $shape) { $oddCrop.Add(("the crop {0}" -f $d)) }
    if ([string]$crops[$d].Produce -cnotmatch $shape) { $oddCrop.Add(("the produce of the crop {0}: {1}" -f $d, $crops[$d].Produce)) }
}
if ($oddCrop.Count -gt 0) { foreach ($o in $oddCrop) { Bad ("an id that does not look right: {0}" -f $o) } }
else { Ok 'every crop desc on both sides is hex digits and a plugin' }

# a crop with no produce name is a message that reads 'The  is still growing.'
$namelessCrop = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $crops.Keys) { if (-not [string]$crops[$d].Name) { $namelessCrop.Add([string]$d) } }
if ($namelessCrop.Count -gt 0) { Bad ("{0} crops have no name for their produce: {1}" -f $namelessCrop.Count, ($namelessCrop -join ', ')) }
else { Ok 'every crop names what it gives' }

$oddCropRank = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $crops.Keys) { if ($ranks -notcontains [string]$crops[$d].Rank) { $oddCropRank.Add([string]$d) } }
if ($oddCropRank.Count -gt 0) { Bad ("{0} crops have a rank that is not one of the four in classes.md" -f $oddCropRank.Count) }
else { Ok "every crop's rank is one of classes.md's four" }

# THE NOVICE RUNG MUST NOT BE EMPTY. This is the check that would have caught
# the circle Patrick found on 20 September: every crop ranked advanced or above
# means a new Farmer has nothing to sow, no farming work to do, and therefore no
# way to the rank that would let them start. A farm ladder with no bottom rung
# is not a ladder.
$noviceCrops = @($crops.Keys | Where-Object { [string]$crops[$_].Rank -eq 'novice' })
if ($noviceCrops.Count -eq 0) {
    Bad "no crop asks for novice, so a new farmer has nothing they may sow and no way to earn a rank that would let them"
} else {
    Ok ("{0} crop(s) a novice farmer may sow on their first day" -f $noviceCrops.Count)
}

# And say which crops fell through the farm ladder onto the gold rule, because
# that is the rank nobody chose and it is the one worth arguing with.
$fellThrough = @($crops.Keys | Where-Object { [string]$crops[$_].RankFrom -ne 'the farm ladder' })
if ($fellThrough.Count -eq 0) {
    Ok 'every crop is ranked by the farm ladder'
} else {
    Note ("{0} crop(s) are not on the farm ladder and took the gold rule instead: {1}" -f $fellThrough.Count,
          (($fellThrough | ForEach-Object { [string]$crops[$_].Name + ' (' + [string]$crops[$_].Rank + ')' }) -join ', '))
}

# the floor is the whole design: under the engine's reloot hour the rule would
# call a crop ripe while the plant still looked picked
$oddGrow = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $crops.Keys) {
    $g = [int]$crops[$d].Grow
    if ($g -lt $CROP_GROW_MINUTES_BASE -or $g -gt $CROP_GROW_MINUTES_MAX) {
        $oddGrow.Add(("{0} grows in {1} minutes" -f $d, $g))
    }
}
if ($oddGrow.Count -gt 0) {
    Bad ("{0} crops have a grow time outside {1} to {2} minutes: {3}" -f `
        $oddGrow.Count, $CROP_GROW_MINUTES_BASE, $CROP_GROW_MINUTES_MAX, ($oddGrow -join ', '))
} else {
    Ok ("every crop grows in {0} to {1} minutes, never under the engine's own hour" -f $CROP_GROW_MINUTES_BASE, $CROP_GROW_MINUTES_MAX)
}

# THIS CHECK USED TO SAY THE OPPOSITE AND IT WAS TURNED AROUND ON 21 SEPTEMBER.
#
# It read 'every crop is a plant the harvests table already carries', because
# until Patrick's correction a cabbage was in both tables and a crop the plant
# table did not carry would have been a plot the gathering gate never saw. The
# whole of that change is that the gathering gate must not see a crop: a plant
# whose produce is food is not the gatherer's, so a crop leaving the plant table
# is the change working rather than a hole in it, and a check written the old
# way would fail on every one of the thirteen.
#
# What still has to hold is the other direction, and it is the one that catches
# a real fault: a crop whose produce is food must be OUT of the plant table, or
# a gatherer could pick a cabbage after all. Wheat gives an ingredient rather
# than a food, so the food rule never touches it and it is in both tables on
# purpose; it is the one named in CROP_BY_EDITOR_ID and the run says so by name
# rather than by a count. Tundra cotton (#626) is gatherer-only and must NOT be
# in the crops table.
$bothTables = New-Object 'System.Collections.Generic.List[string]'
$ingrCrops  = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $crops.Keys) {
    if (-not $table.Contains($d)) { continue }
    if ($produce.ContainsKey($plants[$d].ProduceDesc) -and $produce[$plants[$d].ProduceDesc].IsFood) {
        $bothTables.Add(("{0} ({1})" -f $plants[$d].Edid, $d))
    } else {
        $ingrCrops.Add([string]$plants[$d].Edid)
    }
}
if ($bothTables.Count -gt 0) {
    Bad ("{0} crop(s) give food and are still in the gatherer's table, so a gatherer can pick a crop: {1}" -f `
        $bothTables.Count, ($bothTables -join ', '))
} else {
    Ok ("no crop that gives food is in the gatherer's table; the {0} still in both give an ingredient and are the ones named by hand: {1}" -f `
        $ingrCrops.Count, ($ingrCrops -join ', '))
}

# AND NOTHING THE FOOD RULE MOVED MAY HAVE LANDED NOWHERE. This is the check
# that the four ways out of the food branch add up. A row taken off the gatherer
# and picked up by nobody is not a table with a wrong entry in it, it is a plant
# that quietly left the game, and nothing else here would say so: the plant
# table would be shorter and every other check would pass.
$dropped = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $forFarmer.Keys) { if (-not $crops.Contains($d)) { $dropped.Add(("{0} ({1})" -f $forFarmer[$d], $d)) } }
if ($dropped.Count -gt 0) {
    Bad ("{0} row(s) the food rule sent to the farmer never reached the crops table: {1}" -f $dropped.Count, ($dropped -join ', '))
} else {
    Ok ("every one of the {0} rows the food rule sent to the farmer is in the crops table" -f $forFarmer.Count)
}

# AND THE GATHERER'S TABLE IS REAGENTS AND NOTHING ELSE, which is the rule said
# back to itself off the built table rather than off the pass that built it.
# Every row left in it either gives something that is not food, or is one of the
# few named in FOOD_STAYS_THE_GATHERERS, and the run names those out loud
# because that list is the rule being overruled by hand.
$foodLeft = New-Object 'System.Collections.Generic.List[string]'
$namedLeft = 0
foreach ($d in $table.Keys) {
    $pd = $plants[$d].ProduceDesc
    if (-not ($produce.ContainsKey($pd) -and $produce[$pd].IsFood)) { continue }
    if ($FOOD_STAYS_THE_GATHERERS -contains [string]$plants[$d].Edid) { $namedLeft++; continue }
    $foodLeft.Add(("{0} ({1}) gives {2}" -f $plants[$d].Edid, $d, $produce[$pd].Full))
}
if ($foodLeft.Count -gt 0) {
    Bad ("{0} row(s) in the gatherer's table give food and are not named as staying there: {1}" -f `
        $foodLeft.Count, ($foodLeft -join ', '))
} else {
    Ok ("every row in the gatherer's table gives something that is not food, but for the {0} named in FOOD_STAYS_THE_GATHERERS" -f $namedLeft)
}

# THE FIRST RUNG OF THE GATHERER'S LADDER MUST NOT BE EMPTY EITHER. The crops,
# the fish and the game each have this check already and the plants did not,
# because until 21 September nothing ever took rows out of the plant table in
# bulk. Fourteen of the fifty-six novice rows are food and left in one change.
# A gatherer who cannot pick anything cannot climb, which is the same sentence
# three times over in this file now, and it is the same fault every time.
$novicePlants = @($table.Keys | Where-Object { [string]$table[$_].Rank -eq 'novice' })
if ($novicePlants.Count -eq 0) {
    Bad "no plant asks for novice, so a new gatherer has nothing they may pick and no way to earn a rank that would let them"
} else {
    Ok ("{0} plant(s) a novice gatherer may pick on their first day" -f $novicePlants.Count)
}

# the game table, checked the way the fish and the crops are and for the same
# reasons. A rank that is not a rank is a gate nothing enforces, an id that is
# not an id matches no reference in the world, and a row with no name is a
# sentence that reads 'You take 1  off the Hanging Pheasant.'
if ($game.Count -eq 0) { Bad 'no hanging game at all, so the food rule found none and the game block would go out empty' }
else { Ok ("{0} records in the game table" -f $game.Count) }

$oddGame = New-Object 'System.Collections.Generic.List[string]'
foreach ($d in $game.Keys) {
    if ([string]$d -cnotmatch $shape) { $oddGame.Add(("the game record {0}" -f $d)) }
    if ([string]$game[$d].Produce -cnotmatch $shape) { $oddGame.Add(("the produce of the game record {0}: {1}" -f $d, $game[$d].Produce)) }
    if (-not [string]$game[$d].Name) { $oddGame.Add(("the game record {0} has no name for what it gives" -f $d)) }
    if (-not [string]$game[$d].From) { $oddGame.Add(("the game record {0} has no name of its own" -f $d)) }
    if ($ranks -notcontains [string]$game[$d].Rank) { $oddGame.Add(("the game record {0} has a rank that is not one of the four in classes.md" -f $d)) }
    if ($table.Contains([string]$d)) { $oddGame.Add(("the game record {0} is in the gatherer's table as well" -f $d)) }
    if ($crops.Contains([string]$d)) { $oddGame.Add(("the game record {0} is in the crops table as well" -f $d)) }
    if ($fish.Contains([string]$d)) { $oddGame.Add(("the game record {0} is in the fish table as well" -f $d)) }
}
if ($oddGame.Count -gt 0) { foreach ($o in $oddGame) { Bad $o } }
else { Ok "every game record has an id, a name, a rank that is one of classes.md's four, and no second table claiming it" }

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

# ------------------------------------------------------------- the writing -

Write-Host ''
Write-Host 'writing' -ForegroundColor Cyan
# The json is written out by hand rather than with ConvertTo-Json, and there is
# no timestamp in it, so that the same game files give byte for byte the same
# file: ConvertTo-Json lays out Windows PowerShell 5.1 and PowerShell 7
# differently, and a rebuild that changed nothing would be a whole-file diff.
# It is joined with LF, as everything this writes is.
$jsonEol = $Eol
$docLines = New-Object 'System.Collections.Generic.List[string]'
$docLines.Add('{')
$docLines.Add('  "builtBy": ' + (JsonStr 'scripts\dev\Build-HarvestTable.ps1') + ',')
$docLines.Add('  "source": ' + (JsonStr ('the FLOR and TREE records of ' + (Get-LoadOrderName $order))) + ',')
$docLines.Add('  "language": ' + (JsonStr $LANGUAGE) + ',')
$docLines.Add('  "rankedBy": ' + (JsonStr 'the gold value of the produce, the thresholds in RANK_MAX_VALUE at the top of the script') + ',')
$docLines.Add('  "harvestsAre": ' + (JsonStr ('the plants whose produce is an alchemy reagent. A plant whose produce is food is not the gatherer''s: ' +
    'food is bit 0x2 of an ALCH record''s ENIT flag word, proved in scripts\dev\Build-RecipeTable.ps1, and those rows are in crops, game or unranked instead, ' +
    'but for the ones named in FOOD_STAYS_THE_GATHERERS at the top of the script. A plant named in FARMYARD_BY_EDITOR_ID (the chicken nest) gives a reagent ' +
    'and is still the farmer''s, so it is in unranked and not here')) + ',')
$docLines.Add('  "cropsRankedBy": ' + (JsonStr ('how hard the crop is to grow, named one at a time in CROP_RANK_BY_EDITOR_ID at the top of the script, ' +
    'because the gold value is the gatherer''s ladder and ranking a farm by it put every crop at advanced and left a new farmer nothing to sow')) + ',')
$thr = New-Object 'System.Collections.Generic.List[string]'
foreach ($r in $RANK_MAX_VALUE) { $thr.Add('    ' + (JsonStr ([string]$r.Rank)) + ': ' + [int]$r.Max) }
$docLines.Add('  "rankMaxValue": {')
$docLines.Add(($thr -join (',' + $jsonEol)))
$docLines.Add('  },')
$docLines.Add('  "count": ' + $table.Count + ',')
$docLines.Add('  "harvests": {')
$n = 0
foreach ($d in $table.Keys) {
    $n++
    $comma = ','
    if ($n -eq $table.Count) { $comma = '' }
    $e = $table[$d]
    $docLines.Add('    ' + (JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$e.Produce)) +
                  ', "name": ' + (JsonStr ([string]$e.Name)) +
                  ', "rank": ' + (JsonStr ([string]$e.Rank)) + ' }' + $comma)
}
$docLines.Add('  },')
# the crops sit beside the harvests rather than inside them: every crop is also
# a harvest, and a reader of this file should be able to see at a glance which
# of the plants are plots somebody farms.
$docLines.Add('  "cropsAre": ' + (JsonStr ('a plant of either record type whose produce carries the ALCH food bit and which is not hanging game, not a prop ' +
    'and not named as staying the gatherer''s, plus the ones named in CROP_BY_EDITOR_ID at the top of the script; the HearthFires planters are left out')) + ',')
$docLines.Add('  "cropGrowMinutes": ' + (JsonStr ('base + the produce value in gold x perGold, capped at max, and never under base, which is the hour the engine reloots a FLOR or TREE in on its own')) + ',')
$docLines.Add('  "cropGrowMinutesKnobs": {')
$docLines.Add('    "base": ' + [int]$CROP_GROW_MINUTES_BASE + ',')
$docLines.Add('    "perGold": ' + [int]$CROP_GROW_MINUTES_PER_GOLD + ',')
$docLines.Add('    "max": ' + [int]$CROP_GROW_MINUTES_MAX)
$docLines.Add('  },')
$docLines.Add('  "cropCount": ' + $crops.Count + ',')
$docLines.Add('  "crops": {')
$n = 0
foreach ($d in $crops.Keys) {
    $n++
    $comma = ','
    if ($n -eq $crops.Count) { $comma = '' }
    $c = $crops[$d]
    $docLines.Add('    ' + (JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$c.Produce)) +
                  ', "name": ' + (JsonStr ([string]$c.Name)) +
                  ', "rank": ' + (JsonStr ([string]$c.Rank)) +
                  ', "growMinutes": ' + [int]$c.Grow + ' }' + $comma)
}
$docLines.Add('  },')
# the water produce, beside the harvests rather than inside them. A reader of
# this file should be able to see at a glance which records are the fisher's,
# and the gamemode reads this map into a table of its own.
$docLines.Add('  "fishAre": ' + (JsonStr ('the records named in FISH_BY_EDITOR_ID at the top of the script, which are water produce and therefore the fisher''s work rather than the gatherer''s; ' +
    'the ones named in FISH_NOT_A_CATCH are left out and are in the unranked list instead')) + ',')
$docLines.Add('  "fishRankedBy": ' + (JsonStr ('the Fisher rank named one at a time in FISH_RANK_BY_EDITOR_ID at the top of the script, ' +
    'because every one of these produce records is priced at 2 or 3 gold and the gold rule that ranks a plant puts all of them on one rung')) + ',')
$docLines.Add('  "fishCount": ' + $fish.Count + ',')
$docLines.Add('  "fish": {')
$n = 0
foreach ($d in $fish.Keys) {
    $n++
    $comma = ','
    if ($n -eq $fish.Count) { $comma = '' }
    $f = $fish[$d]
    $docLines.Add('    ' + (JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$f.Produce)) +
                  ', "name": ' + (JsonStr ([string]$f.Name)) +
                  ', "from": ' + (JsonStr ([string]$f.From)) +
                  ', "rank": ' + (JsonStr ([string]$f.Rank)) + ' }' + $comma)
}
$docLines.Add('  },')
# the hanging game, beside the harvests the same way the fish are. A reader of
# this file should be able to see at a glance which records are the hunter's
# press-E work, and the gamemode reads this map into a table of its own.
$docLines.Add('  "gameAre": ' + (JsonStr ('the plants whose produce is food and which are named in GAME_BY_EDITOR_ID at the top of the script: hanging game, ' +
    'which is the hunter''s work rather than the gatherer''s. They are not in game\data\hunts.json because that table is built out of NPC_ records and ' +
    'loot() only answers a reference the engine says is a dead actor, and a hanging pheasant is a FLOR standing in a camp')) + ',')
$docLines.Add('  "gameRankedBy": ' + (JsonStr ('the Hunter rank named one at a time in GAME_RANK_BY_EDITOR_ID at the top of the script, ' +
    'because the three produce records are priced at 2, 3 and 4 gold and the gold rule that ranks a plant puts all of them on one rung')) + ',')
$docLines.Add('  "gameCount": ' + $game.Count + ',')
$docLines.Add('  "game": {')
$n = 0
foreach ($d in $game.Keys) {
    $n++
    $comma = ','
    if ($n -eq $game.Count) { $comma = '' }
    $g = $game[$d]
    $docLines.Add('    ' + (JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$g.Produce)) +
                  ', "name": ' + (JsonStr ([string]$g.Name)) +
                  ', "from": ' + (JsonStr ([string]$g.From)) +
                  ', "rank": ' + (JsonStr ([string]$g.Rank)) + ' }' + $comma)
}
$docLines.Add('  },')
$docLines.Add('  "unranked": {')
$n = 0
foreach ($d in $unranked.Keys) {
    $n++
    $comma = ','
    if ($n -eq $unranked.Count) { $comma = '' }
    $u = $unranked[$d]
    $docLines.Add('    ' + (JsonStr ([string]$d)) + ': {')
    $fields = New-Object 'System.Collections.Generic.List[string]'
    foreach ($f in $u.Keys) { $fields.Add('      "' + $f + '": ' + (JsonStr ([string]$u[$f]))) }
    $docLines.Add(($fields -join (',' + $jsonEol)))
    $docLines.Add('    }' + $comma)
}
$docLines.Add('  },')
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
        if ($f -eq 'produceValue') { $fields.Add('      "' + $f + '": ' + [int]$v[$f]) }
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
    Ok ("wrote {0} ({1} plants, {2} bytes)" -f $Out, $table.Count, $json.Length)
}

$lines = New-Object 'System.Collections.Generic.List[string]'
$lines.Add('/* Built by scripts\dev\Build-HarvestTable.ps1 out of the FLOR and TREE records of this build.')
$lines.Add('     ' + $table.Count + ' plants, the same table as game\data\harvests.json.')
$lines.Add('     The key is the plant''s base record. The server already picks a FLOR or TREE on')
$lines.Add('     its own, so onActivate only has to look the base up here and decide.')
$lines.Add('     The gamemode reads it from game\gamemode-tables\HARVESTS_BY_BASE.json. Do not hand edit. */')
$lines.Add('  var HARVESTS_BY_BASE = {')
$n = 0
foreach ($d in $table.Keys) {
    $n++
    $comma = ','
    if ($n -eq $table.Count) { $comma = '' }
    $e = $table[$d]
    # double quoted, the same as the installed block, so what is printed here
    # and what is written into the gamemode are the same text. Half these
    # names carry an apostrophe (Namira's Rot, Dragon's Tongue, Hawk's Egg)
    # and a single quoted literal would be one backslash away from broken.
    $lines.Add('    ' + (JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$e.Produce)) +
               ', "name": ' + (JsonStr ([string]$e.Name)) +
               ', "rank": ' + (JsonStr ([string]$e.Rank)) + ' }' + $comma)
}
$lines.Add('  };')
$literal = $lines -join [Environment]::NewLine

$cropLines = New-Object 'System.Collections.Generic.List[string]'
$cropLines.Add('/* Built by scripts\dev\Build-HarvestTable.ps1 out of the same records as the harvests.')
$cropLines.Add('     ' + $crops.Count + ' farm crops, the same table as the crops map in game\data\harvests.json.')
$cropLines.Add('     A crop is a plot somebody works rather than a plant anybody finds: a plant of')
$cropLines.Add('     either record type whose produce carries the ALCH food bit and which is not')
$cropLines.Add('     hanging game and not a prop, plus wheat, which gives an')
$cropLines.Add('     ingredient and is named one at a time in the script. Tundra cotton is gatherer flora (#626).')
$cropLines.Add('     growMinutes is how long after a pick the server counts the plot as grown.')
$cropLines.Add('     The engine reloots a FLOR or TREE an hour after a pick and the gamemode cannot')
$cropLines.Add('     set isHarvested or a reloot time, so the plant looks ready before it is: the')
$cropLines.Add('     server refuses the pick until growMinutes is up and says how long is left.')
$cropLines.Add('     The gamemode reads it from game\gamemode-tables\CROPS_BY_BASE.json. Do not hand edit. */')
$cropLines.Add('  var CROPS_BY_BASE = {')
$n = 0
foreach ($d in $crops.Keys) {
    $n++
    $comma = ','
    if ($n -eq $crops.Count) { $comma = '' }
    $c = $crops[$d]
    # double quoted for the same reason as the harvests literal above
    $cropLines.Add('    ' + (JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$c.Produce)) +
                   ', "name": ' + (JsonStr ([string]$c.Name)) +
                   ', "rank": ' + (JsonStr ([string]$c.Rank)) +
                   ', "growMinutes": ' + [int]$c.Grow + ' }' + $comma)
}
$cropLines.Add('  };')
$cropLiteral = $cropLines -join [Environment]::NewLine

$fishLines = New-Object 'System.Collections.Generic.List[string]'
$fishLines.Add('/* Built by scripts\dev\Build-HarvestTable.ps1 out of the same records as the harvests.')
$fishLines.Add('     ' + $fish.Count + ' water records, the same table as the fish map in game\data\harvests.json.')
$fishLines.Add('     These are the fisher''s and not the gatherer''s, and they are named one at a time')
$fishLines.Add('     in FISH_BY_EDITOR_ID at the top of the script because nothing in a salmon''s record')
$fishLines.Add('     says water. "from" is what stands in the world, "name" is what it gives.')
$fishLines.Add('     The rank is named one at a time too: every one of these produce records is priced')
$fishLines.Add('     at 2 or 3 gold, so the gold rule that ranks a plant puts all of them on one rung.')
$fishLines.Add('     The gamemode reads it from game\gamemode-tables\FISH_BY_BASE.json. Do not hand edit. */')
$fishLines.Add('  var FISH_BY_BASE = {')
$n = 0
foreach ($d in $fish.Keys) {
    $n++
    $comma = ','
    if ($n -eq $fish.Count) { $comma = '' }
    $f = $fish[$d]
    # double quoted for the same reason as the harvests literal above
    $fishLines.Add('    ' + (JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$f.Produce)) +
                   ', "name": ' + (JsonStr ([string]$f.Name)) +
                   ', "from": ' + (JsonStr ([string]$f.From)) +
                   ', "rank": ' + (JsonStr ([string]$f.Rank)) + ' }' + $comma)
}
$fishLines.Add('  };')
$fishLiteral = $fishLines -join [Environment]::NewLine

$gameLines = New-Object 'System.Collections.Generic.List[string]'
$gameLines.Add('/* Built by scripts\dev\Build-HarvestTable.ps1 out of the same records as the harvests.')
$gameLines.Add('     ' + $game.Count + ' hanging game records, the same table as the game map in game\data\harvests.json.')
$gameLines.Add('     These are the hunter''s and not the gatherer''s. A plant whose produce is food is')
$gameLines.Add('     not a thing a gatherer gathers, and these seven are the food rows that are an')
$gameLines.Add('     animal somebody hung up rather than a crop somebody grew. They are not rows in')
$gameLines.Add('     game\data\hunts.json because that table is NPC_ records and loot() reads the')
$gameLines.Add('     reference itself: a hanging pheasant is a FLOR and was never an actor.')
$gameLines.Add('     "from" is what hangs in the world, "name" is what it gives.')
$gameLines.Add('     The rank is named one at a time in GAME_RANK_BY_EDITOR_ID in the script: the')
$gameLines.Add('     three produce records are priced at 2, 3 and 4 gold, so the gold rule that ranks')
$gameLines.Add('     a plant puts all seven on one rung and the ladder would do nothing.')
$gameLines.Add('     The gamemode reads it from game\gamemode-tables\GAME_BY_BASE.json. Do not hand edit. */')
$gameLines.Add('  var GAME_BY_BASE = {')
$n = 0
foreach ($d in $game.Keys) {
    $n++
    $comma = ','
    if ($n -eq $game.Count) { $comma = '' }
    $g = $game[$d]
    # double quoted for the same reason as the harvests literal above
    $gameLines.Add('    ' + (JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$g.Produce)) +
                   ', "name": ' + (JsonStr ([string]$g.Name)) +
                   ', "from": ' + (JsonStr ([string]$g.From)) +
                   ', "rank": ' + (JsonStr ([string]$g.Rank)) + ' }' + $comma)
}
$gameLines.Add('  };')
$gameLiteral = $gameLines -join [Environment]::NewLine

# ---------------------------------------------------------------- install --
#
# The gamemode reads each of the four tables from game\gamemode-tables\<NAME>.json
# when it loads (#5191): until then this wrote them between markers in
# gamemode.js, and every content change rewrote the same lines there. They
# are four tables rather than one because the gamemode reads them at
# different moments: the harvests on any pick, the crops at a plot, the fish
# for a fisher and the game for a hunter. Nothing is written when a check
# failed, and -NoInstall prints them and leaves the files alone.
#
if (-not $NoInstall -and $fail -eq 0) {
    . (Join-Path $PSScriptRoot 'GamemodeTables.ps1')
    $rows = New-Object 'System.Collections.Generic.List[string]'
    foreach ($d in $table.Keys) {
        $e = $table[$d]
        $rows.Add((JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$e.Produce)) + ', "name": ' + (JsonStr ([string]$e.Name)) + ', "rank": ' + (JsonStr ([string]$e.Rank)) + ' }')
    }
    $changed = Write-GamemodeTable 'HARVESTS_BY_BASE' ('{' + ($rows -join ',') + '}')
    if ($changed) { Ok ("wrote {0} plants into {1}" -f $table.Count, (Get-GamemodeTableFile 'HARVESTS_BY_BASE')) }
    else { Ok ("{0} already holds these {1} plants" -f (Get-GamemodeTableFile 'HARVESTS_BY_BASE'), $table.Count) }
}

if (-not $NoInstall -and $fail -eq 0) {
    . (Join-Path $PSScriptRoot 'GamemodeTables.ps1')
    $rows = New-Object 'System.Collections.Generic.List[string]'
    foreach ($d in $crops.Keys) {
        $c = $crops[$d]
        $rows.Add((JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$c.Produce)) + ', "name": ' + (JsonStr ([string]$c.Name)) + ', "rank": ' + (JsonStr ([string]$c.Rank)) + ', "growMinutes": ' + [int]$c.Grow + ' }')
    }
    $changed = Write-GamemodeTable 'CROPS_BY_BASE' ('{' + ($rows -join ',') + '}')
    if ($changed) { Ok ("wrote {0} crops into {1}" -f $crops.Count, (Get-GamemodeTableFile 'CROPS_BY_BASE')) }
    else { Ok ("{0} already holds these {1} crops" -f (Get-GamemodeTableFile 'CROPS_BY_BASE'), $crops.Count) }
}

if (-not $NoInstall -and $fail -eq 0) {
    . (Join-Path $PSScriptRoot 'GamemodeTables.ps1')
    $rows = New-Object 'System.Collections.Generic.List[string]'
    foreach ($d in $fish.Keys) {
        $f = $fish[$d]
        $rows.Add((JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$f.Produce)) + ', "name": ' + (JsonStr ([string]$f.Name)) + ', "from": ' + (JsonStr ([string]$f.From)) + ', "rank": ' + (JsonStr ([string]$f.Rank)) + ' }')
    }
    $changed = Write-GamemodeTable 'FISH_BY_BASE' ('{' + ($rows -join ',') + '}')
    if ($changed) { Ok ("wrote {0} water records into {1}" -f $fish.Count, (Get-GamemodeTableFile 'FISH_BY_BASE')) }
    else { Ok ("{0} already holds these {1} water records" -f (Get-GamemodeTableFile 'FISH_BY_BASE'), $fish.Count) }
}

if (-not $NoInstall -and $fail -eq 0) {
    . (Join-Path $PSScriptRoot 'GamemodeTables.ps1')
    $rows = New-Object 'System.Collections.Generic.List[string]'
    foreach ($d in $game.Keys) {
        $g = $game[$d]
        $rows.Add((JsonStr ([string]$d)) + ': { "produce": ' + (JsonStr ([string]$g.Produce)) + ', "name": ' + (JsonStr ([string]$g.Name)) + ', "from": ' + (JsonStr ([string]$g.From)) + ', "rank": ' + (JsonStr ([string]$g.Rank)) + ' }')
    }
    $changed = Write-GamemodeTable 'GAME_BY_BASE' ('{' + ($rows -join ',') + '}')
    if ($changed) { Ok ("wrote {0} hanging game records into {1}" -f $game.Count, (Get-GamemodeTableFile 'GAME_BY_BASE')) }
    else { Ok ("{0} already holds these {1} hanging game records" -f (Get-GamemodeTableFile 'GAME_BY_BASE'), $game.Count) }
}

Write-Host ''
Write-Host 'the same table, as JavaScript (the gamemode reads its file in game\gamemode-tables):' -ForegroundColor Cyan
Write-Host $literal
Write-Host ''
Write-Host 'the crops, as JavaScript (the gamemode reads its file in game\gamemode-tables):' -ForegroundColor Cyan
Write-Host $cropLiteral
Write-Host ''
Write-Host 'the fish, as JavaScript (the gamemode reads its file in game\gamemode-tables):' -ForegroundColor Cyan
Write-Host $fishLiteral
Write-Host ''
Write-Host 'the hanging game, as JavaScript (the gamemode reads its file in game\gamemode-tables):' -ForegroundColor Cyan
Write-Host $gameLiteral
if ($JsOut) {
    # all four blocks, in the order they are read in the gamemode. -JsOut is
    # the paste file and a block left out of it would be a table somebody had
    # to go back to the console for.
    $both = $literal + [Environment]::NewLine + [Environment]::NewLine + $cropLiteral +
            [Environment]::NewLine + [Environment]::NewLine + $fishLiteral +
            [Environment]::NewLine + [Environment]::NewLine + $gameLiteral
    [System.IO.File]::WriteAllText($JsOut, $both, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ''
    Ok "wrote $JsOut"
}

Write-Host ''
if ($fail) {
    Write-Host "$fail check(s) failed. Read those before the table ships." -ForegroundColor Red
    exit 1
}
Write-Host ("the table is complete: {0} plants, {1} with no price left out and listed, none doubled." -f $table.Count, $unranked.Count) -ForegroundColor Green
Write-Host ("the crops are complete: {0} of those plants are farm plots, every one with a produce, a rank and a grow time, none doubled." -f $crops.Count) -ForegroundColor Green
Write-Host ("the fish are complete: {0} water records are the fisher's and are out of the plant table, {1} of them a novice's." -f $fish.Count, $fishPerRank['novice']) -ForegroundColor Green
Write-Host ("the game is complete: {0} hanging game records are the hunter's and are out of the plant table, {1} of them a novice's." -f $game.Count, $gamePerRank['novice']) -ForegroundColor Green
Write-Host ("the food rule is complete: {0} plants give food, {1} to the farmer, {2} to the hunter, {3} excluded as props, {4} named as staying the gatherer's." -f `
    $foodRows, $forFarmer.Count, $game.Count, $propRows, $stayed.Count) -ForegroundColor Green
