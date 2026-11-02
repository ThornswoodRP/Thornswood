<#
  Build-RecipeTable.ps1

  Builds game\data\recipes.json: the table the server needs to answer "may this
  person make this". Nothing in it is typed from memory. It is read out of the
  plugins of the build on this machine, and every judgement it makes is in the
  knob block at the top of this file rather than buried in the code.

  WHY THE SERVER CAN DO THIS AT ALL, MEASURED IN THE FORK RATHER THAN ASSUMED

  It was believed here that the server could not see crafting. It can, and this
  was read in C:\Thornswood-Dev\skymp on 20 September rather than remembered.

  skymp5-server/cpp/server_guest_lib/CraftService.cpp is the whole path. A
  client asks to craft; OnCraftItem looks the workbench reference up, reads the
  workbench base record's keywords with GetKeywordIds, and calls FindRecipe.
  FindRecipe walks every COBJ in the load order (GetDistinctRecordsByType
  "COBJ"), keeps the ones whose inputs and output match what was asked for, and
  then ConsiderRecipeCandidate refuses any whose BNAM is not one of the
  workbench's keywords. What survives goes to UseCraftRecipe, which builds a
  CraftEvent and fires it.

  gamemode_events/CraftEvent.cpp: GetName returns "onCraft" and
  GetArgumentsJsonArray sends four numbers, in this order:
      actorFormId, craftedItemBaseId, count, recipeId
  recipeId is the COBJ's own form id, mapped to the combined load order.

  THE FOURTH ARGUMENT IS A NUMBER AND THE KEY OF THIS TABLE IS A STRING

  This is the one thing that has to be right for the gate to work at all, and
  the header of this script said the wrong thing about it until 20 September.

  CraftEvent::GetArgumentsJsonArray writes std::to_string(recipeId), and
  CraftService.cpp builds that recipeId as
  espm::utils::GetMappedId(recipeUsed->GetId(), *mapping). It is a uint32 and
  it reaches the gamemode as a plain JavaScript number, 1006945 and the like.

  Every key in this table, and in the RECIPES_BY_ID block, is a desc string:
  the form id in lower case hex, a colon, and the file the record belongs to.
  "f61:Skyrim.esm", "8a4:Gourmet.esp". That is the form the rest of this repo
  keys everything by, and it is the only form that survives a load order
  changing underneath it, which is why the table is written that way and not
  as numbers.

  So a gamemode CANNOT write RECIPES_BY_ID[recipeId]. That is undefined for
  every row in the table, onCraft never returns false, and every profession
  quietly makes everything with no error anywhere to say so. It has to convert
  first, with the function the gamemode already uses elsewhere:

      var row = RECIPES_BY_ID[mp.getDescFromId(recipeId)];

  The other generated tables in the gamemode do not need this line because
  their call sites already hold a desc: the harvest gate reads
  mp.get(refrId, 'baseDesc') and the ore gate goes the other way with
  mp.getIdFromDesc. onCraft is the one event that hands over a bare number, so
  the conversion is written into the json's "event" field and into the block
  comment rather than left for somebody to work out.

  gamemode_events/GameModeEvent.cpp: Fire asks every listener, and if any one
  of them answered false it calls OnFireBlocked and returns false. Only when
  nobody blocked does it call OnFireSuccess. CraftEvent::OnFireSuccess is the
  method that does the work:
      actor->RemoveItems(entries);
      actor->AddItem(craftedItemBaseId, count);
  So a gamemode whose mp.onCraft returns false REFUSES the craft outright. The
  inputs are never taken and the output is never given. The person keeps their
  materials. That is the gate this table feeds.

  ONE THING THE SERVER NEVER SEES, AND IT MATTERS FOR THE COUNTS BELOW

  CraftService::RecipeItemsMatch opens with an early refusal:
      enum { ArmorTable = 0xadb78, SharpeningWheel = 0x88108 };
      const bool isTemper = recipeData.benchKeywordId == ArmorTable ||
        recipeData.benchKeywordId == SharpeningWheel;
      if (isTemper) { return false; }
  Tempering is thrown out before any recipe is considered, so onCraft never
  fires for a recipe on the armour table or the sharpening wheel. On this build
  that is 1720 of the 5116 recipes. They are still in this table, with their
  owner, and every row carries a "fires" field saying whether the server will
  ever be asked about it. Only the rows that fire are written into the gamemode
  block, because a row the server is never asked about is dead weight in a file
  that ships as one piece.

  WHICH SUBRECORD IS WHICH, AND HOW THAT WAS PROVED

  Counted first, the way Build-HarvestTable.ps1 worked out PFIG: every
  subrecord of every COBJ in Skyrim.esm, 601 records.

      EDID  601  text, 16 to 46 bytes
      COCT  599  4 bytes
      CNTO  952  8 bytes
      CTDA  931  32 bytes
      CNAM  594  4 bytes
      BNAM  601  4 bytes
      NAM1  601  2 bytes

  Then reasoned about, then proved one at a time by resolving each and checking
  the answer makes sense.

    EDID is the editor id. Text, and it reads as text.

    COCT and CNTO go together. Over the five Bethesda masters COCT adds up to
    2619 and there are exactly 2619 CNTO subrecords. So COCT is a count of the
    CNTO subrecords that follow it, and CNTO is one input: eight bytes, a form
    id then a count. RecipeLeatherFoxHide has COCT 1 and one CNTO, which is the
    one fox pelt it wants.

    CNAM and BNAM are both four bytes and both a form id, and telling them
    apart is the whole job. Resolved across the five masters:
      BNAM lands on a KYWD record every single time, and there are only a
      handful of distinct values. The two commonest are 88105:Skyrim.esm
      (CraftingSmithingForge) and adb78:Skyrim.esm
      (CraftingSmithingArmorTable). Those two hex numbers are the same two
      constants CraftService.cpp hardcodes for tempering, which is an
      independent confirmation from the engine's own source.
      CNAM never lands on a KYWD. It lands on ARMO 457, MISC 523, WEAP 344,
      ALCH 37 and AMMO 19, and nothing failed to resolve. Read as the output it
      gives the right answer every time: RecipeWeaponElvenBow -> ElvenBow,
      RecipeArmorSteelCuirassB -> ArmorSteelCuirassB, RecipeLeatherFoxHide ->
      Leather01, RecipeIngotDwarvenScrapLarge -> IngotDwarven.
    So BNAM is the workbench keyword and CNAM is the output item.

    NAM1 is two bytes and it is 1 on 1344 of the 1387 records in the masters.
    Where it is not 1 it is right: RecipeLeatherStrips reads 4 and one hide
    does give four strips, RecipeIngotDwarvenScrapLarge02 reads 5, and the
    dwarven scrap pile recipes read 2 and 3. So NAM1 is how many the recipe
    makes.

    CTDA is 32 bytes and is the condition list, and it is read in full here.
    It was stepped over until 20 September, which is how three halves came to
    be reported as having work when they have none. The layout is
    libespm/include/libespm/CTDA.h, read out of the fork rather than
    remembered, and every offset below was checked against a record:
      byte 0     the operator in the top three bits, the flags in the low
                 five. 0x04 in the flags means the comparison value is a GLOB
                 form id rather than a number. Operator 0 is ==, 1 is !=, 2 is
                 >, 3 is >=, 4 is <, 5 is <=.
      bytes 4-7  the comparison value, a float.
      bytes 8-9  the function index, a uint16. Bytes 10 and 11 are padding and
                 hold leftovers from the Creation Kit, not data.
      bytes 12-15 and 16-19  the two parameters.
      the rest   what the condition runs on, a reference, and a trailing -1.
    Proved on TemperWeaponSkyforgeSteelSword, whose two conditions read as
    function 659 with no form parameter, and function 448 against
    5218e:Skyrim.esm, which resolves to a PERK record.

  The fork's own parser agrees, which is worth saying because it was read after
  the census rather than before it: libespm/src/COBJ.cpp maps CNTO to
  inputObjects, CNAM to outputObjectFormId, BNAM to benchKeywordId, NAM1 to
  outputCount and CTDA to conditions. Two independent readings, same answer.

  Eleven COBJ records in this build carry no CNAM at all, so they name no
  output. Nine of them are armour table temper records and they are listed as
  unowned with that reason rather than quietly dropped.

  THE POISON FLAG, PROVED THE SAME WAY

  An ALCH record's ENIT is 12 bytes or more: the value in gold as a uint32,
  then a flag word as a uint32. Read that way the flag word over the five
  masters takes exactly five values, which is what a bit field should look
  like, and each one lands on the right kind of record:

      0x00000000  205  potions:  RestoreAll, FortifyMagicka04, FortifyStaminaRate01
      0x00000001    7  potions with the no-auto-calc bit: BladesPotion, DLC1BloodPotion
      0x00000002    8  food:     FoodGourd, DLC2FoodBoarMeat, FirebrandWine
      0x00000003  107  food with the no-auto-calc bit: FoodVegetableSoup, FoodCheeseWedge01
      0x00020000   80  poison:   DamageHealthLinger03, WeaknessFire01, DamageStaminaLinger01

  So bit 0x00000002 is the food bit and bit 0x00020000 is the poison bit. Every
  record carrying 0x00020000 is a damage or weakness brew and nothing else
  carries it, and every record carrying 0x00000002 is something eaten. That
  flag is exactly the Blightbrewer and Physicker split classes.md asks for.

  WHAT IS NOT IN THE RECORDS AT ALL, AND THIS IS THE FINDING OF THE BUILD

  There are no alchemy recipes. Not few, none. Across the whole load order,
  5116 COBJ records, not one of them names an alchemy bench keyword. Skyrim's
  alchemy is not a recipe system: potions are worked out from the effects the
  ingredients share, in the alchemy menu, and no COBJ record is involved.
  Thornswood-Content.esp already defines a keyword called ThornswoodCraftingAlchemy
  and nothing in the build points a recipe at it.

  Since #1383 (4 October) two of its recipes do: the Physicker's poultice and
  remedy, made at that plugin's own lab, a create-object bench, and named in
  RECIPE_OWNER. They are the Physicker's only rows. The Blightbrewer still has
  none.

  There are no enchanting recipes either, with one exception. The only
  enchanting keyword any COBJ uses is 17738:Dragonborn.esm, DLC2StaffEnchanter,
  and its 160 recipes all output a staff. Enchanting a sword or a cuirass is
  the enchanting menu, not a record.

  So COBJ cannot carry the Alchemist at all, and it carries only the staff half
  of the Enchanter. Those halves are named in HALVES_WITH_NO_RECIPES below,
  with the reason, and each of them goes into the json's "halves" map with its
  own count and a craftsAtAll flag. Every other half must come out with recipes
  or this build fails.

  NOTHING IN HERE IS A REASON TO TAKE A HALF OUT OF CHARACTER CREATION, and
  this file said the opposite until 20 September. It wrote five half names into
  a field called cannotCraftYet and printed, at the end of every run, that the
  panel on K should refuse to offer them. Two of the five are Warrior/Bulwark
  and Warrior/Berserker. Warrior has no third half, so a panel built as
  instructed would have dropped the Warrior out of character creation
  altogether, and the Alchemist with it, leaving five professions of the eight.
  A half that makes nothing is a half with no crafting gate, not a half nobody
  may be.

  WHAT A CONDITION DOES TO A COUNT, AND IT IS THE FINDING OF 20 SEPTEMBER

  A COBJ can carry conditions, and until this script read them it counted a
  recipe as work whether or not anybody could reach it. The difference is not
  small. Measured on this build, of the 1728 owned rows the server is ever
  asked about, 1559 carry at least one condition, and 1125 of those want a
  vanilla perk that classes.md says nobody here will ever hold.

  Three numbers now come out per half instead of one: what it owns, what the
  server is asked about, and what somebody who picked that half this morning
  can actually make. Read down that last column and the table says something it
  never said before:
      Cook/Confectioner     28 recipes, 0 of them
      Enchanter/Bladebinder 161 recipes, 0 of them
      Cook/Hearthcook       112 recipes, 2 of them
      Woodworker/Charburner   4 recipes, 1 of them
      Smith/Platewright     771 recipes the server sees, 48 of them
  The first two fail this build unless they are named in
  HALVES_NOBODY_CAN_START with the measured reason, which they are, because the
  answer to both is a decision somebody has to make rather than a line of code.

  The Charburner's other three want a book: ThornswoodWoodcutterAdvanced, Expert and
  Master, out of Thornswood-Content.esp, which is this repo's own plugin. The
  search under 'what hands out the items these recipes ask for' went through
  all 101 plugins for a placed reference, a container or inventory line and a
  levelled list line, found 76 of the 79 items recipes in this table ask for,
  and did not find those three anywhere. So the Charburner is one recipe, Poor
  Charcoal, and the rest of classes.md's "firewood through to coke" is waiting
  on somebody putting those books in the world.

  WHAT RANK A RECIPE ASKS FOR

  classes.md has four ranks and says each one opens more of what you can make.
  No row in this table carried one until 20 September, so a gate built on it
  could only be all or nothing per half. Every row carries a rank now, and a
  rank on the row is also the only way to express the sister half rule the
  published page promises, that an Edgewright can beat out plain iron plate and
  no more.

  WHAT SETS THAT RANK IS THE NEXT SECTION AND NOT THIS ONE. From 20 to
  21 September it was the price of what the recipe makes, cut into shares by
  the RANK_SHARE knob. That rule left three halves with an empty rung and is
  now the FALLBACK: it ranks only the rows whose inputs no class in this world
  produces. Saying otherwise here is what a reader would carry away, so this
  paragraph says it once and hands over.

  INPUT COST, AND WHY THE PRICE OF THE OUTPUT CANNOT RANK ANYTHING

  The rule above shipped on 20 September and scripts\dev\Check-Balance.ps1 found
  three halves with an empty rung the next morning. It is not a threshold and
  no threshold fixes it. Measured on 21 September, on the table this script
  itself wrote:

      Cook/Confectioner      28 recipes, TWO distinct output prices in the
                             whole half: 18 at 6 gold and 10 at 14 gold.
      Enchanter/Bladebinder 161 recipes, TWO distinct prices: 160 at 5 gold,
                             because a staff's worth is in its enchantment and
                             not in its record, and one at 1250.
      Woodworker/Charburner   4 recipes, ONE price: all four at 2 gold.

  Four rungs cannot be cut out of two numbers. The data has no spread in it,
  and the measure was wrong rather than the cut.

  What the output SELLS for is a fact about a shopkeeper. What a recipe COSTS
  is a fact about work: somebody had to go and get the makings, and they had to
  be far enough up their own ladder to be allowed to. A dessert of flour and a
  cabbage is novice work whoever priced it; a staff that wants ebony is not.

  So a recipe's rank is the rank of the DEAREST thing it asks for, read off the
  producing tables in this same folder. That answers Patrick's question of
  21 September at the same time and by construction rather than by luck:
  "we also need to make sure the different tiers match across so like farmer
  matches with tiers of cook for their recipes, miner and smith, woodworker and
  miner and so on, so there isn't an imbalance". A Cook's rungs are the
  Farmer's rungs because they are the same numbers off the same table.

  THE REVERSE INDEX. ores.json, harvests.json with its four maps and hunts.json
  are all keyed by the base that gets worked and carry the item it hands over.
  The verbs this server answers itself are in no table at all: the salt quarry,
  the chopping blocks, the churn and the farmyard are answered in
  game\gamemode.js, so the items and the ranks are READ out of mineSalt() and
  the rest by ReadStationVerbs below rather than copied into a list here (the
  charcoal kiln was one until #2337 made it a bench), which is what
  stops the index and the server drifting apart in silence. This script needs
  the other direction, item -> rank, and it takes the LOWEST rank any class gets
  that item at: if a novice miner can find iron anywhere in Skyrim then iron
  costs novice, whatever some expert seam also drops.

  THE LOWEST RANK IS NOT ALWAYS THE FARMER'S, AND THE FARMER IS THE CLASS THIS
  MATTERS TO. All 11 crops of harvests.json are the same base records as rows
  in its harvests map, Cabbage is bcf48:Skyrim.esm in both, and for every one
  of the 11 the gatherer picks it at a rank at or below the one a farmer has to
  hold to grow it. So the crops map places nothing in the index and the farmer
  owns no entry in it, which was measured on 21 September after it had been
  asserted in a comment that said the opposite. That is the lowest-wins rule
  working rather than a fault: a Cook wanting a Red Apple can be handed one by
  a novice gatherer, so a Red Apple costs novice, whoever else grows it. What
  it is NOT is Patrick's tiers lining up by construction. The run now prints
  what each table placed and what it lost to an earlier one, and prints every
  owned row that is ranked below a class that produces one of its inputs, so
  the gap between the Cook and the Farmer is a number in the output instead of
  a claim in a comment.

  THE HOP, WHICH IS WHERE MINER TO SMITH AND HUNTER TO TAILOR COME FROM. Until
  21 September the index stopped at the ground. The owned recipes ask for 176
  distinct items and only 73 of them came out of it: the 103 that did not were
  led by Leather Strips, wanted by 924 recipes, Steel Ingot by 888 and Leather
  by 665, and not one of those is in the ground. Each is one recipe back from
  something that is: leather off a tanning rack from a hide a HUNTER skins, an
  ingot off a smelter from ore a MINER digs, and both benches are in the 1679
  rows nobody owns and anybody may make.

  So an input that is itself made by a recipe now costs what THAT recipe's
  dearest input costs, over all 5116 recipes and not the owned ones. It is a
  fixpoint and not a walk, for the reason written at FOLLOW_THE_HOP, and it
  settles in three rounds on this build. What it placed, measured the same two
  ways the index is measured: 116 of the 176 distinct items against 73 before,
  and 5711 of the 6708 input entries against 785 before. What is left is bought,
  looted or dropped rather than made: Dragon Bone on 138 rows, Linen Wrap on
  106, Dwarven Metal Ingot on 103, Firewood on 78, Butter on 46. Those rows
  still fall back to the price rule and still say so in rankFrom.

  A BREAKDOWN ROW IS NOT A SOURCE, and reading it as one undid the whole point.
  1072 of the 5116 rows turn a finished good back into stock, a fur hood into a
  Steel Ingot and a gemstone bow into a Ruby. Read like any other recipe they
  made Steel Ingot novice work for a HUNTER four hops away through a fur hood,
  and put 1301 of the Platewright's 2015 rows on novice. They are recognised by
  their shape, a MISC out of an ARMO, WEAP or AMMO, and HOP_THROUGH_A_FINISHED_GOOD
  is where that is argued and where it can be turned back on.

  A TEMPERING ROW IS NOT A SOURCE EITHER, and that one hid a year longer, because
  the only exclusion the hop had was the breakdown shape and tempering is the
  opposite shape. TemperArmorIronCuirass says Iron Armor out of one iron ingot,
  on the armour table, and the armour table improves a piece already in the pack:
  nobody has ever obtained an Iron Armor by tempering one. Read as a source it
  settled Iron Armor at novice for a MINER and ranked a 100 gold Robed Iron Armor
  novice against a price rank of advanced. 14 of the 43 supply routes in that
  build were tempering rows, placing 11 items and ranking 16 owned rows. They are
  recognised by their bench, the same two the engine throws out before it looks
  at a recipe, and HOP_THROUGH_A_TEMPER is where that is argued.

  THE OWNERSHIP RULE

  Written out in full in the knobs below, because that is where somebody will
  look to change it. In short: the output record decides, and the bench decides
  where the output cannot. An ALCH splits on the poison bit and on the dessert
  keyword; a WEAP splits on its animation type, which is what separates a bow
  from a sword; an ARMO splits on whether it is clothing, jewelry or armour; a
  MISC is usually stock rather than a finished good and goes unowned.

  Nothing is forced into a profession. A recipe nobody has decided about goes
  in the unowned map with the reason it landed there, and unowned means anybody
  may make it, which is the right default for something nobody has settled.

  Warriors do not craft. Bulwark and Berserker are halves of how somebody
  fights, not of what they make, and there are no warrior recipes to find. No
  recipe is invented for them, they are named in HALVES_WITH_NO_RECIPES with
  craftsAtAll false, and the profession is offered like any other.

  The Mage is in the roster too, with no halves at all, for the same reason: a
  panel built from the professions map in this file has to be able to offer all
  eight of classes.md's professions. What a mage knows is spells, and
  scripts\dev\Build-SpellTable.ps1 is what writes those.

  Read only. It touches nothing in the game folder and nothing on the VPS, and
  it proves that with a fingerprint of the folder before and after.

  Usage:
    .\scripts\dev\Build-RecipeTable.ps1
    .\scripts\dev\Build-RecipeTable.ps1 -Data 'C:\Thornswood\Game\Data'
    .\scripts\dev\Build-RecipeTable.ps1 -NoInstall
    .\scripts\dev\Build-RecipeTable.ps1 -JsOut "$env:TEMP\recipes.js"

  Exit code 1 if a recipe's output does not resolve to a real record, if an
  owner is not one of the professions in classes.md, if a half is not one of
  its two, if a recipe lands on a profession that has no halves, if a recipe is
  listed twice, if an owned recipe makes something the records put no price on
  and so cannot be ranked, if a half that is meant to have recipes has none, if
  a half named as empty turns out to have some, if a half with recipes has
  nothing at all a new character can make and is not named in
  HALVES_NOBODY_CAN_START, if a half named there turns out to have something,
  if one of the producing tables named in PRODUCER_TABLES is missing or has no
  map of that name, if a function named in STATION_VERBS is not in
  game\gamemode.js or hands over an item that is in no record, if that file's
  RANK_LADDER is not this script's RANKS, if the hop does not settle inside
  HOP_ROUND_LIMIT, if any half is left with an empty rung below a full one
  after both ranking rules have run, counting every owned row and counting only
  the rows the server is asked about, if a half holds a rung nobody at that rank
  could gather for and is not named in HALVES_WITH_AN_UNSTANDABLE_RUNG, or if
  the game folder changed while this ran. Nothing is written unless every check
  passed.
#>
param(
    # The build's Data folder. Read only.
    [string]   $Data       = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    # The load order. The five Bethesda masters are always first and are never
    # in this file, so they are put in front of it.
    [string]   $PluginsTxt = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Profile\Default\plugins.txt'),
    # Overrides the load order entirely when it is given.
    [string[]] $Plugins    = @(),
    [string]   $Out        = '',
    [string]   $JsOut      = '',
    # Print the block and leave its files in game\gamemode-tables alone.
    [switch]   $NoInstall
)

$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
# Thornswood's own plugins are read from game\content, every other plugin
# from -Data (#2923, OwnPlugins.ps1).
. (Join-Path $PSScriptRoot 'OwnPlugins.ps1')

# ---------------------------------------------------------------- knobs ----
#
# classes.md is the rulebook. It settles the eight professions, the two halves
# of each, and that what your half is decides what you are able to make at all.
# It settles nothing about which Skyrim record belongs to which half, because
# it was written about the world and not about the plugins. Everything below is
# this script's judgement, in one place, so that changing it is one edit and a
# rebuild rather than a hunt through the code.
#
# LANGUAGE: which string table the names come from. classes.md says nothing
# about language; the server and the panel on K are English, so English.
$LANGUAGE = 'english'

# THE PROFESSIONS AND THEIR HALVES, copied from classes.md and from nowhere
# else. Every owner this script writes must be one of these eight and every
# half must be one of that profession's two. The check at the bottom enforces
# it, which is what stops a typo inventing a ninth trade.
#
# THE MAGE IS IN THIS LIST WITH NO HALVES, AND THAT IS THE FIX FOR A REAL BUG.
# It was left out of the table entirely until 20 September on the grounds that
# a mage makes nothing a COBJ record describes, which is true and was not a
# reason to leave it out. The professions map in recipes.json is the only
# roster of professions this file ships, so a panel built from it offered seven
# professions and lost the Mage, while this script's own comments called it
# "the eight professions" over a table holding seven. classes.md's table has
# eight rows, with Mage second, and gamemode.js already offers mage with
# halves: null, schools: 2, mastered: 3.
#
# So the Mage is here, with an empty half list, and recipes.json says in as
# many words that it has no halves and makes nothing by recipe. What a mage
# knows is spells, and Build-SpellTable.ps1 is what writes those.
$PROFESSIONS = [ordered]@{
    'Warrior'    = @('Bulwark', 'Berserker')
    'Mage'       = @()
    'Alchemist'  = @('Blightbrewer', 'Physicker')
    'Cook'       = @('Hearthcook', 'Confectioner')
    'Smith'      = @('Platewright', 'Edgewright')
    'Enchanter'  = @('Bladebinder', 'Wardweaver')
    'Tailor'     = @('Liverywright', 'Haberdasher')
    'Woodworker' = @('Charburner', 'Woodwright')
}

# WHETHER A PROFESSION MAKES THINGS BY RECIPE AT ALL, and the sentence that
# says why when it does not. Every profession above needs a line here.
#
# This exists because "this half owns no recipes" and "this half is broken"
# came out of this script as the same statement, and a panel written from that
# would drop the Warrior out of character creation. A Warrior owning no recipes
# is classes.md working as written. A Wardweaver owning none is a gap in what
# the records can express. Both are true, neither should stop somebody picking
# the profession, and only the second one is ever going to be fixed.
#
# Crafts = $false means the crafting gate has nothing to say about this
# profession. It does NOT mean hide it: the panel on K offers all eight.
$PROFESSION_CRAFTS = [ordered]@{
    'Warrior'    = @{ Crafts = $false; Why = 'warriors do not craft. classes.md gives Bulwark and Berserker combat maneuvers rather than recipes, so there is nothing in the records to find and nothing for a crafting gate to refuse. The profession is offered like any other.' }
    'Mage'       = @{ Crafts = $false; Why = 'a mage has no halves. classes.md gives the Mage two schools and two starting spells, and none of it is a crafting recipe. What a mage knows is written by scripts\dev\Build-SpellTable.ps1.' }
    'Alchemist'  = @{ Crafts = $true;  Why = '' }
    'Cook'       = @{ Crafts = $true;  Why = '' }
    'Smith'      = @{ Crafts = $true;  Why = '' }
    'Enchanter'  = @{ Crafts = $true;  Why = '' }
    'Tailor'     = @{ Crafts = $true;  Why = '' }
    'Woodworker' = @{ Crafts = $true;  Why = '' }
}

# HALVES THAT ARE MEANT TO COME OUT EMPTY, each with the measured reason.
#
# A half that can make nothing is a half nobody should be allowed to pick. That
# circle has bitten this repo twice, in farming and in gathering, so the check
# at the bottom fails the build when a half comes out with no recipes. This knob
# is the short list of halves where the emptiness is a fact about Skyrim rather
# than a mistake in this script, and every one of them was measured, not
# assumed. A half in this list that turns out to HAVE recipes also fails the
# build, because then this list is out of date and somebody has to look.
#
# These halves go into recipes.json under "halves", each with its own count and
# its own reason. WHAT THEY DO NOT DO IS COME OUT OF CHARACTER CREATION.
#
# Until 20 September this knob wrote its five names into a json field called
# cannotCraftYet and this script printed, at the end of every run, that the
# panel on K should refuse to offer them. Two of the five are Warrior/Bulwark
# and Warrior/Berserker, and Warrior has no third half, so a panel built as
# instructed would have dropped the whole Warrior profession out of character
# creation, and the Alchemist with it. gamemode.js offers warrior with exactly
# those two halves today.
#
# So each entry now says which of the two things is true, and the json says it
# too, because the reason strings alone left a consumer nothing to test:
#   Crafts = $false  the half is not about making anything. classes.md wrote it
#                    that way. Offer it, and the crafting gate stays quiet.
#   Crafts = $true   the half makes things and this build has no records for
#                    them yet. Offer it, and say so where somebody picking it
#                    can read it, because it is a gap rather than a design.
# Nothing here is a reason to hide a half. A half nobody may pick is a
# profession nobody may pick, and that is a bigger hole than an empty trade.
$HALVES_WITH_NO_RECIPES = [ordered]@{
    'Warrior/Bulwark'      = @{ Crafts = $false; Why = 'warriors do not craft. Bulwark and Berserker are halves of how somebody fights, and classes.md gives them combat maneuvers rather than recipes. There is nothing in the records to find.' }
    'Warrior/Berserker'    = @{ Crafts = $false; Why = 'the same. Warrior is the one profession whose halves are not about making anything.' }
    'Alchemist/Blightbrewer' = @{ Crafts = $true; Why = 'Skyrim has no alchemy recipes. Not one COBJ record in the whole load order names an alchemy bench keyword: potions are worked out from the effects that the ingredients share, in the alchemy menu, and no record is involved. The poison bit that would split this half from the Physicker is proved and ready in the code above, so the moment a mod adds an alchemy bench recipe it lands here by itself. The Physicker''s poultice and remedy (#1383) are named recipes in RECIPE_OWNER, not brews, so they are not this half''s.' }
    'Enchanter/Wardweaver' = @{ Crafts = $true; Why = 'the only enchanting recipes in the build are the staff recipes on the Dragonborn staff enchanter, and a staff is a weapon, so they all land on the Bladebinder. Enchanting a cuirass or a robe is the enchanting menu and not a record, so the Wardweaver has nothing to own here.' }
}

# WHAT THE ENGINE NEVER ASKS ABOUT. CraftService::RecipeItemsMatch throws
# tempering out before it considers any recipe, by these two bench keywords,
# hardcoded there as ArmorTable = 0xadb78 and SharpeningWheel = 0x88108. Read
# out of the fork, not remembered. A recipe on one of these still gets an owner
# here, because it is still that half's work, but it is marked as one the
# server is never asked about and it is left out of the gamemode block.
$BENCHES_THE_SERVER_NEVER_SEES = @('adb78:Skyrim.esm', '88108:Skyrim.esm')

# WHAT A LIGHT PLUGIN HOLDS (#1715). An engine that loads no light plugin has
# none of their records: not the recipe (CraftService::FindRecipe walks the
# server's own load order), not the bench (every loom is
# MoreCraftableEquipment.esp's, and the loom keyword 6ce000:Update.esm is a
# record that plugin adds under Update.esm's numbering), not an output or an
# input the light plugin makes. Measured on 4 and 5 October: 255 open-book
# rows needed one, MoreCraftableEquipment.esp's and Gourmet.esp's and the
# Bandage at the loom, and the server was never asked about any of them.
# Patrick, 5 October (#1715): keep them, and the server learns light plugins.
# So a row that needs a light plugin fires once the engine this release
# records loads them, "lightPlugins": true in records\server-build.json
# (scripts\deploy\ServerOrder.ps1 reads it, the same flag Deploy-Gamemode
# lists light plugins by), and does not fire before. Which plugin a record
# needs is the one that first holds it in the load order, which is how the
# injected loom keyword is caught.
. (Join-Path $PSScriptRoot '..\deploy\ServerOrder.ps1')
$ENGINE_LOADS_LIGHT = Test-ThornswoodEngineLoadsLight (Join-Path $PSScriptRoot '..\..\records\server-build.json')

# The light plugin a recipe needs, or '' when it needs none: the first plugin
# in the load order that holds the recipe, its bench, its output or an input,
# when that plugin is light. $firstIn maps a desc to that plugin, $isLight a
# plugin to whether it is light; a desc no scanned record holds goes by the
# plugin its numbering names.
function Get-RecipeLightPlugin($r, [hashtable]$firstIn, [hashtable]$isLight) {
    $descs = @($r.Desc, $r.BenchDesc, $r.OutDesc) + @($r.InputList | ForEach-Object { $_.Desc })
    foreach ($d in $descs) {
        if (-not $d) { continue }
        $pl = if ($firstIn.ContainsKey($d)) { $firstIn[$d] } else { ([string]$d).Split(':', 2)[1] }
        if ($pl -and $isLight.ContainsKey($pl) -and $isLight[$pl]) { return $pl }
    }
    return ''
}

# WHICH CONDITION FUNCTIONS THE SERVER CAN ACTUALLY EVALUATE. Read out of
# C:\Thornswood-Dev\skymp on 20 September, one file per number:
# skymp5-server/cpp/server_guest_lib/condition_functions/*.cpp, each with a
# GetFunctionIndex that returns the number below, and
# ConditionFunctionFactory::CreateConditionFunctions registering every one of
# them into the map the world state holds.
#
# This matters because of what happens to the ones that are NOT in the map.
# ConditionsEvaluator.cpp, the branch that runs when the map has no function
# for an index: it logs "doesn't exist. Evaluating condition to True" and
# returns true. So a condition the fork does not implement is not enforced by
# the server at all: the server waves it through.
#
# That is not the same as the recipe being available. Skyrim's own crafting
# menu evaluates the same CTDA list on the machine in front of the person and
# only lists the recipes whose conditions pass. A recipe whose condition fails
# there is never shown, so it is never asked for, so onCraft never fires and
# the server never gets to have an opinion. A row like that is in this table,
# owned by a half, and unreachable by anybody.
#
# The three SkympGetDamageSourceHasKeyword, SkympGetIsDamageSource and
# SkympWornHasKeywordCount functions return uint16 max for their index, which
# no CTDA carries, so they are not in this list.
$CONDITION_FUNCTIONS_THE_SERVER_HAS = @{
    47  = 'GetItemCount'
    69  = 'GetIsRace'
    101 = 'IsWeaponMagicOut'
    182 = 'GetEquipped'
    254 = 'GetIsPlayableRace'
    263 = 'IsWeaponOut'
    264 = 'HasSpell'
    300 = 'IsInInterior'
    569 = 'IsBlocking'
    596 = 'SpellHasKeyword'
    597 = 'GetEquippedItemType'
    640 = 'GetActorValuePercent'
    682 = 'WornHasKeyword'
    722 = 'WornApparelHasKeywordCount'
}

# THE VANILLA PERK CONDITION. Function index 448 is not in the fork's map and
# so is not named by it. It is named here from what its parameter resolves to
# rather than from memory: every CTDA in this build carrying 448 resolves its
# first parameter to a PERK record, and the count is printed every run under
# 'conditions'. That is Skyrim's HasPerk.
#
# classes.md line 4: "Nothing you do raises a vanilla skill and no perk menu
# opens when you sleep", and the page says vanilla progression being off is the
# part already shipped. So no character on this server will ever hold a vanilla
# perk. A recipe behind one was a recipe nobody could reach, whatever this
# table said about who owns it.
#
# THE PERKS COME OFF (#4826; Patrick, 22 Oct 2026, B: the whole vanilla perk
# system goes). scripts\mods\Build-LastPlugin.py takes every perk test out of
# every winning recipe in Thornswood-Last.esp, so the crafting menu no longer
# hides a row the server allows. This table reads the end state in one pass:
# a perk test on a recipe the last plugin copies is not one of the row's
# needs. A recipe of a plugin the last plugin never copies from
# (notCopiedFrom in game\data\last-plugin-policy.json) keeps its perk tests,
# and those rows are still counted as behind a perk, unless that plugin's row
# says perkRecipesCopied: Immersive Armors' does (Patrick, 31 Oct 2026, A on
# q-4826-ia-perk-recipes), so its perk tests come off like everybody's.
# Thornswood-Last.esp's own copy of a recipe is never read for its
# conditions: the ones below it are, the way its bench is (#3120), so the
# table is the same whether the box's last plugin is from before this or
# after. A perk test counts as passed, so one joined to other conditions by
# OR makes its whole OR group pass, and none of that group is a need either,
# the same OR groups Build-LastPlugin.py takes off (perk_drops there).
#
# Gourmet makes many dishes twice over, the plain recipe asking
# MAG_FoodUpgradePerk03 == 0 and one that makes two portions asking it == 1.
# Both are rows here already, each ranked by this table (the two-portion
# dumplings are advanced Confectioner work), so with the perks off both list
# and the rank decides who makes which, as for every other row.
$CONDITION_VANILLA_PERK = 448
$PERKS_OFF_IN_LAST_PLUGIN = $true
$LAST_POLICY_FILE = Join-Path $PSScriptRoot '..\..\game\data\last-plugin-policy.json'
$PERKS_KEPT_IN = @{}
foreach ($row in @(([IO.File]::ReadAllText($LAST_POLICY_FILE) | ConvertFrom-Json).notCopiedFrom)) {
    if ($row -and $row.plugin -and $row.perkRecipesCopied -ne $true) { $PERKS_KEPT_IN[([string]$row.plugin).ToLowerInvariant()] = $true }
}

# HOW A CONDITION IS READ OUT LOUD. The operator is the top three bits of the
# CTDA's first byte, and these six are the enum in
# libespm/include/libespm/CTDA.h.
$CONDITION_OPERATORS = @('==', '!=', '>', '>=', '<', '<=')

# ---------------------------------------------------------------- ranks ----
#
# THE FOUR RANKS, from classes.md's own table and in its order. A row in this
# table carries one of these, and the gate compares it against the rank the
# character holds in that half.
#
# Until 20 September no row carried a rank at all, and a gate built on the
# table could only be all or nothing per half: either a Platewright made
# DaedricArmor on the morning they were created or they made nothing. Both of
# those contradict the published page. classes.md: "Each rank opens more of
# what you are able to make", and its Novice row is "the basics of your half,
# and not much of it".
#
# A rank on every row is also what makes classes.md's sister half rule
# expressible, and it is the only thing that can: "You get the novice work of
# your sister half for nothing. An Edgewright knows how to beat out plain iron
# plate." The gate reads that as: your own half at your own rank, plus the
# other half of your own profession at novice and no further. It cannot ask
# that question of a table whose rows have no rank.
$RANKS = @('novice', 'advanced', 'expert', 'master')

# WHAT RANK A RECIPE ASKS FOR. INVENTED. classes.md sets no numbers and nothing
# in the records ranks a recipe, so this is the judgement, in one place.
#
# The measure is the gold value of what the recipe makes, which is the one
# number the records already carry about how much of a thing a thing is, and it
# is the same measure Build-HarvestTable.ps1 ranks a plant by. What could not
# be copied from that script is its fixed gold ceilings, and the reason is
# printed under 'ranking' every run: the halves do not share a scale. What a
# Confectioner makes runs from a few gold to a few tens of gold, and what a
# Platewright makes runs to thousands. One ceiling in gold across all of them
# would put every dessert in the game at novice and every piece of armour above
# it, which ranks the Cook's whole trade as beginner's work and leaves a
# Platewright with nothing to start on.
#
# So the split is per half: sort that half's rows by what they make, cheapest
# first, and cut the list at these shares. Read as "novice is the cheapest
# quarter of your own half's work". Every half gets a novice rung by
# construction, which is the point.
#
# The spread each half actually has is printed every run, under 'ranking', so
# these shares can be moved against real numbers. Measured on 20 September:
#   Cook/Confectioner       28 rows from 6 to 14 gold
#   Smith/Platewright     2015 rows from 2 to 24634 gold
#   Woodworker/Woodwright  124 rows from 0 to 26305 gold
#   Woodworker/Charburner    4 rows, all of them 2 gold
# One gold ceiling across that is not a ladder, it is a wall with the Cook on
# the wrong side of it.
#
# TWO RUNGS COME OUT EMPTY IN THIS BUILD AND THAT IS THE TIE RULE WORKING, not
# a mistake. A cut never splits a run of rows that make things worth the same,
# because two recipes for things of equal worth on different rungs is a rule
# nobody could explain to the person it refuses. The Confectioner has 18 of its
# 28 desserts priced the same, so novice takes all 18 and advanced takes none.
# The Bladebinder has 160 staves priced at 5 gold each, because a staff's worth
# is in its enchantment rather than its record, so 160 rows sit at novice and
# the Aetherial Staff at 1250 sits alone at master.
#
# THIS RULE IS NOW THE FALLBACK AND NOT THE RULE, and the paragraph above is
# why. Read the two sentences again: three halves come out with an empty rung
# and no threshold anywhere can fix it, because the data those halves have is
# two numbers. Measured on 21 September, on the table this script wrote:
#   Cook/Confectioner       28 rows, TWO distinct prices: 18 at 6 gold, 10 at 14
#   Enchanter/Bladebinder  161 rows, TWO distinct prices: 160 at 5, one at 1250
#   Woodworker/Charburner    4 rows, ONE price: all four at 2 gold
# No ranking by output price makes four rungs out of two numbers. The tie rule
# is not the problem and moving the shares is not the answer; the measure is.
# What ranks a recipe now is INPUT COST, below, and the shares here rank only
# the rows whose inputs no class in this world produces.
$RANK_SHARE = @(
    @{ Rank = 'novice';   Upto = 0.25 },
    @{ Rank = 'advanced'; Upto = 0.60 },
    @{ Rank = 'expert';   Upto = 0.85 },
    @{ Rank = 'master';   Upto = 1.00 }
)

# WHAT A RECIPE COSTS THE PERSON WHO HAS TO GATHER FOR IT. INVENTED, in the
# sense that classes.md sets no numbers for it, and measured in the sense that
# every number it reads comes out of a table built from the game's own records.
#
# PATRICK, 21 September: "we also need to make sure the different tiers match
# across so like farmer matches with tiers of cook for their recipes, miner and
# smith, woodworker and miner and so on, so there isn't an imbalance".
#
# That request and the three empty rungs above are the same defect from two
# ends. A recipe's rank came from what its output SELLS for, which is a fact
# about a shopkeeper and not about work. A dessert of flour and a cabbage is
# novice work whoever priced it. A staff that wants ebony is not. Rank a recipe
# by what its inputs cost somebody to get and the empty rungs close, and the
# Cook is reading the same numbers off the same tables the producing classes
# are ranked from.
#
# IT DOES NOT MAKE THE COOK'S RUNGS THE FARMER'S, and this comment claimed it
# did until 21 September. The index takes the LOWEST rank any class gets an
# item at, and every crop a farmer grows is also a plant a gatherer picks at
# the same rank or lower, so the farmer never sets a number here at all.
# Measured on the build of 21 September: 12 Cook rows are ranked below the
# farmer rank of a crop they ask for, Apple Dumpling at novice against an
# expert farmer's Red Apple among them. That is defensible, because the apple
# in the pot does not care who pulled it, but it is not the same sentence, and
# the difference is now printed under 'where a ladder sits below the class that
# grows what it asks for' every run instead of being asserted here.
#
# THE FIVE PRODUCING LADDERS, all already built and all in this folder. Each
# one is keyed by the base that gets worked, a vein or a plant or an animal,
# and carries the descriptor of the ITEM it hands over. This script needs the
# reverse of that: item -> the rank somebody has to hold to get it.
#
# THE ORDER OF THIS LIST IS THE TIE BREAK AND IT DECIDES REAL ATTRIBUTIONS.
# Lowest wins, and where two classes get the same item at the same rank nothing
# in the rule separates them, so the table read first takes it. The run names
# every tie it resolved that way, and names every item a later table's class
# has to climb higher for as well, because those two together are the whole of
# what the order of this list does to the output.
#
# NotAlsoIn: A BASE THE SERVER REFUSES THIS CLASS IS NOT THIS CLASS'S LADDER,
# whatever rank the table puts on it. Added 21 September, and it is the fix for
# the wrong half of the food split rather than a tidying.
#
# PATRICK, 21 September: "The farmer grows the crops? Those crops should be
# used to make food, why is a gatherer giving them all the food ingredient when
# they gather herbs and things".
#
# Two bases sit in the harvests map and in the crops map at once, on purpose:
# bb947 Tundra Cotton and bb953 Wheat. Their produce is an INGR and not a food,
# so the food rule in scripts\dev\Build-HarvestTable.ps1 that moved the other eleven
# crops out of the plant table never touches them, and CROP_BY_EDITOR_ID there
# names them as crops by hand. scripts\dev\Build-HarvestTable.ps1 leaving them in both
# maps is correct and this list reading both is what was wrong.
#
# The server does not let a gatherer near either of them. game\gamemode.js
# harvest() opens with `if (isCrop(baseDesc)) return null;`, and onActivate
# sends a crop base to farmActivate before it ever offers it to the plants. So
# a gatherer pressing a wheat plant gets nothing, at any rank, and the only way
# anybody in this world obtains Wheat or Tundra Cotton is a farmer at advanced.
#
# WHAT READING THEM AS THE GATHERER'S COST, measured off game\data\recipes.json as
# it stood before this line existed. Sack of Flour read suppliedBy gatherer on
# 36 Cook input entries plus 1 raw Wheat entry, and Thread read suppliedBy
# gatherer on 188 Tailor entries plus 1 raw Tundra Cotton entry: 226 of the 820
# supplied input entries the Cook and the Tailor ask for, credited to a class
# that cannot pick either plant. It is what made Check-Balance report
# 'farmer to Cook: DOES NOT HOLD. The farmer supplies 52 of 360 supplied input
# entries, 14%'. It also set the shipped rank on 105 rows of RECIPES_BY_ID that
# the craft gate reads, 63 of them Tailor and Haberdasher novice rows resting on
# Thread at novice, which rests on Tundra Cotton read as a novice gatherer's
# when the only way to hold one is a farmer at advanced.
#
# It is written as the name of another map in the same file rather than as a
# list of two descriptors, so that a crop added to harvests.json tomorrow is
# taken off the gatherer by the same line and nobody has to remember this one.
$PRODUCER_TABLES = @(
    @{ File = 'ores.json';     Map = 'ores';     Who = 'miner';    Item = 'ore';     List = ''      },
    @{ File = 'harvests.json'; Map = 'harvests'; Who = 'gatherer'; Item = 'produce'; List = '';
       NotAlsoIn = 'crops';
       NotAlsoWhy = 'game\gamemode.js harvest() refuses a crop base outright and onActivate routes it to farmActivate, so a gatherer gets nothing from it at any rank' },
    @{ File = 'harvests.json'; Map = 'crops';    Who = 'farmer';   Item = 'produce'; List = ''      },
    @{ File = 'harvests.json'; Map = 'fish';     Who = 'fisher';   Item = 'produce'; List = ''      },
    # The hunter has two tables and not one, as of 21 September. hunts.json is
    # bodies, built out of NPC_ records. The game map is hanging game: seven FLOR
    # records, a pheasant or a rabbit strung up at a camp, which the food rule in
    # scripts\dev\Build-HarvestTable.ps1 took off the gatherer that day because a
    # gatherer gathers reagents and those give food. They are the same shape as
    # the fish rows, one produce each, so they are read the same way.
    #
    # WITHOUT THIS LINE THE CHANGE WOULD HAVE COST THE CHAIN RATHER THAN FIXED
    # IT. Measured over game\data\recipes.json on 21 September, before the food rule
    # ran, Pheasant Breast was 4 of the Cook's inputs and came back producedBy
    # gatherer. The rule moves that row out of the harvests map, and a producer
    # index that only reads harvests, crops, fish and hunts would then answer
    # producedBy null for it: an input nothing in the world hands out, which is
    # the reverse of what the rule was for.
    @{ File = 'harvests.json'; Map = 'game';     Who = 'hunter';   Item = 'produce'; List = ''      },
    @{ File = 'hunts.json';    Map = 'hunts';    Who = 'hunter';   Item = 'item';    List = 'gives' }
)

# THE SIXTH LADDER IS THE SERVER'S OWN STATIONS, AND IT IS READ OUT OF
# game\gamemode.js RATHER THAN COPIED OUT OF IT BY HAND.
#
# PATRICK, 21 September, on the whole chain: "the farmer would supply the cook,
# gatherer would supply tailor and alchemist, miner smith, hunter tailor and
# smith and so on." A station this repository put in the world is one of the
# places a class's goods come from, so it belongs in the index beside the five
# tables or the chain has a hole in it with nothing saying so.
#
# The five tables above are built from the game's own records. The stations are
# not in the game's records at all: STATIONS.saltQuarry is a base this
# repository's own plugin put in the world, gamemode.js answers it in
# mineSalt(), and no script writes a json table for it. So the reverse index
# could not see it. (STATIONS.charcoalKiln was the second until #2337: the kiln
# is a bench now and its charcoal is four recipe rows, ranked in RECIPE_RANK.)
#
# WHY IT IS READ AND NOT LISTED. Until 21 September this was a hand written list
# of four descs with the gamemode line quoted in a comment beside each one. That
# list is a copy, and a copy goes stale the first time somebody changes what a
# verb hands over or what rank it hands it over at, with nothing anywhere to
# say the table and the server now disagree. ReadStationVerbs below opens
# game\gamemode.js, parses its ITEMS and RANK_LADDER lines, takes the body of
# each function named here and reads the items out of the body itself. Change
# mineSalt and the index changes with it; rename an item and the build fails
# saying so rather than quietly dropping a producer.
#
# WHAT THE READER LOOKS FOR, and all three shapes were read off the two function
# bodies on 21 September rather than invented (burnCharcoal is gone since
# #2337; its two shapes stay readable for the next verb that has them):
#   an ITEMS.<key> under no rank guard          -> novice, the bottom of RANK_LADDER
#     mineSalt: addItem(actorId, ITEMS.saltPile, randInt(1, 2 + step))
#   an ITEMS.<key> inside a block guarded by step >= N or rankStep(...) >= N
#     -> RANK_LADDER[N]
#     mineSalt: the rare roll, [ITEMS.fireSalts, ITEMS.frostSalts, ITEMS.voidSalts]
#     behind if (step >= 2 && ...), and RANK_LADDER[2] is expert
#   a list of ITEMS keys indexed by rankStep -> element i is RANK_LADDER[i]
#     burnCharcoal: ['charcoalT1','charcoalT2','charcoalT3','charcoalT4'][rankStep(actorId, 'charburner')]
#   an ITEMS.<key> that is only ever taken is CONSUMED and is not produced
#     burnCharcoal: takeItem(actorId, ITEMS.firewood, cost), which is what the
#     kiln eats rather than what it hands over
#
# WHAT THE SALT QUARRY COST WHEN IT WAS MISSING ENTIRELY, measured on the build
# of 21 September: 98 owned rows ask for a Salt Pile and 38 ask for a rare salt,
# 138 input entries in all, and every one came back producedBy null. Two Cooked
# Boar Meat rows sat at advanced on the price rule and are novice work by the
# input rule.
#
# THE KILN LEFT THIS LIST ON 12 OCTOBER (#2337). burnCharcoal answered a press
# on the kiln and was read here as the Charburner's producer of the four
# grades. The press stood in for four charcoal recipes the plugin did not have
# yet; it has them now, so the kiln is a bench, the press goes to the engine
# and opens its menu, and the grades are made there by the rows RECIPE_RANK
# ranks. No recipe in the table asks for charcoal of any grade, which the hop
# below measures every run, so the index loses no producer anybody's row reads.
#
# The placed hive is a farmer verb. hive() hands over one Honeycomb.
# Honey, the jar, is still not a row of harvests.json.
$STATION_VERBS = @(
    @{ Fn = 'mineSalt';     Who = 'miner';
       What = 'the salt quarry, STATIONS.saltQuarry, which is a miner''s verb: classGate(actorId, ''mine'')' },
    # Added 21 September, and it closes the gap this script's own closing
    # paragraph had been printing for days: "A woodcutter's verb and a churn
    # would put Firewood and Butter on a class". Firewood was the fifth largest
    # unsupplied input in the table, 79 entries, and until chopWood existed
    # nothing in this world produced a single stick of it.
    @{ Fn = 'chopWood';     Who = 'woodworker';
       What = 'the chopping blocks, three in Skyrim.esm and Solstheim''s ash one in Dragonborn.esm, which are the Woodwright half''s: halfGate(actorId, ''woodwright''). Bethesda''s records are untouched and the verb is answered server side, because Patrick said on 21 September that a chopping block is "just for getting the firewood and not usable by non woodworkers".'},
    # Added 24 September, and it is the other half of that same sentence. The
    # food rule in scripts\dev\Build-HarvestTable.ps1 took the churn off the gatherer
    # and gave it to nobody, which left Butter, 46 of the Cook's inputs, with no
    # producer at all. Patrick, 21 September: "give milk and butter to farmers".
    @{ Fn = 'churn';        Who = 'farmer';
       What = 'the butter churn in HearthFires.esm, BYOHButterChurn, which is a farmer''s verb: classGate(actorId, ''farm'')' },
    # Added for #396: living cows give Jug of Milk to a farmer. Goats wait on Patrick.
    @{ Fn = 'milk';         Who = 'farmer';
       What = 'a living cow, the Cow rows in hunts.json, which is a farmer''s verb: classGate(actorId, ''farm'') and null for everybody else so the living-actor fall through stays' },
    # Added for #628: the chicken nest gives Chicken's Egg to a farmer. The
    # harvest table's FARMYARD_BY_EDITOR_ID took the nest off the gatherer, so
    # without this line the egg, which the Cook's breads and pies ask for, would
    # have no producer at all.
    @{ Fn = 'collectEgg';   Who = 'farmer';
       What = 'the chicken nest, ChickenNest in Skyrim.esm, which is a farmer''s verb: classGate(actorId, ''farm'')' },
    # Placed hive, issue 1377. One Honeycomb, ten minutes, no rank gate.
    @{ Fn = 'hive';         Who = 'farmer';
       What = 'the placed hive, dbf8b3:Thornswood-Content.esp, which is a farmer''s verb: classGate(actorId, ''farm''), one Honeycomb, no rank gate' }
)

# WHERE THE STATIONS ARE READ FROM. The shipped gamemode, in this folder, which
# is the same file Deploy-Gamemode.ps1 sends to the server, so what the index
# believes and what the server does are one file and not two.
$GAMEMODE_JS = Join-Path $PSScriptRoot '..\..\game\gamemode.js'

# LOWEST WINS IN THE REVERSE INDEX, and this is a judgement rather than an
# obvious truth, so it is a knob with the argument written next to it.
#
# The same item is produced in more than one place at more than one rank. Iron
# Ore comes off novice seams all over Skyrim and off a handful of seams that
# this table ranks higher. If a novice miner can get iron ANYWHERE, then iron
# costs novice, and a recipe wanting iron is novice-cost work. Taking the
# highest instead would rank a recipe by the unluckiest place to find its
# inputs, which is not what it costs anybody.
#
# Set this to $false and the index records the dearest rank instead, which is
# worth doing once to see how far it pushes every half up.
$PRODUCER_RANK_IS_LOWEST = $true

# A CROP THAT ALSO GROWS WILD. Patrick, 28 September, issue #398: leave it as
# it is. Since the food rule and #626 no crop is also picked wild, so turning
# this on moves no recipe; ask again only if a crop is added back to the wild
# plants.
#
# Lowest wins, above, means a crop that a gatherer can also pick in the wild
# costs the gatherer's rank and never the farmer's: Tomato is gatherer novice,
# not farmer advanced, and every overlapping crop is the same, so the farmer's
# ladder decides nothing where it overlaps the gatherer's.
#
# $false  IN USE, and what the table has always done: the cheapest way wins,
#         whichever class it is.
# $true   anything the farmer produces costs the farmer's rank, even where a
#         gatherer picks the same thing lower, so a Cook's rungs follow the
#         farmer's. Everything the farmer does not produce is unchanged.
$CROP_COSTS_THE_FARMERS_RANK = $false

# WHETHER THE INPUT RULE RANKS AT ALL. Set to $false and every row falls back
# to RANK_SHARE, which is what this script did before 21 September, including
# the three empty rungs.
$RANK_FROM_INPUT_COST = $true

# THE FLOOR IS THE DEAREST INPUT, not the cheapest and not an average. A recipe
# is unmakeable until you can get ALL of it, so the rung somebody has to have
# reached is the rung of the hardest thing on the list. An average would say a
# staff of ebony and firewood is advanced work, and nobody can make half a
# staff.
$INPUT_RANK_IS_THE_DEAREST = $true

# WHAT TO DO WITH A ROW WHOSE SHOPPING LIST IS ONLY HALF PLACED. INVENTED:
# classes.md sets nothing here, and until 21 September the code did not ask the
# question at all, which is how the worst defect in this build got in.
#
# 'the dearest input' above can only be the dearest of the inputs the index can
# SEE. An input nothing produces is an unknown cost, not a cost of nothing, and
# the rule above skipped it silently and then overrode the price rank anyway.
#
# WHAT THAT DID, MEASURED ON THE BUILD OF 21 SEPTEMBER. Dragon Knight Light
# Armor is worth 3100 gold and asks for Dragon Scales, Dragon Bone, Ebony Ingot
# and Refined Malachite, none of which any class produces, and one Snow Fox
# Pelt, which a hunter skins at novice. The four unknowns were skipped, the fox
# pelt was the dearest of what was left, and the row went out at NOVICE: a
# first-day Platewright allowed dragonbone armour. It was not one row. 301 of
# the 320 firing rows the input rule fired on carry at least one input nothing
# produces; 150 landed below the rank the price rule gave them and 49 of those
# fell two rungs or more, Wild Hunt Heavy Helm master to novice, 14 Hearthcook
# stews expert to novice off a Salt Pile.
#
# DECIDED BY PATRICK ON 28 SEPTEMBER, issue #398: keep 'floor'. The things
# nobody gathers (Dragon Bone, Dragon Scales, Linen Wrap, Dwarven metal, Daedra
# Hearts) are loot or bought, and a recipe that wants one stays dear. The rows
# this holds above their gatherable makings are kept on purpose, and each says
# so in rankFrom with UNPLACED_INPUT_KEPT_BECAUSE below, which is what
# Check-Balance.ps1 reads to count them as kept rather than waiting.
#
# 'floor'    IN USE. When every input is placed, the dearest one decides, which
#            is the rule above unchanged. When any input is not placed, the
#            dearest placed one can only RAISE the row above what its price
#            said and never lower it, because the things nobody produces could
#            cost anything and a fox pelt is not evidence that dragon bone is
#            cheap. The row says which of the two answered, in rankFrom.
# 'decides'  what shipped on 21 September: the dearest placed input decides
#            whatever else is on the list. The numbers above are what it does.
# 'price'    a row with any unplaced input is not ranked by its inputs at all
#            and keeps the price rank. Honest, and it throws away the one thing
#            the index does know about 301 rows.
$UNPLACED_INPUT_RULE = 'floor'
$UNPLACED_INPUT_KEPT_BECAUSE = 'Patrick decided on 28 September (issue #398) that a recipe wanting something nobody gathers stays dear.'

# THE HOP: AN INPUT THAT IS ITSELF MADE BY A RECIPE. INVENTED, in the sense that
# classes.md sets no numbers for it, and measured in the sense that every number
# it reads comes out of the same tables and the same COBJ records as the rest.
#
# THE DEFECT IT CLOSES, MEASURED ON THE BUILD OF 21 SEPTEMBER before it existed.
# The owned recipes ask for 176 distinct items and the reverse index placed 73.
# The 103 it could not place were led by Leather Strips, wanted by 924 recipes,
# Steel Ingot by 888, Leather by 665, Ebony Ingot by 455 and Iron Ingot by 423.
# Not one of those comes out of the ground, and that is why the index could not
# see them: leather comes off a tanning rack and an ingot off a smelter, and both
# are COBJ records in this same table. A tanning rack recipe wants a hide, which a
# HUNTER skins. A smelter recipe wants ore, which a MINER digs. So the cost was
# always there, one recipe further back, and the whole of miner-to-smith and
# hunter-to-tailor was invisible because nothing followed that step.
#
# WHAT AN INPUT COSTS WHEN A RECIPE MAKES IT: what the dearest thing THAT recipe
# asks for costs, which is INPUT_RANK_IS_THE_DEAREST applied one level down, for
# the same reason. Where several recipes make the same item, the cheapest of
# them wins, which is PRODUCER_RANK_IS_LOWEST applied one level down: if there is
# any way to get a Steel Ingot for novice work then a Steel Ingot costs novice.
#
# IT WALKS ALL 5116 RECIPES AND NOT THE 3437 OWNED ONES. The smelter and the
# tanning rack are both in the 1679 nobody owns, so a hop over owned rows alone
# would place nothing at all. Unowned means anybody may make it, which makes
# those rows the most available step in the whole chain rather than the least.
#
# IT TERMINATES BECAUSE IT IS A FIXPOINT AND NOT A WALK. A depth limit was the
# other option and it is the wrong one here: it answers differently depending on
# where it starts, and there is no honest number to set it to. Instead every item
# starts at unknown, and each round recomputes every recipe's answer from what is
# known so far. An item's cost only ever moves from unknown to a rank, or from a
# rank to a cheaper one, and there are four ranks, so an item can change at most
# five times and the rounds cannot go on for ever. A smelter recipe that wants
# its own output, and there are such rows, simply never improves on itself: it
# reads its own cost, which is unknown or already at least as dear, and nothing
# happens. The run prints how many rounds it took and fails the build if it hits
# HOP_ROUND_LIMIT, which is the shape of a proof rather than a claim.
$FOLLOW_THE_HOP = $true

# The round ceiling. Not a depth limit on the chain: the fixpoint above settles
# on its own and this only exists so that a bug in a future edit cannot spin for
# ever without the build noticing. Hitting it fails the build. Measured on this
# data, the fixpoint settles well inside it and the run prints the number.
$HOP_ROUND_LIMIT = 40

# WHAT A RECIPE SAYS ABOUT ITS OUTPUT WHEN PART OF ITS OWN LIST IS UNKNOWN.
# INVENTED, and it is the same question UNPLACED_INPUT_RULE answers one level up,
# so it is answered the same way and for the same reason.
#
# $true   IN USE. A recipe tells you what its output costs only when every one of
#         its inputs has a cost. One unknown and the answer is unknown, because
#         the unknown thing could cost anything and the known things are not
#         evidence that it is cheap. This is exactly the dragonbone defect
#         written out at UNPLACED_INPUT_RULE, one hop further down, where it
#         would be harder to see: an item priced off half a shopping list does
#         not say so on the recipes that then ask for it.
# $false  the dearest KNOWN input decides and the unknowns are ignored. The run
#         prints what this would place, every run, so the cost of the strict rule
#         is a number rather than a guess.
$MADE_COST_NEEDS_EVERY_INPUT = $true

# WHETHER A BENCH IS ALLOWED TO BEAT THE GROUND. INVENTED: classes.md sets
# nothing here, and it only became a question once the hop existed.
#
# PRODUCER_RANK_IS_LOWEST says a recipe costs what the CHEAPEST way of getting
# its makings costs, and the hop is that same rule with one more way of getting
# them in it. Left alone, the two rules together say that if you can make a
# thing more cheaply than you can dig it up, it costs what making it costs.
#
# WHAT THAT ACTUALLY DOES ON THIS BUILD, measured on 21 September, and it is
# five items and no more:
#   Emerald, Sapphire and Ruby are master work at a deposit in ores.json, and
#   Immersive Weapons ships IWBreakdownGemstoneEmeraldBow and its two sisters,
#   smelter recipes that break a gemstone bow back down into the stone. The bow
#   is made from novice materials, so the stone reads novice.
#   Gold Ore is expert at a deposit and falls out of IWBreakdownCaptainsCutlass
#   and other breakdown rows the same way.
#   Cooked Skeever is advanced off a hunter and novice at a cookpot, which is
#   just cooking: a Salt Pile and some Skeever Meat.
# Only the gem rows are arguable, and every recipe that wants those stones is in
# the 38 rings and necklaces nobody owns, so not one owned row moves either way.
#
# $true   IN USE. One rule for both ways of getting a thing. Every item where the
#         bench undercuts the ground is printed by name every run, so this cannot
#         happen quietly.
# $false  the ground rank wins wherever a class hands the item over at all, and a
#         breakdown recipe can only place things no class produces. Worth setting
#         once to see whether that list has grown past five.
$HOP_MAY_UNDERCUT_A_CLASS = $true

# WHETHER A BREAKDOWN ROW MAY SET WHAT A THING COSTS. INVENTED: classes.md says
# nothing about it, and the question only exists because the hop follows recipes
# and Skyrim's mods are full of rows that run the chain backwards.
#
# A breakdown row takes a finished good and gives stock back: a smelter row that
# turns a fur hood into a Steel Ingot, a gemstone bow into a Ruby, a cutlass into
# Gold Ore. Hothtrooper44_ArmorCompilation and Immersive Weapons ship hundreds of
# them between them.
#
# WHY IT MATTERS, MEASURED ON THE BUILD OF 21 SEPTEMBER. With these rows reading
# like any other recipe, a Steel Ingot came back novice, supplied by a HUNTER,
# four hops away through IABArmorHeavyFurHoodBlack: pelts a novice hunter skins,
# made into a fur hood, smelted down into steel. It is not a mistake in the
# arithmetic. It is what the records say, and it is even true in the game. What
# it is not is a source: the hood had to be made first, so the steel cost
# whatever the hood cost plus the work, and a chain that reads it as a source
# hands the Smith's whole ladder to the Hunter at novice. On that run 1301 of the
# Platewright's 2015 rows landed on novice.
#
# The rows are recognised by their SHAPE and never by their name: the output is
# a MISC, which is stock, and one of the inputs is an ARMO, a WEAP or an AMMO,
# which is a finished good. STOCK_TYPE and FINISHED_GOOD_TYPES below are those
# two ends, and both are record types out of the game's own records rather than
# a judgement about any particular mod.
#
# $false  IN USE. A refund is not a source. An ingot costs what the ore costs,
#         which is the miner's ladder, and that is the chain Patrick described.
# $true   read them like any other recipe. The run prints how many items move
#         either way every time, so this is a number and not a preference.
$HOP_THROUGH_A_FINISHED_GOOD = $false

# The two ends of that shape, as record types. Read off the output type census
# this script already prints: MISC is the stock every smelter and tanning rack
# gives back, and ARMO, WEAP and AMMO are the three kinds of finished good a
# recipe in this build makes.
$STOCK_TYPE = 'MISC'
$FINISHED_GOOD_TYPES = @('ARMO', 'WEAP', 'AMMO')

# WHETHER A TEMPERING ROW MAY SET WHAT A THING COSTS. INVENTED in the same sense
# as the knob above: classes.md says nothing about it, and the question only
# exists because the hop walks every COBJ in the load order.
#
# A TEMPERING ROW CREATES NOTHING. TemperArmorIronCuirass carries CNAM = Iron
# Armor and one CNTO, 1 Iron Ingot, on the armour table. Read as a recipe that
# is 'Iron Armor out of an iron ingot', which is exactly what the record looks
# like and is not what it does: the armour table improves a piece you are
# already holding, and Skyrim will not offer the row to somebody with no iron
# armour in their pack. Nobody has ever obtained an Iron Armor by tempering one.
#
# WHAT READING THEM AS SOURCES COST, measured off game\data\recipes.json before this
# knob existed. Iron Armor settled at cost 0 and was recorded as 'miner, novice,
# hops 2, via TemperArmorIronCuirass'. 002RecipeCommonArmor10 in
# CommonClothes.esp asks for 1 Iron Armor, 1 Leather and 2 Leather Strips, is
# worth 100 gold, and came out rank novice against rankByValue advanced, with
# whyThatRank reading 'the dearest thing it asks for is Iron Armor, which a
# miner gets at novice'. 14 of the 43 distinct supply routes in that build were
# tempering rows, placing 11 distinct input items, and 16 owned rows were ranked
# off one of them, every one of them reporting inputsWithNoProducer 0 when the
# true figure was higher.
#
# THE ROWS ARE RECOGNISED BY THEIR BENCH AND NEVER BY THEIR NAME, the same way
# the engine recognises them: CraftService::RecipeItemsMatch in the fork throws
# out the armour table and the sharpening wheel before it looks at a recipe at
# all, which is $BENCHES_THE_SERVER_NEVER_SEES above, read out of the fork. A
# name list would catch TemperArmorIronCuirass and miss whatever the next
# armour mod calls its own.
#
# The script already models these two benches as not-a-craft in three other
# places: $BENCHES_THE_SERVER_NEVER_SEES, the $fires = $false that marks an
# owned row as one the server is never asked about, and the block comment on
# the gamemode table saying a tempering recipe never reaches onCraft. The hop
# was the one place that did not apply it.
#
# $false  IN USE. Tempering is not a source. An Iron Armor costs what making an
#         Iron Armor costs, and where nothing makes one it is unplaced, which
#         UNPLACED_INPUT_RULE already knows how to answer.
# $true   read them like any other recipe. The run prints how many items move
#         either way every time, so this is a number and not a preference.
$HOP_THROUGH_A_TEMPER = $false

# THE SECOND RULE, for a half the first two rules leave with an empty rung.
# INVENTED. classes.md does not set it, and it is here rather than in the code
# so that it is one edit to change and impossible to apply by accident.
#
# Some halves cannot be ranked by either honest measure, and that is a fact
# about the records rather than a failure of a threshold. The Bladebinder is the
# case this was written for, and it is worth writing out in full because it is
# the one place in this table where a rank does NOT mean what every other rank
# means. Measured on 21 September, on this build:
#   every one of its 161 rows sells for 5 gold but one, so price says nothing;
#   160 of the 161 want a Heart Stone, which ores.json ranks as master work for
#   a miner, so input cost puts the WHOLE half on master and leaves novice,
#   advanced and expert with nothing on them.
# Two honest rules, one rung between them, and a half nobody could ever climb.
#
# What DOES vary there is the shopping list: 5 distinct total input counts
# across the 161 rows against 2 distinct prices and 1 distinct input rank. The
# run prints those three numbers for any half it is about to re-rank, so the
# choice below can be argued with against numbers rather than taste.
#
# WHAT THIS COSTS, SAID OUT LOUD. A Bladebinder row ranked novice by this rule
# still wants a Heart Stone. The rank stops meaning "what it costs you" for
# that half and starts meaning "how long its shopping list is".
# scripts\dev\Check-Balance.ps1 counts every row more than one rung from its input
# cost and prints them by name: on this build it is 97 rows, all of them
# Bladebinder. It is the least bad of three answers, the other two being a half
# with one usable rung or an invented recipe, and it is a knob so that somebody
# who decides otherwise changes one line.
#
# AND IT IS NOT ENOUGH ON ITS OWN, WHICH WAS FOUND ON 21 SEPTEMBER. Counting
# rows on a rung cannot see whether anybody can stand on it. All 41 rows this
# rule put on the Bladebinder's novice rung want a Heart Stone, which
# ores.json ranks master on all four of its deposits, so a novice Bladebinder
# opens 41 recipes and can gather the makings for none of them. That is the
# exact circle the empty rung rule exists to catch, and both this script and
# Check-Balance were passing it, because the only thing the second rule changed
# was the label. So the standability check below now asks the other question,
# and a half that fails it has to be named in the knob under it with the
# measured reason or this build does not write a table.
#
# SETTLED ON 28 SEPTEMBER, issue #398, AND AGAIN ON 4 OCTOBER, issue #1622. On
# 28 September Patrick made Heart Stone deposits advanced mining, and the one
# rung hole fill below spread the staves over all four rungs. The miner page
# then put heart stone back on master, in one place (#1380, #1586, RANK_BY_ORE
# in Build-OreTable.ps1), so input cost puts every staff on master again, one
# rung cannot close three holes, and this rule would rank the half by shopping
# list once more. Patrick, 4 October, answering #1622: "B, each college book
# staff at its spell's rank". The thirteen are named in RECIPE_RANK, which fills
# novice, advanced and expert before the hole check runs, and the other 148,
# all cut, stay on master where their stone puts them. Measured on 4 October:
# novice 3, advanced 6, expert 4, master 148. So no half on this build reaches
# the second rule. It stays as the last resort for a future half, and the build
# prints by name any half that uses it.
#
# 'total inputs'    how many things the recipe wants in all, counting three
#                   firewood as three. This is the one in use: it is the
#                   closest thing the records have to how much work went into
#                   standing at the bench with everything ready.
# 'distinct inputs' how many different things it wants. Fewer distinct values
#                   in every half measured, so it collapses sooner.
$SECOND_RULE_KEY = 'total inputs'

# BEFORE THE SECOND RULE, TRY MOVING A FEW ROWS ONE RUNG. INVENTED, and it is
# here because the second rule turned out to be a much bigger hammer than the
# holes it was being used on. Issue #398.
#
# The second rule was written for the Bladebinder, a half where price and input
# cost both say one number for every row. It is applied to ANY half the first
# two rules leave with a hole, and it throws the whole half's ranking away to
# fill one rung. Measured on the build of 28 September, after Tundra Cotton moved
# to the gatherer (#626): the Liverywright's input cost put its 102 rows at
# novice 82, advanced 10, expert 0, master 10, a hole at expert and nothing
# else wrong. The second rule re-ranked all 102 by shopping list length and put
# 30 robes whose makings are novice work, four Thread and a Leather Strip, on
# expert and master: 39 Liverywright rows sat two rungs or more above what they
# cost, and the Confectioner lost five more the same way.
#
# $true   IN USE. A hole is filled first from the rung next to it, above and
#         then below, and no row moves more than one rung from where the first
#         two rules put it. How many move is the hole's share in RANK_SHARE
#         against its neighbour's, so the ladder keeps the shape the shares ask
#         for. Rows whose own input cost does not stand in the way move first,
#         then the cheapest (moving down) or the dearest (moving up). The rung
#         moved from always keeps a row, named ranks and the row moved to novice
#         for a new character never move, and a row moved once is never moved
#         again. Only a half this cannot close, the Bladebinder with all 161
#         rows on master, goes on to the second rule, and every move is printed.
# $false  every hole goes straight to the second rule, as it did before.
$HOLE_FILL_MOVES_ONE_RUNG = $true

# A RUNG YOU CAN REACH AND CANNOT GATHER FOR IS STILL AN EMPTY RUNG. INVENTED,
# and it is the other half of the rule HoleIn already enforces.
#
# HoleIn asks whether a rung has rows on it. This asks whether anybody standing
# on that rung could get the makings for even one of them. A row is standable
# at its rung when the dearest input any class produces for it is at or below
# that rung, or when nothing it asks for is produced by a class at all, which
# means a shop or another recipe hands it over and no class rank is in the way.
#
# Set this to $false and the build goes back to counting rows and calling that
# a ladder, which is what it did until the Bladebinder's 41 Heart Stone rows
# were measured on 21 September.
$RUNGS_MUST_BE_STANDABLE = $true

# THE HALVES WHOSE LADDER IS KNOWN TO HAVE AN UNSTANDABLE RUNG, each with the
# measured reason, in the shape of HALVES_NOBODY_CAN_START above and for the
# same purpose: a fact somebody decided to live with, written down, rather than
# a check quietly passing. Any half not named here that fails the check fails
# the build, because a rung nobody can gather for is a rank that opens nothing.
$HALVES_WITH_AN_UNSTANDABLE_RUNG = [ordered]@{
    'Cook/Confectioner' = 'every one of its 28 rows wants a Sack of Flour and a pat of Butter, counted over the whole half on 21 September, and flour is made from Wheat, which harvests.json ranks advanced for a gatherer and for a farmer alike. So the cheapest thing a Confectioner can bake is advanced work to gather for and the novice rung cannot be stood on whatever rule ranks the half: by input cost all 28 land 20 advanced and 8 expert and none novice (28 September), and filling the empty novice rung (HOLE_FILL_MOVES_ONE_RUNG) only relabels eight of the advanced ones. This appeared the day the hop was followed and it was always true; before it, flour had no producer at all and every row read as costing nothing. It closes when somebody decides where a Confectioner''s flour comes from. The two vanilla perks every row carried come off in Thornswood-Last.esp since #4826, so the rows are open to whoever the server allows.'
    'Enchanter/Bladebinder' = 'all of its 161 rows but the Aetherial Staff want a Heart Stone, which is master mining (the miner page, issues #1380 and #1586, RANK_BY_ORE in Build-OreTable.ps1), so by input cost all 160 land on master. Patrick, 4 October (#1622): each college book staff at its spell''s rank, named in RECIPE_RANK. So the thirteen the Bladebinder page keeps sit novice 3, advanced 6 and expert 4, and the other 148, all cut, stay on master. The novice, advanced and expert rungs hold only staves whose stone nobody below master can dig, so a Bladebinder below master buys heart stones from a master miner. That is the decision, not a hole: the recipe says what the spell gate already says, because a staff is not made until its spell is on you and a Bladebinder unlocks a spell on K only at a rank at least the spell''s.'
}

# WHERE THE GOLD VALUE SITS IN EACH KIND OF RECORD. The first five were proved
# in Build-HarvestTable.ps1 and are copied from its VALUE_RULES knob. AMMO and
# BOOK are not in that script, because nothing a gatherer picks is either, and
# both were measured here on 20 September against Skyrim.esm:
#   AMMO DATA is 20 bytes and FollowerIronArrow reads 245265, 6, 8.0, 1 as the
#   four fields, so the value is the uint32 at offset 12 and an iron arrow is
#   worth 1 gold, which is what an iron arrow is worth.
#   BOOK DATA is 16 bytes and SpellTomeThunderbolt reads 4, 1112046, 750, 1.0,
#   so the value is the uint32 at offset 8 and a spell tome is worth 750.
# A row whose output type is not in here cannot be ranked and fails the build
# rather than being guessed at, because a rank invented without a price would
# decide what a real person may make.
$VALUE_RULES = [ordered]@{
    'INGR' = @{ Sub = 'DATA'; At = 0 }
    'MISC' = @{ Sub = 'DATA'; At = 0 }
    'SLGM' = @{ Sub = 'DATA'; At = 0 }
    'KEYM' = @{ Sub = 'DATA'; At = 0 }
    'ARMO' = @{ Sub = 'DATA'; At = 0 }
    'WEAP' = @{ Sub = 'DATA'; At = 0 }
    'ALCH' = @{ Sub = 'ENIT'; At = 0 }
    'AMMO' = @{ Sub = 'DATA'; At = 12 }
    'BOOK' = @{ Sub = 'DATA'; At = 8 }
}

# THE NOVICE RUNG HAS TO BE REACHABLE ON THE DAY SOMEBODY PICKS THE HALF.
#
# PATRICK, 20 September, about the farming table: "they cant grow them if they
# dont have the rank, they cant get the rank if they dont level up from growing
# them, they cant get the rank if they cant grow them". The same circle is
# waiting here, and it closes in a worse way, because a recipe can be gated
# twice: by this table's rank, and by a CTDA the game's own crafting menu
# enforces before the server sees anything.
#
# So after the shares above have ranked a half, the cheapest row of that half
# that a character created this morning can actually reach, meaning it carries
# no condition at all, is moved to novice if it is not there already. Every
# move is printed under 'ranking' with the row it moved, so the rule is visible
# rather than silent. Set this to $false and the shares stand as they fall,
# which is worth doing once to see how many halves it strands.
$NOVICE_MUST_BE_REACHABLE = $true

# HALVES WHERE NOBODY CAN MAKE ANYTHING ON THE DAY THEY PICK IT, each with the
# measured reason. The check at the bottom fails the build for any half that
# has recipes, has rows the server is asked about, and has not one row a new
# character can reach, unless it is named here.
#
# This is a different question from the empty half check above and it had to be
# asked separately: a half can own hundreds of rows and still be empty in
# practice, which is exactly what two of these are. The counts printed every
# run now carry both numbers side by side for this reason.
# A SPELL A TOME TEACHES IS A SPELL AN ENCHANTER CAN LEARN, and so a staff
# recipe whose only condition is that spell is one somebody can reach.
#
# Patrick, 28 September, answering issue #967: "Enchanters learn staff spells
# from spell tomes". 160 of the Bladebinder's 161 recipes carry a HasSpell
# condition naming the staff's own spell, and the fork evaluates it (function
# index 264 against MpActor::GetSpellList). Reading a tome teaches the spell in
# the engine for anybody, and game\gamemode.js (THE STAFF SPELLS) records it for
# somebody who can make staves, and a staff is refused until its spell is
# recorded. So a HasSpell row counts as reachable here when some BOOK record
# with the teaches spell flag names that spell, and the tomes are written into
# the needs list (taughtBy) and into the STAFF_SPELLS block the gamemode reads.
# A spell no tome teaches (the NPC copies some Apocalypse staves name) leaves
# its row closed, and the run prints every one of them.
#
# Set this to $false and a HasSpell row is closed again whatever teaches it,
# which puts the Bladebinder back in HALVES_NOBODY_CAN_START.
$TOMES_TEACH_STAFF_SPELLS = $true
# The BOOK DATA flag bit that says the tome teaches a spell: TeachesSpell = 0x04
# in libespm/include/libespm/BOOK.h.
$BOOK_TEACHES_SPELL = 0x04
# The HasSpell condition function index, CONDITION_FUNCTIONS_THE_SERVER_HAS.
$CONDITION_HAS_SPELL = 264

$HALVES_NOBODY_CAN_START = [ordered]@{
}

# WHEN A HALF IS THIN ENOUGH TO NAME OUT LOUD. A half with a handful of rows a
# new character can reach passes the check above and is still worth printing
# row by row, because the difference between four recipes and one recipe is
# invisible in a count. The Charburner is the case this was written for.
$THIN_HALF_ROWS = 3
# How many of those rows to print before the rest are left to recipes.json. The
# Hearthcook trips the rule above with 2 of 112, and 110 lines of soup buries
# everything else in the run.
$THIN_HALF_LINES = 6

# THE ALCH FLAG BITS, proved in the header above against the records that carry
# them. Bit 1 is a no-auto-calc bit and says nothing about what the thing is.
$ALCH_FLAG_FOOD   = 0x00000002
$ALCH_FLAG_POISON = 0x00020000

# THE WEAPON ANIMATION TYPE. The first byte of a WEAP record's DNAM. Measured
# across every WEAP a recipe in this build outputs, against the WeapType
# keyword on the same record: 1 sword, 2 dagger, 3 war axe, 4 mace, 5
# greatsword, 6 battleaxe and warhammer, 7 bow, 8 staff, 9 crossbow. The
# animation byte and the keyword agree on all but a handful of mod records
# where the keyword is the wrong one, and the byte is the one the game animates
# from, so the byte wins.
$WEAP_ANIM_BOW      = 7
$WEAP_ANIM_STAFF    = 8
$WEAP_ANIM_CROSSBOW = 9

# WHO OWNS A BOW. This is the one place where the obvious rule and classes.md
# disagree, and classes.md wins because it is the rulebook.
#
# The obvious rule is that the smithing forge with a WEAP output is the
# Edgewright's. Bows are made at the forge and they are WEAP records, so the
# obvious rule hands every bow in the game to the Edgewright. classes.md says
# the Woodwright does "bows, arrows and instruments", in as many words. A
# server that let an Edgewright make bows would be contradicting the page the
# testers read.
#
# So a WEAP whose animation type is a bow or a crossbow goes to the Woodwright,
# and so does every AMMO, which is arrows and bolts and nothing else. Set this
# to $false and bows go back to the Edgewright and arrows go unowned, which is
# the plain forge rule with no carve-out.
$WOODWRIGHT_TAKES_BOWS_AND_ARROWS = $true

# WHO OWNS AN INSTRUMENT. The same sentence of classes.md, and it was half
# followed until 20 September: "**Woodwright**, bows, arrows and instruments".
# The bow carve-out above tests the animation type and nothing else, so the
# three instrument recipes in this build fell past it into the plain forge rule
# and came out as the Edgewright's. A Woodwright could not make a flute and a
# swordsmith could, which is the exact contradiction with the published page
# that the bow knob was written to prevent.
#
# The records were read before this rule was written. RecipeWeaponFlute,
# RecipeWeaponLute and RecipeWeaponDrum, all from PlayFluteLuteDrum.esp, all at
# CraftingSmithingForge, output FluteWeapon, LuteWeapon and DrumWeapon. All
# three outputs are WEAP records carrying animation byte 0, which is hand to
# hand, and an empty keyword list. So the records themselves say these are not
# weapons of any type, and neither the animation rule nor the keyword rule can
# reach them.
#
# What is left is the name, so that is what this is, and it is a judgement
# rather than a reading. It is matched as a whole word against the output's
# editor id and its name, so a Drum matches and a Drumstick does not. The
# count of what it catches is printed every run: if a mod ever adds a fourth
# instrument, it lands here by itself, and if this rule ever catches something
# that is not an instrument it is visible in that line.
$WOODWRIGHT_TAKES_INSTRUMENTS = $true
$INSTRUMENT_WORDS = @('Flute', 'Lute', 'Drum')

# WHO OWNS A SPEAR, AND A FISHING ROD.
#
# Patrick, 23 September, playing it: "Spears should also be woodworkers", in
# the same breath as instruments, bows and arrows. He is right and the reason
# is the same one classes.md gives for a bow: the length of it is a shaft of
# wood and the smith's part is the head on the end. A spear is a pole with a
# point, which is a Woodwright's work with an Edgewright's tip, and the server
# has to give it to one of them.
#
# BY NAME, LIKE THE INSTRUMENTS, AND FOR THE SAME REASON: a spear is a WEAP
# with the animation type of a two handed weapon, which is exactly what a
# greatsword is, so nothing on the record separates them. Matched as a whole
# word against the output's editor id and its name, so Spear matches and
# Spearmint does not, and the count is printed every run.
# WHOSE RACE MADE THIS.
#
# Patrick, 23 September: "Riekling stuff should only be able to be made by a
# riekling", and then "We already agreed on the race gate for race based items
# so if there is anything by another race aswell it should be race locked".
#
# ONLY A RACE SOMEBODY CAN ACTUALLY BE. Patrick, 23 September, reading a first
# list that had Falmer, Dremora and Draugr in it: "they are not playable races
# so they can be by anuone only playable races should be race locked". He is
# right: locking a recipe to a race nobody can choose is deleting the recipe
# by a longer road.
#
# So the list comes out of game/data/races.json, which reads the playable bit off
# the RACE record itself, at an offset measured against ten races everybody
# knows are playable rather than looked up. Twelve races are playable on this
# build: the ten vanilla ones, and two from Playable Rieklings.esp, which is
# the whole reason riekling gear can be locked to rieklings at all.
#
# AND THE TEN VANILLA NAMES ARE STYLES, NOT PEOPLES, WHICH IS WHY THEY ARE
# TAKEN BACK OUT. Nordic weapons, Orcish armour, Imperial armour and Elven
# everything are MATERIALS any smith with the perk hammers out, and always
# have been. Leaving Nord in this list would lock Nord Mail and Nordic Carved
# to Nords, which is not what anybody asked for and would gut the smithing
# tree. What is left on this build is riekling, which is the case he named.
$RACE_LOCKED = $true
$RACE_STYLE_NOT_PEOPLE = @('Nord', 'Breton', 'Imperial', 'Redguard', 'Orc',
                           'HighElf', 'WoodElf', 'DarkElf', 'Argonian', 'Khajiit',
                           'Elf', 'Elven')

# BUT A PEOPLE'S OWN DRESS IS NOT A MATERIAL, AND THAT DOES LOCK.
#
# Patrick, 23 September: "somtimes things are called bosmer, orsimer, altmer,
# dunmer", then "That's the exact reason I said it because of Bosmer armour",
# then "Which we should have in our mods", then "Also I believe we have Nordic
# armour somewhere".
#
# All of it is in the order and all of it was measured rather than guessed.
# Immersive Armors (Hothtrooper44_ArmorCompilation.esp) ships 41 Bosmer, 7
# Dunmer, 2 Orsimer and 16 Nord Mail recipes, and 4 Nord spectacle helmets.
# Every one of them was unlocked before this, and nothing above could ever
# have caught them: a RACE record spells that people WoodElfRace and the
# armour spells them Bosmer.
#
# THE LINE, WHICH PATRICK DREW ON 23 SEPTEMBER WHEN ASKED WHAT NORD GEAR DOES.
# A set named for a people is that people's dress and locks. A MATERIAL is a
# tier of metal any smith with the perk hammers out, and the name on it is the
# recipe rather than the maker, so it stays open. He chose the cultural sets
# alone. In the same build that means Nord Mail locks and Nordic Carved does
# not, though both say Nord: Nordic Carved is the quicksilver tier between
# Elven and Glass, and taking a whole tier off everybody who is not a Nord is
# not what any of this was for. Ancient Nord and Nord Hero stay open for the
# same reason. Bosmer armour locks, Elven armour does not.
#
# THE PHRASE IS WHAT THE THING IS CALLED AND THE VALUE IS WHAT THE RACE RECORD
# CALLS THE PEOPLE. 'Bosmer Boots' is recorded as woodelf, because the
# gamemode has nothing to compare against but WoodElfRace. The words of a
# phrase have to sit next to each other, so 'Nord Mail' catches Nord Mail
# Hauberk and never Nord Hero or Nordic.
#
# 'Spectacle Helmet' is here without a Nord in front of it because both of
# them are called Nord Heavy and Nord Light Spectacle Helmet, so the words are
# not adjacent. Measured: every spectacle helmet in this order is a Nord one.
# The run prints what each set caught, so the day a mod adds somebody else's
# spectacles the count says so.
#
# WHERE THE REST OF THE LIST CAME FROM. Patrick, 23 September: "look for
# anymoire culture sets". So every recipe name in the order was swept for the
# name of a people, a homeland or a great house, and what came back is below
# with the count it answered for.
#
# TWO THAT CAME BACK AND ARE DELIBERATELY NOT HERE. Thalmor, 5, is a political
# faction and it takes Bosmer as readily as Altmer, so robes named for it
# belong to no one people. Forsworn, 22, is a tribe at war with the Reach
# rather than a people, and its gear is fur and antler anybody can tie on.
# Neither is a race, and this gate is for races.
#
# Einherjar, Barbarian, Warchief, Stormlord and Viking came back too and are
# not here either: they are Immersive Armors flavour names, and none of them
# is a people anybody in Tamriel is born into.
$RACE_OWN_SETS = [ordered]@{
    'Bosmer'           = 'WoodElf'    # 41, Immersive Armors
    'Orsimer'          = 'Orc'        # 2, Immersive Weapons
    'Altmer'           = 'HighElf'    # none on this build, and it costs nothing to be ready
    'Dunmer'           = 'DarkElf'    # 7, MoreCraftableEquipment
    'Telvanni'         = 'DarkElf'    # 3, a Dunmer great house
    'Nord Mail'        = 'Nord'       # 16, Immersive Armors
    'Spectacle Helmet' = 'Nord'       # 4, Nord Heavy and Nord Light
    'Skaal'            = 'Nord'       # 8, the Nords of Solstheim
    'Redguard'         = 'Redguard'   # 19, mostly the Redguard Knight set
    'Alik''r'          = 'Redguard'   # 17, and the apostrophe splits it into two words, which is why it reads as one
    'Yokudan'          = 'Redguard'   # 5, Yokuda is where the Redguards came from
    'Colovian'         = 'Imperial'   # 4, a Cyrodiil province, unlike Imperial itself which is legion issue
    'Khajiit'          = 'Khajiit'    # 2, Ornate Khajiit Bow
}

# Word to look for in an item name -> the race word the lock is recorded as.
$RACE_LOCK_WORDS = [ordered]@{}
$RACE_WORDS = @()
$racesJson = Join-Path $PSScriptRoot '..\..\game\data\races.json'
if ($RACE_LOCKED -and (Test-Path -LiteralPath $racesJson)) {
    try {
        $raceDoc = Get-Content -LiteralPath $racesJson -Raw | ConvertFrom-Json
        $words = New-Object 'System.Collections.Generic.HashSet[string]'
        $playableWords = New-Object 'System.Collections.Generic.HashSet[string]'
        foreach ($prop in $raceDoc.items.PSObject.Properties) {
            $row = $prop.Value
            if (-not $row.p) { continue }
            # RieklingBlueRace, 1RieklingPurpleRace and DLC2RieklingRace are
            # all one people. Strip the decoration and keep what is left.
            $w = [string]$row.e
            $w = $w -replace '^(DLC\d*|\d+|Npc)+', ''
            $w = $w -replace '(Race|Vampire|Child|Blue|Purple|Npc)+$', ''
            $w = $w -replace '(Blue|Purple)', ''
            if ($w.Length -lt 3) { continue }
            [void]$playableWords.Add($w)
            if ($RACE_STYLE_NOT_PEOPLE -contains $w) { continue }
            [void]$words.Add($w)
        }
        $RACE_WORDS = @($words)
        foreach ($w in $RACE_WORDS) { $RACE_LOCK_WORDS[$w] = $w.ToLower() }
        # And the cultural sets, but only for a race somebody can actually be
        # on this build. If WoodElfRace is not playable here then Bosmer armour
        # has nobody to belong to, and locking it would delete it.
        foreach ($set in $RACE_OWN_SETS.Keys) {
            $canon = [string]$RACE_OWN_SETS[$set]
            if (-not $playableWords.Contains($canon)) { continue }
            $RACE_LOCK_WORDS[$set] = $canon.ToLower()
        }
    } catch {
        Write-Host ('  could not read races.json, so nothing is race locked: ' + $_.Exception.Message) -ForegroundColor Yellow
    }
}

$WOODWRIGHT_TAKES_SPEARS = $true
$SPEAR_WORDS = @('Spear', 'Pike', 'Halberd', 'FishingRod', 'Fishing Rod', 'FishingPole', 'Fishing Pole')

# WHAT NOBODY MAKES AT ALL.
#
# Patrick, 23 September: "Remove all of the house pars except for a key", and
# asked which parts he meant, "I mean the craftable stuff in the forge hinges,
# locks, nails, iron fittings, etc". Separately, about the same menu: "Locks
# shouldn't be craftable".
#
# These are HearthFires house building stock. Nobody builds a HearthFires house
# on this server: property is claimed through the deed system and a door is
# opened with a key the holder has cut from a mold, so a nail is a thing you can
# make and can then do nothing whatever with.
#
# THE KEY HE IS KEEPING IS NOT ONE OF THESE and is not a recipe at all: there
# is no craftable key anywhere in the order, measured across all 4,527 rows. It
# comes from the mold, 15495:Thornswood-Content.esp, which the property system
# hands to the holder, and /key cuts it.
#
# REFUSED IS NOT THE SAME AS UNOWNED, which is the distinction this knob adds.
# Unowned means anybody may make it, and that is the right answer for an ingot.
# These four went to unowned under the stock-and-tools rule and so were open to
# everybody, which is the opposite of what he asked for. A refused row is
# carried into the gamemode with a sentence and mp.onCraft turns it down.
#
# The listing stays in the forge menu either way. A menu entry is the BNAM
# keyword on the record and no server code moves it, which is the same wall
# entry 345 is against.
$NOBODY_MAKES = [ordered]@{
    'Nails'         = 'a nail, for a house nobody builds here. Property is claimed with a deed and opened with a key cut from a mold.'
    'Hinge'         = 'a hinge, for a house nobody builds here. Property is claimed with a deed and opened with a key cut from a mold.'
    'Lock'          = 'a lock, and locks are not made at a forge here. A door takes the key its holder cut from a mold.'
    'Iron Fittings' = 'house fittings, for a house nobody builds here. Property is claimed with a deed and opened with a key cut from a mold.'
}

# DUPLICATE DWARVEN SCRAP SMELTS (#613). Six Skyrim.esm RecipeIngotDwarvenScrap*
# rows all make Dwarven Metal Ingot. cut-items keeps one (PlateMetalLarge) and
# cuts the rest. Thornswood-Content.esp hides the five from the smelter menu by
# dropping BNAM. This list refuses them on rebuild so the gate matches the menu.
# Matched on the recipe's own editor id, not the output name, so the keeper stays.
$COLLAPSED_SMELT_EDITOR_IDS = [ordered]@{
    'RecipeIngotDwarvenScrapPlateMetalSmall' = 'duplicate Dwarven Metal Ingot scrap smelt. One scrap path stays (RecipeIngotDwarvenScrapPlateMetalLarge). The other five are hidden from the smelter menu in Thornswood-Content.esp and refused here so the gate matches the menu. No sale price. People sell to each other.'
    'RecipeIngotDwarvenScrapLarge03' = 'duplicate Dwarven Metal Ingot scrap smelt. One scrap path stays (RecipeIngotDwarvenScrapPlateMetalLarge). The other five are hidden from the smelter menu in Thornswood-Content.esp and refused here so the gate matches the menu. No sale price. People sell to each other.'
    'RecipeIngotDwarvenScrapLarge02' = 'duplicate Dwarven Metal Ingot scrap smelt. One scrap path stays (RecipeIngotDwarvenScrapPlateMetalLarge). The other five are hidden from the smelter menu in Thornswood-Content.esp and refused here so the gate matches the menu. No sale price. People sell to each other.'
    'RecipeIngotDwarvenScrapLarge' = 'duplicate Dwarven Metal Ingot scrap smelt. One scrap path stays (RecipeIngotDwarvenScrapPlateMetalLarge). The other five are hidden from the smelter menu in Thornswood-Content.esp and refused here so the gate matches the menu. No sale price. People sell to each other.'
    'RecipeIngotDwarvenScrapBent' = 'duplicate Dwarven Metal Ingot scrap smelt. One scrap path stays (RecipeIngotDwarvenScrapPlateMetalLarge). The other five are hidden from the smelter menu in Thornswood-Content.esp and refused here so the gate matches the menu. No sale price. People sell to each other.'
}

# THE DWARVEN SCRAP SMELT THAT STAYS (#613, #1400). It stays in the unowned map,
# because #613 kept it out of the owned bucket and tests\test-613-dwarven-ingot-collapse.js
# holds it there, and the gamemode gates it by hand in KEPT_SMELT as novice
# Platewright work. Its reason says so instead of the smelter's "open to
# everybody", which #1400 wrote into recipes.json by hand and a rebuild would
# have undone.
$OPEN_ROW_WHY = [ordered]@{
    'RecipeIngotDwarvenScrapPlateMetalLarge' = 'a smelter makes ingots, which are stock rather than a finished good. Both halves of the Smith need them, and a Miner who could not smelt his own ore would have nothing to sell. Smith work at novice, so both smith halves can do it. Not open to anybody.'
}

# THE CUT FILE (#1391). docs\systems\cut-items.json names every recipe that
# leaves the open craft book, one row per reference so a row can be put back
# for an event, and says which of three things each one is:
#   cut       not found and not made. An owned row keeps its owner and rank in
#             recipes.json with "book": "cut", so putting it back is taking its
#             line out of the cut file, and the gamemode block carries it as a
#             row nobody makes. A row nobody owned goes to the refused map with
#             the cut file's reason, because unowned means anybody may make it.
#   embassy   made only by the embassy roll: "roll": "embassy" on the row.
#   thalmor   made only by the Thalmor remnant roll: "roll": "remnant".
# It is applied after every rank and every count above, so the ladders and the
# half counts are the same with it as without it.
#
# Until 4 October this was done to recipes.json and the gamemode block by hand
# after the build had written them, so the next rebuild would have put all 3342
# rows back in the open book (issue #1622). This file is now what the build
# reads. scripts\dev\Write-CutItems.js wrote it once from the table before
# anything was cut. On a table that is already cut it starts from this file
# and writes it back as it is (issue #1714), because its rules would read the
# cut table wrongly.
$CUT_FILE = Join-Path $PSScriptRoot '..\..\docs\systems\cut-items.json'
$CUT_ROLLS = [ordered]@{ 'embassy' = 'embassy'; 'thalmor' = 'remnant' }
# What the gamemode says, after "Nobody makes that here. ", for a cut row.
$CUT_SENTENCE = 'Cut from the open book. Not found and not made. The reference stays in the cut file.'


# WHICH FOOD IS A DESSERT. This was expected to be a judgement and it is not,
# on this build, which is worth writing down because the next person will
# expect it to be a judgement too.
#
# What was tried first and thrown away: the ALCH value in gold (a sweetroll and
# a beef stew are both cheap, so price says nothing), the record's own name (a
# list of words is a list of names by another route), and the ALCH food bit
# (every cooked thing carries it, desserts included, so it separates nothing).
#
# What is actually in the records: the Gourmet mod in this load order puts a
# food type keyword on every cooked food it touches, and one of them is
# MAG_FoodTypeDessert. Counted over the cooking benches: 28 dessert, 24 stew,
# 22 meat, 18 soup, 14 cheese, 8 vegetable, 8 bread, 4 fish, 2 crab, 2 chowder.
# So the split is read out of a keyword after all, and it is the mod's own
# classification rather than this script's opinion.
#
# Bread is not a dessert and goes to the Hearthcook. That is the keyword's
# answer and not an argument this script is having.
#
# On a build without Gourmet this keyword does not exist, every cooked thing
# falls to the Hearthcook, and the Confectioner comes out empty, which fails
# the build loudly rather than quietly. That is the right failure: it means the
# split cannot be read and somebody has to decide it by hand.
$DESSERT_KEYWORD = 'MAG_FoodTypeDessert'

# WHAT IS NOT COOKING EVEN THOUGH IT HAPPENS AT A COOKING BENCH. A judgement,
# and a small one. A survival mod in this load order fills water bottles and
# waterskins at the cooking pot, and the fishing mod mixes its fire paste
# there. Handing those to the Hearthcook would mean nobody else in Skyrim can
# fill a waterskin, which is a worse outcome than a cook not owning water.
# Matched against the output record's editor id, case ignored.
$NOT_COOKING_WORDS = @('Waterskin', 'WaterBottle', 'SujammaWaterBottle', 'FishingFirePaste')

# THE TAILOR'S TWO HALVES. classes.md gives the Liverywright "robes and faction
# dress" and the Haberdasher "common and fine clothing". This is a judgement,
# and the biggest one in the file.
#
# What is in the records: ClothingRich sits on 86 of the outputs and
# ClothingPoor on a handful, which separates fine from common and says nothing
# at all about robes, because a mage robe is rich clothing and so is a noble's
# coat. There is no robe keyword and no livery keyword in the build.
#
# What comes closest is faction dress, which two keywords do mark:
# WAF_MaterialFaction from Weapons Armor Clothing and Clutter Fixes, on the
# Thieves Guild and Dark Brotherhood sets, and CWMission03ImperialGarb on the
# Imperial common armour. Those are read from the record.
#
# The robes themselves come down to a list of words, so that is what this is,
# and it is a judgement rather than a reading. Matched against the output's
# editor id and its name, case ignored. Everything that does not match is
# common or fine clothing and goes to the Haberdasher.
#
# THE WORDS ARE MATCHED AS WHOLE WORDS AND THAT IS A FIX, NOT A STYLE. Until
# 20 September the match was a plain substring, and two of the words below are
# short enough to sit inside ordinary ones. 'Guard' matched Redguard,
# Wristguards and Armguards; 'Cowl' matched a farm hat. Measured on the table
# this script wrote that day, that sent eleven rows of common clothing to the
# Liverywright: the three MCERecipeClothesRedguard rows and their three Dark
# Brotherhood variants, IARRedguardKnightCape, and the three Jarl glove rows,
# which are named Gilded Wristguards, Fine Armguards and Ulfric's Armguards.
# Hammerfell garb and fine armguards are exactly the "common and fine clothing"
# classes.md gives the Haberdasher, so a Haberdasher could not make them and a
# Liverywright could.
#
# Whole word here means the way an editor id is actually written: it is split
# where a capital letter starts a new word, so ClothesRedguardBoots reads as
# Clothes, Redguard, Boots and none of those is Guard, while
# ArmorWhiterunGuardCuirass reads as Armor, Whiterun, Guard, Cuirass and that
# one is. A name is split on its spaces and punctuation the same way. A word in
# the list with more than one word in it, and there are none today, matches a
# run of words in order.
$LIVERYWRIGHT_KEYWORDS = @('WAF_MaterialFaction', 'CWMission03ImperialGarb')
#
# 'Cowl' IS GONE FROM THE LIST, and it was measured rather than argued about.
# Every cowl a Tailor can make in this build is already caught by its editor
# id: the monk cowls by Monk, the coloured ones by Robes, Necromancer Cowl by
# Necromancer. Counted on the table of 20 September, the only row 'Cowl' won on
# its own was MCERecipeClothesFarmClothes03Hat, whose output is
# ClothesFarmClothes03Hat and whose name is the bare word Cowl. It is a farm
# hat. The word earned nothing and cost one row, so it is not here.
#
# 'Guard' stays, and whole word matching is what makes it safe. Counted on the
# table this writes today, fourteen of the Liverywright's 96 rows have Guard as
# a word in what they make, and every one of them is a hold guard cloak out of
# Cloaks&Capes.esp, Pale Guard Cloak through Winterhold Guard Cloak. That is
# faction dress by any reading of classes.md.
$LIVERYWRIGHT_WORDS    = @(
    'Robe', 'Vestment', 'Livery',
    'Guard', 'ThievesGuild', 'DarkBrotherhood', 'Cultist', 'MythicDawn',
    'Necromancer', 'Archmage', 'Psiijic', 'MothPriest', 'Vaermina',
    'Monk', 'Dawnguard', 'Stormcloak', 'Imperial', 'Blades'
)

# THE ARMOUR KEYWORDS. Read from the output record. ArmorShield is on 580 of
# the outputs in this build, which answers the question this script was asked
# to answer out loud: a shield IS an ARMO record, it carries ArmorShield on top
# of ArmorHeavy or ArmorLight, and by the forge rule it is the Platewright's.
# That is the right answer anyway. A shield is armour, it is worn on the arm,
# and an Edgewright who could make shields would be making armour.
$KW_SHIELD   = 'ArmorShield'
$KW_HEAVY    = 'ArmorHeavy'
$KW_LIGHT    = 'ArmorLight'
$KW_CLOTHING = @('ArmorClothing', 'VendorItemClothing')
$KW_JEWELRY  = @('ArmorJewelry', 'VendorItemJewelry')

# THE FAMILY A ROW BELONGS TO, WHICH IS HOW THE RECIPE BOOK GROUPS IT.
#
# Patrick, 21 September, asking for the book in the K panel: "don't be very
# specific because for like tailor there are hundreds of clothing items". So
# the book lists families rather than items, and the family has to be read off
# the records the way the halves are, not typed out.
#
# WHAT WAS TRIED FIRST AND THROWN AWAY: the last word of the output's name.
# Counted on the 3437 owned rows of this build it gives 411 families, and the
# fourth biggest of them is the word White, 34 rows, because the armour
# compilations name a record 'Padded Fur Hood - White'. Blue, Black, Red,
# Green and Vile are families under that rule as well. A list that long and
# that wrong is exactly the "very specific" he asked against.
#
# WHAT IS ACTUALLY IN THE RECORDS, counted the same way: 3305 of the 3437
# outputs carry exactly one keyword that names a KIND of thing, 68 carry two
# and 64 carry none. The game already keeps four groups of kind keyword for
# its own use and this reads those:
#
#   the weapon type keywords    WeapTypeSword, WeapTypeBow, WeapTypeStaff ...
#   the armour slot keywords    ArmorCuirass, ArmorHelmet, ArmorGauntlets,
#                               ArmorBoots, ArmorShield
#   the clothing slot keywords  ClothingBody, ClothingHead, ClothingFeet,
#                               ClothingHands, ClothingCirclet ...
#   the food type keywords      MAG_FoodTypeStew, MAG_FoodTypeDessert ...
#                               out of Gourmet.esp, the same mod the
#                               Confectioner split is already read from
#
# TWO KINDS IS NOT A TIE TO BREAK. IT IS A RECORD THAT DOES NOT SAY. The 68
# are led by 48 cloaks out of Cloaks&Capes.esp, which carry ArmorHelmet or
# ArmorCuirass beside ClothingNecklace, because that mod hangs a cloak off
# whichever slot is free. Neither keyword is what the thing is. An order
# written here would pick one of them and file 48 cloaks under helmets with a
# straight face, so instead a record that names two kinds names none and falls
# through to its own record type with the 64 that name none at all. That is
# 132 rows of the 3437 and the run prints the three counts every time.
#
# classes.md sets none of this. It names the professions and their halves and
# says nothing whatever about how the work inside a half is grouped, so the
# groups below are this script's and the words are this script's words for
# what each keyword says. A kind keyword that is not named here still makes a
# family of its own, named from the keyword's own words by FamilyNameOf, so a
# mod that adds one appears in the run's family list rather than vanishing.
$FAMILY_ARMOR_SLOTS = @('ArmorCuirass', 'ArmorHelmet', 'ArmorGauntlets', 'ArmorBoots', 'ArmorShield')
$FAMILY_KEYWORD_PREFIXES = @('WeapType', 'MAG_FoodType', 'Clothing')
# Clothing keywords that say how fine a garment is rather than what it is.
# These two sit on 86 and a handful of the outputs and would otherwise split
# every tailor's family in half along a line nobody asked for.
$FAMILY_KEYWORD_NOT = @('ClothingRich', 'ClothingPoor')
$FAMILY_NAMES = [ordered]@{
    'WeapTypeSword'        = 'Swords'
    'WeapTypeGreatsword'   = 'Greatswords'
    'WeapTypeDagger'       = 'Daggers'
    'WeapTypeWarAxe'       = 'War axes'
    'WeapTypeBattleaxe'    = 'Battleaxes'
    'WeapTypeMace'         = 'Maces'
    'WeapTypeWarhammer'    = 'Warhammers'
    'WeapTypeBow'          = 'Bows'
    'WeapTypeCrossbow'     = 'Crossbows'
    'WeapTypeStaff'        = 'Staves'
    'ArmorCuirass'         = 'Body armour'
    'ArmorHelmet'          = 'Helmets'
    'ArmorGauntlets'       = 'Gauntlets'
    'ArmorBoots'           = 'Armoured boots'
    'ArmorShield'          = 'Shields'
    'ClothingBody'         = 'Robes and body wear'
    'ClothingHead'         = 'Hats and hoods'
    'ClothingFeet'         = 'Shoes and light boots'
    'ClothingHands'        = 'Gloves'
    'ClothingCirclet'      = 'Circlets'
    'ClothingNecklace'     = 'Necklaces'
    'ClothingRing'         = 'Rings'
    'MAG_FoodTypeStew'     = 'Stews'
    'MAG_FoodTypeSoup'     = 'Soups'
    'MAG_FoodTypeMeat'     = 'Meat dishes'
    'MAG_FoodTypeFish'     = 'Fish dishes'
    'MAG_FoodTypeCrab'     = 'Crab dishes'
    'MAG_FoodTypeChowder'  = 'Chowders'
    'MAG_FoodTypeCheese'   = 'Cheese'
    'MAG_FoodTypeBread'    = 'Bread'
    'MAG_FoodTypeVegetable' = 'Vegetable dishes'
    'MAG_FoodTypeDessert'  = 'Desserts'
}
# Where the record names no kind, or names two, the record's own type is the
# last thing it says about itself. AMMO is arrows and bolts and nothing else,
# which is why it earns a family of its own rather than a leftovers bin.
$FAMILY_BY_TYPE = [ordered]@{
    'WEAP' = 'Other weapons'
    'ARMO' = 'Other armour and clothing'
    'AMMO' = 'Arrows and bolts'
    'ALCH' = 'Other food and drink'
    'INGR' = 'Ingredients'
    'MISC' = 'Other goods'
    'BOOK' = 'Books'
    'SLGM' = 'Soul gems'
}
# A record whose type is not even in that list. Plainly named on purpose: a
# row with nothing to say about itself is still a row somebody can make, and
# dropping it would be the book lying about what a half can do.
$FAMILY_OTHERWISE = 'Everything else'

# THE BENCHES, by the editor id of the keyword the recipe names. Only the ones
# that need naming are here. Everything else is decided by its output.
#
# The forge, the skyforge, the aetherium forge and the Dawnguard's bench all
# make finished metal goods and the output decides the half. The armour table
# and the sharpening wheel are tempering and the output decides the half there
# too, and the server is never asked about either of them.
#
# The smelter, 1078 recipes here, is deliberately unowned. A smelter turns ore
# and scrap into ingots. An ingot is stock and not a finished good, both halves
# of the Smith need it, and a Miner who could not smelt the ore he dug would
# have to find a smith to sell anything at all. classes.md splits what you can
# MAKE, not what you can melt. Move it to the Smith by putting it in
# $BENCH_OWNER below if the playtest says otherwise.
#
# The tanning rack is split by its output rather than named here: the leather
# and the fur plates are stock and go unowned for the same reason as the
# smelter, and the cloaks and light armour it also makes are decided the same
# way everything else is.
#
# The HearthFires house building keywords are unowned. Building a house is not
# a trade in classes.md, the recipes hand out lumber and nails and wall
# sconces, and gating them behind a profession would stop somebody furnishing a
# house they paid for.
$BENCH_UNOWNED = [ordered]@{
    'BYOHBuildingCarpenter'  = 'HearthFires house building. Not a trade in classes.md, and gating it would stop somebody furnishing a house they paid for.'
    'BYOHBuildingDrafting'   = 'HearthFires house building, the drafting table.'
    'BYOHBuildingTrophyBase1' = 'HearthFires house building, a trophy base.'
    'BYOHBuildingTrophyBase2' = 'HearthFires house building, a trophy base.'
    'testPhilCraftingBreakItDowner' = 'a Bethesda test record left in Dragonborn.esm. It is not a bench anybody stands at.'
}
# The grain mill is not here, and it is worth saying why so that the next
# reader does not think it was missed. Its keyword is called isGrainMill rather
# than CraftingSomething, which makes it look like a flag rather than a bench,
# and it is a bench: it grinds one recipe, flour. It is in $BENCH_OWNER below,
# with the Cook.

# Any keyword whose editor id starts with this is one of the 206 HearthFires
# furniture keywords, one per piece of furniture. They are all house building.
$BENCH_UNOWNED_PREFIX = 'BYOHBuildingInteriorPart'

# Benches that settle the profession on their own, where the output cannot.
# ONE NAMED RECIPE, WHERE NEITHER THE BENCH NOR THE OUTPUT CAN SETTLE IT.
#
# Everything below decides an owner from the bench a recipe stands at and the
# kind of thing it makes, and for 3,438 recipes that is enough. It is not enough
# for a tool, and a tool is the one thing on this server that somebody is
# guaranteed to need a second of.
#
# ThornswoodRecipeToolShovel is made at CraftingSmithingForge, which is a smith's
# bench that does not settle ownership on its own because half the province
# smelts and tempers there. Ownership at a forge is then settled by the output,
# and the rule is "the output is a WEAP that is not a bow and not a staff". A
# shovel is Shovel01, 0x0F5D05, a MISC. So it matched nothing and fell through to
# unowned, which means anybody may make it, which would mean a farmer forging
# their own shovel the moment the old one broke and no smith ever being asked.
#
# The pickaxe and the woodcutter's axe are not in this table because they do not
# need to be: both are WEAP and the forge rule already gives them to the
# Edgewright. The shovel is the odd one out because Bethesda made it a MISC.
#
# This is a knob for a recipe whose owner is a decision rather than a reading.
# Every entry needs the measured reason it cannot be derived, and a name in here
# that the rules WOULD have settled is worth taking out again.
# The entries are in records\recipe-owners.json, under "owner", each with its
# Owner, Half, an optional Family and its Why. They are data and not code so
# that a recipe change is the content plugin and that file and nothing else:
# the box's Rebuild-ContentTables then rebuilds a pull request's tables with
# main's own builders, taking only those two files from it (Patrick, 30 Oct
# 2026, B on the report page, #3470).
#
# What the groups in the file are:
#
# The fish trap (#1379). docs/systems/classes/fisher.md: "A woodwright makes
# them", the poles and the trap. The poles reach the Woodwright by the spear
# rule further down; the trap is a MISC with no pole in its name, so the
# forge rule leaves it to anybody unless it is named here.
# ONE SMELT ROW PER INGOT AND ONE ROW FOR LEATHER (#1391, #1400). Smelting an
# ingot is smith work and tanning a hide is the Platewright's
# (docs/systems/cut-items.md, "Smelting and tanning are not anybody's work").
# The duplicates are cut in docs/systems/cut-items.json, which CUT_FILE reads,
# and these are the rows that stay. They are named here because the smelter
# is open furniture in BENCH_OWNER and the tanning rack is no profession's
# bench, so no derived rule gives either to a half. All of them are novice
# in RECIPE_RANK, Platewright work that the sister half reaches at novice.
# Family is the recipe book's group for them, Ingots and Leather, because a
# MISC output names no kind of thing and would land in Other goods.
# Until 4 October they were put in recipes.json by hand after the build,
# so a rebuild handed every one of them back to anybody (issue #1622).
$RECIPE_NAMES_FILE = Join-Path $PSScriptRoot '..\..\records\recipe-owners.json'
$RECIPE_NAMES = [IO.File]::ReadAllText($RECIPE_NAMES_FILE) | ConvertFrom-Json
$RECIPE_OWNER = [ordered]@{}
foreach ($nameEntry in $RECIPE_NAMES.owner.PSObject.Properties) {
    $knob = @{}
    foreach ($field in $nameEntry.Value.PSObject.Properties) { $knob[$field.Name] = [string]$field.Value }
    $RECIPE_OWNER[$nameEntry.Name] = $knob
}

# NAMED RECIPES WHOSE RANK IS A DECISION RATHER THAN A READING.
#
# The charcoal grades: Poor Charcoal at novice, Charcoal at advanced, Charcoal
# Briquette at expert, Coke at master, a grade a Charburner rank. That ladder is
# the design (docs\systems\professions\woodworker\charburner.md). Until #2337
# gamemode.js burnCharcoal handed the same ladder out by
# rankStep(actorId, 'charburner') on a press; since then these four COBJ
# records at the kiln's menu are the only way charcoal is made, so the rank on
# each row is all that keeps a novice from making coke.
#
# Until 21 September a CTDA on three of them held that line, testing for the
# woodcutter manuals. The manuals are gone, so the rank on the row has to carry
# what the condition carried.
#
# It is not derivable and here is the measurement of why. All four ask for the
# same one item, firewood, in rising amounts, and all four outputs are priced
# the same at 2 gold. So the price rule cannot tell them apart and the input
# cost rule cannot either: the moment chopWood gave firewood a producer, all
# four ranked novice together, because the dearest thing any of them asks for is
# novice work for a woodworker. Before that the second rule spread them by total
# input count, which happened to land close and was still an accident.
#
# THIS IS THE LAST RESORT AND IT IS CHECKED. A named rank is applied after every
# automatic rule and BEFORE the empty-rung and standable checks, so it cannot be
# used to write a ladder with a hole in it.
# The entries are in records\recipe-owners.json, under "rank", each with its
# Rank and its Why, for the reason above. What the groups in the file are:
#
# The poles and the trap, as docs/systems/classes/fisher.md ranks them under
# "The poles and the trap" (issue #1379). Input cost puts the fine pole on
# advanced and the master pole on expert, because a steel ingot and a
# refined moonstone are their dearest makings; the page ranks a pole by the
# water it fishes, so the rank is a decision and not a reading.
# THE COLLEGE BOOK STAVES, each at its spell's rank. Patrick, 4 October,
# answering issue #1622: "B, each college book staff at its spell's rank".
# Heart stone is master mining (the miner page, #1380, #1586), so input
# cost puts every staff on master. A staff is not made until its spell is
# on you, and a Bladebinder unlocks a spell only at a rank at least the
# spell's (the Bladebinder page, Staff spells), so the recipe says what the
# spell gate already says. These are the thirteen the Bladebinder page
# keeps; the other 147 and the Aetherial Staff are cut and stay where input
# cost puts them. The rank is the spell's in the college book, the mage
# school pages and STAFF_SPELLS, and tests\test-1622-recipe-generator.js
# holds each line to it. A Bladebinder below master buys the stones from a
# master miner, which HALVES_WITH_AN_UNSTANDABLE_RUNG says for this half.
# The kept smelt and tan rows named in RECIPE_OWNER (#1391, #1400): novice
# smith work, whatever the ore costs to dig.
$RECIPE_RANK = [ordered]@{}
foreach ($nameEntry in $RECIPE_NAMES.rank.PSObject.Properties) {
    $knob = @{}
    foreach ($field in $nameEntry.Value.PSObject.Properties) { $knob[$field.Name] = [string]$field.Value }
    $RECIPE_RANK[$nameEntry.Name] = $knob
}

$BENCH_OWNER = [ordered]@{
    'CraftingCookpot'         = @{ Owner = 'Cook';       Why = 'a cooking pot' }
    'BYOHCraftingOven'        = @{ Owner = 'Cook';       Why = 'the HearthFires oven' }
    'isGrainMill'             = @{ Owner = 'Cook';       Why = 'a grain mill, which makes the flour a kitchen runs on' }
    # Renamed on 21 September from the other server's prefix to Thornswood,
    # with 32 more records of Thornswood-Content.esp, by a script that did that
    # one job and is gone (#400). That commit said no generated table moved, and
    # this one did: the bench is matched here by its editor id, so from the
    # rename until 21 September the kiln stopped being the Charburner's bench
    # and all four charcoal rows fell through to 'a MISC off a bench nobody has
    # claimed'. The build failed on it the first time the table was rebuilt,
    # with 'Woodworker/Charburner owns no recipes at all', and refused to write
    # game\data\recipes.json, which is the check doing its job.
    'ThornswoodCraftingCharcoalKiln' = @{ Owner = 'Woodworker'; Half = 'Charburner'; Why = 'the charcoal kiln Thornswood-Content.esp already ships. classes.md gives the Charburner firewood through to coke in as many words, and this bench is that chain.' }
    'ThornswoodCraftingWoodworking' = @{ Owner = 'Woodworker'; Half = 'Woodwright'; Why = 'the woodworking bench Thornswood-Content.esp ships for #516. Bows, arrows, instruments and poles are made here; classes.md gives them to the Woodwright.' }
    'MCE_CraftingLoom'        = @{ Owner = 'Tailor';     Why = 'a loom, from MoreCraftableEquipment' }
    'DLC2StaffEnchanter'      = @{ Owner = 'Enchanter';  Half = 'Bladebinder'; Why = 'the Dragonborn staff enchanter. Every one of its recipes outputs a staff, and a staff is a weapon, so it is the Bladebinder''s by the same rule that gives him swords.' }
    'CraftingSmelter'         = @{ Owner = '';           Why = 'a smelter makes ingots, which are stock rather than a finished good. Both halves of the Smith need them, and a Miner who could not smelt his own ore would have nothing to sell. Left open to everybody on purpose.' }
}

# THE BENCHES EACH TRADE WORKS AT, AND WHERE A ROW AT ANY OTHER IS MOVED (#3120).
#
# Patrick, 21 October, in the #3080 thread: "fix the benches so only the
# correct people can do things and they have the correct recpipes for eah
# cbnech", and "make sure if a bench has a recipoe that should be on adifferent
# bench it should get moved". A bench opens for somebody craftAnswer allows one
# of its rows (Build-BenchTable.py, #3080), so who a bench opens for follows
# from which rows sit at it. Measured 26 October on recipes.json: 51 Tailor
# rows people can make sat at the forge (Immersive Armors' fur hoods, capes,
# robes and unarmoured mage sets, three Riekling clothes), and 9 Woodwright
# rows (two arrows, the Falmer bow, the flute, the lute, the drum and the
# Riekling spears), so the forge opened for every Tailor and every Woodwright.
#
# The owner is read off the output, wherever the mod put the recipe, and that
# does not change. What changes is the bench: a row whose owner does not work
# at the bench its mod put it at goes to that trade's Home bench. Benches is
# every bench the trade works at; Only narrows one of them to the families of
# work done there (a Smith at the tanning rack tans, and makes no armour there).
#
# Only rows somebody can make are moved: a row that fires and is not cut. A
# row nobody makes opens no bench, and a cut row put back for an event is moved
# on the build that puts it back. A row the server never sees (a temper at the
# sharpening wheel or the armour table) opens no bench either.
#
# The rows nobody owns are not moved: a row nobody owns is made by whoever the
# bench opens for, which is Patrick's answer on 22 October (A on the report
# page): rings, necklaces and circlets are Smith work at the forge, either
# half, and the rest of the unowned rows go to the trade of the bench they sit
# at. With the Tailor and Woodwright rows off the forge, the forge opens for
# Smiths alone, and that is the answer.
#
# Where the row is made now goes in bench and benchName, so every reader of
# recipes.json (the bench gate, the fuel table, the re-cost, the merchant
# tables) reads the bench the row is made at. movedFrom and movedFromName say
# where its mod put it. scripts/mods/Build-LastPlugin.py carries each move in
# Thornswood-Last.esp, or, for a plugin it never copies from, hands it to each
# person's game (RECIPES_MOVED_IN_GAME).
$TRADE_BENCHES = [ordered]@{
    'Smith'      = @{ Home = 'CraftingSmithingForge'
                      Benches = @('CraftingSmithingForge', 'CraftingSmithingSkyforge', 'CraftingSmelter', 'CraftingSmithingArmorTable',
                                  'CraftingSmithingSharpeningWheel', 'DLC1LD_CraftingForgeAetherium', 'CraftingTanningRack')
                      Only = @{ 'CraftingTanningRack' = @('Leather') } }
    'Tailor'     = @{ Home = 'MCE_CraftingLoom'; Benches = @('MCE_CraftingLoom', 'CraftingTanningRack') }
    'Woodworker' = @{ Home = 'ThornswoodCraftingWoodworking'
                      Benches = @('ThornswoodCraftingWoodworking', 'ThornswoodCraftingCharcoalKiln', 'DLC1CraftingDawnguard') }
    'Enchanter'  = @{ Home = 'DLC2StaffEnchanter'; Benches = @('DLC2StaffEnchanter', 'DLC1LD_CraftingForgeAetherium') }
    'Cook'       = @{ Home = 'CraftingCookpot'; Benches = @('CraftingCookpot', 'BYOHCraftingOven', 'isGrainMill') }
    'Alchemist'  = @{ Home = 'ThornswoodCraftingAlchemy'; Benches = @('ThornswoodCraftingAlchemy') }
}

# The plugin Build-LastPlugin.py writes. Its BNAM is never read as where a mod
# put a recipe: it is where this table moved it, so reading it back would take
# every move off on the next build (#3120).
$LAST_PLUGIN = 'Thornswood-Last.esp'

if (-not $Out) { $Out = Join-Path $PSScriptRoot '..\..\game\data\recipes.json' }

$fail = 0
function Ok  ($m) { Write-Host "  ok    $m" -ForegroundColor Green }
function Bad ($m) { Write-Host "  FAIL  $m" -ForegroundColor Red; $script:fail++ }
function Note($m) { Write-Host "        $m" -ForegroundColor DarkGray }
function Loud($m) { Write-Host "  ----  $m" -ForegroundColor Yellow }

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
# of the file it really belongs to in its top byte, so an Update.esm record with
# 00 up there is a Skyrim.esm record being overridden and the desc has to say
# Skyrim.esm. A form id inside CNAM, BNAM or KWDA is numbered the same way,
# which is what makes the output and the bench resolvable at all.
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
    # character 'S'. Update.esm, Dawnguard.esm, HearthFires.esm and
    # Dragonborn.esm have exactly one master each, so this is the common case.
    # Build-OreTable.ps1 was bitten by it and proved it in a shell.
    return ,$masters.ToArray()
}

# One json string, quoted and escaped. Written here rather than reached for with
# ConvertTo-Json so the file comes out the same on 5.1 and on 7.
function JsonStr($s) {
    $t = [string]$s
    $t = $t.Replace('\', '\\')
    $t = $t.Replace('"', '\"')
    $t = $t.Replace("`r", '\r')
    $t = $t.Replace("`n", '\n')
    $t = $t.Replace("`t", '\t')
    return '"' + $t + '"'
}

# form id -> 'hex:owning plugin', the desc the server takes. The top byte is an
# index into the plugin's master list; the plugin's own records carry the index
# one past the end of it.
function DescOf([uint32]$formId, $masters, [string]$plugin) {
    $mi = [int]($formId -shr 24)
    $owner = $plugin
    if ($mi -lt $masters.Count) { $owner = $masters[$mi] }
    return ('{0:x}' -f ($formId -band 0xFFFFFF)) + ':' + $owner
}

# Where a rank sits on classes.md's ladder, 0 for novice up to 3 for master,
# and -1 for anything that is not one of the four. Comparing ranks as strings
# is how a ladder gets checked in alphabetical order, where advanced comes
# before novice and the whole answer is wrong without anything printing.
function RankAt([string]$rank) {
    for ($i = 0; $i -lt $RANKS.Count; $i++) { if ($RANKS[$i] -eq $rank) { return $i } }
    return -1
}

# One producer of one item, into both maps. True when this is the first entry
# for the item, which is the number each table is credited with in the run.
#
# BOTH MAPS, ALWAYS. $producer keeps one answer per item by the rule in
# PRODUCER_RANK_IS_LOWEST, because a recipe costs what the cheapest way of
# getting its makings costs. $producerAll keeps every class that produces it,
# because the answer $producer throws away is exactly the cross-class question
# Patrick asked: a Cook wanting a Red Apple is novice work off a gatherer and
# the farmer who grows one has to be expert, and only this map can say so.
function RememberProducer([string]$desc, [string]$rank, [int]$at, [string]$who, [string]$name, [string]$via) {
    if (-not $producerAll.ContainsKey($desc)) { $producerAll[$desc] = @() }
    $producerAll[$desc] += ,([pscustomobject]@{ Rank = $rank; At = $at; Who = $who; Name = $name; Via = $via })

    $have = $null
    if ($producer.ContainsKey($desc)) { $have = $producer[$desc] }
    $take = $false
    if (-not $have) {
        $take = $true
    } elseif ($CROP_COSTS_THE_FARMERS_RANK -and ($who -eq 'farmer' -or $have.Who -eq 'farmer')) {
        # See CROP_COSTS_THE_FARMERS_RANK: the farmer's entry wins over any
        # other class, and between two farmer entries the usual rule decides.
        if ($who -eq 'farmer' -and $have.Who -ne 'farmer') { $take = $true }
        elseif ($who -eq 'farmer' -and $have.Who -eq 'farmer' -and $at -lt $have.At) { $take = $true }
    } elseif ($PRODUCER_RANK_IS_LOWEST) {
        if ($at -lt $have.At) { $take = $true }
    } else {
        if ($at -gt $have.At) { $take = $true }
    }
    if ($take) {
        $producer[$desc] = [pscustomobject]@{ Rank = $rank; At = $at; Who = $who; Name = $name; Via = $via }
    }
    if (-not $have) { return $true }
    return $false
}


# THE STATIONS, READ OUT OF game\gamemode.js. Argued for at STATION_VERBS: this
# is a reader and not a copy, so the index cannot drift from what the server
# actually hands over without the build saying so.
#
# It returns one row per item a named verb gives away, with the rank somebody
# has to hold before the verb gives it, and the line it was read off. Anything
# it cannot make sense of is returned as a complaint rather than skipped, because
# a station that silently reads as producing nothing is the exact fault this
# replaced: an input nothing in the world hands out, and no line anywhere saying
# the reader lost it.
function ReadStationVerbs([string]$path) {
    $out = New-Object 'System.Collections.Generic.List[object]'
    $bad = New-Object 'System.Collections.Generic.List[string]'
    $res = [pscustomobject]@{ Rows = $out; Bad = $bad; Ladder = @() }

    if (-not (Test-Path -LiteralPath $path)) {
        $bad.Add(("{0} is not in this folder, so nothing can say what the server's own stations hand over" -f $path))
        return $res
    }
    $text = Get-Content -LiteralPath $path -Raw

    # ITEMS is one generated line: every item gamemode.js names, key -> desc.
    $m = [regex]::Match($text, '(?m)^const ITEMS = (\{.*\});\s*$')
    if (-not $m.Success) {
        $bad.Add('game\gamemode.js has no "const ITEMS = {...};" line, so no station item can be resolved to a record')
        return $res
    }
    $itemsJs = @{}
    $parsed = $m.Groups[1].Value | ConvertFrom-Json
    foreach ($pn in $parsed.PSObject.Properties.Name) { $itemsJs[$pn] = [string]$parsed.$pn }

    # RANK_LADDER is the gamemode's own copy of classes.md's four ranks, and the
    # index into it is what rankStep() returns. Read rather than assumed, and
    # checked against this script's RANKS below, because the whole reading turns
    # on the two lists being the same list.
    $m2 = [regex]::Match($text, '(?m)^const RANK_LADDER = \[(.*)\];\s*$')
    if (-not $m2.Success) {
        $bad.Add('game\gamemode.js has no "const RANK_LADDER = [...];" line, so a rankStep index cannot be turned into a rank')
        return $res
    }
    $ladder = @()
    foreach ($lm in [regex]::Matches($m2.Groups[1].Value, "'([^']+)'")) { $ladder += $lm.Groups[1].Value }
    $res.Ladder = $ladder

    foreach ($v in $STATION_VERBS) {
        $at = $text.IndexOf('function ' + $v.Fn + '(')
        if ($at -lt 0) {
            $bad.Add(("game\gamemode.js has no function {0}(), which STATION_VERBS names as a producer" -f $v.Fn))
            continue
        }
        $open = $text.IndexOf('{', $at)
        if ($open -lt 0) { $bad.Add(("function {0}() has no body" -f $v.Fn)); continue }
        # Brace matching over the body. Crude on purpose: a brace inside a string
        # would throw it off, and neither of these two functions has one. The
        # check under this loop is what catches it if that ever stops being true,
        # because a body read short hands over fewer items than the server does.
        $depth = 0
        $end = -1
        for ($i = $open; $i -lt $text.Length; $i++) {
            $ch = $text[$i]
            if ($ch -eq '{') { $depth++ }
            elseif ($ch -eq '}') { $depth--; if ($depth -eq 0) { $end = $i; break } }
        }
        if ($end -lt 0) { $bad.Add(("function {0}() never closes its body" -f $v.Fn)); continue }
        $body = $text.Substring($open, $end - $open + 1)

        $found = 0
        $depth = 0
        $guards = New-Object 'System.Collections.Generic.List[object]'
        foreach ($rawLine in ($body -split "`r?`n")) {
            $line = $rawLine

            # The rank in force on this line: the deepest step guard this line
            # sits inside. Nothing guarded is the bottom of the ladder, which is
            # what a novice can do, which is what rankStep returns for one.
            $step = 0
            foreach ($g in $guards) { if ($g.Step -gt $step) { $step = $g.Step } }

            # Shape three first: a list of ITEMS keys indexed by rankStep, which
            # is one item per rung and not one item under a guard.
            $gm = [regex]::Match($line, "\[((?:\s*'[A-Za-z0-9_]+'\s*,)+\s*'[A-Za-z0-9_]+'\s*)\]\s*\[\s*rankStep\s*\(")
            if ($gm.Success) {
                $keys = @()
                foreach ($km in [regex]::Matches($gm.Groups[1].Value, "'([^']+)'")) { $keys += $km.Groups[1].Value }
                for ($ki = 0; $ki -lt $keys.Count; $ki++) {
                    $k = $keys[$ki]
                    if (-not $itemsJs.ContainsKey($k)) {
                        $bad.Add(("{0}() hands over ITEMS.{1} and no such key is in the ITEMS line" -f $v.Fn, $k))
                        continue
                    }
                    if ($ki -ge $ladder.Count) {
                        $bad.Add(("{0}() lists {1} grades and RANK_LADDER has {2} rungs, so grade {3} sits on no rank" -f `
                                  $v.Fn, $keys.Count, $ladder.Count, ($ki + 1)))
                        continue
                    }
                    $out.Add([pscustomobject]@{
                        Fn = $v.Fn; Who = $v.Who; Key = $k; Desc = $itemsJs[$k]
                        Rank = $ladder[$ki]; At = $ki
                        Where = ('game\gamemode.js ' + $v.Fn + '(), ' + $v.What + ', grade ' + ($ki + 1) +
                                 ' of ' + $keys.Count + ' off ' + $line.Trim())
                    })
                    $found++
                }
            }

            # Shape four: what the verb EATS is not what it produces.
            if ($line -notmatch 'takeItem\s*\(') {
                foreach ($im in [regex]::Matches($line, 'ITEMS\.([A-Za-z_][A-Za-z0-9_]*)')) {
                    $k = $im.Groups[1].Value
                    if (-not $itemsJs.ContainsKey($k)) {
                        $bad.Add(("{0}() hands over ITEMS.{1} and no such key is in the ITEMS line" -f $v.Fn, $k))
                        continue
                    }
                    if ($step -ge $ladder.Count) {
                        $bad.Add(("{0}() guards ITEMS.{1} behind step >= {2} and RANK_LADDER has {3} rungs" -f `
                                  $v.Fn, $k, $step, $ladder.Count))
                        continue
                    }
                    $out.Add([pscustomobject]@{
                        Fn = $v.Fn; Who = $v.Who; Key = $k; Desc = $itemsJs[$k]
                        Rank = $ladder[$step]; At = $step
                        Where = ('game\gamemode.js ' + $v.Fn + '(), ' + $v.What + ', off ' + $line.Trim())
                    })
                    $found++
                }
            }

            # Then the braces, so that a guard opened on this line covers the
            # lines under it and not the line itself.
            $opens  = ([regex]::Matches($line, '\{')).Count
            $closes = ([regex]::Matches($line, '\}')).Count
            $depth += ($opens - $closes)
            if ($opens -gt $closes) {
                $sm = [regex]::Match($line, '(?:rankStep\s*\([^)]*\)|\bstep\b)\s*>=\s*(\d+)')
                if ($sm.Success) {
                    $guards.Add([pscustomobject]@{ Depth = $depth; Step = [int]$sm.Groups[1].Value })
                }
            }
            for ($gi = $guards.Count - 1; $gi -ge 0; $gi--) {
                if ($guards[$gi].Depth -gt $depth) { $guards.RemoveAt($gi) }
            }
        }
        if ($found -eq 0) {
            $bad.Add(("{0}() was found and read and hands over nothing this reader could see, so the station would enter the index as a producer of nothing" -f $v.Fn))
        }
    }
    return $res
}
# How many rows of one half sit on each of the four rungs, in classes.md's
# order, counted off the Rank that is on the rows right now.
function CountRungs($descs) {
    $counts = [ordered]@{}
    foreach ($rk in $RANKS) { $counts[$rk] = 0 }
    foreach ($d in $descs) {
        $rk = [string]$owned[$d].Rank
        if ($counts.Contains($rk)) { $counts[$rk] = $counts[$rk] + 1 }
    }
    return $counts
}

# The lowest empty rung that has work above it, or -1 when the ladder is sound.
# An empty rung with nothing above it is fine: that is a half whose work simply
# does not reach that far up. An empty rung with work above it is a rank that
# opens nothing, and a rank that opens nothing at the bottom is a character who
# can never start.
function HoleIn($counts) {
    for ($i = 0; $i -lt $RANKS.Count; $i++) {
        if ([int]$counts[$RANKS[$i]] -gt 0) { continue }
        for ($j = $i + 1; $j -lt $RANKS.Count; $j++) {
            if ([int]$counts[$RANKS[$j]] -gt 0) { return $i }
        }
    }
    return -1
}

# The other half of HoleIn: the rungs that have rows on them and not one row
# anybody standing on that rung could gather the makings for.
#
# A row is standable at its rung when the dearest input any class produces for
# it sits at or below that rung, or when nothing it asks for is produced by a
# class at all, which means a shop or one of the 1679 unowned recipes hands it
# over and no class rank stands in the way.
#
# Counting rows is what both this script and Check-Balance did until the
# Bladebinder was measured: 41 rows on its novice rung, every one of them
# wanting a master miner's Heart Stone, and every count in both scripts said
# the ladder was sound. Returns one entry per bad rung, worst rung first.
function UnstandableRungs($descs) {
    $out = New-Object 'System.Collections.Generic.List[object]'
    for ($i = 0; $i -lt $RANKS.Count; $i++) {
        $on = 0
        $standable = 0
        $cheapest = -1
        $blocker = ''
        $blockerWho = ''
        foreach ($d in $descs) {
            if ([string]$owned[$d].Rank -ne $RANKS[$i]) { continue }
            $on++
            $ir = [string]$owned[$d].InputRank
            if (-not $ir) { $standable++; continue }
            $irAt = RankAt $ir
            if ($irAt -le $i) { $standable++; continue }
            if ($cheapest -lt 0 -or $irAt -lt $cheapest) {
                $cheapest = $irAt
                $blocker = [string]$owned[$d].OutName
                $blockerWho = [string]$owned[$d].InputRankWho
            }
        }
        if ($on -gt 0 -and $standable -eq 0) {
            $out.Add([pscustomobject]@{
                Rank = $RANKS[$i]; Rows = $on; NeedAt = $RANKS[$cheapest]
                Nearest = $blocker; Who = $blockerWho
            })
        }
    }
    return $out.ToArray()
}

# THE SECOND RULE, for one half at a time and only where the first two left a
# rung with nothing on it. Named in SECOND_RULE_KEY, argued for there.
#
# The ordering is deliberately a TOTAL order with no ties in it: the key, then
# the other input measure, then the output price, then the row's own id. That
# is the difference between this and the price rule, which collapses rungs
# exactly because it refuses to split rows that tie. A total order fills every
# rung the shares ask for whenever the half has four rows or more, which is why
# this rule always closes the hole and the price rule cannot.
function SecondRule([string]$key, $descs) {
    $order = @($descs | Sort-Object `
        @{ Expression = { [int](SecondRuleKey $owned[$_]) } }, `
        @{ Expression = { [int](OtherInputMeasure $owned[$_]) } }, `
        @{ Expression = { [int64]$owned[$_].Value } }, `
        @{ Expression = { [string]$_ } })
    $n = $order.Count
    $at = 0
    foreach ($s in $RANK_SHARE) {
        $last = [int][math]::Ceiling($n * [double]$s.Upto)
        if ($last -gt $n) { $last = $n }
        while ($at -lt $last) {
            $owned[$order[$at]].Rank = [string]$s.Rank
            $owned[$order[$at]].RankFrom = ('the second rule, ' + $SECOND_RULE_KEY)
            $owned[$order[$at]].RankWhy = ('what this half makes cannot be told apart by price or by what its inputs cost, so it is ranked by ' +
                                           $SECOND_RULE_KEY + ': this one wants ' + (SecondRuleKey $owned[$order[$at]]) +
                                           ', which puts it in the ' + $s.Rank + ' share of its own half')
            $at++
        }
    }
    while ($at -lt $n) {
        $owned[$order[$at]].Rank = [string]$RANK_SHARE[$RANK_SHARE.Count - 1].Rank
        $owned[$order[$at]].RankFrom = ('the second rule, ' + $SECOND_RULE_KEY)
        $owned[$order[$at]].RankWhy = ('the longest shopping list in a half that cannot be told apart by price or by what its inputs cost')
        $at++
    }
    return (CountRungs $descs)
}

# The share RANK_SHARE gives one rung, 0.25 for novice and so on.
function RungShare([int]$i) {
    $lo = 0.0
    if ($i -gt 0) { $lo = [double]$RANK_SHARE[$i - 1].Upto }
    return ([double]$RANK_SHARE[$i].Upto - $lo)
}

# THE ONE RUNG HOLE FILL, argued for at HOLE_FILL_MOVES_ONE_RUNG. Moves rows
# from the rung next to each hole into it, never a row more than one rung and
# never a pinned row. Returns the list of moves when every hole is closed. When
# it cannot close them all it puts every row back as it found it and returns
# $null, and the caller goes on to the second rule.
function FillHolesOneRung($descs) {
    $saved = @{}
    foreach ($d in $descs) { $saved[$d] = @($owned[$d].Rank, $owned[$d].RankFrom, $owned[$d].RankWhy) }
    $moved = @{}
    $moves = New-Object 'System.Collections.Generic.List[string]'
    for ($round = 0; $round -lt ($RANKS.Count * 2); $round++) {
        $counts = CountRungs $descs
        $hole = HoleIn $counts
        if ($hole -lt 0) { return ,($moves.ToArray()) }
        $took = $false
        foreach ($from in @(($hole + 1), ($hole - 1))) {
            if ($from -lt 0 -or $from -ge $RANKS.Count) { continue }
            $total = [int]$counts[$RANKS[$from]]
            if ($total -lt 2) { continue }
            $pool = @($descs | Where-Object {
                [string]$owned[$_].Rank -eq $RANKS[$from] -and -not $owned[$_].Pinned -and -not $moved.ContainsKey($_)
            })
            if ($pool.Count -eq 0) { continue }
            $take = [int][math]::Floor($total * (RungShare $hole) / ((RungShare $hole) + (RungShare $from)))
            if ($take -lt 1) { $take = 1 }
            if ($take -gt ($total - 1)) { $take = $total - 1 }
            if ($take -gt $pool.Count) { $take = $pool.Count }
            $down = ($from -gt $hole)
            # A row whose input cost is already at or past the hole loses
            # nothing by moving, so those go first. Then the cheapest when the
            # move is down and the dearest when it is up, then the id so the
            # order is total and the build is the same every run.
            $order = @($pool | Sort-Object `
                @{ Expression = {
                    $ir = RankAt ([string]$owned[$_].InputRank)
                    if ($ir -lt 0) { 0 } elseif ($down -and $ir -le $hole) { 0 } elseif ((-not $down) -and $ir -ge $hole) { 0 } else { 1 }
                } }, `
                @{ Expression = { if ($down) { [int64]$owned[$_].Value } else { -[int64]$owned[$_].Value } } }, `
                @{ Expression = { [int](SecondRuleKey $owned[$_]) } }, `
                @{ Expression = { [string]$_ } })
            for ($t = 0; $t -lt $take; $t++) {
                $d = $order[$t]
                $owned[$d].Rank = $RANKS[$hole]
                $owned[$d].RankFrom = ('moved one rung from ' + $RANKS[$from] + ' to fill an empty ' + $RANKS[$hole] + ' rung, after ' + $saved[$d][1])
                $owned[$d].RankWhy = ($saved[$d][2] + '. Then moved one rung, ' + $RANKS[$from] + ' to ' + $RANKS[$hole] +
                                      ', because the ' + $RANKS[$hole] + ' rung of this half was empty with work above it (HOLE_FILL_MOVES_ONE_RUNG)')
                $moved[$d] = $true
                $moves.Add(('{0} ({1}), {2} to {3}' -f $owned[$d].Edid, $owned[$d].OutName, $RANKS[$from], $RANKS[$hole]))
            }
            $took = $true
            break
        }
        if (-not $took) { break }
    }
    if ((HoleIn (CountRungs $descs)) -lt 0) { return ,($moves.ToArray()) }
    foreach ($d in $descs) {
        $owned[$d].Rank = $saved[$d][0]; $owned[$d].RankFrom = $saved[$d][1]; $owned[$d].RankWhy = $saved[$d][2]
    }
    return $null
}

# The number the second rule sorts on, and the other one, so that changing
# SECOND_RULE_KEY changes both in one place.
function SecondRuleKey($row) {
    if ($SECOND_RULE_KEY -eq 'distinct inputs') { return @($row.InputList).Count }
    $t = 0
    foreach ($i in @($row.InputList)) { $t += [int]$i.Count }
    return $t
}
function OtherInputMeasure($row) {
    if ($SECOND_RULE_KEY -eq 'distinct inputs') {
        $t = 0
        foreach ($i in @($row.InputList)) { $t += [int]$i.Count }
        return $t
    }
    return @($row.InputList).Count
}

# The inputs of one recipe, as json. Every CNTO the record carried: the item,
# what it is called, what kind of record it is, how many the recipe wants, and
# which class produces it at which rank, and which class SUPPLIES it once the
# hop is followed. producedBy null means no table in this folder and no verb in
# game\gamemode.js hands that item over, which is the case for anything bought
# from a shop and for everything made at a bench; suppliedBy null means nothing
# in this world gets it to you at all, at any number of benches. Both are
# written down rather than left out so that a reader can tell "nobody produces
# this" from "this script did not look".
function InputsJson($r) {
    if (-not $r.InputList -or @($r.InputList).Count -eq 0) { return '[]' }
    $bits = @()
    foreach ($i in $r.InputList) {
        $nm = $i.Desc
        $ty = ''
        if ($items.ContainsKey($i.Desc)) { $nm = $items[$i.Desc].Name; $ty = $items[$i.Desc].Type }
        $line = '{ "item": ' + (JsonStr $i.Desc) + ', "name": ' + (JsonStr $nm) +
                ', "type": ' + (JsonStr $ty) + ', "count": ' + $i.Count
        if ($producer.ContainsKey($i.Desc)) {
            $line += ', "producedBy": ' + (JsonStr $producer[$i.Desc].Who) +
                     ', "producedAt": ' + (JsonStr $producer[$i.Desc].Rank)
            # EVERY OTHER CLASS THAT PRODUCES THE SAME THING, at the rank it
            # produces it at. This is the field Patrick's cross-tier question is
            # read off, and without it the farmer is invisible in this whole
            # file, because every crop is also a plant a gatherer picks at the
            # same rank or lower.
            #
            # A CLASS THAT TIES THE WINNER BELONGS IN HERE, and it did not until
            # 21 September: the test was 'dearer than the winner', so a tied
            # class was dropped from the file altogether and every consumer of
            # it was blind to that class for that item. Measured that day, wheat
            # was advanced in the harvests map and advanced in the crops map, so
            # the farmer tied the gatherer and not one of the 36 Sack of Flour
            # input entries named the farmer anywhere: Check-Balance could report
            # the tundra cotton chain, where the ranks differ, and could not
            # report the wheat chain at all. The winner is still the only answer
            # producedBy gives, which is what a recipe costs; this says who else
            # is standing there.
            #
            # The winner's own class is left out whatever rank it appears at,
            # because producedAt has already answered for it and a second line
            # saying the same class reaches the same item higher up some other
            # ladder is noise rather than a cross-class fact.
            $dearer = @()
            $seen = @{}
            if ($producerAll.ContainsKey($i.Desc)) {
                foreach ($pz in $producerAll[$i.Desc]) {
                    if ($pz.Who -eq $producer[$i.Desc].Who) { continue }
                    if ($pz.At -lt $producer[$i.Desc].At) { continue }
                    $k = $pz.Who + '/' + $pz.Rank
                    if ($seen.ContainsKey($k)) { continue }
                    $seen[$k] = $true
                    $dearer += ('{ "who": ' + (JsonStr $pz.Who) + ', "at": ' + (JsonStr $pz.Rank) + ' }')
                }
            }
            if ($dearer.Count -gt 0) { $line += ', "alsoProducedBy": [' + ($dearer -join ', ') + ']' }
        } else {
            $line += ', "producedBy": null, "producedAt": null'
        }
        # AND WHO SUPPLIES IT IN THE END, which is a different question from who
        # digs it up. producedBy answers only for a thing that comes out of the
        # ground; suppliedBy follows the hop as well, so a Steel Ingot reads
        # miner and a Leather Strip reads hunter instead of both reading null.
        # hops is how many benches stand between the class and this input: 0 is
        # handed straight over, 1 is a smelter or a tanning rack away, and via
        # names the recipe that last step is.
        if ($supply.ContainsKey($i.Desc)) {
            $sp = $supply[$i.Desc]
            $hops = 0
            if ($sp.PSObject.Properties.Name -contains 'Hops') { $hops = [int]$sp.Hops }
            $line += ', "suppliedBy": ' + (JsonStr $sp.Who) +
                     ', "suppliedAt": ' + (JsonStr $sp.Rank) +
                     ', "hops": ' + $hops
            if ($hops -gt 0) { $line += ', "suppliedVia": ' + (JsonStr ([string]$sp.Via)) }
        } else {
            $line += ', "suppliedBy": null, "suppliedAt": null, "hops": null'
        }
        $bits += ($line + ' }')
    }
    return '[' + ($bits -join ', ') + ']'
}

# Every table and gamemode block this writes is joined with LF, the ending
# .gitattributes gives these files on every checkout (#3029). Until then each
# run took the ending of the file it found, because a checkout with autocrlf
# held them CRLF and the agents' VM and the runners' clones LF (#1622, #1787,
# #1828), so a run on One rewrote every table it touched.
$Eol = "`n"

# A listing of the game folder: name, size and last write, for the files this
# reads and the folder they sit in. Taken before and after so the promise that
# nothing was touched is measured rather than asserted.
function Get-FolderPrint([string]$dir) {
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $n = 0
    foreach ($d in @($dir, (Join-Path $dir 'Strings'))) {
        if (-not (Test-Path -LiteralPath $d)) { continue }
        foreach ($f in (Get-ChildItem -LiteralPath $d -File -Force | Sort-Object Name)) {
            $lines.Add(('{0}|{1}|{2:o}' -f $f.Name, $f.Length, $f.LastWriteTimeUtc))
            $n++
        }
    }
    $text = $lines -join "`n"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = [BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text))).Replace('-', '')
    $sha.Dispose()
    return [pscustomobject]@{ Count = $n; Hash = $hash.ToLowerInvariant() }
}

# ------------------------------------------------------- the load order -----

Write-Host ''
Write-Host 'the load order' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $Data)) { throw "not found: $Data" }

$before = Get-FolderPrint $Data
Ok ("{0}: {1} files before this ran, {2}" -f $Data, $before.Count, $before.Hash.Substring(0, 16))

$order = New-Object 'System.Collections.Generic.List[string]'
if ($Plugins.Count -gt 0) {
    foreach ($p in $Plugins) { if (-not $order.Contains($p)) { $order.Add($p) } }
    Ok ("{0} plugins, given on the command line" -f $order.Count)
} else {
    if (-not (Test-Path -LiteralPath $PluginsTxt)) { throw "not found: $PluginsTxt" }
    # The five masters, then each '*' line; a line with no '*' is a plugin
    # switched off, which the game does not load (OwnPlugins.ps1, #1622,
    # #1712, #2976).
    foreach ($p in (Get-LoadOrder $PluginsTxt)) { $order.Add($p) }
    $offCount = (Get-SwitchedOff $PluginsTxt).Count
    Ok ("{0} plugins: the five masters, then {1}" -f $order.Count, $PluginsTxt)
    if ($offCount -gt 0) { Note "$offCount line(s) in that list are switched off and were left out" }
}

$missing = New-Object 'System.Collections.Generic.List[string]'
foreach ($p in $order) { if (-not (Test-Path -LiteralPath (Get-PluginPath $Data $p))) { $missing.Add($p) } }
if ($missing.Count -gt 0) {
    Bad ("{0} plugin(s) in the load order are not in {1}: {2}" -f $missing.Count, $Data, ($missing -join ', '))
} else {
    Ok 'every plugin in the load order is on disk'
}

# ------------------------------------------------------- the string tables --

Write-Host ''
Write-Host 'names' -ForegroundColor Cyan
$tables = @{}
$looseDir = Join-Path $Data 'Strings'
# A localised plugin's table is loose in Data\Strings, or in an archive: its
# own (_ResourcePack.esl's is in _ResourcePack.bsa), or Skyrim - Interface.bsa
# for the five masters. The same places Build-HuntTable.ps1 and
# Build-HarvestTable.ps1 look (#3349: this read only Skyrim - Interface.bsa,
# and stopped on _ResourcePack.esl once dev's load order carried it).
$bsaCache = @{}
function Get-BsaCached([string]$name) {
    if ($bsaCache.ContainsKey($name)) { return $bsaCache[$name] }
    $p = Join-Path $Data $name
    if (-not (Test-Path -LiteralPath $p)) { $bsaCache[$name] = $null; return $null }
    $got = $null
    try { $got = Get-BsaStringFiles $p } catch { Note ("could not read {0}: {1}" -f $name, $_.Exception.Message); $got = $null }
    $bsaCache[$name] = $got
    return $got
}
foreach ($pl in $order) {
    $path = Get-PluginPath $Data $pl
    if (-not (Test-Path -LiteralPath $path)) { continue }
    # only a plugin flagged localised keeps its names in a string table
    $head = New-Object byte[] 12
    $fs = [System.IO.File]::OpenRead($path)
    [void]$fs.Read($head, 0, 12)
    $fs.Dispose()
    if (-not ([BitConverter]::ToUInt32($head, 8) -band 0x80)) { continue }

    $base = [System.IO.Path]::GetFileNameWithoutExtension($pl).ToLowerInvariant()
    $want = $base + '_' + $LANGUAGE + '.strings'
    $loose = Join-Path $looseDir $want
    if (Test-Path -LiteralPath $loose) {
        $tables[$pl] = @{ Table = (Read-StringTable ([System.IO.File]::ReadAllBytes($loose))); Where = 'Data\Strings' }
        continue
    }
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($pl)
    foreach ($cand in @(($stem + '.bsa'), ($stem + ' - Interface.bsa'), 'Skyrim - Interface.bsa')) {
        $files = Get-BsaCached $cand
        if ($files -and $files.ContainsKey($want)) {
            $tables[$pl] = @{ Table = (Read-StringTable $files[$want]); Where = $cand }
            break
        }
    }
    if ($tables.ContainsKey($pl)) {
    } else {
        # a plugin flagged localised with no table can only fall back to editor
        # ids, and then an item in the table has an editor id where its name goes
        Bad ("{0}: localised and no $LANGUAGE string table found; its names fall back to editor ids" -f $pl)
    }
}
foreach ($pl in $order) {
    if ($tables.ContainsKey($pl)) {
        Ok ("{0}: {1} strings, from {2}" -f $pl, $tables[$pl].Table.Count, $tables[$pl].Where)
    }
}
Note ("{0} of {1} plugins are localised and needed a string table" -f $tables.Count, $order.Count)

# ------------------------------------------------------------ the records ---

Write-Host ''
Write-Host 'records' -ForegroundColor Cyan

# The record types a recipe can name as its output. ARMO, WEAP, ALCH, MISC,
# INGR and AMMO are the six this build actually uses, measured: 2332 ARMO,
# 1629 MISC, 966 WEAP, 143 ALCH, 29 AMMO, 6 INGR. The other five are read
# anyway so that a mod recipe outputting a book, a scroll, a soul gem, a torch
# or a key resolves to a real record and lands in unowned with a reason,
# instead of failing the build for a missing record.
$OUTPUT_TYPES = @('ARMO', 'WEAP', 'ALCH', 'MISC', 'INGR', 'AMMO', 'BOOK', 'SCRL', 'SLGM', 'LIGH', 'KEYM')
# KYWD is needed for the bench and for every keyword on an output record.
# The record types a CTDA on a recipe points its parameters at. PERK and SPEL
# are here so that a condition can be read out as the thing it asks for rather
# than as a number: HasPerk against MAG_FoodUpgradePerk03, HasSpell against
# Thunderbolt. GLOB is here because a CTDA can compare against a global instead
# of a number, which the flag bit 0x04 says. Everything else a condition can
# name, a book or an ingot or a piece of armour, is already in $OUTPUT_TYPES.
$CONDITION_TYPES = @('PERK', 'SPEL', 'GLOB')
# MGEF is read for one thing: the school and rank of the spell a staff binds
# (issue #1128, an Enchanter's staff spells unlock by rank). A SPEL record's
# SPIT names its half cost perk, whose editor id says both (DestructionAdept50),
# and failing that its effects say them: MGEF DATA int32 at offset 12 is the
# magic skill and uint32 at offset 40 the minimum level. The same reading the
# gamemode's spell tomes block does at runtime. Kept in $mgefs, not $items.
$SCAN_TYPES = @('KYWD', 'COBJ') + $OUTPUT_TYPES + $CONDITION_TYPES + @('MGEF')

# desc -> the record, last one in the load order wins, because that is the
# record the game is using
$items   = @{}
$kwName  = @{}
# MGEF desc -> { Skill, Level }, for the staff spells' school and rank (#1128).
$mgefs   = @{}
# item desc -> which class produces it, at the lowest rank any of them does.
# Filled under 'what an input costs a producer', below, out of the five
# producing tables and the server's own verbs. Declared here because InputsJson
# reads it.
$producer = @{}
# item desc -> every class that produces it and at what rank, the winner above
# among them. A separate map because $producer holds one answer per item by
# design and the cross-class report needs the ones it beat: the farmer's whole
# ladder lives in here and nowhere else, since every crop is also a plant a
# gatherer picks at the same rank or lower.
$producerAll = @{}
# desc -> the recipe, same rule. Ordered so the json and the block come out in
# load order, which makes a rebuild a small diff rather than a shuffle.
$recipes = New-Object System.Collections.Specialized.OrderedDictionary
$perPluginRecipes = @{}
# plugin -> the master list it declares, kept so that a form id can be written
# back into any plugin's own numbering afterwards. The search for what hands
# out an item needs that and it runs after the scan.
$pluginMasters = @{}
# For Get-RecipeLightPlugin (#1715): each plugin's lightness from its header,
# and the first plugin that holds each record.
$pluginIsLight = @{}
$recordFirstIn = @{}
$seenTwice = New-Object 'System.Collections.Generic.List[string]'

foreach ($pl in $order) {
    $path = Get-PluginPath $Data $pl
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $b = [System.IO.File]::ReadAllBytes($path)
    if ([System.Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'TES4') { Bad "not a plugin: $path"; continue }
    $headerSize = [int][BitConverter]::ToUInt32($b, 4)
    $localized  = [bool]([BitConverter]::ToUInt32($b, 8) -band 0x80)
    $pluginIsLight[$pl] = ($pl -match '\.esl$') -or (([BitConverter]::ToUInt32($b, 8) -band 0x200) -ne 0)
    $masters    = Get-PluginMasters $b $headerSize
    $pluginMasters[$pl] = $masters
    $strTable = $null
    if ($tables.ContainsKey($pl)) { $strTable = $tables[$pl].Table }

    $here = 0
    $i = 24 + $headerSize
    while ($i + 24 -le $b.Length) {
        if ([System.Text.Encoding]::ASCII.GetString($b, $i, 4) -ne 'GRUP') { break }
        $groupSize = [int][BitConverter]::ToUInt32($b, $i + 4)
        if ($groupSize -lt 24) { break }
        $label = [System.Text.Encoding]::ASCII.GetString($b, $i + 8, 4)
        if ($SCAN_TYPES -contains $label) {
            $j = $i + 24
            $groupEnd = $i + $groupSize
            while ($j + 24 -le $groupEnd) {
                $type     = [System.Text.Encoding]::ASCII.GetString($b, $j, 4)
                $dataSize = [int][BitConverter]::ToUInt32($b, $j + 4)
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
                    $k = 0
                    $over = 0
                    $edid = ''
                    $full = ''
                    $fullFrom = ''
                    $alchFlags = 0
                    $hasEnit = $false
                    $weapAnim = -1
                    $teaches = ''
                    # SPEL: the half cost perk (SPIT at 32) and the effects
                    # (EFID); MGEF: the skill and minimum level. #1128.
                    $spit = 0
                    $efids = New-Object 'System.Collections.Generic.List[uint32]'
                    $mgefSkill = -1; $mgefLevel = -1
                    $cnam = 0; $hasCnam = $false
                    $bnam = 0; $hasBnam = $false
                    $nam1 = 1
                    $inputs = 0
                    $coct = -1
                    $value = -1
                    $valueRule = $null
                    if ($VALUE_RULES.Contains($label)) { $valueRule = $VALUE_RULES[$label] }
                    $kwds = New-Object 'System.Collections.Generic.List[string]'
                    $conds = New-Object 'System.Collections.Generic.List[object]'
                    # The form ids inside the CNTO subrecords, which this
                    # script read and threw away until 21 September. They are
                    # what a recipe costs somebody, and the rank of a recipe is
                    # built out of them now rather than out of what its output
                    # sells for. See INPUT COST above.
                    $cnto = New-Object 'System.Collections.Generic.List[object]'
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
                            if ($localized -and $sz -eq 4) {
                                $sid = [BitConverter]::ToUInt32($rec, $k)
                                if ($strTable -and $strTable.ContainsKey($sid)) {
                                    $full = $strTable[$sid]
                                    $fullFrom = 'string table'
                                }
                            } elseif ($sz -gt 1) {
                                $full = [System.Text.Encoding]::GetEncoding(1252).GetString($rec, $k, $sz - 1)
                                $fullFrom = 'the record'
                            }
                        } elseif ($sub -eq 'KWDA' -and $label -ne 'COBJ') {
                            # KWDA is a straight array of form ids, four bytes
                            # each. KSIZ in front of it says how many, and it is
                            # not read here because the length of KWDA says the
                            # same thing and cannot disagree with itself.
                            for ($z = 0; $z + 4 -le $sz; $z += 4) {
                                $kwds.Add((DescOf ([BitConverter]::ToUInt32($rec, $k + $z)) $masters $pl))
                            }
                        } elseif ($sub -eq 'ENIT' -and $label -eq 'ALCH' -and $sz -ge 8) {
                            # ALCH ENIT: the value in gold, then the flag word.
                            # The flag word is the poison bit and the food bit.
                            $alchFlags = [BitConverter]::ToUInt32($rec, $k + 4)
                            $hasEnit = $true
                        } elseif ($sub -eq 'DNAM' -and $label -eq 'WEAP' -and $sz -ge 1) {
                            # the first byte of a WEAP DNAM is the animation
                            # type, which is what tells a bow from a sword
                            $weapAnim = [int]$rec[$k]
                        } elseif ($sub -eq 'DATA' -and $label -eq 'BOOK' -and $sz -ge 8) {
                            # BOOK DATA: the flag byte, then at offset 4 the
                            # spell a tome teaches when flag 0x04 (TeachesSpell
                            # in libespm's BOOK.h) is set. SpellTomeThunderbolt
                            # reads 4 and 0x10f7ee, which is Thunderbolt. Read
                            # for issue #967: an Enchanter learns a staff's
                            # spell from the tome that teaches it.
                            if (([int]$rec[$k] -band $BOOK_TEACHES_SPELL) -ne 0) {
                                $teaches = DescOf ([BitConverter]::ToUInt32($rec, $k + 4)) $masters $pl
                            }
                        } elseif ($label -eq 'SPEL' -and $sub -eq 'SPIT' -and $sz -ge 36) {
                            $spit = [BitConverter]::ToUInt32($rec, $k + 32)
                        } elseif ($label -eq 'SPEL' -and $sub -eq 'EFID' -and $sz -ge 4) {
                            $efids.Add([BitConverter]::ToUInt32($rec, $k))
                        } elseif ($label -eq 'MGEF' -and $sub -eq 'DATA' -and $sz -ge 44) {
                            $mgefSkill = [BitConverter]::ToInt32($rec, $k + 12)
                            $mgefLevel = [int64][BitConverter]::ToUInt32($rec, $k + 40)
                        } elseif ($label -eq 'COBJ') {
                            if ($sub -eq 'CNAM' -and $sz -eq 4) { $cnam = [BitConverter]::ToUInt32($rec, $k); $hasCnam = $true }
                            elseif ($sub -eq 'BNAM' -and $sz -eq 4) { $bnam = [BitConverter]::ToUInt32($rec, $k); $hasBnam = $true }
                            elseif ($sub -eq 'NAM1' -and $sz -eq 2) { $nam1 = [int][BitConverter]::ToUInt16($rec, $k) }
                            elseif ($sub -eq 'CNTO') {
                                $inputs++
                                # Eight bytes: the input item's form id, then
                                # how many of it the recipe wants. Proved in
                                # the header against RecipeLeatherFoxHide,
                                # which has COCT 1, one CNTO, and wants one fox
                                # pelt. The count was never in doubt; what was
                                # dropped was the id, and the id is the only
                                # thing that can say which class has to go and
                                # get it.
                                if ($sz -ge 8) {
                                    $cnto.Add([pscustomobject]@{
                                        Id    = [BitConverter]::ToUInt32($rec, $k)
                                        Count = [int][BitConverter]::ToUInt32($rec, $k + 4)
                                    })
                                }
                            }
                            elseif ($sub -eq 'COCT' -and $sz -eq 4) { $coct = [int][BitConverter]::ToUInt32($rec, $k) }
                            elseif ($sub -eq 'CTDA' -and $sz -ge 20) {
                                # The layout is in the header, out of
                                # libespm's CTDA.h. Only the first twenty
                                # bytes are read: the operator, what it
                                # compares against, which function it is, and
                                # the two parameters. What the condition runs
                                # on is always the person crafting here, and
                                # the fork's own EvaluateCraftRecipeConditions
                                # passes the same actor as both subject and
                                # target, so there is nothing in the rest of
                                # the subrecord this table can act on.
                                $opByte = [int]$rec[$k]
                                $conds.Add([pscustomobject]@{
                                    Operator = ($opByte -shr 5)
                                    UsesGlobal = (($opByte -band 0x04) -ne 0)
                                    Or = (($opByte -band 0x01) -ne 0)
                                    Value = [BitConverter]::ToSingle($rec, $k + 4)
                                    Func = [int][BitConverter]::ToUInt16($rec, $k + 8)
                                    Param1 = [BitConverter]::ToUInt32($rec, $k + 12)
                                    Param2 = [BitConverter]::ToUInt32($rec, $k + 16)
                                })
                            }
                        }
                        if ($valueRule -and $sub -eq $valueRule.Sub -and $sz -ge ($valueRule.At + 4)) {
                            # The gold value, which is what ranks the row. Where
                            # it sits in each kind of record is the VALUE_RULES
                            # knob, and every offset in it was measured.
                            $value = [int64][BitConverter]::ToUInt32($rec, $k + $valueRule.At)
                        }
                        $k += $sz
                    }

                    $desc = DescOf $formId $masters $pl
                    if (-not $recordFirstIn.ContainsKey($desc)) { $recordFirstIn[$desc] = $pl }

                    if ($label -eq 'COBJ') {
                        if ($recipes.Contains($desc)) {
                            # not a failure: a later plugin overriding a recipe
                            # is the normal way a mod changes one, and the last
                            # one in the load order is the one the game uses
                            $seenTwice.Add($desc)
                        }
                        $outDesc = ''
                        if ($hasCnam -and $cnam -ne 0) { $outDesc = DescOf ([uint32]$cnam) $masters $pl }
                        $benchDesc = ''
                        if ($hasBnam -and $bnam -ne 0) { $benchDesc = DescOf ([uint32]$bnam) $masters $pl }
                        # Thornswood-Last.esp's BNAM is a move this table made
                        # ($TRADE_BENCHES), so the bench stays the one the
                        # plugin before it named (#3120).
                        if ($pl -eq $LAST_PLUGIN -and $recipes.Contains($desc)) { $benchDesc = $recipes[$desc].BenchDesc }
                        # The inputs, as descs, resolved here where the master
                        # list of the plugin that carried the record is still
                        # in hand. The same two lines the output and the bench
                        # already had.
                        $inList = New-Object 'System.Collections.Generic.List[object]'
                        foreach ($c in $cnto) {
                            if ($c.Id -eq 0) { continue }
                            $inList.Add([pscustomobject]@{
                                Desc  = (DescOf ([uint32]$c.Id) $masters $pl)
                                Count = $c.Count
                            })
                        }
                        # Thornswood-Last.esp's copy has its perk tests
                        # taken out (#4826), so the conditions stay the ones
                        # the plugin before it carried, read with that
                        # plugin's masters.
                        $condList = $conds.ToArray(); $condMasters = $masters; $condIn = $pl
                        if ($pl -eq $LAST_PLUGIN -and $recipes.Contains($desc)) {
                            $condList = $recipes[$desc].Conditions
                            $condMasters = $recipes[$desc].CondMasters
                            $condIn = $recipes[$desc].CondIn
                        }
                        $recipes[$desc] = [pscustomobject]@{
                            Desc = $desc; Edid = $edid; SeenIn = $pl
                            Plugin = $desc.Split(':')[1]
                            Local = ($formId -band 0xFFFFFF)
                            OutDesc = $outDesc; BenchDesc = $benchDesc
                            Count = $nam1; Inputs = $inputs; Coct = $coct
                            InputList = $inList.ToArray()
                            Conditions = $condList; Masters = $masters
                            CondMasters = $condMasters; CondIn = $condIn
                        }
                        $here++
                        if (-not $perPluginRecipes.ContainsKey($pl)) { $perPluginRecipes[$pl] = 0 }
                        $perPluginRecipes[$pl] = $perPluginRecipes[$pl] + 1
                    } elseif ($label -eq 'MGEF') {
                        $mgefs[$desc] = [pscustomobject]@{ Skill = $mgefSkill; Level = $mgefLevel }
                    } else {
                        if (-not $full) { $full = $edid; $fullFrom = 'the editor id' }
                        $spitDesc = ''
                        if ($spit -ne 0) { $spitDesc = DescOf ([uint32]$spit) $masters $pl }
                        $efidDescs = @()
                        foreach ($e in $efids) { if ($e -ne 0) { $efidDescs += (DescOf ([uint32]$e) $masters $pl) } }
                        $items[$desc] = [pscustomobject]@{
                            Desc = $desc; Type = $label; Edid = $edid; Name = $full; NameFrom = $fullFrom
                            AlchFlags = $alchFlags; HasEnit = $hasEnit; WeapAnim = $weapAnim
                            Keywords = $kwds.ToArray(); SeenIn = $pl; Value = $value
                            Teaches = $teaches; Spit = $spitDesc; Efids = $efidDescs
                        }
                        if ($label -eq 'KYWD') { $kwName[$desc] = $edid }
                    }
                }
                $j += 24 + $dataSize
            }
        }
        $i += $groupSize
    }
    if ($here -gt 0) { Note ("{0}: {1} COBJ record(s)" -f $pl, $here) }
}

Ok ("{0} recipes after overrides, out of {1} COBJ records read" -f $recipes.Count, ($recipes.Count + $seenTwice.Count))
Ok ("{0} item and keyword records to resolve against, {1} of them keywords" -f $items.Count, $kwName.Count)
if ($recipes.Count -eq 0) { Bad 'no COBJ records found at all, which means the load order or the Data folder is not what this thinks it is' }

# Spell desc -> every spell tome that teaches it, sorted so two runs agree.
# Read out of the BOOK records the scan above kept, last one in the load order
# winning as everywhere else. TOMES_TEACH_STAFF_SPELLS says why (#967).
$tomesBySpell = @{}
foreach ($d in @($items.Keys | Sort-Object)) {
    $it = $items[$d]
    if ($it.Type -ne 'BOOK' -or -not $it.Teaches) { continue }
    if (-not $tomesBySpell.ContainsKey($it.Teaches)) { $tomesBySpell[$it.Teaches] = New-Object 'System.Collections.Generic.List[string]' }
    $tomesBySpell[$it.Teaches].Add($d)
}
$tomeCount = 0
foreach ($s in $tomesBySpell.Keys) { $tomeCount += $tomesBySpell[$s].Count }
Ok ("{0} spell tome(s) teaching {1} spell(s)" -f $tomeCount, $tomesBySpell.Count)

# --------------------------------------------------------------- the split --

Write-Host ''
Write-Host 'who owns what' -ForegroundColor Cyan

# The keyword editor ids on one record, resolved after the whole scan rather
# than during it. A plugin can carry a record that names a keyword the same
# plugin defines further down the file, and resolving as we went would miss it.
function KeywordNames($item) {
    $names = New-Object 'System.Collections.Generic.List[string]'
    foreach ($k in $item.Keywords) {
        if ($kwName.ContainsKey($k)) { $names.Add($kwName[$k]) }
    }
    return $names.ToArray()
}

function HasKeyword($names, $want) {
    foreach ($n in $names) { if ($n -eq $want) { return $true } }
    return $false
}

function HasAnyKeyword($names, $wants) {
    foreach ($n in $names) { foreach ($w in $wants) { if ($n -eq $w) { return $true } } }
    return $false
}

# Splits an editor id or an item's name into the words a person reads in it.
# ClothesRedguardBoots comes back as Clothes, Redguard, Boots, and
# "Ulfric's Armguards" comes back as Ulfric, s, Armguards. A new word starts
# where a capital follows a small letter, where a capital is followed by a
# small letter after other capitals, and where letters meet digits. Anything
# that is not a letter or a digit ends a word.
function WordsIn([string]$text) {
    $words = New-Object 'System.Collections.Generic.List[string]'
    if (-not $text) { return ,$words.ToArray() }
    $cur = ''
    for ($i = 0; $i -lt $text.Length; $i++) {
        $c = $text[$i]
        if (-not [char]::IsLetterOrDigit($c)) {
            if ($cur) { $words.Add($cur); $cur = '' }
            continue
        }
        if ($cur.Length -gt 0) {
            $prev = $cur[$cur.Length - 1]
            $starts = $false
            if ([char]::IsDigit($c) -ne [char]::IsDigit($prev)) {
                $starts = $true
            } elseif ([char]::IsUpper($c) -and -not [char]::IsUpper($prev)) {
                $starts = $true
            } elseif ([char]::IsUpper($c) -and [char]::IsUpper($prev) -and ($i + 1 -lt $text.Length) -and [char]::IsLower($text[$i + 1])) {
                $starts = $true
            }
            if ($starts) { $words.Add($cur); $cur = '' }
        }
        $cur += $c
    }
    if ($cur) { $words.Add($cur) }
    return ,$words.ToArray()
}

# One word against one word, plural included. Case is ignored, which is what
# -eq does with two strings in PowerShell.
#
# The plural is not a nicety. Measured on the first run of whole word matching:
# 'Robe' on its own caught nothing at all, because every robe in this build is
# a record called Robes, and the Tailor's Liverywright half fell from 107 rows
# to 69 in one go. So a word in a list matches that word, that word with an s,
# and that word with es on the end, and nothing else.
function SameWord([string]$have, [string]$want) {
    if ($have -eq $want) { return $true }
    if ($have -eq ($want + 's')) { return $true }
    if ($have -eq ($want + 'es')) { return $true }
    return $false
}

# True when one of $words appears in $text as a whole word, or as a run of
# whole words in order for an entry like MothPriest. Case is ignored.
#
# This was a plain substring test until 20 September. See the Liverywright knob
# for what that cost: 'Guard' inside Redguard and Armguards moved eleven rows
# of common clothing into the wrong half of the Tailor.
function MatchesWord([string]$text, $words) {
    if (-not $text) { return $false }
    $have = WordsIn $text
    if ($have.Count -eq 0) { return $false }
    foreach ($w in $words) {
        $want = WordsIn $w
        if ($want.Count -eq 0) { continue }
        for ($i = 0; $i + $want.Count -le $have.Count; $i++) {
            $all = $true
            for ($j = 0; $j -lt $want.Count; $j++) {
                if (-not (SameWord $have[$i + $j] $want[$j])) { $all = $false; break }
            }
            if ($all) { return $true }
        }
    }
    return $false
}

# Every keyword on one output that names a KIND of thing, with no duplicates.
# See the FAMILY knobs above for what counts as one and why. The armour slot
# keywords are a named set rather than a prefix because ArmorHeavy,
# ArmorLight, ArmorClothing, ArmorJewelry and the whole ArmorMaterial family
# all begin with the same four letters and none of them says what the thing is.
function KindKeywords($names) {
    $out = New-Object 'System.Collections.Generic.List[string]'
    foreach ($n in $names) {
        if ($out.Contains($n)) { continue }
        $is = $false
        foreach ($a in $FAMILY_ARMOR_SLOTS) { if ($n -eq $a) { $is = $true } }
        if (-not $is) {
            foreach ($p in $FAMILY_KEYWORD_PREFIXES) { if ($n.StartsWith($p)) { $is = $true } }
            foreach ($x in $FAMILY_KEYWORD_NOT) { if ($n -eq $x) { $is = $false } }
        }
        if ($is) { $out.Add($n) }
    }
    return ,$out.ToArray()
}

# The words a person reads for one kind keyword. The knob's word where there is
# one; otherwise the keyword's own words with the group word in front of them
# dropped, so a WeapTypeHalberd some mod adds tomorrow reads as Halberd and
# lands in the run's family list asking to be named properly.
$FAMILY_GROUP_WORDS = @('Weap', 'Type', 'MAG', 'Food', 'Armor', 'Clothing')
function FamilyNameOf([string]$kw) {
    if ($FAMILY_NAMES.Contains($kw)) { return $FAMILY_NAMES[$kw] }
    $words = WordsIn $kw
    $kept = New-Object 'System.Collections.Generic.List[string]'
    $stillLeading = $true
    foreach ($w in $words) {
        if ($stillLeading) {
            $isGroup = $false
            foreach ($g in $FAMILY_GROUP_WORDS) { if ($w -eq $g) { $isGroup = $true } }
            if ($isGroup) { continue }
            $stillLeading = $false
        }
        $kept.Add($w)
    }
    if ($kept.Count -eq 0) { return $kw }
    return ($kept -join ' ')
}

# The family for one output, and the sentence saying which of the three
# readings answered. Never a guess: where the record says nothing, or says two
# things, the record type answers and the row says so.
function FamilyOf($item, $names) {
    $kinds = KindKeywords $names
    if ($kinds.Count -eq 1) {
        return @((FamilyNameOf $kinds[0]), ('the output carries ' + $kinds[0]), 'keyword')
    }
    $byType = $FAMILY_OTHERWISE
    if ($FAMILY_BY_TYPE.Contains($item.Type)) { $byType = $FAMILY_BY_TYPE[$item.Type] }
    if ($kinds.Count -gt 1) {
        return @($byType, ('the output carries ' + ($kinds -join ' and ') +
                 ', which is two kinds and so is none of them, so its ' + $item.Type +
                 ' record type answered instead'), 'twoKinds')
    }
    return @($byType, ('the output carries no keyword naming a kind of thing, so its ' +
             $item.Type + ' record type answered'), 'type')
}

# The Tailor's half. The faction keywords first because they are read out of
# the record, then the word list, which is the judgement.
function TailorHalf($item, $names) {
    if (HasAnyKeyword $names $LIVERYWRIGHT_KEYWORDS) { return @('Liverywright', 'the output carries a faction dress keyword') }
    if (MatchesWord $item.Edid $LIVERYWRIGHT_WORDS)  { return @('Liverywright', 'the output''s editor id matches the robe and faction word list') }
    if (MatchesWord $item.Name $LIVERYWRIGHT_WORDS)  {
        # Reported by name every run. The editor id is the modder's own filing
        # and the name is what a person reads, and where the two disagree the
        # name is the weaker evidence, so every row that only the name won is
        # printed rather than buried in a count of 107.
        $script:tailorByName.Add(("{0} ({1}), named '{2}'" -f $item.Edid, $item.Desc, $item.Name))
        return @('Liverywright', 'the output''s name matches the robe and faction word list')
    }
    return @('Haberdasher', 'clothing that is neither a robe nor faction dress')
}

# One condition on one recipe, read out as the question it asks. A parameter is
# a form id for the functions that take one, numbered the way every other form
# id in a plugin is, so DescOf resolves it against the same master list; a
# parameter that is not a form id, an actor value index for instance, has
# nothing to resolve to and is left as the number it is.
#
# ServerSees is the whole point of this. It is true when the fork has a
# function for that index and will really evaluate the condition, and false
# when it does not, in which case ConditionsEvaluator logs the index and
# answers True. A false here does NOT mean the recipe is available: the
# crafting menu in front of the person evaluates the same condition and hides
# the recipe when it fails, so the server is never asked.
function ConditionRead($cond, $masters, [string]$plugin) {
    $idx = [int]$cond.Func
    $name = 'function ' + $idx
    $serverSees = $false
    if ($CONDITION_FUNCTIONS_THE_SERVER_HAS.ContainsKey($idx)) {
        $name = $CONDITION_FUNCTIONS_THE_SERVER_HAS[$idx]
        $serverSees = $true
    } elseif ($idx -eq $CONDITION_VANILLA_PERK) {
        $name = 'HasPerk'
    }
    $what = ''
    $whatType = ''
    $whatDesc = ''
    if ($cond.Param1 -ne 0 -and $cond.Param1 -ne 4294967295) {
        $d = DescOf ([uint32]$cond.Param1) $masters $plugin
        if ($items.ContainsKey($d)) {
            $what = $items[$d].Edid
            $whatType = $items[$d].Type
            $whatDesc = $d
        } else {
            $what = '0x{0:x8}' -f $cond.Param1
        }
    }
    $op = '?'
    if ($cond.Operator -ge 0 -and $cond.Operator -lt $CONDITION_OPERATORS.Count) {
        $op = $CONDITION_OPERATORS[$cond.Operator]
    }
    $val = '{0:0.###}' -f $cond.Value
    if ($cond.UsesGlobal) { $val = 'the global 0x{0:x8}' -f ([uint32][math]::Round($cond.Value)) }
    $text = $name
    if ($what) { $text += '(' + $what + ')' }
    $text += ' ' + $op + ' ' + $val
    # The tomes that teach the spell a HasSpell names, for TOMES_TEACH_STAFF_SPELLS.
    $tomes = @()
    if ($idx -eq $CONDITION_HAS_SPELL -and $whatDesc -and $tomesBySpell.ContainsKey($whatDesc)) {
        $tomes = $tomesBySpell[$whatDesc].ToArray()
    }
    return [pscustomobject]@{
        Func = $idx; Name = $name; Text = $text
        Param = $what; ParamType = $whatType; ParamDesc = $whatDesc
        ServerSees = $serverSees
        Tomes = $tomes
    }
}

# Whether Thornswood-Last.esp takes this recipe's perk tests out (#4826): yes,
# unless the record or the plugin that carries it below the last plugin is
# one the last plugin never copies from and does not copy the perk recipes of.
function PerksComeOff($r) {
    if (-not $PERKS_OFF_IN_LAST_PLUGIN) { return $false }
    if ($PERKS_KEPT_IN.ContainsKey(([string]$r.Plugin).ToLowerInvariant())) { return $false }
    if ($PERKS_KEPT_IN.ContainsKey(([string]$r.CondIn).ToLowerInvariant())) { return $false }
    return $true
}

# How many perk tests a recipe carries, and Joined when one is joined to
# another condition by OR (its own OR flag, or the one of the condition
# before it).
function PerkTestsOf($r) {
    $n = 0; $joined = $false; $prevOr = $false
    foreach ($c in $r.Conditions) {
        if ($c.Func -eq $CONDITION_VANILLA_PERK) {
            $n++
            if ($c.Or -or $prevOr) { $joined = $true }
        }
        $prevOr = [bool]$c.Or
    }
    return [pscustomobject]@{ Count = $n; Joined = $joined }
}

# The positions in a recipe's conditions that come off with its perks
# (#4826): every OR group holding a perk test, whole, as perk_drops in
# Build-LastPlugin.py takes them. A group is a run of conditions each joined
# to the next by OR, ended by one that is not; groups are joined by AND.
function PerkDropsOf($r) {
    $drop = @{}
    $group = New-Object 'System.Collections.Generic.List[int]'
    $hasPerk = $false
    $conds = @($r.Conditions)
    for ($i = 0; $i -lt $conds.Count; $i++) {
        $group.Add($i)
        if ($conds[$i].Func -eq $CONDITION_VANILLA_PERK) { $hasPerk = $true }
        if (-not $conds[$i].Or -or $i -eq $conds.Count - 1) {
            if ($hasPerk) { foreach ($j in $group) { $drop[$j] = $true } }
            $group.Clear(); $hasPerk = $false
        }
    }
    return $drop
}

# Can a new character get past every condition on a row. No condition at all
# is the plain yes. Under TOMES_TEACH_STAFF_SPELLS a HasSpell whose spell a
# tome teaches is also a yes, because the tome is how the spell is learned.
function NeedsAreReachable($needs) {
    foreach ($n in $needs) {
        if ($TOMES_TEACH_STAFF_SPELLS -and $n.Func -eq $CONDITION_HAS_SPELL -and @($n.Tomes).Count -gt 0) { continue }
        return $false
    }
    return $true
}

# The spell a row's HasSpell names, or '' when it has none.
function StaffSpellOf($row) {
    foreach ($n in $row.Needs) {
        if ($n.Func -eq $CONDITION_HAS_SPELL -and $n.ParamDesc) { return [string]$n.ParamDesc }
    }
    return ''
}

$owned    = New-Object System.Collections.Specialized.OrderedDictionary
$unowned  = New-Object System.Collections.Specialized.OrderedDictionary
# See $NOBODY_MAKES. Owned means one half makes it, unowned means anybody does,
# and refusedRows means nobody does. There was no third answer until 23 September.
#
# NOT $refused, WHICH IS TAKEN, 600 lines further down, by the map of bases a
# class is refused. This was called that for one run and the symptom is worth
# knowing: the rows went in correctly, counted 0, 1, 2, 3 as they arrived, and
# the collection read as empty everywhere it was used afterwards, because the
# other assignment had replaced the whole variable in between. Nothing errored.
$refusedRows = New-Object System.Collections.Specialized.OrderedDictionary
$instrumentRows = New-Object 'System.Collections.Generic.List[string]'
$tailorByName   = New-Object 'System.Collections.Generic.List[string]'
$noOutput = 0
$unresolvedOut = New-Object 'System.Collections.Generic.List[string]'
$namelessOut = @{}
$outTypeCount = @{}
$script:lightRows = 0

# The perks come off (#4826): the count of what comes off, and of the
# recipes whose perk test takes an OR group off with it.
$perkRows = 0; $perkConds = 0; $perkKeptRows = 0; $perkJoinedRows = 0; $perkGroupConds = 0
foreach ($desc in $recipes.Keys) {
    $r = $recipes[$desc]
    $pt = PerkTestsOf $r
    if ($pt.Count -eq 0) { continue }
    if (-not (PerksComeOff $r)) { $perkKeptRows++; continue }
    $perkRows++; $perkConds += $pt.Count
    if ($pt.Joined) { $perkJoinedRows++; $perkGroupConds += (PerkDropsOf $r).Count - $pt.Count }
}
if ($PERKS_OFF_IN_LAST_PLUGIN) {
    Ok ("{0} perk test(s) on {1} recipe(s) come off in Thornswood-Last.esp, {2} of them joined by OR, which take {3} other condition(s) of their OR groups off with them; {4} recipe(s) of a plugin it never copies from keep theirs" -f $perkConds, $perkRows, $perkJoinedRows, $perkGroupConds, $perkKeptRows)
}

foreach ($desc in $recipes.Keys) {
    $r = $recipes[$desc]

    $benchName = ''
    if ($r.BenchDesc -and $kwName.ContainsKey($r.BenchDesc)) { $benchName = $kwName[$r.BenchDesc] }

    # 1. A recipe with no CNAM names no output. There are eleven of them here
    #    and nine are armour table temper records. Nothing to gate.
    if (-not $r.OutDesc) {
        $noOutput++
        $unowned[$desc] = [pscustomobject]@{
            Edid = $r.Edid; OutDesc = ''; OutName = ''; OutType = ''; BenchDesc = $r.BenchDesc; BenchName = $benchName
            Why = 'the recipe carries no CNAM, so it names no output item'
        }
        continue
    }
    if (-not $items.ContainsKey($r.OutDesc)) {
        $unresolvedOut.Add(("{0} ({1}) outputs {2} and there is no such record in the load order" -f $r.Edid, $desc, $r.OutDesc))
        continue
    }
    $o = $items[$r.OutDesc]
    if ($o.NameFrom -eq 'the editor id') {
        if (-not $namelessOut.ContainsKey($o.Desc)) { $namelessOut[$o.Desc] = New-Object 'System.Collections.Generic.List[string]' }
        $namelessOut[$o.Desc].Add($r.Edid)
    }
    if (-not $outTypeCount.ContainsKey($o.Type)) { $outTypeCount[$o.Type] = 0 }
    $outTypeCount[$o.Type] = $outTypeCount[$o.Type] + 1
    $names = KeywordNames $o

    # 1a. A duplicate dwarven scrap smelt (#613). Thornswood-Content.esp takes
    #     the bench keyword off five of them so the smelter menu hides them,
    #     which put them on the bench NONE rule just below, unowned, before the
    #     refusal further down was ever reached. The build that #613 wrote this
    #     refusal for never ran against the plugins, and recipes.json was set by
    #     hand to what it should have said (issue #1622). So they are refused by
    #     their own editor id first, whatever bench the winning record names.
    if ($COLLAPSED_SMELT_EDITOR_IDS.Contains($r.Edid)) {
        $refusedRows[$desc] = [pscustomobject]@{
            Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = $r.BenchDesc; BenchName = $benchName
            Why = [string]$COLLAPSED_SMELT_EDITOR_IDS[$r.Edid]
        }
        continue
    }

    # 2. A recipe with no bench keyword. CraftService's own note says it: in the
    #    original game, setting the bench keyword to NONE removes the recipe
    #    from every crafting station. So nobody can reach it whatever this table
    #    says about it.
    if (-not $r.BenchDesc) {
        $unowned[$desc] = [pscustomobject]@{
            Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = ''; BenchName = ''
            Why = 'the recipe''s bench keyword is NONE, which takes it out of every crafting station in the game, so nobody can reach it'
        }
        continue
    }

    # 3. House building, and the one Bethesda test record.
    if ($benchName.StartsWith($BENCH_UNOWNED_PREFIX)) {
        $unowned[$desc] = [pscustomobject]@{
            Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = $r.BenchDesc; BenchName = $benchName
            Why = 'HearthFires house building, one keyword per piece of furniture. Not a trade in classes.md.'
        }
        continue
    }
    if ($BENCH_UNOWNED.Contains($benchName)) {
        $unowned[$desc] = [pscustomobject]@{
            Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = $r.BenchDesc; BenchName = $benchName
            Why = $BENCH_UNOWNED[$benchName]
        }
        continue
    }

    # 4. A bench that settles the profession on its own, and sometimes the half
    #    with it. The smelter is in this table with an empty owner, which is how
    #    a bench is declared open to everybody.
    #    A recipe named in RECIPE_OWNER is not open whatever its bench, which
    #    is how the one smelt row kept for each ingot is the smith's (#1400).
    $benchOwner = $null
    if ($BENCH_OWNER.Contains($benchName)) { $benchOwner = $BENCH_OWNER[$benchName] }
    if ($benchOwner -and -not $benchOwner.Owner -and -not $RECIPE_OWNER.Contains($r.Edid)) {
        $openWhy = $benchOwner.Why
        if ($OPEN_ROW_WHY.Contains($r.Edid)) { $openWhy = [string]$OPEN_ROW_WHY[$r.Edid] }
        $unowned[$desc] = [pscustomobject]@{
            Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = $r.BenchDesc; BenchName = $benchName
            Why = $openWhy
        }
        continue
    }

    $ownerName = ''
    $half = ''
    $reason = ''

    # 4a. A recipe named outright, because neither its bench nor its output can
    #     settle it. See $RECIPE_OWNER: today that is the shovel and nothing else.
    #     It comes before the bench and the output rules so that naming a recipe
    #     means what it says.
    if ($RECIPE_OWNER.Contains($r.Edid)) {
        $named = $RECIPE_OWNER[$r.Edid]
        $ownerName = $named.Owner
        $half = $named.Half
        $reason = $named.Why
    }
    elseif ($benchOwner -and $benchOwner.ContainsKey('Half')) {
        $ownerName = $benchOwner.Owner
        $half = $benchOwner.Half
        $reason = $benchOwner.Why
    }
    elseif ($o.Type -eq 'ALCH') {
        # The cooking benches fill water bottles and mix fishing paste, and
        # neither is cooking a dinner.
        if (MatchesWord $o.Edid $NOT_COOKING_WORDS) {
            $unowned[$desc] = [pscustomobject]@{
                Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = $r.BenchDesc; BenchName = $benchName
                Why = 'it happens at a cooking bench but it is not cooking: filling water is not a dinner and refusing it to everybody but a Hearthcook would leave the rest of the world thirsty'
            }
            continue
        }
        if ($o.AlchFlags -band $ALCH_FLAG_POISON) {
            $ownerName = 'Alchemist'; $half = 'Blightbrewer'
            $reason = 'the output is an ALCH with the poison bit set in its ENIT flags'
        } elseif ($o.AlchFlags -band $ALCH_FLAG_FOOD) {
            $ownerName = 'Cook'
            if (HasKeyword $names $DESSERT_KEYWORD) {
                $half = 'Confectioner'
                $reason = 'the output is food and carries ' + $DESSERT_KEYWORD
            } else {
                $half = 'Hearthcook'
                $reason = 'the output is food and does not carry ' + $DESSERT_KEYWORD
            }
        } else {
            $ownerName = 'Alchemist'; $half = 'Physicker'
            $reason = 'the output is an ALCH with neither the poison bit nor the food bit, so it is a potion'
        }
    }
    elseif ($o.Type -eq 'WEAP') {
        if ($WOODWRIGHT_TAKES_INSTRUMENTS -and ((MatchesWord $o.Edid $INSTRUMENT_WORDS) -or (MatchesWord $o.Name $INSTRUMENT_WORDS))) {
            # Before the animation rule on purpose. An instrument is a WEAP
            # record with the animation type of a fist and no keywords at all,
            # so nothing further down this chain can tell it from a sword.
            $ownerName = 'Woodworker'; $half = 'Woodwright'
            $reason = 'the output is an instrument, and classes.md gives the Woodwright bows, arrows and instruments in one sentence'
            $instrumentRows.Add(("{0} -> {1} ({2}), animation type {3}, {4} keyword(s)" -f $r.Edid, $o.Name, $o.Edid, $o.WeapAnim, $names.Count))
        } elseif ($WOODWRIGHT_TAKES_SPEARS -and ((MatchesWord $o.Edid $SPEAR_WORDS) -or (MatchesWord $o.Name $SPEAR_WORDS))) {
            # Before the animation rule, like the instruments above: a spear
            # carries a two handed animation and so does a greatsword, so the
            # record cannot tell them apart and the name has to.
            $ownerName = 'Woodworker'; $half = 'Woodwright'
            $reason = 'the output is a spear or a pole, which is a shaft of wood with a head on it'
        } elseif ($o.WeapAnim -eq $WEAP_ANIM_STAFF) {
            $ownerName = 'Enchanter'; $half = 'Bladebinder'
            $reason = 'the output is a WEAP whose animation type is a staff, and a staff is an enchantment on a stick'
        } elseif ($WOODWRIGHT_TAKES_BOWS_AND_ARROWS -and ($o.WeapAnim -eq $WEAP_ANIM_BOW -or $o.WeapAnim -eq $WEAP_ANIM_CROSSBOW)) {
            $ownerName = 'Woodworker'; $half = 'Woodwright'
            $reason = 'the output is a WEAP whose animation type is a bow or a crossbow, and classes.md gives the Woodwright bows'
        } else {
            $ownerName = 'Smith'; $half = 'Edgewright'
            $reason = 'the output is a WEAP that is not a bow and not a staff'
        }
    }
    elseif ($o.Type -eq 'AMMO') {
        if ($WOODWRIGHT_TAKES_BOWS_AND_ARROWS) {
            $ownerName = 'Woodworker'; $half = 'Woodwright'
            $reason = 'the output is AMMO, which is arrows and bolts, and classes.md gives the Woodwright arrows'
        } else {
            $unowned[$desc] = [pscustomobject]@{
                Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = $r.BenchDesc; BenchName = $benchName
                Why = 'arrows and bolts, and the knob that gives them to the Woodwright is switched off'
            }
            continue
        }
    }
    elseif ($o.Type -eq 'ARMO') {
        $isArmour = (HasKeyword $names $KW_HEAVY) -or (HasKeyword $names $KW_LIGHT) -or (HasKeyword $names $KW_SHIELD)
        if ((HasAnyKeyword $names $KW_JEWELRY) -and -not $isArmour) {
            $unowned[$desc] = [pscustomobject]@{
                Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = $r.BenchDesc; BenchName = $benchName
                Why = 'a ring or a necklace. classes.md has no jeweller, and the forge rule would otherwise hand every ring in Skyrim to the Platewright'
            }
            continue
        }
        if ($isArmour) {
            $ownerName = 'Smith'; $half = 'Platewright'
            if (HasKeyword $names $KW_SHIELD) {
                $reason = 'the output is an ARMO carrying ' + $KW_SHIELD + ', so it is a shield, and a shield is armour'
            } else {
                $reason = 'the output is an ARMO carrying ' + $KW_HEAVY + ' or ' + $KW_LIGHT
            }
        } elseif (HasAnyKeyword $names $KW_CLOTHING) {
            $ownerName = 'Tailor'
            $pick = TailorHalf $o $names
            $half = $pick[0]
            $reason = $pick[1]
        } else {
            $unowned[$desc] = [pscustomobject]@{
                Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = $r.BenchDesc; BenchName = $benchName
                Why = 'an ARMO that carries no armour keyword, no clothing keyword and no jewelry keyword, so nothing in the record says what it is'
            }
            continue
        }
    }
    elseif ($benchOwner) {
        # A bench that settles the profession but not the half, with an output
        # that does not settle it either. The loom is the case: its thread and
        # its children's clothes are MISC records rather than ARMO.
        $ownerName = $benchOwner.Owner
        if ($ownerName -eq 'Tailor') {
            $pick = TailorHalf $o $names
            $half = $pick[0]
            $reason = $benchOwner.Why + ', and ' + $pick[1]
        } elseif ($ownerName -eq 'Cook') {
            $half = 'Hearthcook'
            $reason = $benchOwner.Why + ', and the output carries no ' + $DESSERT_KEYWORD
        } else {
            $unowned[$desc] = [pscustomobject]@{
                Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = $r.BenchDesc; BenchName = $benchName
                Why = 'the bench says ' + $ownerName + ' but nothing in the output says which half, and a guess here would be a guess in the table'
            }
            continue
        }
    }
    else {
        # MISC and INGR off a bench nobody has claimed: ingots, leather, fur
        # plates. Stock and tools rather than a finished good of any half.
        #
        # THIS BUCKET WAS SORTING TWO OTHER THINGS INTO ITSELF, and its own
        # comment used to name them both as examples of stock: 'nails, fishing
        # poles'. On 23 September Patrick said what each should be and neither
        # is stock. Nine MISC rows come off the forge on this build and all nine
        # were open to everybody: four house parts, four fishing poles and a
        # Dwarven depth charge, which is the only one that belongs here.
        #
        # The house parts first. See $NOBODY_MAKES.
        $refusedWhy = ''
        foreach ($part in $NOBODY_MAKES.Keys) {
            if ((MatchesWord $o.Name @($part)) -or (MatchesWord $o.Edid @($part))) {
                $refusedWhy = [string]$NOBODY_MAKES[$part]
                break
            }
        }
        if ($refusedWhy) {
            $refusedRows[$desc] = [pscustomobject]@{
                Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = $r.BenchDesc; BenchName = $benchName
                Why = $refusedWhy
            }
            continue
        }

        #
        # Then the fishing poles, which are the Woodwright's by the same
        # sentence that gave him spears. Patrick, 23 September: 'Same with
        # fishing poles which should be woodworkers'. The rule that catches a
        # spear sits under WEAP and a fishing pole is a MISC record, so it has
        # never once been reached: that is why the poles sat here with the
        # ingots while the spears went where he asked.
        if ($WOODWRIGHT_TAKES_SPEARS -and ((MatchesWord $o.Edid $SPEAR_WORDS) -or (MatchesWord $o.Name $SPEAR_WORDS))) {
            $ownerName = 'Woodworker'; $half = 'Woodwright'
            $reason = 'the output is a fishing pole, a shaft of wood with a line on it, and a MISC record rather than a WEAP so the spear rule above never sees it'
        } else {
            $unowned[$desc] = [pscustomobject]@{
                Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type; BenchDesc = $r.BenchDesc; BenchName = $benchName
                Why = 'a ' + $o.Type + ' off ' + $benchName + '. It is stock or a tool rather than a finished good of any half, so nobody owns it and anybody may make it.'
            }
            continue
        }
    }

    $fires = $true
    foreach ($b in $BENCHES_THE_SERVER_NEVER_SEES) {
        if ($r.BenchDesc -eq $b) { $fires = $false }
    }
    # A row that needs a light plugin fires only on an engine that loads them.
    $lightNeeded = Get-RecipeLightPlugin $r $recordFirstIn $pluginIsLight
    if ($lightNeeded) {
        $script:lightRows++
        if (-not $ENGINE_LOADS_LIGHT) { $fires = $false }
    }

    # What the recipe asks of the person before the game will even list it.
    # A row with nothing here is one a character created this morning, carrying
    # nothing, can make the moment they reach the bench. Everything else needs
    # something first, and what that something is is written out rather than
    # counted, because "this half has 28 recipes" and "this half has 28
    # recipes nobody on this server can reach" printed the same number until
    # these were read.
    $needs = New-Object 'System.Collections.Generic.List[object]'
    $perksOff = PerksComeOff $r
    $perkDrops = if ($perksOff) { PerkDropsOf $r } else { @{} }
    $ci = 0
    foreach ($c in $r.Conditions) {
        $at = $ci; $ci++
        if ($perkDrops.ContainsKey($at)) { continue }
        $needs.Add((ConditionRead $c $r.CondMasters $r.CondIn))
    }
    $behindPerk = $false
    $serverChecks = 0
    foreach ($n in $needs) {
        if ($n.Func -eq $CONDITION_VANILLA_PERK) { $behindPerk = $true }
        if ($n.ServerSees) { $serverChecks++ }
    }

    # Which family the recipe book groups this row under. Read off the output
    # record, never off the half: two halves can make the same kind of thing
    # and a family is about what the thing is.
    $famRead = FamilyOf $o $names
    if ($RECIPE_OWNER.Contains($r.Edid) -and $RECIPE_OWNER[$r.Edid].ContainsKey('Family')) {
        $famRead = @([string]$RECIPE_OWNER[$r.Edid].Family, 'named in RECIPE_OWNER', 'named')
    }

    # Whose race made it. See $RACE_LOCK_WORDS: the word looked for is the one
    # the item is named with, Riekling or Bosmer, and the word recorded is the
    # one the RACE record uses, riekling or woodelf, because that is what the
    # gamemode has to compare the person against.
    $raceWord = ''
    if ($RACE_LOCKED) {
        foreach ($w in $RACE_LOCK_WORDS.Keys) {
            if ((MatchesWord $o.Edid @($w)) -or (MatchesWord $o.Name @($w))) {
                $raceWord = [string]$RACE_LOCK_WORDS[$w]
                break
            }
        }
    }

    $owned[$desc] = [pscustomobject]@{
        Edid = $r.Edid; OutDesc = $o.Desc; OutName = $o.Name; OutType = $o.Type
        BenchDesc = $r.BenchDesc; BenchName = $benchName
        Owner = $ownerName; Half = $half; Reason = $reason; Race = $raceWord
        Family = $famRead[0]; FamilyFrom = $famRead[1]; FamilyRead = $famRead[2]
        Count = $r.Count; Inputs = $r.Inputs; InputList = $r.InputList; Fires = $fires
        Plugin = $r.Plugin; SeenIn = $r.SeenIn; Local = $r.Local
        NameFrom = $o.NameFrom
        Value = $o.Value
        Needs = $needs.ToArray()
        DayOne = (NeedsAreReachable $needs)
        # No condition at all. NOVICE_MUST_BE_REACHABLE ranks by this rather than
        # by DayOne, so a staff opened by its tome (TOMES_TEACH_STAFF_SPELLS) does
        # not move the Bladebinder's ladder, which RECIPE_RANK sets (#1622).
        Bare = ($needs.Count -eq 0)
        BehindVanillaPerk = $behindPerk
        ServerChecks = $serverChecks
        Rank = ''
        RankWhy = ''
        RankByValue = ''
        RankFrom = ''
        InputRank = ''
        InputRankWho = ''
        # How many of this row's inputs no class in this world produces. The
        # UNPLACED_INPUT_RULE knob reads it, and it goes in the json, because
        # 'the dearest input is novice' means something different on a row where
        # that is the whole list and on a row with four unknowns beside it.
        InputsUnplaced = 0
        # True for a row whose rank a rule set on purpose (the novice row a new
        # character can reach, a rank named in RECIPE_RANK), which the one
        # rung hole fill must never move. See HOLE_FILL_MOVES_ONE_RUNG.
        Pinned = $false
    }
}

# ------------------------------------------------------- what the rules did -

if ($instrumentRows.Count -gt 0) {
    Note ("{0} recipe(s) went to the Woodwright as instruments:" -f $instrumentRows.Count)
    foreach ($i in $instrumentRows) { Note ("  " + $i) }
} elseif ($WOODWRIGHT_TAKES_INSTRUMENTS) {
    Note 'no recipe in this build outputs an instrument'
}
if ($tailorByName.Count -gt 0) {
    Note ("{0} Tailor row(s) went to the Liverywright on the output's name alone:" -f $tailorByName.Count)
    foreach ($t in $tailorByName) { Note ("  " + $t) }
}

# ---------------------------------------------------------- the families ---
#
# What the recipe book in the K panel groups by. Printed rather than asserted,
# because a family list is the one thing in this table a person reads directly
# and a rule that quietly stopped working would look like a book with one
# enormous family in it.
Write-Host ''
Write-Host 'families' -ForegroundColor Cyan
$famRows = @{}
$famPerHalf = @{}
$famPerHalfFiring = @{}
$famReadCount = @{ 'keyword' = 0; 'twoKinds' = 0; 'type' = 0; 'named' = 0 }
$famNameless = New-Object 'System.Collections.Generic.List[string]'
foreach ($desc in $owned.Keys) {
    $row = $owned[$desc]
    if (-not $row.Family) { $famNameless.Add($desc); continue }
    $famReadCount[$row.FamilyRead] = $famReadCount[$row.FamilyRead] + 1
    if (-not $famRows.ContainsKey($row.Family)) { $famRows[$row.Family] = 0 }
    $famRows[$row.Family] = $famRows[$row.Family] + 1
    $k = $row.Owner + '/' + $row.Half
    if (-not $famPerHalf.ContainsKey($k)) {
        $famPerHalf[$k] = New-Object System.Collections.Specialized.OrderedDictionary
        $famPerHalfFiring[$k] = New-Object System.Collections.Specialized.OrderedDictionary
    }
    if (-not $famPerHalf[$k].Contains($row.Family)) {
        $famPerHalf[$k][$row.Family] = 0
        $famPerHalfFiring[$k][$row.Family] = 0
    }
    $famPerHalf[$k][$row.Family] = $famPerHalf[$k][$row.Family] + 1
    if ($row.Fires) { $famPerHalfFiring[$k][$row.Family] = $famPerHalfFiring[$k][$row.Family] + 1 }
}
if ($famNameless.Count -gt 0) {
    Bad ("{0} owned row(s) came out with no family at all, which cannot happen while FamilyOf always answers" -f $famNameless.Count)
    foreach ($d in ($famNameless | Select-Object -First 5)) { Note ("  " + $d) }
} else {
    Ok ("every one of the {0} owned rows has a family, in {1} families across the table" -f $owned.Count, $famRows.Count)
}
Note ("{0} row(s) read their family off one kind keyword on the output, {1} off the record type because the output named two kinds and so named none, {2} off the record type because the output named no kind at all, {3} named in RECIPE_OWNER" -f `
      $famReadCount['keyword'], $famReadCount['twoKinds'], $famReadCount['type'], $famReadCount['named'])
foreach ($f in ($famRows.Keys | Sort-Object { -$famRows[$_] })) {
    Write-Host ("  {0,6}  {1}" -f $famRows[$f], $f)
}
# And the same list per half, which is the shape the book actually draws: one
# person opens it and sees their own half's families and nobody else's.
foreach ($k in ($famPerHalf.Keys | Sort-Object)) {
    $bits = @()
    foreach ($f in $famPerHalf[$k].Keys) { $bits += ("{0} {1}" -f $f, $famPerHalf[$k][$f]) }
    Note ("{0}: {1} families, {2}" -f $k, $famPerHalf[$k].Count, ($bits -join ', '))
}
# The check that says the rule is still doing its job. A family holding more
# than this share of one half's rows is the "very specific" complaint arriving
# from the other direction: one bucket with everything in it. classes.md sets
# no number here, so this is a knob, and it is loud rather than fatal because
# a half with two families in it can trip it while being perfectly right.
$FAMILY_SHARE_TO_WARN = 0.9
foreach ($k in $famPerHalf.Keys) {
    $total = 0
    foreach ($f in $famPerHalf[$k].Keys) { $total += $famPerHalf[$k][$f] }
    if ($total -lt 20) { continue }
    foreach ($f in $famPerHalf[$k].Keys) {
        if ($famPerHalf[$k][$f] -ge ($total * $FAMILY_SHARE_TO_WARN) -and $famPerHalf[$k].Count -gt 1) {
            Loud ("{0}: the family {1} holds {2} of its {3} rows, so the book will read as one bucket for that half" -f $k, $f, $famPerHalf[$k][$f], $total)
        }
    }
}

# ------------------------------------------------------------ the conditions

Write-Host ''
Write-Host 'conditions' -ForegroundColor Cyan

# What the recipes in this build ask for, counted by function. This is the
# table that says whether a half's rows are work or scenery.
$condFuncRows = @{}
$condPerkParamTypes = @{}
$rowsWithConditions = 0
foreach ($desc in $owned.Keys) {
    $row = $owned[$desc]
    if (-not $row.Fires) { continue }
    if ($row.Needs.Count -gt 0) { $rowsWithConditions++ }
    $seenHere = @{}
    foreach ($n in $row.Needs) {
        if (-not $seenHere.ContainsKey($n.Name)) {
            $seenHere[$n.Name] = $true
            if (-not $condFuncRows.ContainsKey($n.Name)) { $condFuncRows[$n.Name] = 0 }
            $condFuncRows[$n.Name] = $condFuncRows[$n.Name] + 1
        }
        if ($n.Func -eq $CONDITION_VANILLA_PERK) {
            $t = $n.ParamType
            if (-not $t) { $t = 'not a record in this load order' }
            if (-not $condPerkParamTypes.ContainsKey($t)) { $condPerkParamTypes[$t] = 0 }
            $condPerkParamTypes[$t] = $condPerkParamTypes[$t] + 1
        }
    }
}
$firingOwned = 0
foreach ($desc in $owned.Keys) { if ($owned[$desc].Fires) { $firingOwned++ } }
Note ("{0} owned row(s) need a light plugin; they {1} (lightPlugins in records\server-build.json, #1715)" -f $script:lightRows,
      $(if ($ENGINE_LOADS_LIGHT) { 'fire, because the engine this release records loads light plugins' } else { 'do not fire, because the engine this release records loads no light plugin' }))
Note ("{0} of the {1} owned rows the server is asked about carry at least one condition" -f $rowsWithConditions, $firingOwned)
foreach ($f in ($condFuncRows.Keys | Sort-Object { -$condFuncRows[$_] })) {
    $tail = 'the server evaluates this one itself'
    if ($f -eq 'HasPerk' -or $f.StartsWith('function ')) {
        $tail = 'the fork has no function for this index, so the server answers True and the crafting menu in front of the person is the only thing enforcing it'
    }
    Write-Host ("  {0,6}  {1,-28} {2}" -f $condFuncRows[$f], $f, $tail)
}
# The evidence for calling index 448 HasPerk, printed rather than asserted.
if ($condPerkParamTypes.Count -gt 0) {
    foreach ($t in ($condPerkParamTypes.Keys | Sort-Object)) {
        Note ("function {0} carries a first parameter that resolves to {1} on {2} condition(s)" -f $CONDITION_VANILLA_PERK, $t, $condPerkParamTypes[$t])
    }
}

# ------------------------------- what hands out the items a recipe asks for -
#
# A recipe gated on GetItemCount wants something in the pack before the game
# will list it. If nothing in the whole load order ever hands that something
# out, the recipe is not gated, it is dead, and the half that owns it is
# smaller than its count says. The Charburner is the case: three of its four
# recipes want a woodcutter's book.
#
# HOW THIS SEARCHES, AND WHAT IT CANNOT SEE. Every plugin is read again and
# searched for the three subrecords that put an item within reach of a person:
#   NAME of 4 bytes  a placed reference, which is an object standing in a cell
#   CNTO of 8 bytes  a line in a container's or a character's inventory
#   LVLO of 12 bytes a line in a levelled list
# The form id is written into each plugin's own numbering first, out of the
# master list that plugin declares, because the same record is a different
# number in every file that mentions it.
#
# It cannot see three things, and none of them is guessed at: a record stored
# compressed inside a plugin hides its subrecords from a byte search; a Papyrus
# script handing over an item is not in any of these subrecords, and this
# server does not run Papyrus anyway; and a mod that gives the item through the
# Creation Kit's quest aliases lands in none of the three either. So a hit here
# is proof the item is reachable, and no hit is a reason to go and look rather
# than a proof of nothing.
#
# It is loud rather than fatal. The recipe belongs to whoever's plugin ships it
# and the fix is in that plugin, not in this table, and refusing to write 5116
# rows over a mod's dead recipe would leave the server with no table at all.

Write-Host ''
Write-Host 'what hands out the items these recipes ask for' -ForegroundColor Cyan

$wantedItems = New-Object System.Collections.Specialized.OrderedDictionary
foreach ($desc in $owned.Keys) {
    $row = $owned[$desc]
    if (-not $row.Fires) { continue }
    foreach ($nd in $row.Needs) {
        if ($nd.Name -ne 'GetItemCount') { continue }
        $d = $nd.ParamDesc
        if (-not $d) { continue }
        if (-not $wantedItems.Contains($d)) {
            $wantedItems[$d] = [pscustomobject]@{
                Edid = $nd.Param; Type = $nd.ParamType
                Wanters = New-Object 'System.Collections.Generic.List[string]'
                Found = ''
            }
        }
        $wantedItems[$d].Wanters.Add($row.Edid)
    }
}

if ($wantedItems.Count -eq 0) {
    Ok 'no recipe in this table asks for an item first'
} else {
    $latin1 = [System.Text.Encoding]::GetEncoding(28591)
    foreach ($pl in $order) {
        $left = 0
        foreach ($d in $wantedItems.Keys) { if (-not $wantedItems[$d].Found) { $left++ } }
        if ($left -eq 0) { break }
        $path = Get-PluginPath $Data $pl
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $masters = $pluginMasters[$pl]
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $text = $latin1.GetString($bytes)
        foreach ($d in $wantedItems.Keys) {
            if ($wantedItems[$d].Found) { continue }
            $bits = $d.Split(':')
            $localId = [uint32]('0x' + $bits[0])
            $owner = $bits[1]
            $index = -1
            if ($owner -eq $pl) {
                $index = $masters.Count
            } else {
                for ($m = 0; $m -lt $masters.Count; $m++) { if ($masters[$m] -eq $owner) { $index = $m; break } }
            }
            if ($index -lt 0) { continue }
            $full = ([uint32]$index -shl 24) -bor ($localId -band 0xFFFFFF)
            $idText = [string]([char]($full -band 0xFF)) + [char](($full -shr 8) -band 0xFF) +
                      [char](($full -shr 16) -band 0xFF) + [char](($full -shr 24) -band 0xFF)
            if ($text.IndexOf('NAME' + [char]4 + [char]0 + $idText, [StringComparison]::Ordinal) -ge 0) {
                $wantedItems[$d].Found = 'placed in the world by ' + $pl
                continue
            }
            if ($text.IndexOf('CNTO' + [char]8 + [char]0 + $idText, [StringComparison]::Ordinal) -ge 0) {
                $wantedItems[$d].Found = 'in a container or a character''s inventory in ' + $pl
                continue
            }
            $p = 0
            while (($p = $text.IndexOf('LVLO' + [char]12 + [char]0, $p, [StringComparison]::Ordinal)) -ge 0) {
                if ($p + 14 -le $text.Length -and $text.Substring($p + 10, 4) -ceq $idText) {
                    $wantedItems[$d].Found = 'on a levelled list in ' + $pl
                    break
                }
                $p += 6
            }
        }
        $text = $null
        $bytes = $null
    }

    $orphans = 0
    foreach ($d in $wantedItems.Keys) {
        $w = $wantedItems[$d]
        if ($w.Found) { continue }
        $orphans++
        Loud ("nothing in the load order hands out {0} {1} ({2}), and {3} recipe(s) will not appear without it: {4}" -f `
              $w.Type, $w.Edid, $d, $w.Wanters.Count, (($w.Wanters | Select-Object -First 4) -join ', '))
    }
    if ($orphans -eq 0) {
        Ok ("all {0} item(s) these recipes ask for are handed out somewhere in the load order" -f $wantedItems.Count)
    } else {
        Note ("{0} of {1} wanted item(s) were found, {2} were not" -f ($wantedItems.Count - $orphans), $wantedItems.Count, $orphans)
    }
}

# -------------------------------------------------- what an input costs ----
#
# The reverse index: item -> the rank somebody has to hold before any class in
# this world can hand that item over, and which class that is. Built out of the
# five producing tables named in PRODUCER_TABLES, every one of which is in this
# folder and was built from the game's own records by its own script, and out
# of SERVER_PRODUCERS, which is the salt quarry this repository's own plugin
# and gamemode.js put in the world and no table is written for.
#
# This is the only place the two halves of the economy meet. Until it existed,
# the producing ladders and the crafting ladder were built by different scripts
# from different records with different rules and nothing compared them, so a
# novice Hearthcook could be handed a first recipe wanting a crop only an
# expert Farmer may grow and neither table could see it.
#
# EVERY PRODUCER OF AN ITEM IS KEPT AND NOT JUST THE WINNER. The index answers
# with the lowest, which is what a recipe costs, but a table that placed
# nothing used to be indistinguishable in the output from a table that was not
# read at all: the crops map contributed 0 of 137 entries for a year of builds
# and the run said '0 item(s) it is the first to name' and nothing else. The
# full list is what the cross-class report below reads to say that a Cook is
# novice on an apple a farmer has to be expert to grow.

Write-Host ''
Write-Host 'what an input costs a producer' -ForegroundColor Cyan

$producerSources = @{}
foreach ($t in $PRODUCER_TABLES) {
    # The tables are in game\data since phase 6 of issue #440.
    $path = Join-Path $PSScriptRoot ('..\..\game\data\' + $t.File)
    if (-not (Test-Path -LiteralPath $path)) {
        Bad ("{0} is not in this folder, so nothing can say what a {1} produces or at what rank. Build it and run this again." -f $t.File, $t.Who)
        continue
    }
    if (-not $producerSources.ContainsKey($t.File)) {
        $producerSources[$t.File] = (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
    }
    $tab = $producerSources[$t.File]
    if (-not ($tab.PSObject.Properties.Name -contains $t.Map)) {
        Bad ("{0} has no '{1}' map in it, so the {2}'s ladder cannot be read" -f $t.File, $t.Map, $t.Who)
        continue
    }
    $map = $tab.($t.Map)
    # THE BASES THIS CLASS IS REFUSED, read off another map of the same file.
    # Argued for at PRODUCER_TABLES under NotAlsoIn: a base the server hands to
    # a different verb is not this class's work at whatever rank this map puts
    # on it, and crediting it here is what put 226 Cook and Tailor input entries
    # on a gatherer who cannot pick either plant.
    $refused = @{}
    if ($t.ContainsKey('NotAlsoIn') -and $t.NotAlsoIn) {
        if (-not ($tab.PSObject.Properties.Name -contains $t.NotAlsoIn)) {
            Bad ("{0} has no '{1}' map in it, and the {2}'s ladder is read as everything in '{3}' that is NOT in it. Without that map every base in '{3}' would be credited to the {2}, so nothing was read off it." -f `
                 $t.File, $t.NotAlsoIn, $t.Who, $t.Map)
            continue
        }
        foreach ($rk in $tab.($t.NotAlsoIn).PSObject.Properties.Name) { $refused[$rk] = $true }
    }
    $rows = 0
    $addedHere = 0
    $lostHere = 0
    $skippedHere = New-Object 'System.Collections.Generic.List[string]'
    # THE ORDER OF PRODUCER_TABLES IS THE TIE BREAK, and it decides real
    # attributions rather than nothing. Where two classes get the same item at
    # the same rank, lowest wins cannot separate them and the table read first
    # takes it. Counted and named here instead of being left to whoever reads
    # the order of a list.
    $tiedHere = New-Object 'System.Collections.Generic.List[string]'
    # AND WHERE THIS TABLE'S CLASS LOSES ON RANK RATHER THAN ON ORDER, which is
    # the other way an item ends up attributed to somebody, and it went unprinted
    # until 21 September while the comment above claimed every one was named.
    # Measured that day: Tundra Cotton was novice in the harvests map and advanced
    # in the crops map, so it was never a tie, the equal-rank test never matched,
    # and the run said nothing at all about 189 input entries of Thread and raw
    # cotton hanging off it. That is five times the 37 wheat entries the tie test
    # did catch, so the case the old comment called the one that matters was the
    # smaller of the two. Both are printed now.
    $dearerHere = New-Object 'System.Collections.Generic.List[string]'
    foreach ($k in $map.PSObject.Properties.Name) {
        $row = $map.$k
        $rank = [string]$row.rank
        $at = RankAt $rank
        if ($at -lt 0) { continue }
        if ($refused.ContainsKey($k)) {
            $skippedHere.Add([string]$row.name)
            continue
        }
        $rows++
        # An ore vein or a plant hands over one item and names it in a field of
        # its own. An animal hands over a list, because a mudcrab gives legs
        # and chitin off the same carcass, so both shapes are read.
        $gives = @()
        if ($t.List) {
            if ($row.PSObject.Properties.Name -contains $t.List) {
                foreach ($g in $row.($t.List)) {
                    $d = [string]$g.($t.Item)
                    if ($d) { $gives += @{ Desc = $d; Name = [string]$g.name } }
                }
            }
        } else {
            $d = [string]$row.($t.Item)
            if ($d) { $gives += @{ Desc = $d; Name = [string]$row.name } }
        }
        foreach ($g in $gives) {
            if ($producer.ContainsKey($g.Desc) -and $producer[$g.Desc].Who -ne $t.Who) {
                if ($producer[$g.Desc].At -eq $at) {
                    $tiedHere.Add(('{0} with the {1}' -f $g.Name, $producer[$g.Desc].Who))
                } elseif ($producer[$g.Desc].At -lt $at) {
                    $dearerHere.Add(('{0}, which a {1} has at {2} and this table puts at {3}' -f `
                                     $g.Name, $producer[$g.Desc].Who, $producer[$g.Desc].Rank, $rank))
                }
            }
            if (RememberProducer $g.Desc $rank $at $t.Who $g.Name ($t.File + ' ' + $t.Map)) {
                $addedHere++
            } else {
                $lostHere++
            }
        }
    }
    if ($addedHere -eq 0 -and $rows -gt 0) {
        # A whole ladder that places nothing is the failure that hid for as long
        # as this only printed what a table won. Named out loud, with the reason
        # it lost, because a silent zero here is a class whose ranks decide
        # nothing about any recipe in the table.
        Loud ("{0} {1}: {2} ranked row(s) read and NOT ONE item entered the index. Every item it hands over is already in there off an earlier table at the same rank or lower, so the {3}'s ranks set nothing in this table." -f `
              $t.File, $t.Map, $rows, $t.Who)
    } else {
        Note ("{0} {1}: {2} ranked row(s) read, {3} item(s) it is the first to name, {4} an earlier table already had at the same rank or lower" -f `
              $t.File, $t.Map, $rows, $addedHere, $lostHere)
    }
    if ($skippedHere.Count -gt 0) {
        $skipNames = @{}
        foreach ($sn in $skippedHere) { $skipNames[$sn] = $true }
        Note ("  {0} row(s) of it were left out because they are also in the '{1}' map: {2}. {3}" -f `
              $skipNames.Count, $t.NotAlsoIn, (($skipNames.Keys | Sort-Object) -join ', '), $t.NotAlsoWhy)
    }
    if ($tiedHere.Count -gt 0) {
        $tieNames = @{}
        foreach ($tn in $tiedHere) { $tieNames[$tn] = $true }
        Note ("  {0} of them tie at exactly the same rank and the {1} lost the tie only because its table is read later in PRODUCER_TABLES: {2}" -f `
              $tieNames.Count, $t.Who, (($tieNames.Keys | Sort-Object) -join ', '))
    }
    if ($dearerHere.Count -gt 0) {
        $dearNames = @{}
        foreach ($dn in $dearerHere) { $dearNames[$dn] = $true }
        $dearList = @($dearNames.Keys | Sort-Object)
        Note ("  {0} of them the {1} has to climb higher for than the class already holding them, so the {1} sets no rank on them and the order of PRODUCER_TABLES had nothing to do with it:" -f `
              $dearList.Count, $t.Who)
        foreach ($dn in ($dearList | Select-Object -First 8)) { Note ('    ' + $dn) }
        if ($dearList.Count -gt 8) { Note ("    ... and {0} more" -f ($dearList.Count - 8)) }
    }
}

# The stations this repository put in the world, which are in no json table at
# all. Read out of game\gamemode.js by ReadStationVerbs above rather than
# copied into a list here, argued for at STATION_VERBS.
$stationRead = ReadStationVerbs $GAMEMODE_JS
foreach ($b in $stationRead.Bad) { Bad $b }

# The two ladders have to be the same ladder or every rankStep index read above
# means something else here. Cheap to check and it would be silent otherwise.
if ($stationRead.Ladder.Count -gt 0) {
    $sameLadder = ($stationRead.Ladder.Count -eq $RANKS.Count)
    if ($sameLadder) {
        for ($li = 0; $li -lt $RANKS.Count; $li++) {
            if ($stationRead.Ladder[$li] -ne $RANKS[$li]) { $sameLadder = $false }
        }
    }
    if (-not $sameLadder) {
        Bad ("game\gamemode.js RANK_LADDER is {0} and this script's RANKS is {1}. A rankStep index cannot be turned into a rank while those disagree, so nothing was read off the stations." -f `
             ($stationRead.Ladder -join ', '), ($RANKS -join ', '))
        $stationRead.Rows.Clear()
    }
}

$stationAdded = 0
foreach ($s in $stationRead.Rows) {
    if (-not $items.ContainsKey($s.Desc)) {
        Bad ("{0}() hands over ITEMS.{1} ({2}) and there is no such record in the load order, so nobody could receive it" -f `
             $s.Fn, $s.Key, $s.Desc)
        continue
    }
    $nm = $items[$s.Desc].Name
    if (RememberProducer $s.Desc $s.Rank $s.At $s.Who $nm $s.Where) { $stationAdded++ }
    Note ("  {0}() gives {1} ({2}) to a {3} at {4}" -f $s.Fn, $nm, $s.Desc, $s.Who, $s.Rank)
}
if ($stationRead.Rows.Count -gt 0) {
    Note ("the server's own stations: {0} item(s) read out of game\gamemode.js, {1} of them the first to name the item" -f `
          $stationRead.Rows.Count, $stationAdded)
} else {
    Loud 'nothing was read off the server''s own stations, so the salt quarry, the chopping blocks and the farmyard hand out items this table believes nobody produces'
}

$byWho = @{}
foreach ($d in $producer.Keys) {
    $w = $producer[$d].Who
    if (-not $byWho.ContainsKey($w)) { $byWho[$w] = 0 }
    $byWho[$w] = $byWho[$w] + 1
}
$whoLine = @()
foreach ($w in ($byWho.Keys | Sort-Object)) { $whoLine += ('{0} {1}' -f $w, $byWho[$w]) }
Ok ("the reverse index holds {0} distinct item(s): {1}" -f $producer.Count, ($whoLine -join ', '))

# How many of the recipes' inputs this index can place, counted two ways,
# because the two numbers answer different questions. Distinct items says how
# much of the world's stock has a producer behind it. Rows says how many
# recipes can be ranked by the new rule at all.
$inputItemsSeen = @{}
$rowsWithInputs = 0
$rowsPlaced = 0
foreach ($desc in $owned.Keys) {
    $r = $owned[$desc]
    $list = @($r.InputList)
    if ($list.Count -eq 0) { continue }
    $rowsWithInputs++
    $anyPlaced = $false
    foreach ($i in $list) {
        if (-not $inputItemsSeen.ContainsKey($i.Desc)) { $inputItemsSeen[$i.Desc] = 0 }
        $inputItemsSeen[$i.Desc] = $inputItemsSeen[$i.Desc] + 1
        if ($producer.ContainsKey($i.Desc)) { $anyPlaced = $true }
    }
    if ($anyPlaced) { $rowsPlaced++ }
}
$placedItems = 0
foreach ($d in $inputItemsSeen.Keys) { if ($producer.ContainsKey($d)) { $placedItems++ } }
Ok ("the owned recipes ask for {0} distinct input item(s); {1} of them have a producer and {2} do not" -f `
    $inputItemsSeen.Count, $placedItems, ($inputItemsSeen.Count - $placedItems))
Ok ("{0} of the {1} owned rows that list any input have at least one input with a producer behind it; {2} have none and fall back to what the output sells for" -f `
    $rowsPlaced, $rowsWithInputs, ($rowsWithInputs - $rowsPlaced))
$noInputRows = $owned.Count - $rowsWithInputs
if ($noInputRows -gt 0) {
    Note ("{0} owned row(s) carry no CNTO at all, so they list no inputs and there is nothing to read a cost off" -f $noInputRows)
}

# The commonest inputs nothing produces, because that list is the shopping list
# for whoever wants more halves ranked by cost rather than by price.
$unplaced = @()
foreach ($d in $inputItemsSeen.Keys) { if (-not $producer.ContainsKey($d)) { $unplaced += $d } }
if ($unplaced.Count -gt 0) {
    $unplaced = @($unplaced | Sort-Object { -$inputItemsSeen[$_] })
    Note 'the inputs no producing table hands out, commonest first:'
    foreach ($d in ($unplaced | Select-Object -First 12)) {
        $nm = $d
        if ($items.ContainsKey($d)) { $nm = $items[$d].Name + ' (' + $items[$d].Type + ')' }
        Note ("  {0,5} recipe(s) want {1} [{2}]" -f $inputItemsSeen[$d], $nm, $d)
    }
    if ($unplaced.Count -gt 12) { Note ("  ... and {0} more" -f ($unplaced.Count - 12)) }
}


# ------------------------------------------------------------- the hop ------
#
# An input that is itself the output of a recipe costs what that recipe's
# dearest input costs. Argued for at FOLLOW_THE_HOP, HOP_ROUND_LIMIT,
# MADE_COST_NEEDS_EVERY_INPUT, HOP_MAY_UNDERCUT_A_CLASS and
# HOP_THROUGH_A_FINISHED_GOOD, each with the measurement that set it.
#
# This is where miner-to-smith and hunter-to-tailor become visible at all. An
# ingot is not in the ground and neither is a leather strip; both are one recipe
# back from something that is.

Write-Host ''
Write-Host 'the hop: an input that is itself made by a recipe' -ForegroundColor Cyan

# What one recipe says its output costs, given what is known so far. -1 is
# unknown, and unknown is not free: see MADE_COST_NEEDS_EVERY_INPUT.
function HopCost($costs, $r, [bool]$needAll) {
    $list = @($r.InputList)
    if ($list.Count -eq 0) { return -1 }
    $best = -1
    $unknown = 0
    foreach ($i in $list) {
        if ($costs.ContainsKey($i.Desc)) {
            if ($costs[$i.Desc] -gt $best) { $best = $costs[$i.Desc] }
        } else {
            $unknown++
        }
    }
    if ($unknown -gt 0 -and $needAll) { return -1 }
    return $best
}

# The fixpoint itself. Seeded with what a class hands over, then every recipe in
# the load order is asked what its output costs, round after round, until a round
# changes nothing. Returns the settled map and how many rounds it took.
function HopFixpoint($seed, $allRecipes, $skip, [bool]$needAll, [int]$limit, [bool]$mayUndercut) {
    $costs = @{}
    foreach ($d in $seed.Keys) { $costs[$d] = $seed[$d].At }
    $rounds = 0
    $changed = 1
    while ($changed -gt 0 -and $rounds -lt $limit) {
        $changed = 0
        $rounds++
        foreach ($rd in $allRecipes.Keys) {
            if ($skip.ContainsKey($rd)) { continue }
            $r = $allRecipes[$rd]
            if (-not $r.OutDesc) { continue }
            # A class already hands this over and the bench is not allowed to
            # beat it. Argued for at HOP_MAY_UNDERCUT_A_CLASS.
            if ($seed.ContainsKey($r.OutDesc) -and -not $mayUndercut) { continue }
            $c = HopCost $costs $r $needAll
            if ($c -lt 0) { continue }
            if ((-not $costs.ContainsKey($r.OutDesc)) -or $c -lt $costs[$r.OutDesc]) {
                $costs[$r.OutDesc] = $c
                $changed++
            }
        }
    }
    return [pscustomobject]@{ Costs = $costs; Rounds = $rounds; Settled = ($changed -eq 0) }
}

# THE BREAKDOWN ROWS, FOUND BY THEIR SHAPE AND NOT BY THEIR NAME. Argued for at
# HOP_THROUGH_A_FINISHED_GOOD. A row that turns a finished good back into stock
# is a refund and not a source, and it is recognised here by what the records
# say the two ends are: the output is a MISC and one of the inputs is an ARMO, a
# WEAP or an AMMO. No editor id is matched, because a name list would only find
# the mod it was written against.
$breakdownRows = @{}
foreach ($rd in $recipes.Keys) {
    $r = $recipes[$rd]
    if (-not $r.OutDesc) { continue }
    if (-not $items.ContainsKey($r.OutDesc)) { continue }
    if ($items[$r.OutDesc].Type -ne $STOCK_TYPE) { continue }
    foreach ($i in @($r.InputList)) {
        if (-not $items.ContainsKey($i.Desc)) { continue }
        if ($FINISHED_GOOD_TYPES -contains $items[$i.Desc].Type) { $breakdownRows[$rd] = $true; break }
    }
}
# THE TEMPERING ROWS, FOUND BY THEIR BENCH AND NOT BY THEIR NAME. Argued for at
# HOP_THROUGH_A_TEMPER. A row on the armour table or the sharpening wheel
# improves something already in the pack and creates nothing, so it is not a
# source of the thing it names as its output. The two benches come from the
# fork, out of CraftService, and are the same two the owned rows already read to
# set fires = false.
$temperRows = @{}
foreach ($rd in $recipes.Keys) {
    foreach ($b in $BENCHES_THE_SERVER_NEVER_SEES) {
        if ($recipes[$rd].BenchDesc -eq $b) { $temperRows[$rd] = $true; break }
    }
}

$hopSkip = @{}
if (-not $HOP_THROUGH_A_FINISHED_GOOD) { foreach ($rd in $breakdownRows.Keys) { $hopSkip[$rd] = $true } }
if (-not $HOP_THROUGH_A_TEMPER) { foreach ($rd in $temperRows.Keys) { $hopSkip[$rd] = $true } }
Note ("{0} of the {1} recipe(s) in the load order turn a finished good back into stock. HOP_THROUGH_A_FINISHED_GOOD is {2}, so the hop {3}." -f `
      $breakdownRows.Count, $recipes.Count, $HOP_THROUGH_A_FINISHED_GOOD, `
      $(if ($HOP_THROUGH_A_FINISHED_GOOD) { 'reads them like any other recipe' } else { 'does not let one of them set what anything costs' }))
Note ("{0} of them are tempering, on the armour table or the sharpening wheel. HOP_THROUGH_A_TEMPER is {1}, so the hop {2}." -f `
      $temperRows.Count, $HOP_THROUGH_A_TEMPER, `
      $(if ($HOP_THROUGH_A_TEMPER) { 'reads them like any other recipe' } else { 'does not let one of them say it is where an item comes from' }))

$made = @{}
$supply = @{}
$hopCheaper = New-Object 'System.Collections.Generic.List[string]'

if (-not $FOLLOW_THE_HOP) {
    Loud 'FOLLOW_THE_HOP is off, so an input made by a recipe stays unknown and the Smith is ranked by what he sells'
    foreach ($d in $producer.Keys) { $supply[$d] = $producer[$d] }
} else {
    $fx = HopFixpoint $producer $recipes $hopSkip $MADE_COST_NEEDS_EVERY_INPUT $HOP_ROUND_LIMIT $HOP_MAY_UNDERCUT_A_CLASS
    if (-not $fx.Settled) {
        Bad ("the hop did not settle in {0} rounds, which is HOP_ROUND_LIMIT. It is a fixpoint over four ranks and it cannot honestly need that many, so something in the rule changed and the table was not written." -f $HOP_ROUND_LIMIT)
    } else {
        Ok ("the hop settled after {0} round(s), the last of which changed nothing. Four ranks and {1} recipe(s): an item's cost only ever moves from unknown to a rank or from a rank to a cheaper one, so it cannot go round for ever, and this is the run saying it did not." -f `
            $fx.Rounds, $recipes.Count)
    }
    $costs = $fx.Costs

    # WHICH recipes give each made item its cost. Every one of them and not the
    # first, which was a defect for as long as it was the first: the walk back to
    # a class below can come up empty on a route that goes round in a circle, and
    # when only one route was kept the item was then dropped from the index
    # entirely. Corundum Ingot, wanted by 402 recipes, was lost exactly that way
    # on 21 September while its own smelter row sat in the table saying corundum
    # ore, advanced, miner.
    #
    # Taken after the costs have settled and not while they were moving: the
    # cheapest route is a fact about the settled map, and reading it mid-flight
    # would record whichever recipe happened to be looked at first that round.
    $makers = @{}
    foreach ($rd in $recipes.Keys) {
        if ($hopSkip.ContainsKey($rd)) { continue }
        $r = $recipes[$rd]
        if (-not $r.OutDesc) { continue }
        if (-not $costs.ContainsKey($r.OutDesc)) { continue }
        $c = HopCost $costs $r $MADE_COST_NEEDS_EVERY_INPUT
        if ($c -lt 0) { continue }
        if ($c -ne $costs[$r.OutDesc]) { continue }
        if (-not $makers.ContainsKey($r.OutDesc)) { $makers[$r.OutDesc] = New-Object 'System.Collections.Generic.List[object]' }
        $makers[$r.OutDesc].Add($r)
    }

    # Back to a class. The dearest input is the one that set the cost, so the
    # class behind THAT input is the class the chain rests on: an ingot's cost
    # is a miner's, a leather strip's is a hunter's. Ties go to the first input
    # the record lists, which is the order the CNTO subrecords are in, so the
    # answer is the same on every machine and every run.
    #
    # The visited set is not there for tidiness. There are smelter rows that take
    # something made out of what they produce, so following the dearest input can
    # come back to where it started, and without it this walks for ever on real
    # data. When a route does come back on itself the next route that costs the
    # same is tried, which is why makers is a list.
    $chainMemo = @{}
    function ResolveChain([string]$desc, $seen, [bool]$ignoreGround = $false) {
        if ($producer.ContainsKey($desc) -and -not $ignoreGround) {
            return [pscustomobject]@{ Who = $producer[$desc].Who; Hops = 0; Via = $producer[$desc].Via }
        }
        if ($chainMemo.ContainsKey($desc) -and -not $ignoreGround) { return $chainMemo[$desc] }
        if (-not $makers.ContainsKey($desc)) { return $null }
        if ($seen.ContainsKey($desc)) { return $null }
        $seen[$desc] = $true
        $want = $costs[$desc]
        $answer = $null
        foreach ($r in $makers[$desc]) {
            # the dearest input first, then the rest, so a circle on the dearest
            # one still names the class the rest of the list rests on
            $ordered = @(@($r.InputList) | Where-Object { $costs.ContainsKey($_.Desc) -and $costs[$_.Desc] -eq $want }) +
                       @(@($r.InputList) | Where-Object { $costs.ContainsKey($_.Desc) -and $costs[$_.Desc] -ne $want })
            foreach ($i in $ordered) {
                $up = ResolveChain $i.Desc $seen $false
                if ($up) {
                    $answer = [pscustomobject]@{ Who = $up.Who; Hops = ($up.Hops + 1); Via = $r.Edid }
                    break
                }
            }
            if ($answer) { break }
        }
        $seen.Remove($desc)
        if ($answer) { $chainMemo[$desc] = $answer }
        return $answer
    }

    $lost = New-Object 'System.Collections.Generic.List[string]'
    foreach ($d in $costs.Keys) {
        if ($producer.ContainsKey($d) -and $producer[$d].At -le $costs[$d]) { continue }
        # A class hands this over too and the bench is cheaper, so the answer has
        # to come back down the recipe and not off the ground: taking the ground
        # answer here would put a master miner's rank on an item the settled
        # costs say is novice work at a smelter, and read as hops 0 while doing
        # it. Argued for at HOP_MAY_UNDERCUT_A_CLASS.
        $ch = ResolveChain $d (@{}) ($producer.ContainsKey($d))
        $nm = $d
        if ($items.ContainsKey($d)) { $nm = $items[$d].Name }
        if (-not $ch) {
            # Every route to it goes in a circle. Named rather than dropped: an
            # item with a settled cost and no class behind it is a hole in the
            # chain that has to be readable.
            $lost.Add(("{0} ({1}) costs {2} by the hop and every route back to a class goes in a circle" -f $nm, $d, $RANKS[$costs[$d]]))
            continue
        }
        $made[$d] = [pscustomobject]@{
            Rank = $RANKS[$costs[$d]]; At = $costs[$d]; Who = $ch.Who; Name = $nm
            Via = $ch.Via; Hops = $ch.Hops
        }
        if ($producer.ContainsKey($d)) {
            $hopCheaper.Add(("{0} is {1} work for a {2} at a bench and {3} work off the ground for a {4}" -f `
                             $nm, $RANKS[$costs[$d]], $ch.Who, $producer[$d].Rank, $producer[$d].Who))
        }
    }
    if ($lost.Count -gt 0) {
        Loud ("{0} item(s) have a cost and no class behind it, because every route to them comes back on itself:" -f $lost.Count)
        foreach ($l in ($lost | Select-Object -First 6)) { Loud ('  ' + $l) }
    }

    foreach ($d in $producer.Keys) { $supply[$d] = $producer[$d] }
    foreach ($d in $made.Keys) { $supply[$d] = $made[$d] }

    # WHAT THE OTHER TWO ANSWERS WOULD HAVE PLACED, printed every run so that
    # each rule costs a number rather than a guess.
    $loose = HopFixpoint $producer $recipes $hopSkip $false $HOP_ROUND_LIMIT $HOP_MAY_UNDERCUT_A_CLASS
    $looseOnly = 0
    foreach ($d in $loose.Costs.Keys) { if (-not $costs.ContainsKey($d)) { $looseOnly++ } }
    Note ("MADE_COST_NEEDS_EVERY_INPUT is {0}. With it off the hop would place {1} more item(s), each of them priced off the part of its own shopping list anybody could see." -f `
          $MADE_COST_NEEDS_EVERY_INPUT, $looseOnly)
    if ($breakdownRows.Count -gt 0) {
        # ONE KNOB AT A TIME. The skip set the run is using holds both kinds of
        # row, so the alternative has to start from that set and turn over only
        # the breakdown rows, or the number would be the two knobs together and
        # would be read as this one's.
        $other = @{}
        foreach ($rd in $hopSkip.Keys) { $other[$rd] = $true }
        foreach ($rd in $breakdownRows.Keys) {
            if ($HOP_THROUGH_A_FINISHED_GOOD) { $other[$rd] = $true } else { $other.Remove($rd) }
        }
        if (-not $HOP_THROUGH_A_TEMPER) { foreach ($rd in $temperRows.Keys) { $other[$rd] = $true } }
        $alt = HopFixpoint $producer $recipes $other $MADE_COST_NEEDS_EVERY_INPUT $HOP_ROUND_LIMIT $HOP_MAY_UNDERCUT_A_CLASS
        $moved = 0
        $cheaperThere = 0
        foreach ($d in $costs.Keys) {
            if (-not $alt.Costs.ContainsKey($d)) { $moved++; continue }
            if ($alt.Costs[$d] -ne $costs[$d]) { $moved++; if ($alt.Costs[$d] -lt $costs[$d]) { $cheaperThere++ } }
        }
        foreach ($d in $alt.Costs.Keys) { if (-not $costs.ContainsKey($d)) { $moved++ } }
        Note ("HOP_THROUGH_A_FINISHED_GOOD is {0}. Turning it the other way moves {1} item(s), {2} of them to a cheaper rank." -f `
              $HOP_THROUGH_A_FINISHED_GOOD, $moved, $cheaperThere)
    }
    # AND THE SAME NUMBER FOR THE TEMPERING KNOB, so that it costs a measurement
    # every run rather than resting on the one taken the day it was written.
    if ($temperRows.Count -gt 0) {
        $otherT = @{}
        foreach ($rd in $hopSkip.Keys) { $otherT[$rd] = $true }
        foreach ($rd in $temperRows.Keys) {
            if ($HOP_THROUGH_A_TEMPER) { $otherT[$rd] = $true } else { $otherT.Remove($rd) }
        }
        if (-not $HOP_THROUGH_A_FINISHED_GOOD) { foreach ($rd in $breakdownRows.Keys) { $otherT[$rd] = $true } }
        $altT = HopFixpoint $producer $recipes $otherT $MADE_COST_NEEDS_EVERY_INPUT $HOP_ROUND_LIMIT $HOP_MAY_UNDERCUT_A_CLASS
        $movedT = 0
        $cheaperT = 0
        foreach ($d in $costs.Keys) {
            if (-not $altT.Costs.ContainsKey($d)) { $movedT++; continue }
            if ($altT.Costs[$d] -ne $costs[$d]) { $movedT++; if ($altT.Costs[$d] -lt $costs[$d]) { $cheaperT++ } }
        }
        foreach ($d in $altT.Costs.Keys) { if (-not $costs.ContainsKey($d)) { $movedT++ } }
        Note ("HOP_THROUGH_A_TEMPER is {0}. Turning it the other way moves {1} item(s), {2} of them to a cheaper rank, and every one of those is an item somebody would have to be holding already before the row that supposedly gives it to them could be used." -f `
              $HOP_THROUGH_A_TEMPER, $movedT, $cheaperT)
    }
}

$byHop = @{}
foreach ($d in $made.Keys) {
    $h = $made[$d].Hops
    if (-not $byHop.ContainsKey($h)) { $byHop[$h] = 0 }
    $byHop[$h] = $byHop[$h] + 1
}
$hopLine = @()
foreach ($h in ($byHop.Keys | Sort-Object)) { $hopLine += ('{0} at {1} hop(s)' -f $byHop[$h], $h) }
$madeWho = @{}
foreach ($d in $made.Keys) {
    $w = $made[$d].Who
    if (-not $madeWho.ContainsKey($w)) { $madeWho[$w] = 0 }
    $madeWho[$w] = $madeWho[$w] + 1
}
$madeWhoLine = @()
foreach ($w in ($madeWho.Keys | Sort-Object)) { $madeWhoLine += ('{0} {1}' -f $w, $madeWho[$w]) }
Ok ("the hop places {0} more item(s) that no class hands over: {1}" -f $made.Count, ($hopLine -join ', '))
Ok ("the class behind them: {0}" -f ($madeWhoLine -join ', '))
Ok ("what the ranking reads is now {0} item(s): {1} off the ground and {2} off a bench" -f `
    $supply.Count, $producer.Count, $made.Count)
if ($hopCheaper.Count -gt 0) {
    Loud ("{0} item(s) are cheaper to make at a bench than to get off the ground, and the bench answer is the one in use because a recipe costs what the cheapest way of getting its makings costs:" -f $hopCheaper.Count)
    foreach ($h in ($hopCheaper | Select-Object -First 6)) { Loud ('  ' + $h) }
}

# What the hop did for the recipes that have to be ranked, counted the two ways
# the direct index is counted so the before and after are the same numbers.
$placedNow = 0
$entriesSeen = 0
$entriesPlacedDirect = 0
$entriesPlacedNow = 0
foreach ($d in $inputItemsSeen.Keys) { if ($supply.ContainsKey($d)) { $placedNow++ } }
foreach ($desc in $owned.Keys) {
    foreach ($i in @($owned[$desc].InputList)) {
        $entriesSeen++
        if ($producer.ContainsKey($i.Desc)) { $entriesPlacedDirect++ }
        if ($supply.ContainsKey($i.Desc)) { $entriesPlacedNow++ }
    }
}
Ok ("the owned recipes ask for {0} distinct input item(s): {1} had a producer before the hop and {2} have one now, {3} still do not" -f `
    $inputItemsSeen.Count, $placedItems, $placedNow, ($inputItemsSeen.Count - $placedNow))
Ok ("counted as input entries rather than distinct items, {0} of {1} were placed before the hop and {2} are placed now, which leaves {3}" -f `
    $entriesPlacedDirect, $entriesSeen, $entriesPlacedNow, ($entriesSeen - $entriesPlacedNow))

$stillOut = @()
foreach ($d in $inputItemsSeen.Keys) { if (-not $supply.ContainsKey($d)) { $stillOut += $d } }
if ($stillOut.Count -gt 0) {
    $stillOut = @($stillOut | Sort-Object { -$inputItemsSeen[$_] })
    Note 'what is left after the hop, commonest first. Every one of these is bought, looted or dropped, and nothing in this repository says what it costs:'
    foreach ($d in ($stillOut | Select-Object -First 12)) {
        $nm = $d
        if ($items.ContainsKey($d)) { $nm = $items[$d].Name + ' (' + $items[$d].Type + ')' }
        Note ("  {0,5} recipe(s) want {1} [{2}]" -f $inputItemsSeen[$d], $nm, $d)
    }
    if ($stillOut.Count -gt 12) { Note ("  ... and {0} more" -f ($stillOut.Count - 12)) }
} else {
    Ok 'every input of every owned recipe has a class behind it, directly or through a bench'
}

# ------------------------------------------------------------- the ranking --

Write-Host ''
Write-Host 'ranking' -ForegroundColor Cyan

# A row with no price cannot be ranked, and a rank guessed without one would
# decide what a real person may make. The build fails rather than guessing.
$noValue = New-Object 'System.Collections.Generic.List[string]'
foreach ($desc in $owned.Keys) {
    if ($owned[$desc].Value -lt 0) {
        $noValue.Add(("{0} ({1}) makes {2}, a {3}, and no rule in VALUE_RULES says where that record keeps its value" -f `
                      $owned[$desc].Edid, $desc, $owned[$desc].OutName, $owned[$desc].OutType))
    }
}
if ($noValue.Count -gt 0) {
    Bad ("{0} owned recipe(s) have no price to rank by" -f $noValue.Count)
    foreach ($v in ($noValue | Select-Object -First 8)) { Note ("  " + $v) }
} else {
    Ok 'every owned recipe makes something the records put a price on'
}

# The shares, half by half. Sorted by price, cheapest first, and the cut is
# pushed past any run of rows that share the boundary price, so two recipes
# that make things worth the same never land on different rungs.
$promoted = New-Object 'System.Collections.Generic.List[string]'
# Every row whose rank was named in RECIPE_RANK rather than worked out, printed
# at the end so that naming one is never a quiet thing.
$namedRanks = New-Object 'System.Collections.Generic.List[string]'
$rankRows = @{}
$rankedByInputs = @{}
$rankedByValue = @{}
# Per half: how many rows the placed inputs would have pulled DOWN and the
# price rule held up, under UNPLACED_INPUT_RULE 'floor'. Printed per half and
# totalled, because this number is the whole of the dragonbone defect.
$heldByPrice = @{}
$secondRuleUsed = [ordered]@{}
# Per half: the rows HOLE_FILL_MOVES_ONE_RUNG moved, when it closed the half's
# holes without the second rule. Written into the json beside secondRule.
$oneRungFill = [ordered]@{}
# Per half: the rungs that hold rows nobody at that rank can gather the makings
# for. Written into the json so Check-Balance.ps1 reads the same finding off the
# table rather than working it out a second way and disagreeing.
$unstandable = [ordered]@{}
foreach ($p in $PROFESSIONS.Keys) {
    foreach ($h in $PROFESSIONS[$p]) {
        $key = $p + '/' + $h
        $mine = New-Object 'System.Collections.Generic.List[object]'
        foreach ($desc in $owned.Keys) {
            if (($owned[$desc].Owner + '/' + $owned[$desc].Half) -eq $key) { $mine.Add($desc) }
        }
        if ($mine.Count -eq 0) { continue }
        $sorted = @($mine | Sort-Object @{ Expression = { [int64]$owned[$_].Value } }, @{ Expression = { [string]$_ } })
        $n = $sorted.Count
        $at = 0
        foreach ($s in $RANK_SHARE) {
            $last = [int][math]::Ceiling($n * [double]$s.Upto)
            if ($last -gt $n) { $last = $n }
            # do not split a run of equal prices across two ranks
            while ($last -lt $n -and [int64]$owned[$sorted[$last - 1]].Value -eq [int64]$owned[$sorted[$last]].Value) { $last++ }
            while ($at -lt $last) {
                $owned[$sorted[$at]].Rank = [string]$s.Rank
                $owned[$sorted[$at]].RankWhy = ('what it makes is worth ' + $owned[$sorted[$at]].Value + ' gold, which puts it in the ' + $s.Rank + ' share of what this half makes')
                $at++
            }
        }
        while ($at -lt $n) {
            $owned[$sorted[$at]].Rank = [string]$RANK_SHARE[$RANK_SHARE.Count - 1].Rank
            $owned[$sorted[$at]].RankWhy = 'the dearest of what this half makes'
            $at++
        }

        # THE INPUT COST RULE. What the shares said is kept on every row as
        # rankByValue, so the two answers can be compared afterwards rather than
        # one of them quietly replacing the other with nothing to read.
        #
        # A row is ranked by the DEAREST thing it asks for, because a recipe is
        # unmakeable until you can get all of it. A row that asks for nothing
        # any class produces keeps what it sells for, and says so on the row.
        #
        # IT DOES NOT OVERRIDE ANYTHING UNCONDITIONALLY, and it did until
        # 21 September. It can only read the inputs the index PLACES, and an
        # input nothing produces is an unknown cost and not a cost of nothing.
        # UNPLACED_INPUT_RULE is where that is decided and the measurement that
        # forced it is written out there: a 3100 gold dragonbone plate went out
        # at novice because the one thing on its list anybody produces was a
        # novice hunter's fox pelt.
        $fromInputs = 0
        $heldUpByPrice = 0
        foreach ($d in $sorted) {
            $owned[$d].RankByValue = [string]$owned[$d].Rank
            $best = -1
            $whoBest = ''
            $nameBest = ''
            $unplaced = 0
            foreach ($i in @($owned[$d].InputList)) {
                if (-not $supply.ContainsKey($i.Desc)) { $unplaced++; continue }
                if (-not $RANK_FROM_INPUT_COST) { continue }
                $pz = $supply[$i.Desc]
                $better = $false
                if ($best -lt 0) {
                    $better = $true
                } elseif ($INPUT_RANK_IS_THE_DEAREST) {
                    if ($pz.At -gt $best) { $better = $true }
                } else {
                    if ($pz.At -lt $best) { $better = $true }
                }
                if ($better) { $best = $pz.At; $whoBest = $pz.Who; $nameBest = $pz.Name }
            }
            $owned[$d].InputsUnplaced = $unplaced
            if ($best -lt 0) {
                $owned[$d].InputRank = ''
                $owned[$d].InputRankWho = ''
                $owned[$d].RankFrom = 'what it sells for, because nothing it asks for is produced by any class in this world'
                continue
            }
            $owned[$d].InputRank = [string]$RANKS[$best]
            $owned[$d].InputRankWho = $whoBest

            # The whole list is placed, so the dearest of it is what the recipe
            # costs and there is nothing unknown left to be wrong about.
            $inputDecides = $true
            if ($unplaced -gt 0 -and $UNPLACED_INPUT_RULE -ne 'decides') {
                $valAt = RankAt ([string]$owned[$d].RankByValue)
                if ($UNPLACED_INPUT_RULE -eq 'price') {
                    $inputDecides = $false
                } elseif ($valAt -gt $best) {
                    # 'floor': the placed inputs are a floor and the price is
                    # above it, so the price stands and the row says why.
                    $inputDecides = $false
                }
            }
            if (-not $inputDecides) {
                $heldUpByPrice++
                $owned[$d].RankFrom = ('what it sells for, held above what its placed inputs cost because ' + $unplaced +
                                       ' of the things it asks for are produced by no class in this world and could cost anything. Kept on purpose: ' +
                                       $UNPLACED_INPUT_KEPT_BECAUSE)
                $owned[$d].RankWhy = ($owned[$d].RankWhy + '. The dearest input any class does produce is ' + $nameBest +
                                      ', ' + $RANKS[$best] + ' work for a ' + $whoBest + ', which is a floor and not the answer here')
                continue
            }
            $owned[$d].Rank = [string]$RANKS[$best]
            $owned[$d].RankFrom = 'what its inputs cost a producer'
            $owned[$d].RankWhy = ('the dearest thing it asks for is ' + $nameBest + ', which a ' + $whoBest +
                                  ' gets at ' + $RANKS[$best] + ', so that is the rung somebody has to have reached before they could gather the makings at all')
            if ($unplaced -gt 0) {
                $owned[$d].RankWhy = ($owned[$d].RankWhy + '. ' + $unplaced +
                                      ' more thing(s) on its list are produced by no class and what it sells for does not put it any higher')
            }
            $fromInputs++
        }
        $rankedByInputs[$key] = $fromInputs
        $heldByPrice[$key] = $heldUpByPrice
        $rankedByValue[$key] = $n - $fromInputs

        # The circle check, and the one rule that breaks it. The cheapest row
        # of this half that a new character can actually reach is novice,
        # whatever the share said, because a rung nobody can stand on is a rung
        # nobody climbs off.
        if ($NOVICE_MUST_BE_REACHABLE) {
            $firstOpen = ''
            foreach ($d in $sorted) {
                if ($owned[$d].Fires -and $owned[$d].Bare) { $firstOpen = $d; break }
            }
            if ($firstOpen -and $owned[$firstOpen].Rank -ne 'novice') {
                $promoted.Add(("{0}: {1} ({2}), worth {3}, was {4} and is the cheapest row of this half anybody can reach on the day they pick it" -f `
                               $key, $owned[$firstOpen].Edid, $owned[$firstOpen].OutName, $owned[$firstOpen].Value, $owned[$firstOpen].Rank))
                $owned[$firstOpen].Rank = 'novice'
                $owned[$firstOpen].RankWhy = 'the cheapest row of this half that a new character can reach, moved to novice so the half has a way in'
                $owned[$firstOpen].Pinned = $true
            }
        }

        # A ROW WHOSE RANK IS A DECISION RATHER THAN A READING. See $RECIPE_RANK.
        #
        # It is applied here, after every automatic rule has run and BEFORE the
        # empty-rung and standable checks below, so a named rank is still held
        # to every invariant this script enforces. A knob that skipped the
        # checks would be a way to write a ladder with a hole in it and be told
        # nothing.
        foreach ($d in $sorted) {
            $edid = [string]$owned[$d].Edid
            if (-not $RECIPE_RANK.Contains($edid)) { continue }
            $named = $RECIPE_RANK[$edid]
            if ($RANKS -notcontains $named.Rank) {
                Bad ("RECIPE_RANK names {0} as '{1}', which is not one of the four ranks" -f $edid, $named.Rank)
                continue
            }
            $owned[$d].Rank = [string]$named.Rank
            $owned[$d].RankFrom = 'named outright in RECIPE_RANK'
            $owned[$d].RankWhy = [string]$named.Why
            $owned[$d].Pinned = $true
            $namedRanks.Add(("{0}: {1} ({2}) is {3}. {4}" -f $key, $edid, $owned[$d].OutName, $named.Rank, $named.Why))
        }

        $counts = CountRungs $sorted
        $hole = HoleIn $counts

        # THE RUNGS MUST NOT BE EMPTY, and this is where that is enforced rather
        # than reported. A rung with nothing on it and something above it is a
        # rank that opens nothing: you reach it, and the list of what you may
        # make is the same list as yesterday.
        #
        # Nothing is invented and nothing is smeared. The half is named out
        # loud, the empty rung is named, the reason is printed from what was
        # measured, and then the SECOND RULE below ranks that half alone.
        if ($hole -ge 0) {
            $spread = @{}
            foreach ($d in $sorted) {
                $rk = [string]$owned[$d].Rank
                if (-not $spread.ContainsKey($rk)) { $spread[$rk] = 0 }
                $spread[$rk] = $spread[$rk] + 1
            }
            $vals = @{}
            foreach ($d in $sorted) { $vals[[string]$owned[$d].Value] = $true }
            $distinct = @{}
            $totals = @{}
            foreach ($d in $sorted) {
                $distinct[[string](@($owned[$d].InputList).Count)] = $true
                $tc = 0
                foreach ($i in @($owned[$d].InputList)) { $tc += [int]$i.Count }
                $totals[[string]$tc] = $true
            }
            $spreadTxt = @()
            foreach ($rk in $RANKS) {
                $c = 0
                if ($spread.ContainsKey($rk)) { $c = $spread[$rk] }
                $spreadTxt += ('{0} {1}' -f $rk, $c)
            }
            $why = ('{0} row(s) ranked by what their inputs cost and {1} by what they sell for, and they land {2}. What is left to rank by is {3} distinct output price(s), {4} distinct input list length(s) and {5} distinct total input count(s)' -f `
                    $rankedByInputs[$key], $rankedByValue[$key], ($spreadTxt -join ', '), $vals.Keys.Count, $distinct.Keys.Count, $totals.Keys.Count)
            Loud ("{0}: the {1} rung is empty with rows above it. {2}" -f $key, $RANKS[$hole], $why)
            $filled = $null
            if ($HOLE_FILL_MOVES_ONE_RUNG) { $filled = FillHolesOneRung $sorted }
            if ($null -ne $filled) {
                $oneRungFill[$key] = @($filled)
                $counts = CountRungs $sorted
                $hole = HoleIn $counts
                Loud ("  {0}: {1} row(s) moved one rung each and every rung now has work on it (HOLE_FILL_MOVES_ONE_RUNG)" -f $key, @($filled).Count)
                foreach ($mv in @($filled | Select-Object -First 10)) { Loud ("    " + $mv) }
                if (@($filled).Count -gt 10) { Loud ("    ... and {0} more, each one's rankFrom in the json says so" -f (@($filled).Count - 10)) }
            } else {
                $secondRuleUsed[$key] = ('the {0} rung came out empty with rows above it. {1}. Ranked by {2} for this half alone.' -f `
                                         $RANKS[$hole], $why, $SECOND_RULE_KEY)
                $counts = SecondRule $key $sorted
                $hole = HoleIn $counts
                if ($hole -ge 0) {
                    Bad ("{0}: the {1} rung is still empty after the {2} rule, so this half has no ladder and the table was not written" -f `
                         $key, $RANKS[$hole], $SECOND_RULE_KEY)
                } else {
                    Loud ("  {0}: ranked by {1} instead, and every rung now has work on it" -f $key, $SECOND_RULE_KEY)
                }
            }
        }

        # AND THE RUNGS HAVE TO BE STANDABLE, which is the question a count of
        # rows cannot ask. Argued for at RUNGS_MUST_BE_STANDABLE. A half that
        # fails it and is not named in HALVES_WITH_AN_UNSTANDABLE_RUNG with a
        # measured reason fails this build.
        if ($RUNGS_MUST_BE_STANDABLE) {
            $bad = @(UnstandableRungs $sorted)
            if ($bad.Count -gt 0) {
                $said = @()
                foreach ($b in $bad) {
                    $said += ('the {0} rung holds {1} row(s) and not one of them can be gathered for below {2}; the nearest is {3}, wanting {4} work from a {5}' -f `
                              $b.Rank, $b.Rows, $b.NeedAt, $b.Nearest, $b.NeedAt, $b.Who)
                }
                $unstandable[$key] = ($said -join '. ')
                if ($HALVES_WITH_AN_UNSTANDABLE_RUNG.Contains($key)) {
                    Loud ("{0}: {1}. Named in HALVES_WITH_AN_UNSTANDABLE_RUNG, so this build is allowed to write it: {2}" -f `
                          $key, ($said -join '. '), $HALVES_WITH_AN_UNSTANDABLE_RUNG[$key])
                } else {
                    Bad ("{0}: {1}. Reaching that rank opens work nobody at that rank can gather for, which is an empty rung wearing a label. Decide it and name it in HALVES_WITH_AN_UNSTANDABLE_RUNG, or change what the half asks for." -f `
                         $key, ($said -join '. '))
                }
            }
        }

        $rankRows[$key] = $counts
        $lo = [int64]$owned[$sorted[0]].Value
        $hi = [int64]$owned[$sorted[$n - 1]].Value
        Write-Host ("  {0,-24} {1,5} rows, {2} to {3} gold, novice {4}, advanced {5}, expert {6}, master {7}   ({8} by input cost, {9} by price, {10} held up by price over an unplaced input)" -f `
                    $key, $n, $lo, $hi, $counts['novice'], $counts['advanced'], $counts['expert'], $counts['master'], `
                    $rankedByInputs[$key], $rankedByValue[$key], $heldByPrice[$key])
    }
}
if ($promoted.Count -gt 0) {
    Loud ("{0} row(s) were moved to novice so that the half has something a new character can make:" -f $promoted.Count)
    foreach ($pz in $promoted) { Loud ("  " + $pz) }
} else {
    Ok 'every half already had a reachable novice row, so nothing was moved'
}

# Naming a rank is the last resort, so it is never quiet. Every one is printed
# with the reason it could not be worked out, and a knob that holds no names
# says so too, because an empty one is worth noticing the day it fills up.
if ($namedRanks.Count -gt 0) {
    Loud ("{0} row(s) carry a rank named in RECIPE_RANK rather than worked out:" -f $namedRanks.Count)
    foreach ($nr in $namedRanks) { Loud ("  " + $nr) }
    Loud '  Each was applied after every automatic rule and before the empty rung and standable'
    Loud '  checks above, so a named rank is held to the same invariants as any other.'
} else {
    Ok 'no row needed its rank naming outright'
}

# --------------- where a ladder sits below the class that grows what it asks --
#
# PATRICK'S QUESTION, ANSWERED AS A NUMBER INSTEAD OF AS A CLAIM. 21 September:
# "farmer matches with tiers of cook for their recipes, miner and smith,
# woodworker and miner and so on, so there isn't an imbalance".
#
# The reverse index answers with the LOWEST rank any class gets an item at, and
# that is the right answer for what a recipe costs: an apple in the pot does not
# care who pulled it off the tree. What it hides is the class that has to climb
# furthest for the same item, and for crops that is every one of them, because
# all 11 crops are also plants a gatherer picks at the same rank or lower.
#
# So this walks the OTHER producers, the ones $producer dropped, and names every
# owned row whose rank sits below a class that produces something on its list.
# That is not automatically wrong and nothing here fails on it. It is the
# imbalance stated: reading 'Apple Pie, Cook/Confectioner advanced, wants Red
# Apple, which a farmer grows at expert' is what lets somebody decide whether
# the Farmer's ladder or the recipe's rank is the thing to move.

Write-Host ''
Write-Host 'where a ladder sits below the class that grows what it asks for' -ForegroundColor Cyan

$crossPairs = @{}
$crossRows = 0
$crossSaid = New-Object 'System.Collections.Generic.List[string]'
foreach ($desc in $owned.Keys) {
    $r = $owned[$desc]
    $rowAt = RankAt ([string]$r.Rank)
    if ($rowAt -lt 0) { continue }
    $worst = -1
    $worstWho = ''
    $worstName = ''
    foreach ($i in @($r.InputList)) {
        if (-not $producerAll.ContainsKey($i.Desc)) { continue }
        foreach ($pz in $producerAll[$i.Desc]) {
            if ($pz.At -le $rowAt) { continue }
            if ($pz.At -gt $worst) { $worst = $pz.At; $worstWho = $pz.Who; $worstName = $pz.Name }
        }
    }
    if ($worst -lt 0) { continue }
    $crossRows++
    $pair = ($r.Owner + '/' + $r.Half + ' <- ' + $worstWho)
    if (-not $crossPairs.ContainsKey($pair)) { $crossPairs[$pair] = 0 }
    $crossPairs[$pair] = $crossPairs[$pair] + 1
    if ($crossSaid.Count -lt 12) {
        $crossSaid.Add(('{0}/{1} {2} is {3} and wants {4}, which a {5} has to be {6} to produce' -f `
                        $r.Owner, $r.Half, $r.OutName, $r.Rank, $worstName, $worstWho, $RANKS[$worst]))
    }
}
if ($crossRows -eq 0) {
    Ok 'no owned row is ranked below a class that produces something on its list'
} else {
    Note ("{0} owned row(s) are ranked below a class that produces something they ask for" -f $crossRows)
    foreach ($pair in ($crossPairs.Keys | Sort-Object { -$crossPairs[$_] })) {
        Note ("  {0,5}  {1}" -f $crossPairs[$pair], $pair)
    }
    foreach ($s in $crossSaid) { Note ("  " + $s) }
    if ($crossRows -gt $crossSaid.Count) {
        Note ("  ... and {0} more, every one of them in game\data\recipes.json with the other producers on the input" -f ($crossRows - $crossSaid.Count))
    }
}

# ------------------------------------------------------------- the checks ---

Write-Host ''
Write-Host 'checks' -ForegroundColor Cyan

# THE RUNGS OF THE GATE, not of the table. The ranking above checks every owned
# row of a half, and a third of the Smith's rows are tempering the server is
# never asked about. scripts\dev\Check-Balance.ps1 counts the rows that FIRE, because
# those are the only ones a gate can refuse, so a half can pass the ranking and
# still fail there. Both subsets are checked here so that this script cannot
# write a table that the balance check then rejects.
foreach ($p in $PROFESSIONS.Keys) {
    foreach ($h in $PROFESSIONS[$p]) {
        $key = $p + '/' + $h
        $firing = New-Object 'System.Collections.Generic.List[string]'
        foreach ($desc in $owned.Keys) {
            if (-not $owned[$desc].Fires) { continue }
            if (($owned[$desc].Owner + '/' + $owned[$desc].Half) -ne $key) { continue }
            $firing.Add($desc)
        }
        if ($firing.Count -eq 0) { continue }
        $c = CountRungs $firing
        $hole = HoleIn $c
        if ($hole -ge 0) {
            Bad ("{0}: of the {1} row(s) the server is asked about, the {2} rung is empty and there is work above it, so reaching that rank opens nothing" -f `
                 $key, $firing.Count, $RANKS[$hole])
        }
        # And standable, on the same subset and for the same reason. The gate
        # only ever refuses a firing row, so this is the set a person actually
        # meets at a bench.
        if ($RUNGS_MUST_BE_STANDABLE) {
            foreach ($b in @(UnstandableRungs $firing)) {
                if ($HALVES_WITH_AN_UNSTANDABLE_RUNG.Contains($key)) { continue }
                Bad ("{0}: of the {1} row(s) the server is asked about, the {2} rung holds {3} and not one can be gathered for below {4}" -f `
                     $key, $firing.Count, $b.Rank, $b.Rows, $b.NeedAt)
            }
        }
    }
}
Ok 'no half has an empty rung with work above it, counting every owned row and counting only the rows the server is asked about'
if ($RUNGS_MUST_BE_STANDABLE) {
    if ($unstandable.Count -eq 0) {
        Ok 'every rung that holds work holds at least one row somebody at that rank could gather the makings for'
    } else {
        Note ("{0} half/halves hold a rung nobody at that rank can gather for, every one of them named in HALVES_WITH_AN_UNSTANDABLE_RUNG with the reason: {1}" -f `
              $unstandable.Count, (($unstandable.Keys) -join ', '))
    }
}

if ($unresolvedOut.Count -gt 0) {
    Bad ("{0} recipe(s) name an output that is not a record in this load order" -f $unresolvedOut.Count)
    foreach ($u in $unresolvedOut) { Note ("  " + $u) }
} else {
    Ok ("every one of the {0} recipes with an output resolves it to a real record" -f ($recipes.Count - $noOutput))
}

# A record with no FULL subrecord has no name to read, and the editor id is
# then the only thing there is to put in the table. That is a defect in the
# plugin rather than in this script, and it is named out loud rather than
# failed on, because refusing to write 5116 rows over one nameless cape would
# leave the server with no table at all. Every row carries nameFrom in the
# json, so a row named after its editor id can be found without rerunning this.
if ($namelessOut.Count -gt 0) {
    Loud ("{0} output record(s) carry no FULL, so their rows are named after the editor id:" -f $namelessOut.Count)
    foreach ($d in ($namelessOut.Keys | Sort-Object)) {
        Loud ("  {0} ({1}), wanted by: {2}" -f $items[$d].Edid, $d, (($namelessOut[$d] | Select-Object -First 4) -join ', '))
    }
} else {
    Ok 'every output in the table has a real name out of a string table or its own record'
}

# every desc is hex digits and a plugin, the same test the ore table makes
$oddIds = New-Object 'System.Collections.Generic.List[string]'
foreach ($desc in $owned.Keys) {
    if ($desc -cnotmatch '^[0-9a-f]{1,8}:[^:]+\.es[mpl]$') { $oddIds.Add("the recipe $desc") }
    if ($owned[$desc].OutDesc -cnotmatch '^[0-9a-f]{1,8}:[^:]+\.es[mpl]$') { $oddIds.Add("the output of $desc, " + $owned[$desc].OutDesc) }
}
if ($oddIds.Count -gt 0) {
    foreach ($o in $oddIds) { Bad ("an id that does not look right: {0}" -f $o) }
} else {
    Ok 'every desc is hex digits and a plugin'
}

# no recipe is listed twice. Every recipe is keyed by its desc and an override
# replaces the row rather than adding one, so a duplicate here would mean two
# different recipes came out with the same key, which would silently lose one.
$dupes = New-Object 'System.Collections.Generic.List[string]'
foreach ($desc in $owned.Keys) { if ($unowned.Contains($desc)) { $dupes.Add($desc) } }
if ($dupes.Count -gt 0) {
    foreach ($d in $dupes) { Bad ("{0} is in both the owned table and the unowned map" -f $d) }
} else {
    Ok ("no recipe is listed twice: {0} owned and {1} unowned, {2} in all, and every key is distinct" -f $owned.Count, $unowned.Count, ($owned.Count + $unowned.Count))
}
if ($seenTwice.Count -gt 0) {
    Note ("{0} recipe(s) are overridden by a later plugin and the later one is the one in the table" -f $seenTwice.Count)
}

# every owner is one of the eight professions and every half is one of its two
$badOwner = New-Object 'System.Collections.Generic.List[string]'
foreach ($desc in $owned.Keys) {
    $row = $owned[$desc]
    if (-not $PROFESSIONS.Contains($row.Owner)) {
        $badOwner.Add(("{0} is owned by '{1}', which is not a profession in classes.md" -f $desc, $row.Owner))
        continue
    }
    if ($PROFESSIONS[$row.Owner].Count -eq 0) {
        # The Mage is the only one of these. It is in the roster with no halves
        # because the panel needs the full eight, and a recipe landing on it
        # means a rule above sent a crafting row to a profession that does not
        # craft. What a mage knows belongs in scripts\dev\Build-SpellTable.ps1.
        $badOwner.Add(("{0} is owned by {1}, which has no halves and makes nothing by recipe. {2}" -f $desc, $row.Owner, $PROFESSION_CRAFTS[$row.Owner].Why))
        continue
    }
    if (-not ($PROFESSIONS[$row.Owner] -contains $row.Half)) {
        $badOwner.Add(("{0} is {1}/{2} and '{2}' is not one of {1}'s two halves" -f $desc, $row.Owner, $row.Half))
    }
}
if ($badOwner.Count -gt 0) {
    foreach ($b in $badOwner) { Bad $b }
} else {
    Ok 'every owner is one of the professions in classes.md and every half is one of its two'
}

# ------------------------------------------------------------- the counts ---

Write-Host ''
Write-Host 'what each half ends up with' -ForegroundColor Cyan

$perHalf  = @{}
$perHalfFiring = @{}
$perHalfDayOne = @{}
$perHalfPerk   = @{}
foreach ($p in $PROFESSIONS.Keys) {
    foreach ($h in $PROFESSIONS[$p]) {
        $perHalf[$p + '/' + $h] = 0
        $perHalfFiring[$p + '/' + $h] = 0
        $perHalfDayOne[$p + '/' + $h] = 0
        $perHalfPerk[$p + '/' + $h] = 0
    }
}
foreach ($desc in $owned.Keys) {
    $row = $owned[$desc]
    $key = $row.Owner + '/' + $row.Half
    if (-not $perHalf.ContainsKey($key)) {
        $perHalf[$key] = 0; $perHalfFiring[$key] = 0; $perHalfDayOne[$key] = 0; $perHalfPerk[$key] = 0
    }
    $perHalf[$key] = $perHalf[$key] + 1
    if ($row.Fires) {
        $perHalfFiring[$key] = $perHalfFiring[$key] + 1
        if ($row.DayOne) { $perHalfDayOne[$key] = $perHalfDayOne[$key] + 1 }
        if ($row.BehindVanillaPerk) { $perHalfPerk[$key] = $perHalfPerk[$key] + 1 }
    }
}

# Four numbers, not two, and the last two are the ones that were missing.
# 'asked' counts the rows that reach onCraft at all. 'open today' counts the
# rows a character created this morning can make: no condition of any kind, so
# nothing has to be found, learnt or earned first. 'behind a perk' counts the
# rows gated on a vanilla perk, which classes.md says nobody on this server
# will ever hold.
Write-Host ("  {0,-12} {1,-14} {2,8} {3,8} {4,10} {5,14}" -f 'profession', 'half', 'recipes', 'asked', 'open today', 'behind a perk')
foreach ($p in $PROFESSIONS.Keys) {
    $total = 0
    foreach ($h in $PROFESSIONS[$p]) { $total += $perHalf[$p + '/' + $h] }
    foreach ($h in $PROFESSIONS[$p]) {
        $key = $p + '/' + $h
        Write-Host ("  {0,-12} {1,-14} {2,8} {3,8} {4,10} {5,14}" -f $p, $h, $perHalf[$key], $perHalfFiring[$key], $perHalfDayOne[$key], $perHalfPerk[$key])
    }
    if ($PROFESSIONS[$p].Count -eq 0) {
        Write-Host ("  {0,-12} {1,-14} {2,8} {3,8} {4,10} {5,14}" -f $p, '(no halves)', 0, 0, 0, 0)
        Note ("{0}: {1}" -f $p, $PROFESSION_CRAFTS[$p].Why)
    } else {
        Note ("{0}: {1} in all" -f $p, $total)
    }
}
Note ("unowned: {0}, and unowned means anybody may make it" -f $unowned.Count)

# The check this whole file exists for. A half that can make nothing is a half
# nobody should be allowed to pick, and the two times this repo got that wrong
# it was found by somebody playing rather than by a build.
$emptyUnexpected = New-Object 'System.Collections.Generic.List[string]'
$filledUnexpected = New-Object 'System.Collections.Generic.List[string]'
foreach ($p in $PROFESSIONS.Keys) {
    foreach ($h in $PROFESSIONS[$p]) {
        $key = $p + '/' + $h
        $expectedEmpty = $HALVES_WITH_NO_RECIPES.Contains($key)
        if ($perHalf[$key] -eq 0 -and -not $expectedEmpty) { $emptyUnexpected.Add($key) }
        if ($perHalf[$key] -gt 0 -and $expectedEmpty) { $filledUnexpected.Add($key) }
    }
}
Write-Host ''
if ($emptyUnexpected.Count -gt 0) {
    foreach ($k in $emptyUnexpected) {
        Bad ("{0} owns no recipes at all. A half that can make nothing is a half nobody should be allowed to pick. Either the rule above is wrong or that half has nothing behind it, and both of those need a person." -f $k)
    }
} else {
    Ok 'every half that is meant to have recipes has some'
}
if ($filledUnexpected.Count -gt 0) {
    foreach ($k in $filledUnexpected) {
        Bad ("{0} is named in HALVES_WITH_NO_RECIPES as having nothing, and it has {1} recipe(s). That knob is out of date and the reason written in it is no longer true." -f $k, $perHalf[$k])
    }
}
foreach ($k in $HALVES_WITH_NO_RECIPES.Keys) {
    Loud ("{0} owns nothing: {1}" -f $k, $HALVES_WITH_NO_RECIPES[$k].Why)
}
Loud 'those halves go into recipes.json under "halves", each with a craftsAtAll flag. Every one of them is still offered in character creation: a half nobody may pick is a profession nobody may pick.'

# THE CHECK THAT OWNING RECIPES IS NOT THE SAME AS BEING ABLE TO WORK.
#
# A half can own hundreds of rows and have nothing anybody can make on the day
# they pick it. Three halves in this build are exactly that, and every one of
# them passed the check above, because the check above counts rows rather than
# rows a person can reach.
$noStart = New-Object 'System.Collections.Generic.List[string]'
$startsFine = New-Object 'System.Collections.Generic.List[string]'
foreach ($p in $PROFESSIONS.Keys) {
    foreach ($h in $PROFESSIONS[$p]) {
        $key = $p + '/' + $h
        if ($perHalfFiring[$key] -eq 0) { continue }
        $named = $HALVES_NOBODY_CAN_START.Contains($key)
        if ($perHalfDayOne[$key] -eq 0 -and -not $named) { $noStart.Add($key) }
        if ($perHalfDayOne[$key] -gt 0 -and $named) { $startsFine.Add($key) }
        if ($perHalfDayOne[$key] -eq 0) {
            # What that half's rows are actually waiting on, counted, so the
            # reason in the knob can be written from the build rather than
            # from somebody's recollection of it.
            $asks = @{}
            foreach ($desc in $owned.Keys) {
                $row = $owned[$desc]
                if (-not $row.Fires) { continue }
                if (($row.Owner + '/' + $row.Half) -ne $key) { continue }
                $seenHere = @{}
                foreach ($nd in $row.Needs) {
                    if ($seenHere.ContainsKey($nd.Name)) { continue }
                    $seenHere[$nd.Name] = $true
                    if (-not $asks.ContainsKey($nd.Name)) { $asks[$nd.Name] = 0 }
                    $asks[$nd.Name] = $asks[$nd.Name] + 1
                }
            }
            $bits = @()
            foreach ($a in ($asks.Keys | Sort-Object { -$asks[$_] })) { $bits += ($asks[$a].ToString() + ' x ' + $a) }
            Note ("{0}: all {1} row(s) the server is asked about are behind something. {2}" -f $key, $perHalfFiring[$key], ($bits -join ', '))
        }
        elseif ($perHalfDayOne[$key] -le $THIN_HALF_ROWS -and $perHalfFiring[$key] -gt $perHalfDayOne[$key]) {
            # A half with almost nothing to start on. Printed row by row,
            # because "4 recipes" and "1 recipe and three behind a book" are
            # the same number in a table and not the same trade.
            Loud ("{0} has {1} of {2} row(s) a new character can make. The rest:" -f $key, $perHalfDayOne[$key], $perHalfFiring[$key])
            $shown = 0
            $held = 0
            foreach ($desc in $owned.Keys) {
                $row = $owned[$desc]
                if (-not $row.Fires) { continue }
                if (($row.Owner + '/' + $row.Half) -ne $key) { continue }
                if ($row.DayOne) { continue }
                $held++
                if ($shown -ge $THIN_HALF_LINES) { continue }
                $shown++
                $what = @()
                foreach ($nd in $row.Needs) { $what += $nd.Text }
                Loud ("  {0} makes {1} and wants {2}" -f $row.Edid, $row.OutName, ($what -join ' and '))
            }
            if ($held -gt $shown) { Loud ("  and {0} more, all of them in recipes.json with what each one wants" -f ($held - $shown)) }
        }
    }
}
if ($noStart.Count -gt 0) {
    foreach ($k in $noStart) {
        Bad ("{0} owns {1} recipe(s) the server is asked about and not one of them can be made by somebody who picked that half this morning: every one is behind a condition. That is a half that looks like work and is not. Either a rule above is wrong or somebody has to decide what a new one of these starts with." -f $k, $perHalfFiring[$k])
    }
} else {
    Ok 'every half with recipes has at least one a new character can make, or is named in HALVES_NOBODY_CAN_START with the reason'
}
if ($startsFine.Count -gt 0) {
    foreach ($k in $startsFine) {
        Bad ("{0} is named in HALVES_NOBODY_CAN_START and it has {1} recipe(s) a new character can make. That knob is out of date." -f $k, $perHalfDayOne[$k])
    }
}
foreach ($k in $HALVES_NOBODY_CAN_START.Keys) {
    Loud ("{0} has nothing a new character can make: {1}" -f $k, $HALVES_NOBODY_CAN_START[$k])
}

# the unowned map, by reason, because there are too many to print one at a time
Write-Host ''
Write-Host 'why the unowned recipes are unowned' -ForegroundColor Cyan
$byWhy = @{}
foreach ($desc in $unowned.Keys) {
    $w = $unowned[$desc].Why
    if (-not $byWhy.ContainsKey($w)) { $byWhy[$w] = 0 }
    $byWhy[$w] = $byWhy[$w] + 1
}
foreach ($w in ($byWhy.Keys | Sort-Object { -$byWhy[$_] })) {
    Write-Host ("  {0,6}  {1}" -f $byWhy[$w], $w)
}

Write-Host ''
Write-Host 'the output record types a recipe in this build names' -ForegroundColor Cyan
foreach ($t in ($outTypeCount.Keys | Sort-Object { -$outTypeCount[$_] })) {
    Note ("{0}: {1}" -f $t, $outTypeCount[$t])
}

# ------------------------------------------------------------ the cut file -
#
# See $CUT_FILE. Every rank and count above is settled before this runs, so it
# moves no ladder: it marks what leaves the open book and what only a roll
# makes, and hands the rows nobody owned to the refused map.

Write-Host ''
Write-Host 'the cut file' -ForegroundColor Cyan
$cutCount = [ordered]@{ 'owned' = 0; 'refused' = 0; 'alreadyRefused' = 0; 'embassy' = 0; 'thalmor' = 0 }
$cutNotHere = New-Object 'System.Collections.Generic.List[string]'
if (-not (Test-Path -LiteralPath $CUT_FILE)) {
    Bad "the cut file is not there: $CUT_FILE"
} else {
    $cutDoc = Get-Content -LiteralPath $CUT_FILE -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($ci in @($cutDoc.items)) {
        $cid = [string]$ci.id
        $disp = [string]$ci.disposition
        if ($disp -ne 'cut' -and -not $CUT_ROLLS.Contains($disp)) {
            Bad ("the cut file names {0} as '{1}', which is not cut, embassy or thalmor" -f $cid, $disp)
            continue
        }
        if ($owned.Contains($cid)) {
            if ($disp -eq 'cut') {
                $owned[$cid] | Add-Member -NotePropertyName Book -NotePropertyValue 'cut' -Force
                $cutCount['owned']++
            } else {
                $owned[$cid] | Add-Member -NotePropertyName Roll -NotePropertyValue ([string]$CUT_ROLLS[$disp]) -Force
                $cutCount[$disp]++
            }
        } elseif ($unowned.Contains($cid)) {
            if ($disp -ne 'cut') {
                Bad ("the cut file puts {0} ({1}) on the {2} roll, and nobody owns it, so a roll has no half to gate" -f $cid, $unowned[$cid].OutName, $disp)
                continue
            }
            $u = $unowned[$cid]
            $refusedRows[$cid] = [pscustomobject]@{
                Edid = $u.Edid; OutDesc = $u.OutDesc; OutName = $u.OutName; OutType = $u.OutType; BenchDesc = $u.BenchDesc; BenchName = $u.BenchName
                Why = [string]$ci.why; Cut = $true
            }
            $unowned.Remove($cid)
            $cutCount['refused']++
        } elseif ($refusedRows.Contains($cid)) {
            # Already refused by this build, by NOBODY_MAKES or the collapsed
            # dwarven smelts, whose own reason is the one the gate says.
            $cutCount['alreadyRefused']++
        } else {
            $cutNotHere.Add($cid)
        }
    }
    Ok ("{0} owned row(s) cut from the open book, {1} row(s) nobody owned now refused, {2} already refused here" -f `
        $cutCount['owned'], $cutCount['refused'], $cutCount['alreadyRefused'])
    Ok ("{0} row(s) on the embassy roll and {1} on the Thalmor remnant roll" -f $cutCount['embassy'], $cutCount['thalmor'])
    if ($cutNotHere.Count -gt 0) {
        # A reference to a recipe this load order does not carry. It cuts
        # nothing and does no harm, and the cut file keeps it for an event.
        Loud ("{0} row(s) in the cut file are not in this load order: {1}" -f $cutNotHere.Count, (($cutNotHere | Select-Object -First 10) -join ', '))
    }
}

# --------------------------------------------------- the rows that move -
#
# See $TRADE_BENCHES. After the cut file, because only a row somebody can make
# is moved, and after every rank and count, so a move changes no ladder.

Write-Host ''
Write-Host 'the rows at a bench their trade does not work at' -ForegroundColor Cyan
$kwByName = @{}
foreach ($kd in $kwName.Keys) {
    $kn = [string]$kwName[$kd]
    if ($kwByName.ContainsKey($kn) -and $kwByName[$kn] -ne $kd) {
        $kwByName[$kn] = ''
    } else {
        $kwByName[$kn] = $kd
    }
}
foreach ($trade in $TRADE_BENCHES.Keys) {
    $homeBench = [string]$TRADE_BENCHES[$trade].Home
    if (-not $kwByName.ContainsKey($homeBench)) {
        Bad ("the {0}'s home bench {1} is no keyword in this load order" -f $trade, $homeBench)
    } elseif (-not $kwByName[$homeBench]) {
        Bad ("more than one keyword in this load order is called {0}, so the {1}'s home bench cannot be named" -f $homeBench, $trade)
    }
}
$movedCount = @{}
foreach ($desc in $owned.Keys) {
    $r = $owned[$desc]
    if (-not $r.Fires) { continue }
    if ($r.PSObject.Properties['Book'] -and $r.Book -eq 'cut') { continue }
    if (-not $TRADE_BENCHES.Contains($r.Owner)) {
        Bad ("{0} ({1}) is owned by {2}, which names no benches in TRADE_BENCHES" -f $r.Edid, $desc, $r.Owner)
        continue
    }
    $tb = $TRADE_BENCHES[$r.Owner]
    $works = $tb.Benches -contains $r.BenchName
    if ($works -and $tb.ContainsKey('Only') -and $tb.Only.ContainsKey($r.BenchName)) {
        $works = $tb.Only[$r.BenchName] -contains $r.Family
    }
    if ($works) { continue }
    $homeBench = [string]$tb.Home
    if (-not $kwByName[$homeBench]) { continue }
    $r | Add-Member -NotePropertyName MovedFrom -NotePropertyValue $r.BenchDesc -Force
    $r | Add-Member -NotePropertyName MovedFromName -NotePropertyValue $r.BenchName -Force
    $r.BenchDesc = $kwByName[$homeBench]
    $r.BenchName = $homeBench
    $mk = $r.MovedFromName + ' -> ' + $homeBench + ' (' + $r.Owner + ')'
    if (-not $movedCount.ContainsKey($mk)) { $movedCount[$mk] = 0 }
    $movedCount[$mk] = $movedCount[$mk] + 1
}
if ($movedCount.Count -eq 0) {
    Ok 'every row somebody can make is at a bench its trade works at'
} else {
    foreach ($mk in ($movedCount.Keys | Sort-Object)) { Ok ("{0,4} moved: {1}" -f $movedCount[$mk], $mk) }
}

# ------------------------------------------------------------- the writing -

Write-Host ''
Write-Host 'writing' -ForegroundColor Cyan

$after = Get-FolderPrint $Data
if ($after.Hash -ne $before.Hash -or $after.Count -ne $before.Count) {
    Bad ("the game folder changed while this ran: {0} files and {1} before, {2} and {3} after" -f `
         $before.Count, $before.Hash.Substring(0, 16), $after.Count, $after.Hash.Substring(0, 16))
} else {
    Ok ("the game folder is exactly as it was: {0} files, {1}" -f $after.Count, $after.Hash.Substring(0, 16))
}

# The json is written out by hand rather than with ConvertTo-Json, and there is
# no timestamp in it, so that the same game files give byte for byte the same
# file: ConvertTo-Json lays out Windows PowerShell 5.1 and PowerShell 7
# differently, and a rebuild that changed nothing would be a whole-file diff.
$doc = New-Object 'System.Collections.Generic.List[string]'
$doc.Add('{')
$doc.Add('  "builtBy": ' + (JsonStr 'scripts\dev\Build-RecipeTable.ps1') + ',')
$doc.Add('  "source": ' + (JsonStr ('every COBJ record across ' + $order.Count + ' plugins in load order, and the records their CNAM and BNAM point at')) + ',')
$doc.Add('  "language": ' + (JsonStr $LANGUAGE) + ',')
$doc.Add('  "readFrom": ' + (JsonStr 'BNAM is the workbench keyword, CNAM is the output item, NAM1 is how many it makes, COCT and CNTO are the inputs, CTDA is the conditions, which are in every row''s needs list') + ',')
$doc.Add('  "event": ' + (JsonStr 'mp.onCraft(actorFormId, craftedItemBaseId, count, recipeId). All four arguments are numbers. The keys of this table are desc strings, so look a row up with RECIPES_BY_ID[mp.getDescFromId(recipeId)] and never with recipeId itself, which matches nothing. Returning false refuses the craft outright: CraftEvent::OnFireSuccess is what removes the inputs and adds the output, and GameModeEvent::Fire only calls it when nobody blocked.') + ',')
$doc.Add('  "key": ' + (JsonStr 'the recipe''s form id in lower case hex, a colon, and the file it belongs to. mp.getDescFromId turns onCraft''s fourth argument into one.') + ',')
$doc.Add('  "rank": ' + (JsonStr 'which of classes.md''s four ranks the row asks for: novice, advanced, expert or master. Ranked by WHAT ITS INPUTS COST A PRODUCER, taking the dearest thing it asks for, because that is the rung somebody has to have reached before they could gather the makings at all. Where part of the list is produced by nobody, that dearest placed input is a FLOOR and not the answer: it can raise the row above what the output sells for and never lower it, because an item nothing produces is an unknown cost rather than a free one. A row whose inputs no class produces at all falls back to what the output sells for, ranked inside its own half. rankFrom says which of the three answered. classes.md sets no numbers for any of this and nothing in the game records ranks a recipe, so every judgement is a knob at the top of the script: RANK_FROM_INPUT_COST, PRODUCER_TABLES, SERVER_PRODUCERS, PRODUCER_RANK_IS_LOWEST, INPUT_RANK_IS_THE_DEAREST, UNPLACED_INPUT_RULE, RANK_SHARE and SECOND_RULE_KEY.') + ',')
$doc.Add('  "inputItems": ' + (JsonStr 'every CNTO the record carried: what the recipe wants, how many, and which class produces that item at which rank. producedBy is the class that gets it at the LOWEST rank, because that is what the thing costs to get hold of; alsoProducedBy, where it is present, is every OTHER class that produces the same item, at the rank that class produces it at, whether that is higher than producedAt or exactly level with it. A tied class was dropped from this field until 21 September, which made the farmer invisible for wheat in every consumer of this file. producedBy null means nothing in this repository hands that item over: no table in this folder and no verb in game\gamemode.js. Read out of the recipe''s own CNTO subrecords, eight bytes each, a form id then a count.') + ',')
$doc.Add('  "suppliedBy": ' + (JsonStr 'on each input beside producedBy, and a different question: producedBy is the class that digs it out of the ground, and suppliedBy is the class the input rests on however many benches away it is. Steel Ingot reads producedBy null and suppliedBy miner, because a smelter row makes it out of ore. hops is how many recipes stand between the class and the input, 0 for handed straight over and 1 for a smelter or a tanning rack away, and suppliedVia names the recipe of the last of those steps. suppliedBy null means nothing in this world supplies it at all, directly or through any bench: it is bought, looted or dropped. What ranks a row is suppliedAt and not producedAt.') + ',')
$doc.Add('  "theHop": ' + (JsonStr 'how suppliedBy is worked out. An input that is itself the output of a recipe costs what that recipe''s dearest input costs, taken over all 5116 recipes and not just the 3437 with an owner, because the smelter and the tanning rack are among the 1679 nobody owns. It is a fixpoint: every item starts unknown, every recipe is asked again each round, and a cost only ever moves from unknown to a rank or from a rank to a cheaper one, so it settles, and it settles in three rounds on this build. A recipe says nothing about its output while any part of its own list is unknown, for the reason written at UNPLACED_INPUT_RULE. A row that turns a finished good back into stock, a fur hood into a Steel Ingot, is a refund and not a source and sets nothing; 1072 rows have that shape.') + ',')
$doc.Add('  "inputsWithNoProducer": ' + (JsonStr 'how many of the row''s inputs nothing in this repository produces. Read it with inputRank: "the dearest input is novice" means one thing on a row where that is the whole list and another on a row with four unknowns beside it, and not reading it is how a 3100 gold dragonbone plate went out at novice on 21 September off one novice hunter''s fox pelt.') + ',')
$doc.Add('  "rankFrom": ' + (JsonStr 'which rule gave this row its rank: what its inputs cost a producer, what it sells for, or the second rule named in SECOND_RULE_KEY. The second rule is used for one half at a time and only where the first two leave a rung with nothing on it, and every use of it is printed by name when the table is built.') + ',')
$doc.Add('  "rankByValue": ' + (JsonStr 'what the old rule would have said: the rank this row got from the price of what it makes, inside its own half. Kept on every row so the two answers can be compared rather than one of them quietly replacing the other.') + ',')
$doc.Add('  "inputRank": ' + (JsonStr 'the rank of the dearest input this row asks for, and inputRankWho is the class that produces it. Null when nothing it asks for is produced by any class.') + ',')
$doc.Add('  "crossTier": ' + (JsonStr 'scripts\dev\Check-Balance.ps1 reads inputRank against rank and reports every half by how far its recipes sit from what their inputs cost, and reads alsoProducedBy to report every row ranked below a class that has to climb higher for something on its list. That is the imbalance Patrick asked about on 21 September, stated as a number. Both scripts print it; neither fails on it, because which of the two ladders should move is a decision.') + ',')
$doc.Add('  "rungsNobodyCanGatherFor": ' + (JsonStr 'on a half: a rung that holds recipes and not one of them can be gathered for at that rank, which is an empty rung wearing a label and is what the second rule can leave behind. Build-RecipeTable.ps1 fails the build for any half that has one and is not named in its HALVES_WITH_AN_UNSTANDABLE_RUNG knob with the measured reason, so a half carrying this field is one somebody decided to live with and wrote down.') + ',')
$doc.Add('  "rankedByInputCost": ' + (JsonStr 'on each half: how many of its rows the input cost rule could answer for and how many fell back to price, counted BEFORE any second rule ran. Where the half also carries a secondRule field, that rule then re-ranked every row of it, so read rankFrom on the row for what actually decided it.') + ',')
$doc.Add('  "family": ' + (JsonStr 'what kind of thing the row makes, which is how the recipe book in the K panel groups a half''s work. Read off the output record and nothing else: a keyword that names a kind, which is a weapon type keyword, one of the five armour slot keywords, a clothing slot keyword or a Gourmet food type keyword. An output carrying exactly one of those takes its name from it. An output carrying two names neither, because the Cloaks&Capes cloaks carry a helmet or cuirass slot beside a necklace slot and a cloak is none of those, so two kinds falls through with no kind at all to the record''s own type: AMMO is arrows and bolts, ARMO is other armour and clothing, and so on. familyFrom on every row says which of the three readings answered. classes.md sets none of this and names no families at all, so the groups and their words are knobs at the top of the script: FAMILY_ARMOR_SLOTS, FAMILY_KEYWORD_PREFIXES, FAMILY_KEYWORD_NOT, FAMILY_NAMES, FAMILY_BY_TYPE, FAMILY_OTHERWISE and FAMILY_SHARE_TO_WARN.') + ',')
$doc.Add('  "sisterHalf": ' + (JsonStr 'classes.md gives you the novice work of the other half of your own profession for nothing, and no further than novice. The gate can answer that because every row carries a rank.') + ',')
$doc.Add('  "needs": ' + (JsonStr 'the recipe''s own conditions, read out of its CTDA subrecords. An empty list means anybody standing at the bench can make it. serverSees false means the fork has no function for that condition and the server answers True, so the only thing enforcing it is the crafting menu on the machine in front of the person, which hides the recipe rather than refusing it.') + ',')
$doc.Add('  "default": ' + (JsonStr 'a recipe id this table does not carry is one nobody owns, and anybody may make it') + ',')
$doc.Add('  "movedFrom": ' + (JsonStr 'on a row its mod put at a bench its trade does not work at (TRADE_BENCHES, #3120): the bench keyword the mod put it at, and movedFromName its editor id. bench and benchName are where it is made now, its trade''s home bench. scripts\mods\Build-LastPlugin.py carries the move in Thornswood-Last.esp, or hands it to each person''s game for a plugin it never copies from.') + ',')
$doc.Add('  "fires": ' + (JsonStr 'false means the server is never asked about this recipe. CraftService::RecipeItemsMatch throws out the armour table (adb78) and the sharpening wheel (88108) before it considers anything, so tempering never reaches onCraft.') + ',')
$doc.Add('  "count": ' + ($owned.Count + $unowned.Count + $refusedRows.Count) + ',')
$doc.Add('  "owned": ' + $owned.Count + ',')
$doc.Add('  "unownedCount": ' + $unowned.Count + ',')
$doc.Add('  "refusedCount": ' + $refusedRows.Count + ',')

# Items a recipe asks for that nothing in the load order hands out. A recipe
# behind one of these is not gated, it is dead, and it is written down here so
# that the next person does not have to run this script to find out.
$doc.Add('  "itemsNothingHandsOut": {')
$on = 0
$orphanKeys = @()
foreach ($d in $wantedItems.Keys) { if (-not $wantedItems[$d].Found) { $orphanKeys += $d } }
foreach ($d in $orphanKeys) {
    $on++
    $comma = ','
    if ($on -eq $orphanKeys.Count) { $comma = '' }
    $w = $wantedItems[$d]
    $who = @()
    foreach ($x in $w.Wanters) { $who += (JsonStr $x) }
    $doc.Add('    ' + (JsonStr $d) + ': { "editorId": ' + (JsonStr $w.Edid) + ', "type": ' + (JsonStr $w.Type) +
             ', "recipesThatWantIt": [' + ($who -join ', ') + ']' +
             ', "searched": ' + (JsonStr 'every plugin in the load order, for a placed reference, a container or character inventory line, and a levelled list line. A record stored compressed, a Papyrus script or a quest alias would not be found by that search.') + ' }' + $comma)
}
$doc.Add('  },')

# The roster, and it is the whole roster. All eight professions of classes.md,
# the Mage among them with no halves, because this map is the only list of
# professions the file ships and a panel built from a list of seven would offer
# seven. offerInCharacterCreation is true on every one of them: nothing here is
# a reason to take a profession off the character creation panel.
$doc.Add('  "professions": {')
$pn = 0
foreach ($p in $PROFESSIONS.Keys) {
    $pn++
    $comma = ','
    if ($pn -eq $PROFESSIONS.Count) { $comma = '' }
    $halves = @()
    foreach ($h in $PROFESSIONS[$p]) { $halves += (JsonStr $h) }
    $halvesTxt = 'null'
    if ($halves.Count -gt 0) { $halvesTxt = '[' + ($halves -join ', ') + ']' }
    $craftsTxt = 'false'
    if ($PROFESSION_CRAFTS[$p].Crafts) { $craftsTxt = 'true' }
    $line = '    ' + (JsonStr $p) + ': { "halves": ' + $halvesTxt +
            ', "craftsAtAll": ' + $craftsTxt +
            ', "offerInCharacterCreation": true'
    if ($PROFESSION_CRAFTS[$p].Why) { $line += ', "why": ' + (JsonStr $PROFESSION_CRAFTS[$p].Why) }
    $doc.Add($line + ' }' + $comma)
}
$doc.Add('  },')

# One entry per half, with what it owns, what the server is asked about, what a
# character created this morning can actually make, and how those rows split
# across the four ranks. The counts and the cannotCraftYet map used to be two
# separate fields and neither could tell "this half does not craft" from "this
# half is broken", which is how a reader of the old field would have taken the
# Warrior out of character creation.
$doc.Add('  "halves": {')
$cn = 0
$keys = @()
foreach ($p in $PROFESSIONS.Keys) { foreach ($h in $PROFESSIONS[$p]) { $keys += ($p + '/' + $h) } }
foreach ($k in $keys) {
    $cn++
    $comma = ','
    if ($cn -eq $keys.Count) { $comma = '' }
    $prof = $k.Split('/')[0]
    $craftsTxt = 'true'
    $why = ''
    if ($HALVES_WITH_NO_RECIPES.Contains($k)) {
        $why = $HALVES_WITH_NO_RECIPES[$k].Why
        if (-not $HALVES_WITH_NO_RECIPES[$k].Crafts) { $craftsTxt = 'false' }
    } elseif (-not $PROFESSION_CRAFTS[$prof].Crafts) {
        $craftsTxt = 'false'
        $why = $PROFESSION_CRAFTS[$prof].Why
    }
    $byRank = '{}'
    if ($rankRows.ContainsKey($k)) {
        $bits = @()
        foreach ($rk in $RANKS) { $bits += ((JsonStr $rk) + ': ' + $rankRows[$k][$rk]) }
        $byRank = '{ ' + ($bits -join ', ') + ' }'
    }
    # The families this half makes, biggest first, with the rows the server is
    # actually asked about beside the rows there are. The book counts the
    # second number and only the second number, because a tempering row never
    # reaches onCraft and is not a thing a person opens a book to find.
    $famTxt = '{}'
    if ($famPerHalf.ContainsKey($k) -and $famPerHalf[$k].Count -gt 0) {
        $bits = @()
        foreach ($f in ($famPerHalf[$k].Keys | Sort-Object { -$famPerHalf[$k][$_] })) {
            $bits += ((JsonStr $f) + ': { "recipes": ' + $famPerHalf[$k][$f] +
                      ', "theServerIsAsked": ' + $famPerHalfFiring[$k][$f] + ' }')
        }
        $famTxt = '{ ' + ($bits -join ', ') + ' }'
    }
    $line = '    ' + (JsonStr $k) + ': { "recipes": ' + $perHalf[$k] +
            ', "theServerIsAsked": ' + $perHalfFiring[$k] +
            ', "families": ' + $famTxt +
            ', "canBeMadeOnDayOne": ' + $perHalfDayOne[$k] +
            ', "behindAVanillaPerk": ' + $perHalfPerk[$k] +
            ', "byRank": ' + $byRank +
            ', "rankedByInputCost": ' + $(if ($rankedByInputs.ContainsKey($k)) { $rankedByInputs[$k] } else { 0 }) +
            ', "rankedByPrice": ' + $(if ($rankedByValue.ContainsKey($k)) { $rankedByValue[$k] } else { 0 }) +
            ', "craftsAtAll": ' + $craftsTxt +
            ', "offerInCharacterCreation": true'
    if ($secondRuleUsed.Contains($k)) { $line += ', "secondRule": ' + (JsonStr $secondRuleUsed[$k]) }
    if ($oneRungFill.Contains($k)) {
        $line += ', "movedOneRung": ' + (JsonStr (('{0} row(s) moved one rung each to fill an empty rung, HOLE_FILL_MOVES_ONE_RUNG: ' -f @($oneRungFill[$k]).Count) + (@($oneRungFill[$k]) -join '; ')))
    }
    if ($unstandable.Contains($k)) {
        $line += ', "rungsNobodyCanGatherFor": ' + (JsonStr $unstandable[$k])
        if ($HALVES_WITH_AN_UNSTANDABLE_RUNG.Contains($k)) {
            $line += ', "andThatIsAllowedBecause": ' + (JsonStr $HALVES_WITH_AN_UNSTANDABLE_RUNG[$k])
        }
    }
    if ($why) { $line += ', "why": ' + (JsonStr $why) }
    if ($HALVES_NOBODY_CAN_START.Contains($k)) {
        $line += ', "nothingToMakeOnDayOne": ' + (JsonStr $HALVES_NOBODY_CAN_START[$k])
    }
    $doc.Add($line + ' }' + $comma)
}
$doc.Add('  },')

$doc.Add('  "recipes": {')
$n = 0
foreach ($desc in $owned.Keys) {
    $n++
    $comma = ','
    if ($n -eq $owned.Count) { $comma = '' }
    $r = $owned[$desc]
    $firesTxt = 'false'
    if ($r.Fires) { $firesTxt = 'true' }
    $dayOneTxt = 'false'
    if ($r.DayOne) { $dayOneTxt = 'true' }
    $needsTxt = '[]'
    if ($r.Needs.Count -gt 0) {
        $bits = @()
        foreach ($nd in $r.Needs) {
            $sees = 'false'
            if ($nd.ServerSees) { $sees = 'true' }
            # A HasSpell also says which spell record it is and which tomes
            # teach it (TOMES_TEACH_STAFF_SPELLS). Nothing else grows a field.
            $spellTxt = ''
            if ($nd.Func -eq $CONDITION_HAS_SPELL) {
                $tomeBits = @()
                foreach ($tm in @($nd.Tomes)) { $tomeBits += (JsonStr $tm) }
                $spellTxt = ', "ofDesc": ' + (JsonStr $nd.ParamDesc) + ', "taughtBy": [' + ($tomeBits -join ', ') + ']'
            }
            $bits += ('{ "asks": ' + (JsonStr $nd.Text) + ', "function": ' + $nd.Func +
                      ', "of": ' + (JsonStr $nd.Param) + ', "ofType": ' + (JsonStr $nd.ParamType) +
                      ', "serverSees": ' + $sees + $spellTxt + ' }')
        }
        $needsTxt = '[' + ($bits -join ', ') + ']'
    }
    $doc.Add('    ' + (JsonStr $desc) + ': { "editorId": ' + (JsonStr $r.Edid) +
             ', "out": ' + (JsonStr $r.OutDesc) + ', "name": ' + (JsonStr $r.OutName) +
             ', "type": ' + (JsonStr $r.OutType) + ', "makes": ' + $r.Count +
             ', "inputs": ' + $r.Inputs + ', "inputItems": ' + (InputsJson $r) + ', "worth": ' + $r.Value +
             ', "bench": ' + (JsonStr $r.BenchDesc) + ', "benchName": ' + (JsonStr $r.BenchName) +
             $(if ($r.PSObject.Properties['MovedFrom']) { ', "movedFrom": ' + (JsonStr $r.MovedFrom) + ', "movedFromName": ' + (JsonStr $r.MovedFromName) } else { '' }) +
             ', "owner": ' + (JsonStr $r.Owner) + ', "half": ' + (JsonStr $r.Half) +
             ', "race": ' + (JsonStr $r.Race) +
             ', "rank": ' + (JsonStr $r.Rank) +
             ', "family": ' + (JsonStr $r.Family) + ', "familyFrom": ' + (JsonStr $r.FamilyFrom) +
             ', "fires": ' + $firesTxt + ', "canBeMadeOnDayOne": ' + $dayOneTxt +
             ', "needs": ' + $needsTxt +
             ', "plugin": ' + (JsonStr $r.Plugin) +
             ', "nameFrom": ' + (JsonStr $r.NameFrom) +
             ', "why": ' + (JsonStr $r.Reason) +
             ', "rankFrom": ' + (JsonStr $r.RankFrom) +
             ', "rankByValue": ' + (JsonStr $r.RankByValue) +
             ', "inputRank": ' + $(if ($r.InputRank) { JsonStr $r.InputRank } else { 'null' }) +
             ', "inputRankWho": ' + $(if ($r.InputRankWho) { JsonStr $r.InputRankWho } else { 'null' }) +
             ', "inputsWithNoProducer": ' + $r.InputsUnplaced +
             ', "whyThatRank": ' + (JsonStr $r.RankWhy) +
             $(if ($r.PSObject.Properties['Book']) { ', "book": ' + (JsonStr $r.Book) } else { '' }) +
             $(if ($r.PSObject.Properties['Roll']) { ', "roll": ' + (JsonStr $r.Roll) } else { '' }) + ' }' + $comma)
}
$doc.Add('  },')

$doc.Add('  "refused": {')
$n = 0
foreach ($desc in $refusedRows.Keys) {
    $n++
    $comma = ','
    if ($n -eq $refusedRows.Count) { $comma = '' }
    $u = $refusedRows[$desc]
    $doc.Add('    ' + (JsonStr $desc) + ': { "editorId": ' + (JsonStr $u.Edid) +
             ', "out": ' + (JsonStr $u.OutDesc) + ', "name": ' + (JsonStr $u.OutName) +
             ', "type": ' + (JsonStr $u.OutType) + ', "benchName": ' + (JsonStr $u.BenchName) +
             ', "why": ' + (JsonStr $u.Why) + ' }' + $comma)
}
$doc.Add('  },')
$doc.Add('  "unowned": {')
$n = 0
foreach ($desc in $unowned.Keys) {
    $n++
    $comma = ','
    if ($n -eq $unowned.Count) { $comma = '' }
    $u = $unowned[$desc]
    $doc.Add('    ' + (JsonStr $desc) + ': { "editorId": ' + (JsonStr $u.Edid) +
             ', "out": ' + (JsonStr $u.OutDesc) + ', "name": ' + (JsonStr $u.OutName) +
             ', "type": ' + (JsonStr $u.OutType) + ', "benchName": ' + (JsonStr $u.BenchName) +
             ', "why": ' + (JsonStr $u.Why) + ' }' + $comma)
}
$doc.Add('  }')
$doc.Add('}')
# Joined with LF, as everything this writes is.
$jsonEol = $Eol
$json = ($doc -join $jsonEol) + $jsonEol

# A run that failed leaves the table it could not rebuild exactly as it was.
# Nothing is written until every check above has passed, for the same reason the
# spell table does it: a bad -Data left that one 240 bytes of nothing.
if ($fail -gt 0) {
    Bad ("{0} check(s) failed, so {1} was left exactly as it was" -f $fail, $Out)
} else {
    [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
    Ok ("wrote {0} ({1} owned, {2} unowned, {3} bytes)" -f $Out, $owned.Count, $unowned.Count, $json.Length)
}

# ----------------------------------------------------------- the literal ---
#
# Only the rows the server is actually asked about go in the block. A tempering
# recipe never reaches onCraft, and an unowned recipe is one anybody may make,
# so neither changes an answer. Leaving them out keeps a file that ships as one
# piece down to the rows that decide something.
$blockRows = New-Object 'System.Collections.Generic.List[string]'
foreach ($desc in $owned.Keys) {
    if (-not $owned[$desc].Fires) { continue }
    $r = $owned[$desc]
    # A row the cut file takes out of the open book goes in as a row nobody
    # makes, the way a refused row does, so the gate turns it down before it
    # asks about a half or a rank (see $CUT_FILE).
    if ($r.PSObject.Properties['Book'] -and $r.Book -eq 'cut') {
        $blockRows.Add('    ' + (JsonStr $desc) + ': { "out": ' + (JsonStr $r.OutDesc) + ', "name": ' + (JsonStr $r.OutName) +
                       ', "type": ' + (JsonStr $r.OutType) + ', "makes": ' + $r.Count +
                       ', "owner": "", "half": "", "race": ' + (JsonStr $r.Race) + ', "rank": "", "family": ""' +
                       ', "nobody": ' + (JsonStr $CUT_SENTENCE) + ' },')
        continue
    }
    $dayOneTxt = 'false'
    if ($r.DayOne) { $dayOneTxt = 'true' }
    # The spell a staff binds, on the rows that have one, for the gamemode's
    # staff gate (STAFF_SPELLS below). Every other row is unchanged.
    $spellTxt = ''
    $rowSpell = StaffSpellOf $r
    if ($rowSpell) { $spellTxt = ', "spell": ' + (JsonStr $rowSpell) }
    $blockRows.Add('    ' + (JsonStr $desc) + ': { "out": ' + (JsonStr $r.OutDesc) + ', "name": ' + (JsonStr $r.OutName) +
                   ', "type": ' + (JsonStr $r.OutType) + ', "makes": ' + $r.Count +
                   ', "owner": ' + (JsonStr $r.Owner) + ', "half": ' + (JsonStr $r.Half) +
                   ', "race": ' + (JsonStr $r.Race) +
                   ', "rank": ' + (JsonStr $r.Rank) + ', "family": ' + (JsonStr $r.Family) +
                   ', "open": ' + $dayOneTxt + $spellTxt +
                   $(if ($r.PSObject.Properties['Roll']) { ', "roll": ' + (JsonStr $r.Roll) } else { '' }) + ' },')
}

# THE STAFF SPELLS, the second block this script owns in game\gamemode.js
# (issue #967). Spell desc -> its name and every tome that teaches it, for each
# spell a staff recipe the server is asked about names in a HasSpell. The
# gamemode reads a tome off onReadBook against it and a staff off onCraft.
$staffSpells = [ordered]@{}
foreach ($desc in $owned.Keys) {
    $r = $owned[$desc]
    if (-not $r.Fires) { continue }
    foreach ($n in $r.Needs) {
        if ($n.Func -ne $CONDITION_HAS_SPELL -or -not $n.ParamDesc) { continue }
        if ($staffSpells.Contains($n.ParamDesc)) { continue }
        $sname = $n.Param
        if ($items.ContainsKey($n.ParamDesc) -and $items[$n.ParamDesc].Name) { $sname = $items[$n.ParamDesc].Name }
        $staffSpells[$n.ParamDesc] = [pscustomobject]@{ Name = $sname; Edid = $n.Param; Tomes = @($n.Tomes) }
    }
}
# THE SCHOOL AND RANK OF A STAFF SPELL (#1128). An Enchanter unlocks staff
# spells by rank, so each one needs its rank. Read the way the gamemode's spell
# tomes block reads a tome's spell: the SPEL's half cost perk, whose editor id
# names both (DestructionAdept50, AlterationNovice00), and failing that the
# highest minimum level among its effects of the five schools. Skyrim's levels
# to ranks as the rulebook sorts them: 0 Novice, 25 Apprentice and 50 Adept are
# Advanced, 75 Expert, 100 Master. The gamemode still prefers the rulebook's own
# rank for a spell its SPELLS lists.
$SPELL_AV_SCHOOL = @{ 18 = 'alteration'; 19 = 'conjuration'; 20 = 'destruction'; 21 = 'illusion'; 22 = 'restoration' }
$SPELL_PERK_WORD = @{ novice = 'novice'; apprentice = 'advanced'; adept = 'advanced'; expert = 'expert'; master = 'master' }
function StaffSchoolRank([string]$spellDesc) {
    if (-not $items.ContainsKey($spellDesc)) { return $null }
    $sp = $items[$spellDesc]
    if ($sp.Spit -and $items.ContainsKey($sp.Spit)) {
        $m = [regex]::Match([string]$items[$sp.Spit].Edid, '(alteration|conjuration|destruction|illusion|restoration)(novice|apprentice|adept|expert|master)', 'IgnoreCase')
        if ($m.Success) {
            return [pscustomobject]@{ School = $m.Groups[1].Value.ToLower(); Rank = $SPELL_PERK_WORD[$m.Groups[2].Value.ToLower()] }
        }
    }
    $best = $null
    foreach ($e in @($sp.Efids)) {
        if (-not $mgefs.ContainsKey($e)) { continue }
        $mg = $mgefs[$e]
        if (-not $SPELL_AV_SCHOOL.ContainsKey([int]$mg.Skill) -or $mg.Level -lt 0) { continue }
        if (-not $best -or $mg.Level -gt $best.Level) { $best = [pscustomobject]@{ School = $SPELL_AV_SCHOOL[[int]$mg.Skill]; Level = $mg.Level } }
    }
    if (-not $best) { return $null }
    $rk = 'novice'
    if ($best.Level -ge 100) { $rk = 'master' } elseif ($best.Level -ge 75) { $rk = 'expert' } elseif ($best.Level -ge 25) { $rk = 'advanced' }
    return [pscustomobject]@{ School = $best.School; Rank = $rk }
}
$staffTaught = 0
$staffUntaught = New-Object 'System.Collections.Generic.List[string]'
$staffUnranked = New-Object 'System.Collections.Generic.List[string]'
$staffByRank = [ordered]@{ novice = 0; advanced = 0; expert = 0; master = 0 }
foreach ($k in $staffSpells.Keys) {
    if ($staffSpells[$k].Tomes.Count -gt 0) { $staffTaught++ }
    else { $staffUntaught.Add(('{0} ({1}, {2})' -f $staffSpells[$k].Name, $staffSpells[$k].Edid, $k)) }
    $sr = StaffSchoolRank $k
    $staffSpells[$k] | Add-Member -NotePropertyName School -NotePropertyValue $(if ($sr) { $sr.School } else { $null }) -Force
    $staffSpells[$k] | Add-Member -NotePropertyName Rank -NotePropertyValue $(if ($sr) { $sr.Rank } else { $null }) -Force
    if ($sr) { $staffByRank[$sr.Rank] = $staffByRank[$sr.Rank] + 1 }
    else { $staffUnranked.Add(('{0} ({1}, {2})' -f $staffSpells[$k].Name, $staffSpells[$k].Edid, $k)) }
}
Write-Host ''
Write-Host 'the staff spells' -ForegroundColor Cyan
Ok ("{0} spell(s) named by staff recipes, {1} of them taught by a tome" -f $staffSpells.Count, $staffTaught)
Ok ("ranks read out of the records: novice {0}, advanced {1}, expert {2}, master {3}" -f $staffByRank['novice'], $staffByRank['advanced'], $staffByRank['expert'], $staffByRank['master'])
if ($staffUntaught.Count -gt 0) {
    Note ("{0} no tome teaches, so only an Enchanter can unlock them:" -f $staffUntaught.Count)
    foreach ($u in $staffUntaught) { Note ('    ' + $u) }
}
if ($staffUnranked.Count -gt 0) {
    Loud ("{0} have no school and rank the records say, so nobody can unlock them:" -f $staffUnranked.Count)
    foreach ($u in $staffUnranked) { Note ('    ' + $u) }
}
$staffLines = New-Object 'System.Collections.Generic.List[string]'
$staffLines.Add('  /* Built by scripts\dev\Build-RecipeTable.ps1 out of the game''s own records. Do not hand edit.')
$staffLines.Add('     ' + $staffSpells.Count + ' spells a staff recipe binds, ' + $staffTaught + ' of them taught by a spell tome.')
$staffLines.Add('     Spell desc -> its name, its school and rank read out of the records (#1128; null when they cannot be),')
$staffLines.Add('     and every BOOK record whose teaches spell flag names it. */')
$staffLines.Add('  var STAFF_SPELLS = {')
$sn = 0
foreach ($k in $staffSpells.Keys) {
    $sn++
    $comma = ','
    if ($sn -eq $staffSpells.Count) { $comma = '' }
    $tb = @()
    foreach ($tm in $staffSpells[$k].Tomes) { $tb += (JsonStr $tm) }
    $schTxt = 'null'
    if ($staffSpells[$k].School) { $schTxt = JsonStr $staffSpells[$k].School }
    $rkTxt = 'null'
    if ($staffSpells[$k].Rank) { $rkTxt = JsonStr $staffSpells[$k].Rank }
    $staffLines.Add('    ' + (JsonStr $k) + ': { "name": ' + (JsonStr $staffSpells[$k].Name) + ', "school": ' + $schTxt +
                    ', "rank": ' + $rkTxt + ', "tomes": [' + ($tb -join ', ') + '] }' + $comma)
}
$staffLines.Add('  };')
# And the refused rows, which carry a sentence instead of an owner. The gate
# reads nobody before it reads anything else, so these never reach a question
# about profession or rank: there is no rank at which a nail becomes useful.
foreach ($desc in $refusedRows.Keys) {
    $r = $refusedRows[$desc]
    $nobodyWhy = $r.Why
    if ($r.PSObject.Properties['Cut'] -and $r.Cut) { $nobodyWhy = $CUT_SENTENCE }
    $blockRows.Add('    ' + (JsonStr $desc) + ': { "out": ' + (JsonStr $r.OutDesc) + ', "name": ' + (JsonStr $r.OutName) +
                   ', "type": ' + (JsonStr $r.OutType) + ', "makes": 1' +
                   ', "owner": "", "half": "", "race": "", "rank": "", "family": ""' +
                   ', "nobody": ' + (JsonStr $nobodyWhy) + ' },')
}
if ($blockRows.Count -gt 0) {
    $last = $blockRows[$blockRows.Count - 1]
    $blockRows[$blockRows.Count - 1] = $last.Substring(0, $last.Length - 1)
}

# Which rule decided the rank of the rows that actually ship in the block. The
# generated comment states it as a count rather than as a claim, because the
# hand written paragraph it replaces went on describing the price rule for a
# day after the price rule had stopped being the rule.
$ruleInput = 0
$rulePrice = 0
$ruleSecond = 0
$ruleMoved = 0
foreach ($desc in $owned.Keys) {
    if (-not $owned[$desc].Fires) { continue }
    $rf = [string]$owned[$desc].RankFrom
    if ($rf.StartsWith('the second rule')) { $ruleSecond++ }
    elseif ($rf.StartsWith('moved one rung')) { $ruleMoved++ }
    elseif ($rf.StartsWith('what its inputs cost')) { $ruleInput++ }
    else { $rulePrice++ }
}
$secondRuleHalves = @($secondRuleUsed.Keys)

$lines = New-Object 'System.Collections.Generic.List[string]'
$lines.Add('  /* Built by scripts\dev\Build-RecipeTable.ps1 out of the game''s own records. Do not hand edit.')
$lines.Add('     ' + $blockRows.Count + ' crafting recipes, out of ' + ($owned.Count + $unowned.Count) + ' in game\data\recipes.json.')
$lines.Add('')
$lines.Add('     Recipe desc -> what it makes, what kind of record that is, how many it')
$lines.Add('     makes, which profession and which half of it owns the recipe, and which')
$lines.Add('     of classes.md''s four ranks it asks for. Returning false from onCraft')
$lines.Add('     refuses the craft and the person keeps their materials.')
$lines.Add('')
$lines.Add('     THE KEY IS A DESC AND onCraft HANDS YOU A NUMBER. All four arguments of')
$lines.Add('     mp.onCraft(actorFormId, craftedItemBaseId, count, recipeId) are numbers,')
$lines.Add('     and every key in here is a string like "f61:Skyrim.esm". So:')
$lines.Add('')
$lines.Add('         var row = RECIPES_BY_ID[mp.getDescFromId(recipeId)];')
$lines.Add('')
$lines.Add('     RECIPES_BY_ID[recipeId] is undefined for every row in this block, which')
$lines.Add('     is a gate that refuses nothing and says nothing while it does it.')
$lines.Add('')
$lines.Add('     rank is what to compare the character''s rank in that half against.')
$lines.Add('     classes.md also gives somebody the novice work of the other half of')
$lines.Add('     their own profession and no further, so a row whose half is the sister')
$lines.Add('     half passes at rank novice and nowhere above it.')
$lines.Add('')
$lines.Add('     WHAT SETS THAT RANK IS WHAT THE RECIPE COSTS THE PERSON WHO GATHERS FOR')
$lines.Add('     IT, and not what it sells for. The rank is the rank of the dearest thing')
$lines.Add('     on its list, at the rung the class that produces that thing has to have')
$lines.Add('     reached. Where part of the list is produced by nobody, that is a floor')
$lines.Add('     and what the output sells for can hold the row higher; where none of it')
$lines.Add('     is, the price ranks it inside its own half. On this build that is')
$lines.Add('     ' + $ruleInput + ' row(s) by what their inputs cost, ' + $rulePrice + ' by price and ' + $ruleSecond + ' by how long')
$lines.Add('     the shopping list is. That last rule is used for a whole half at a time')
if ($secondRuleHalves.Count -gt 0) {
    $lines.Add('     and only where the first two leave a rung with nothing on it, which here')
    $lines.Add('     is ' + ($secondRuleHalves -join ', ') + '. A rank there means how long the list is and')
    $lines.Add('     nothing else, and the half says so in game\data\recipes.json.')
} else {
    $lines.Add('     and only where the first two leave a rung with nothing on it, which no')
    $lines.Add('     half in this build did.')
}
if ($ruleMoved -gt 0) {
    $lines.Add('     ' + $ruleMoved + ' more row(s) were moved one rung, and no further, to fill an empty')
    $lines.Add('     rung without the second rule: ' + (@($oneRungFill.Keys) -join ', ') + '.')
}
$lines.Add('     Every row carries rankFrom in game\data\recipes.json saying which of the')
$lines.Add('     three answered for it. Nothing in here is the script''s opinion of what a')
$lines.Add('     thing is worth: classes.md sets no numbers for any of it, and every')
$lines.Add('     judgement is a named knob at the top of the script that wrote this.')
$lines.Add('')
$lines.Add('     family is what kind of thing the row makes, and it is what the recipe')
$lines.Add('     book in the K panel groups a half''s work by, because Patrick asked for')
$lines.Add('     the book not to be very specific and a tailor owns hundreds of')
$lines.Add('     garments. It is read off the output record: a weapon type keyword, one')
$lines.Add('     of the five armour slot keywords, a clothing slot keyword or a Gourmet')
$lines.Add('     food type keyword. An output naming two kinds names none and falls to')
$lines.Add('     its record type with the ones naming none at all. game\data\recipes.json')
$lines.Add('     carries familyFrom on every row saying which reading answered, and')
$lines.Add('     this build has ' + $famRows.Count + ' families across the whole table.')
$lines.Add('')
$lines.Add('     open is true when the recipe carries no condition of its own. A row')
$lines.Add('     with open false needs something first, an item, a spell or a vanilla')
$lines.Add('     perk nobody here can hold, and Skyrim''s own crafting menu decides that')
$lines.Add('     before the server is ever asked. game\data\recipes.json says which.')
$lines.Add('     A staff whose one condition is a spell some tome teaches is open too:')
$lines.Add('     the tome is how an Enchanter learns it, and spell names that spell''s')
$lines.Add('     desc for the staff gate, which reads STAFF_SPELLS below.')
$lines.Add('')
$lines.Add('     A recipe id that is not in here is one nobody owns and anybody may')
$lines.Add('     make. Tempering is not in here either: the server is never asked about')
$lines.Add('     it, because CraftService throws the armour table and the sharpening')
$lines.Add('     wheel out before it looks at a recipe. game\data\recipes.json carries')
$lines.Add('     every row, owned and unowned, with the reason for each. */')
$lines.Add('  var RECIPES_BY_ID = {')
foreach ($row in $blockRows) { $lines.Add($row) }
$lines.Add('  };')
$literal = $lines -join [Environment]::NewLine

# ---------------------------------------------------------------- install --
#
# The gamemode reads both tables from game\gamemode-tables\RECIPES_BY_ID.json
# and STAFF_SPELLS.json when it loads (#5191): until then this wrote them
# between markers in gamemode.js, the comment over each with them, and every
# content change rewrote the same lines there. What each field means is
# written over `var RECIPES_BY_ID = table(...)` in the gamemode and in the
# comment printed below; the counts are in game\data\recipes.json.
# -NoInstall prints them and leaves the files alone.
if (-not $NoInstall -and $fail -eq 0) {
    . (Join-Path $PSScriptRoot 'GamemodeTables.ps1')
    # Every row is written with a comma after it, as a JavaScript object took
    # them; JSON takes none after the last.
    $rowText = ($blockRows -join "`n").TrimEnd().TrimEnd(',')
    $changed = Write-GamemodeTable 'RECIPES_BY_ID' ('{' + $rowText + '}')
    if ($changed) { Ok ("wrote {0} recipes into {1}" -f $blockRows.Count, (Get-GamemodeTableFile 'RECIPES_BY_ID')) }
    else { Ok ("{0} already holds these {1} recipes" -f (Get-GamemodeTableFile 'RECIPES_BY_ID'), $blockRows.Count) }
    # The staff spells: the rows between the var line and the closing brace.
    $at = $staffLines.IndexOf('  var STAFF_SPELLS = {')
    $staffRows = @($staffLines | Select-Object -Skip ($at + 1) | Select-Object -First ($staffLines.Count - $at - 2))
    $changed = Write-GamemodeTable 'STAFF_SPELLS' ('{' + ($staffRows -join "`n") + '}')
    if ($changed) { Ok ("wrote {0} staff spells into {1}" -f $staffSpells.Count, (Get-GamemodeTableFile 'STAFF_SPELLS')) }
    else { Ok ("{0} already holds these {1} staff spells" -f (Get-GamemodeTableFile 'STAFF_SPELLS'), $staffSpells.Count) }
}

Write-Host ''
Write-Host ("the block, ready to install: {0} recipes, {1} lines" -f $blockRows.Count, $lines.Count) -ForegroundColor Cyan
$head = [Math]::Min($lines.Count, 24)
for ($z = 0; $z -lt $head; $z++) { Write-Host $lines[$z] }
if ($lines.Count -gt $head) { Note ("... and {0} more lines. -JsOut writes the whole block to a file." -f ($lines.Count - $head)) }
if ($JsOut) {
    [System.IO.File]::WriteAllText($JsOut, $literal + [Environment]::NewLine + ($staffLines -join [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ''
    Ok "wrote $JsOut"
}

Write-Host ''
if ($fail) {
    Write-Host "$fail check(s) failed. Read those before the table ships." -ForegroundColor Red
    exit 1
}
Write-Host ("the table is complete: {0} recipes, {1} of them owned by a half of a profession, {2} the server is asked about." -f ($owned.Count + $unowned.Count + $refusedRows.Count), $owned.Count, $blockRows.Count) -ForegroundColor Green
if ($refusedRows.Count) {
    Write-Host ("nobody makes {0} of them, and the gate says why:" -f $refusedRows.Count) -ForegroundColor Yellow
    foreach ($desc in $refusedRows.Keys) { Write-Host ('    ' + $refusedRows[$desc].OutName + '  (' + $refusedRows[$desc].BenchName + ')') -ForegroundColor DarkGray }
}
