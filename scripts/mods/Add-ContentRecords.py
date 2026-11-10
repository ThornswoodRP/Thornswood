"""
Add-ContentRecords.py

Writes Thornswood-Content.esp's records: every record of Thornswood's own from
the numbers in this script, the overrides of Bethesda's records it carries, and
the cells and worldspaces its placements stand in from Bethesda's own records,
and the placements of Thornswood's kilns, salt quarries, hives and labs from
game\\data\\station-sites.json. Since #2553 nothing in it is the salvaged
plugin's (see THE SALVAGED RECORDS, REMADE, and WHERE THE STATIONS STAND,
below).

THE SALVAGED RECORDS, REMADE (#2553)

Until #400 the plugin's header said its crafting and gathering records were
salvaged from another server's plugin, and no permission from that server's
makers is recorded. Patrick, 15 October 2026, option B on #2177: the salvaged
records are remade as Thornswood's own and the salvaged ones removed.
scripts\\mods\\List-SalvagedRecords.py lists them in
scripts\\mods\\content-salvaged.json, with what became of each:

  remade    the two keywords, the kiln, the alchemy lab, the salt quarry, the
            beehive, the notice board, the four grades of charcoal, their four
            recipes, the pickaxe and the axe. Each is written below from
            Thornswood's rulebook and pointers to Bethesda's own records, its
            form id and editor id kept because the gamemode, the tables and
            the saves name them. Six recipes come out the bytes the plugin
            held, because every field of them is a fact the rulebook states
            (the Charburner and Edgewright pages); the register says which.
  dropped   the other server's placements: its 57 of Thornswood's kiln (8),
            salt quarry (11), hive (13) and alchemy lab (25) at the spots it
            chose, which went on Patrick's A of 16 October when Thornswood
            stood its own; Skyrim's own objects put where it chose and notice
            boards placed switched off; its changes to Skyrim's own
            placements (80 switched off, 32 moved, turned or resized, 3
            relinked, 4 that change nothing); the cells and worldspaces left
            holding nothing of Thornswood's; and a chest of ore nothing names.
  Bethesda's  the salvaged cells and worldspaces a station Thornswood places
            stands in, each written from the winning master's own record by
            Build-LastPlugin.py's copier, never the salvaged copy.

WHERE THE STATIONS STAND (#2553)

Patrick, 16 October 2026, A on #2553: Thornswood measures its own spots for
its kilns, salt quarries, hives and labs, the way the woodworking benches were
placed, and this plugin places them. scripts\\dev\\Build-StationSites.py
measures each spot over the whole load order into game\\data\\station-sites.json
(docs\\systems\\station-placement.md says the rule for each kind); this writes
one placement for each row, its base, its point and its turn and nothing
else, in the cell the row names, under the form id the row gives. A cell or
worldspace a placement needs and the plugin does not carry yet is copied from
the winning master's own record, which needs --masters the first time; the
builder has already refused any spot whose cell a mod changes, so the copy
changes nothing in the game. The placements' form ids start at 0x05015500,
which no version of this plugin ever used, so no change form a save holds for
an old placement can land on a new one.

Before #2553 most of Thornswood's own items here were clones of the salvaged
charcoal and its recipe; they are written from their own numbers now as well.
The tool refuses to write a plugin that holds any salvaged record the
register does not keep, by its bytes under any editor id, or by its form id
for one that left before #2553 (the skill manuals, the Execution Block).
tests\\test-2553-salvaged-gone.js holds the committed plugin to the register.

WHY

Patrick, 21 September: "the woodworker should be able to make handles that the
smith needs for Pickaxes, Shovels, Axes and other items that have wooden handles
like that", on top of "axes, pickaxes and shovels can eventually break and you
have to get a new one from a smith making them".

A tool that breaks has to be replaceable, and the only honest replacement is one
somebody made. Two of the three already are: ThornswoodRecipeWeaponPickaxe and
ThornswoodRecipeWeaponAxe ship in this plugin, both Smith/Edgewright, one iron
ingot each at a forge. The shovel had no recipe at all, so the sentence a farmer
reads when their shovel snaps was not true for them. And nothing anywhere needed
a woodworker, so a smith could make every tool in the game on their own.

So this adds:

    ThornswoodRecipeKeyMold       one iron ingot into a blank key mold.
    ThornswoodRecipeKey           one iron ingot into a key. Since #2487 it carries
                                  NEVER_TRUE, so no forge lists it: a key is cut
                                  and named by the server at the forge's lock key.
                                  Kept, not deleted, so its form id stays taken.
                                  Before that: named server side
                                  for whichever stamped mold is in the pack.

                                  Both added 23 September, at a forge. The
                                  property system's two items had no maker:
                                  the only mold in the world was conjured by
                                  /mold at a door, so the ceremony had to
                                  happen before the object existed and a smith
                                  on their own could never reach a key.
                                  Patrick: "you make a mold, mold gets used on
                                  door to assign mold to the door, than key
                                  uses that mold during crafting to make a key
                                  to specifically that house and it can be
                                  reused".

    ThornswoodMiscToolHandle      the handle itself. A MISC on Skyrim's own
                                  charcoal stick,
                                  Clutter\\Quest\\TG06CharcoalStick.nif: a stick,
                                  which is what a handle looks like. No new mesh
                                  has to ship.
    ThornswoodRecipeToolHandle    the woodworker turns firewood into handles.
    ThornswoodRecipeToolShovel    the smith makes the shovel that had no recipe.

and edits ThornswoodRecipeWeaponPickaxe and ThornswoodRecipeWeaponAxe so that
both of them want a handle as well as the ingot. After this, no tool in the game
exists without a woodworker and a smith between them.

WHICH BENCH THE HANDLE IS MADE AT, AND THE ONE THAT WAS TRIED FIRST

The handle is made at the charcoal kiln, which is a bench woodworkers already
stand at. The sister half rule means a Woodwright gets the novice work of the
Charburner for nothing, so both halves can cut handles.

WHAT WAS TRIED AND TAKEN BACK OUT, because it is worth somebody not trying it
again. The first attempt overrode all three of Skyrim's chopping block FURN
records, turning WBDT from 00ff, not a bench, to 01ff, the create-object bench
the cooking pot and the tanning rack use, so that every chopping block in the
province became a crafting table. Patrick, the same day: "The chopping block
shouldn't be a bench just for getting the firewood and not usable by non
woodworkers and also have the animation script". So the records are Bethesda's
and untouched, and the chopping block is answered server side in gamemode.js by
chopWood instead: the Woodwright's verb, axe required, firewood out.

THE EXECUTION BLOCK, TAKEN OUT OF SOLITUDE (issue #400)

Since #2553 the step that took it out is gone from this tool: the block and
its placement are salvaged records the register says left before #2553, so the
tool refuses a plugin that carries either again. What follows is why it went.

The plugin came from another server, and the last trace of that server's name
in it was a script: FURN 0x05DF7B34, ThornswoodExecutionerChoppingBlock, the
headsman's block placed once in Solitude (REFR 0x05DFCC75), carried a VMAD
attaching the other server's chopping script, named with its prefix, with one
property pointing at Skyrim.esm's executioner swing, IDLE 0x0F95BE. That
script was never in C:\\Thornswood\\Game, the
Steam copy or any pack, measured 20 and 24 September, so it has never run for
anybody here. It is the headsman's block, not a woodcutting one: firewood comes
from the three vanilla chopping blocks, answered server side by chopWood.

Patrick, 28 September, given scenery, the executioner's swing, or removal:
"3. Take it out of Solitude." So this takes the placed reference out of its
cell and, because nothing else points at it, the block's base record as well.
The script goes with it.

WHY REMOVED AND NOT FLAGGED INITIALLY DISABLED AND DELETED. The usual way to
take a reference out of the world is to mark it Initially Disabled, and the
xEdit habit of "undelete and disable" exists for one case: a reference that
belongs to a MASTER, which other plugins may point at, where removing the
override would bring the master's copy back and deleting it outright crashes
anything that still names it. Neither applies here. Both records belong to
this plugin (the 05 at the front of both ids is this file, after its five
masters), no plugin in the game folder lists this one as a master (104 read,
28 September), and nothing in this file or the gamemode names either id. So
the records simply stop existing, which is what Skyrim sees for a form that
was never added, and what an editor does when it removes a record a plugin
itself added. The server's reader (engine\\skymp, WorldState::AttachEspmRecord)
would skip a reference flagged 0x800 or 0x20 as well; it walks groups by their
size fields, which this rewrites, so it reads the smaller file the same way. A
change form the server may have saved for that reference is kept aside and
never loaded (LoadChangeForm defers a form id the plugin does not create, and
skips one whose base is gone), so nothing has to be cleaned out of a save.

THE HEADER'S DESCRIPTION (issue #400, Patrick, 12 October)

The plugin's header carries a description (SNAM), which Vortex and other mod
tools show beside the plugin. Until 12 October it still said the content was
salvaged from the other server, by that server's full name, and was out of
date besides. Patrick's answer B on #400: the description says what the plugin
is for Thornswood, the salvaged records stay, and the other server's name is
mentioned nowhere. So this writes the description into the header, changing
only that subrecord and the header's size, and refuses to write a file whose
header or any record still carries the other server's full name.

Since #2993 the description is built from the records the written plugin
holds. Until then it was one sentence typed into this script, and nothing held
it to the plugin: on 21 October it still listed the skill manuals, which left
on 21 September, and named neither the woodworking bench, the furniture, the
teas, the well and water buckets nor the burnt and fine meals, all added since.
Now each kind of record has a row in CONTENTS with the words that name it. A
row whose records have all left drops out of the description by itself, and a
record no row names stops the tool, so whoever adds a new kind of record says
in the same change how the header names it.

If something ever does point at the base record, the tool keeps the base,
takes only its script off as before, says what points at it, and still takes
the placed reference out. If something points at the placed reference, it
stops and writes nothing.

WHAT IT PROVES BEFORE IT WRITES

The same discipline as Remove-DeadRecords.ps1 and Remove-DeadConditions.py,
whose parser this shares. It serialises the file back
byte for byte before it edits anything. Afterwards it checks that every record
that was there is still there, apart from the ones it was asked to take out, in
the same order, with the same form id, type and flags; that the ones taken out
are gone; that every record it was not asked to touch has the bytes it started with;
that the new records parse back to exactly what was built; that no form id it
allocates is already taken; that the header's record count matches what is
actually in the file; that neither the other server's full name nor either of
its short forms is in the header or in any record's editor id, attached script
or text, and its full name and longer short form in no record's bytes at all,
compressed records included; and that the header changed in its description
and its record count and nowhere else.

It will not touch a compressed record, and it refuses to add a record whose
editor id is already in the file, because two records with one name is the kind
of thing that is found months later.

THE THREE REPAIR KITS (issue #1384)

docs/systems/durability.md: a worn piece is mended with a kit, not at the
grindstone and not at the armour table. Patrick, 4 October, asked for a
suggested recipe for each, written on that page. Cheap, every input from
Skyrim.esm, and every input something a class already supplies at novice,
so the half that makes the kit can get its makings on day one:

    ThornswoodMiscWeaponKit       the Weapon Kit, a MISC.
    ThornswoodMiscArmorKit        the Armor Kit, a MISC.
    ThornswoodMiscSewingKit       the Sewing Kit, a MISC.
    ThornswoodRecipeWeaponKit     1 iron ingot and 1 leather strips, at a forge.
                                  Smith, Edgewright.
    ThornswoodRecipeArmorKit      1 iron ingot and 1 leather, at a forge.
                                  Smith, Platewright.
    ThornswoodRecipeSewingKit     1 tundra cotton and 1 leather strips, at a
                                  tanning rack. Tailor, Haberdasher.

The owner and the half are not readable off a MISC at a forge or a tanning
rack, so all three are named in records/recipe-owners.json (RECIPE_OWNER
in scripts/dev/Build-RecipeTable.ps1), the same as the key mold. The rank is the
dearest input, which is novice for all three.

The Sewing Kit was offered as linen wrap and leather strips. Linen wrap is
supplied by no class in this world (game/data/recipes.json says suppliedBy
null for it, measured 4 October), so a Haberdasher could never get one.
Tundra cotton is a gatherer's at novice and is already on the crude pole.
The tanning rack, not the loom, because the loom's keyword is a mod's record
(MCE_CraftingLoom, 6ce000:Update.esm) and these recipes name only Skyrim.esm.

All three MISC records wear Skyrim's charcoal stick, like the handle, so no
new mesh has to ship.

THE FOUR TREATMENTS (issue #1383)

docs/systems/injury.md: a bandage stops a bleed, a splint holds a break, a
poultice cuts the wound fever chance, and a physicker's remedy closes a cut
and clears one ordinary disease. Patrick, 4 October, settled who makes each:
a bandage is a Haberdasher novice recipe at the loom, a splint a Woodwright
novice recipe at the kiln, and the poultice and the remedy Physicker recipes,
novice and advanced. What each one asks for was not said, so these are the
suggested recipes on #1383, every input something a class supplies, the rank
the dearest of them:

    ThornswoodMiscBandage         the Bandage, a MISC.
    ThornswoodMiscSplint          the Splint, a MISC.
    ThornswoodMiscPoultice        the Poultice, a MISC.
    ThornswoodMiscRemedy          the Physicker's Remedy, a MISC.
    ThornswoodRecipeBandage       1 tundra cotton, at the loom. Tailor,
                                  Haberdasher. Novice: a gatherer's cotton.
    ThornswoodRecipeSplint        1 firewood and 1 leather strips, at the kiln.
                                  Woodworker, Woodwright. Novice: the
                                  woodworker's firewood, the hunter's leather.
    ThornswoodRecipePoultice      1 tundra cotton and 1 garlic, at the alchemy
                                  lab. Alchemist, Physicker. Novice: both a
                                  gatherer's at novice.
    ThornswoodRecipeRemedy        1 mudcrab chitin and 1 blue mountain flower,
                                  at the alchemy lab. Alchemist, Physicker.
                                  Advanced: the flower is a gatherer's at
                                  advanced, and the chitin cures disease.
    ThornswoodRecipePotion...     the ten potions the dungeon pile used to pay,
                                  at the alchemy lab. Alchemist, Physicker
                                  (#3470, THE PHYSICKER'S POTIONS below).

THE LOOM IS A MOD'S BENCH, AND THIS PLUGIN CAN STILL NAME IT. The loom's
keyword is MCE_CraftingLoom, which MoreCraftableEquipment.esp injects into
Update.esm's own numbering as 0x6CE000 (game/data/recipes.json reads it as
6ce000:Update.esm, and the gamemode's TWO_HANDS and BENCH_ACCESS key it the
same way). Update.esm is this plugin's master 01, so 0x016CE000 here is that
keyword, with no new master. The repair kits stayed off the loom because
they named only Skyrim.esm; Patrick asked for the bandage at the loom.

THE ALCHEMY LAB IS THIS PLUGIN'S OWN. ThornswoodCraftingAlchemyWorkbench
(FURN 0x5042E69) is a create-object bench, WBDT 01 10, placed in the apothecary
of each hold capital (WHERE THE STATIONS STAND, above), and carries ThornswoodCraftingAlchemy (KYWD 0x5042E6B), which no recipe named
until now. Skyrim's own alchemy lab cannot show a recipe at all: it brews from
the effects ingredients share. So the physicker's two are made at this one.

The owner and the half are named in records/recipe-owners.json (RECIPE_OWNER
in scripts/dev/Build-RecipeTable.ps1), because none of the four can be read off a
MISC at these benches. All four MISC records wear Skyrim's charcoal stick,
like the kits, so no new mesh has to ship.

THE HEARTHFIRE HOUSE PARTS, TAKEN OFF THE FORGE (issue #2258)

Patrick, 25 September: house parts show as craftable "instead of not
existing". Nobody builds a Hearthfire house here: property is a deed and a key
cut from a mold. The server already refuses the four (the 'nobody' rows of
$NOBODY_MAKES in scripts/dev/Build-RecipeTable.ps1, carried into the gamemode's
recipe table), but the forge menu still lists them, because a menu entry is
read on the machine in front of the person from the record, and no server code
reaches it.

So this plugin overrides the four HearthFires.esm recipes, BYOHRecipeNails,
BYOHRecipeHinge, BYOHRecipeLock and BYOHRecipeFittings, and gives each a
condition that is never true: GetItemCount of gold, on the person at the bench,
less than 0. Nobody carries less than no gold, so Skyrim's crafting menu never
lists them, and the server, which has GetItemCount (condition_functions in the
fork), turns the craft down on its own account too if a client ever asks.
Nothing else on the records changes: the same inputs, output, bench and count,
so the override is the record Bethesda wrote plus one line.

The first time, the records are read out of HearthFires.esm in the game's Data
folder (--masters), and their form ids are written in this plugin's numbering
(HearthFires.esm is its master 03 and its own records are 02 in its own file).
Once they are in this plugin, a later run edits them where they are and needs
no game. No later plugin in the load order overrides them (read 11 October
across the main install's load order), so this override is the one that wins.

The other way, the one Collapse-DwarvenIngots.py took for #613, is to drop the
BNAM so no bench lists the recipe. The condition is used here because it keeps
the bench on the record, which is what recipes.json and the gamemode read as
the recipe's bench, and because the server then refuses it too.

THE MASTER KEY (issue #2254)

    ThornswoodMiscMasterKey       one MISC, named per instance in the pack:
                                  "Master key to Breezehome, no. 12". Handed
                                  with the deed at a claim and cut again at a
                                  forge by the server, so no recipe. On the
                                  key's mesh, weightless, worth nothing.

THIS IS A SHIPPED FILE, so its size changing means a release and every client
downloading it again.

THE WOODWORKING BENCH (#516)

Patrick, 12 October 2026: bows, arrows, instruments and fishing poles listed at
the forge are a woodworker's job. Trade ownership was already correct; the forge
menu is wrong because each COBJ's BNAM is still CraftingSmithingForge.

(A) This plugin gets its own woodworking bench: keyword
ThornswoodCraftingWoodworking and furniture ThornswoodCraftingWoodworkingWorkbench,
wearing Hearthfire's carpenter workbench mesh so no new art ships. The 26 recipes
this plugin can already reach (six Skyrim bows, twelve Dawnguard bows/arrows/bolts,
four Dragonborn bows/arrows, and our own three poles plus the fish trap) have their
BNAM pointed at that keyword. The charcoal kiln is not used until #2337 is fixed.

(i) The other 53 rows live in plugins that load after this one (or that would force
a master renumber if added here). Their live ones are moved to the woodworking bench
by Thornswood-Last.esp, which loads after them all: Build-RecipeTable.ps1 names the
rows of a trade at a bench it does not work at, and Build-LastPlugin.py copies each
with its BNAM pointed at the trade's own bench (#3120). That replaced the small
trailing plugin (Thornswood-WoodworkerTrail.esp) this paragraph used to promise,
which never shipped.

Placements of the furniture in the world are Claude's: at least one beside a forge
in every major hold and some minor towns. This script only adds the base records.

THE CREATION MENUS, TAKEN OUT (#2962)

Four message boxes were the questions of the first creation flow:
ThornswoodTradeMenu1 and 2 (MESG 0x05E80050, 0x05E80051, "What do you do for a
living?", sixteen trades over two pages) and ThornswoodTownMenu1 and 2 (MESG
0x05E80052, 0x05E80053, "Where do you begin?", ten towns over two pages). Since
20 September the choices are made in the game on K, in the panel the character
block of gamemode.js owns, and since 21 September there is no trade to choose:
rank comes from work. The server could never have shown these boxes anyway:
Message.Show from the gamemode has no actor to show it to (the comment above
CHARGEN in gamemode.js says why).

Measured 21 October: no record in this plugin, Thornswood-Last.esp or
Thornswood-WoodworkerTrail.esp names any of the four, compressed records
included, and Thornswood ships no Papyrus script of its own. Nothing in the
repository named them but Check-Chargen.ps1, which asked for them and their
button counts as if creation needed them.

They stayed because this tool keeps every record it does not write, and
nothing took them out when the flow moved. So RETIRED names them, and a run
takes out any of them the plugin still carries, after checking each is the
MESG of that editor id. Nothing keeps a change form for a message box, so no
save or server state names their form ids.


Usage (both default to game\\content\\Thornswood-Content.esp in this repo):
    python scripts/mods/Add-ContentRecords.py --check
    python scripts/mods/Add-ContentRecords.py
    python scripts/mods/Add-ContentRecords.py --masters C:\\Thornswood\\Game\\Data

Exit code 1 if the parse does not round trip, if the result does not verify, or
if anything it was asked to add is already there.
"""

import argparse
import copy
import json
import math
import os
import re
import struct
import sys
import zlib

COMPRESSED = 0x00040000

# The other server's full name, lower case. Written as its code points so that
# this file does not carry the name either: it goes from everywhere in the
# repository (Patrick, 12 October, #400), and tests\test-other-server-name-gone.js
# refuses it in any file git tracks.
OTHER_SERVER_NAME = bytes([107, 101, 105, 122, 97, 97, 108])

# Its two short forms, lower case and written the same way (Patrick, 15
# October, decision C on #400): the three letter prefix that was on 33 of this
# plugin's editor ids, its script and its folders, and the six letter one that
# was on its board and, with two letters in front, on its records. The longer
# one is looked for in every byte of a record. The three letter one only in
# text (an editor id, an attached script, a string), where it would be a name;
# among a record's numbers any three letters can turn up by chance.
OTHER_SERVER_SHORT = bytes([107, 122, 108])
OTHER_SERVER_LONGER = bytes([111, 108, 105, 118, 97, 114])

# What the header says the plugin is (SNAM), written by this tool (#400), built
# from the records the plugin holds (#2993, THE HEADER'S DESCRIPTION at the top).
# Each row: a pattern on "TAG EditorId", whose records it names, whose they are
# (Thornswood's own, or Bethesda's records this plugin changes), and the words
# that name them. A record takes the first row it matches. A record that
# matches none stops the tool; a row that matches nothing is left out.
DESCRIPTION_LEAD = "Thornswood's crafting and gathering content: "
DESCRIPTION_BETHESDA = " Changes to Skyrim's: "
# The file format gives the header's description 512 bytes at most, its closing
# zero included (UESP, Skyrim Mod:Mod File Format/TES4, SNAM), which is what the
# Creation Kit and the mod tools expect to read.
DESCRIPTION_MOST = 512
CONTENTS = (
    (r'(KYWD|FURN) ThornswoodCraftingCharcoalKiln', 'own', 'charcoal kilns'),
    (r'(KYWD|FURN) ThornswoodCraftingAlchemy', 'own', 'alchemy labs'),
    (r'(KYWD|FURN) ThornswoodCraftingWoodworking', 'own', 'woodworking benches'),
    (r'FURN ThornswoodFurnitureSaltMine$', 'own', 'salt quarries'),
    (r'FLOR ThornswoodFloraBeehive$', 'own', 'beehives'),
    (r'ACTI ThornswoodActivator(Well|Water)Bucket$', 'own', 'well and water buckets'),
    (r'ACTI ThornswoodActivatorStudyDesk$', 'own', 'study desks'),
    # The placements, and the cells and worlds they stand in, are the stations
    # above and the quest sites below put in the world (the tool refuses any
    # other placement), so those rows' words already say them.
    (r'(REFR|CELL|WRLD) ', 'own', None),
    (r'ACTI ThornswoodMessageBoard$', 'own', 'notice boards'),
    (r'ACTI ThornswoodDropBox$', 'own', 'drop boxes'),
    (r'(MISC ThornswoodCharcoalTier|COBJ ThornswoodRecipeCharcoalTier)\d$', 'own', 'charcoal'),
    (r'(MISC ThornswoodMiscTool(Handle|Shears|Alembic|RuneKnife)|'
     r'COBJ ThornswoodRecipe(Tool(Handle|Shovel|Hammer|Shears|Alembic|RuneKnife|Ladle)|WeaponPickaxe|WeaponAxe))$',
     'own', 'tools and handles'),
    (r'BOOK ThornswoodBookDeed$', 'own', 'deeds'),
    (r'(MISC ThornswoodMisc(Master)?Key(Mold)?|COBJ ThornswoodRecipeKey(Mold)?)$', 'own', 'keys and molds'),
    (r'(MISC ThornswoodMisc(Pole\w+|FishTrap)|FLOR ThornswoodFish\w+|COBJ ThornswoodRecipe(Pole\w+|FishTrap))$',
     'own', 'fishing'),
    (r'(MISC ThornswoodMisc|COBJ ThornswoodRecipe)(Weapon|Armor|Sewing)Kit$', 'own', 'repair kits'),
    # The treatments and the Physicker's potion recipes (#3470) are one word,
    # because the description has 512 bytes and a row of its own ran over.
    (r'(MISC ThornswoodMisc|COBJ ThornswoodRecipe)(Bandage|Splint|Poultice|Remedy)$|COBJ ThornswoodRecipePotion\w+$',
     'own', 'medicine'),
    (r'(MISC ThornswoodFurniture|COBJ ThornswoodRecipeFurniture)\w+$', 'own', 'furniture'),
    # The teas, the burnt, fine and spoiled food (#3163) and the festival
    # feasts and brews (#3152) share one row, which keeps the description
    # under its 512.
    (r'(ALCH ThornswoodFood|COBJ ThornswoodRecipe)(Tea|Feast|Brew)\w+$|ALCH Thornswood(FoodBurntMeal|FoodFine\w+|FoodSpoiled)$'
     r'|MGEF Thornswood(TeaSteep|Burnt|Fine|Feast|Brew|Spoiled)Effect$', 'own', 'food and drink'),
    (r'(MISC ThornswoodQuest\w+|ACTI ThornswoodQuestLedgerSource)$', 'own', 'quest items'),
    (r'IMAD Thornswood(Drunk|High|Hangover|Withdrawal)Imod$', 'own', 'the screen looks'),
    (r'BOOK ThornswoodPassage\w+$', 'own', 'starting town passages'),
    (r'BOOK ThornswoodWelcome$', 'own', 'the welcome letter'),
    (r'COBJ (DLC[12])?Recipe(Weapon\w+Bow|Arrow\w+|TechBolt\w+)$', 'bethesda',
     'bows, arrows and bolts to the woodworking bench'),
    (r'COBJ BYOHRecipe(Nails|Hinge|Lock|Fittings)$', 'bethesda', 'house parts off the forge'),
    (r'COBJ RecipeIngotDwarvenScrap\w+$', 'bethesda', 'Dwarven scrap to one recipe'),
)


def description_of(keys):
    """The header's description for a plugin whose records are keys, each
    "TAG EditorId", and the keys no row of CONTENTS names."""
    used, unnamed = set(), []
    for key in keys:
        row = next((i for i, (pattern, _, _) in enumerate(CONTENTS) if re.match(pattern, key)), None)
        if row is None:
            unnamed.append(key)
        else:
            used.add(row)
    own = [words for i, (_, whose, words) in enumerate(CONTENTS) if i in used and whose == 'own' and words]
    theirs = [words for i, (_, whose, words) in enumerate(CONTENTS) if i in used and whose == 'bethesda']
    text = DESCRIPTION_LEAD + ', '.join(own[:-1]) + (', and ' if len(own) > 1 else '') + own[-1] + '.'
    if theirs:
        text += DESCRIPTION_BETHESDA + '; '.join(theirs) + '.'
    return text.encode('ascii'), unnamed

# Thornswood's own records that nothing shows or names any more, by object id
# in this plugin's own numbering, type and editor id (THE CREATION MENUS, TAKEN
# OUT, above). A run takes out any of them the plugin carries.
RETIRED = (
    (0xE80050, b'MESG', 'ThornswoodTradeMenu1'),
    (0xE80051, b'MESG', 'ThornswoodTradeMenu2'),
    (0xE80052, b'MESG', 'ThornswoodTownMenu1'),
    (0xE80053, b'MESG', 'ThornswoodTownMenu2'),
)

# Form ids for the three new records. The plugin's own records all sit in the
# 0x05______ space; 0x501548E is the highest of the 0x0501____ family in use, so
# these follow it with a gap rather than butting against it.
HANDLE = 0x5015490
RECIPE_HANDLE = 0x5015491
RECIPE_SHOVEL = 0x5015492

# ONE DEED RECORD FOR EVERY PROPERTY IN THE GAME.
#
# Patrick settled the property system on 21 September and this is the measurement
# that made "every building in the game is claimable" affordable: Inventory::Entry
# in the fork carries an optional per-instance name, serialised by name in
# Inventory.h, so one BOOK becomes "Deed to Breezehome" or "Deed to Honeyside" in
# the pack without a record per building. There are 852 claimable buildings and
# this is one record rather than 852.
#
# It is cloned from a passage book, which is a BOOK this plugin already ships and
# already reads as a plain document rather than a spell tome or a skill book.
DEED = 0x5015493

# A KEY AND A KEY MOLD, AND WHY BOTH ARE MISC RATHER THAN KEYM.
#
# Skyrim has a record type for keys and this does not use it. A KEYM lands in the
# Keys tab, which is a list the game treats as yours: a vanilla key is weightless,
# is not dropped, and is not what a pickpocket takes.
#
# Patrick, 21 September, on what a key is for here: it "can be given to people
# used by you or pickpocketed or taken out of unlocked chests or lockpicked", and
# "a stolen key only gets you in". Every one of those is a thing a MISC does and a
# KEYM does not. So a key here is an object somebody carries and can lose, which
# is the whole point of it, and the Keys tab is the wrong home for it.
#
# Both are one record for the whole game, named per instance in the pack exactly
# as the deed is: "Key to Breezehome", "Key mold for Honeyside".
KEY = 0x5015494
MOLD = 0x5015495

# WHAT THEY LOOK LIKE (#2255). Both were cloned from the charcoal MISC and kept
# its mesh, so a key and a mold were the same stick of charcoal in the pack and
# on the ground: "the key item isn't a key and is the same block log item as the
# mold". Both now wear vanilla meshes from Skyrim.esm, so still no new art ships:
# the key the 191 KEYM records in Skyrim.esm use most, and the silver mold the
# Thieves Guild quest uses (MISC TGTQ01SilverMold). The MODT that came with the
# charcoal is texture data for the charcoal's mesh, so it goes with it.
KEY_MODEL = 'Clutter\\Key01.nif'
MOLD_MODEL = 'Clutter\\SilverMold01.nif'
RECIPE_MOLD = 0x5015496
RECIPE_KEY = 0x5015497

# THE MASTER KEY (#2254). Patrick, 12 Oct 2026: a "Master key to" one building,
# handed with the deed when the building is claimed, which opens it and turns
# its lock, works only while the person it was cut for holds the building, and
# is re-cut from the mold for 2 iron ingots. One MISC for every building, named
# per instance in the pack like the key ("Master key to Breezehome, no. 12"),
# a MISC for the reasons the key is one, on the key's own mesh. It has no
# recipe: it is handed at the claim and cut at a forge by the server, never
# made in the crafting menu, because a master key nobody cut for a holder
# opens nothing. 0x50154D0 is the drop box (#2298), so after a gap from it.
MASTER_KEY = 0x50154E0

# Poles, the trap, and the pressable catches. fisher.md ingredients.
# The master pole does not take dragon bone. A trap is not a pole.
# The catches are one FLOR base each, cloned from Clam01 so they carry a
# PFIG. Spots in the world are somebody else's job. FISH_BY_BASE is not
# written here.
POLE_CRUDE = 0x5015498
POLE_FINE = 0x5015499
POLE_MASTER = 0x501549A
FISH_TRAP = 0x501549B
RECIPE_POLE_CRUDE = 0x501549C
RECIPE_POLE_FINE = 0x501549D
RECIPE_POLE_MASTER = 0x501549E
RECIPE_TRAP = 0x501549F
CATCH_HISTCARP = 0x50154A0
CATCH_RIVER_BETTY = 0x50154A1
CATCH_SCALES = 0x50154A2
CATCH_PERCH = 0x50154A3
CATCH_SPADETAIL = 0x50154A4
CATCH_LONGFIN = 0x50154A5

# The three repair kits and the recipes that make them (#1384). After a gap
# from the catches, so somebody else adding the next record after 0x50154A5
# does not land on these.
WEAPON_KIT = 0x50154B0
ARMOR_KIT = 0x50154B1
SEWING_KIT = 0x50154B2
RECIPE_WEAPON_KIT = 0x50154B3
RECIPE_ARMOR_KIT = 0x50154B4
RECIPE_SEWING_KIT = 0x50154B5

# The four treatments and the recipes that make them (#1383). After a gap from
# the kits, for the same reason the kits left one after the catches.
BANDAGE = 0x50154C0
SPLINT = 0x50154C1
POULTICE = 0x50154C2
REMEDY = 0x50154C3
RECIPE_BANDAGE = 0x50154C4
RECIPE_SPLINT = 0x50154C5
RECIPE_POULTICE = 0x50154C6
RECIPE_REMEDY = 0x50154C7

# THE PHYSICKER'S POTIONS (#3470). Patrick, 26 Oct 2026, A+B on the report
# page: the dungeon pile pays ingredients instead of Skyrim's ten potion
# records, and the Physicker gets a recipe for each record at this plugin's
# alchemy lab. A on 27 Oct for how the strengths differ: the weakest takes two
# ingredients that share the potion's effect and each step up takes one more,
# and the rank climbs with it (Build-RecipeTable.ps1's RECIPE_RANK). Every
# ingredient carries the effect by game/data/ingredients.json, which reads it
# off the INGR records, and has a maker by scripts/dev/Check-Makers.js, at a
# gathering rank no higher than the recipe's;
# tests/test-3470-potion-recipes.js holds both. After a gap from the master
# key, in numbers no version of this plugin used.
POTION_RECIPES = (
    # (recipe, editor id, the potion it makes, its inputs)
    (0x50154F0, 'ThornswoodRecipePotionMinorHealing', 0x0003EADD, ('IMP_STOOL', 'EYE_OF_SABRE_CAT')),
    (0x50154F1, 'ThornswoodRecipePotionHealing', 0x0003EADE,
     ('BLUE_MOUNTAIN_FLOWER', 'WHEAT', 'SWAMP_FUNGAL_POD')),
    (0x50154F2, 'ThornswoodRecipePotionPlentifulHealing', 0x0003EADF,
     ('BLUE_MOUNTAIN_FLOWER', 'WHEAT', 'SWAMP_FUNGAL_POD', 'BLISTERWORT')),
    (0x50154F3, 'ThornswoodRecipePotionVigorousHealing', 0x0003EAE3,
     ('BLUE_MOUNTAIN_FLOWER', 'WHEAT', 'SWAMP_FUNGAL_POD', 'BLISTERWORT', 'EYE_OF_SABRE_CAT')),
    (0x50154F4, 'ThornswoodRecipePotionMinorMagicka', 0x0003EAE0, ('WHITE_CAP', 'CREEP_CLUSTER')),
    (0x50154F5, 'ThornswoodRecipePotionMagicka', 0x0003EAE1, ('RED_MOUNTAIN_FLOWER', 'GIANT_LICHEN', 'WHITE_CAP')),
    (0x50154F6, 'ThornswoodRecipePotionMinorStamina', 0x0003EAE5, ('MUDCRAB_CHITIN', 'SABRE_CAT_TOOTH')),
    (0x50154F7, 'ThornswoodRecipePotionStamina', 0x00039BE8,
     ('PURPLE_MOUNTAIN_FLOWER', 'MUDCRAB_CHITIN', 'EYE_OF_SABRE_CAT')),
    (0x50154F8, 'ThornswoodRecipePotionResistFire', 0x00039B4A, ('SNOWBERRIES', 'FIRE_SALTS')),
    (0x50154F9, 'ThornswoodRecipePotionResistShock', 0x00039BE1, ('SNOWBERRIES', 'GLOWING_MUSHROOM')),
)

# THE NOTICE BOARD AND THE HOLD'S DROP BOX (#2298).
#
# ThornswoodMessageBoard, the activator every board in the world is, named a
# reworked copy of the board in Missives (Nexus 111375) that came with the other
# server's records, MissiveBoardCOTND.nif in a folder named with that server's
# prefix. Patrick, 12 Oct,
# chose Thornswood's own board built from vanilla pieces, with the hold's drop
# box on a shelf on its right post, as two objects placed together: "when they
# click on the Notice Board it does the Notice Board and when they click on the
# dropbox it does just the dropbox". scripts/mods/Build-NoticeBoard.py builds
# both meshes, and they ship as ours from game/ours.
#
# So the board's MODL moves to the new mesh, its OBND to the new mesh's bounds
# (the old one's were Missives' board), and the box is an activator of its own,
# ThornswoodDropBox, written the same way as the board.
#
# WHY AN ACTIVATOR AND NOT A CONTAINER. Patrick, 12 Oct: a person sees only what
# they put in, gold included, and only the hold's officers see everything. A
# Skyrim container shows whoever opens it everything in it, and the server sends
# a container's whole inventory to every client that has it in view. So what is
# in the box is the server's record, the server stands the box beside its board
# (standBoard in game/gamemode.js, #2516), and E on it opens the box's own
# panel, never a container.
BOARD = 0x500593B
BOARD_MODEL = 'thornswood\\noticeboard01.nif'
BOARD_BOUNDS = (-168, -71, 0, 140, 71, 246)     # the mesh's, rounded outward
DROP_BOX = 0x50154D0
DROP_BOX_MODEL = 'thornswood\\dropbox01.nif'
DROP_BOX_BOUNDS = (-26, -18, 0, 26, 18, 37)

# THE WOODWORKING BENCH (#516). Keyword + furniture, then the 26 COBJ overrides.
# Mesh is Hearthfire's carpenter workbench (_BYOH\Furniture\CraftingWorkbench01.nif),
# measured from BYOHHouseCarpentersWorkbench in HearthFires.esm. Bounds are that
# furniture's OBND. Form ids follow MASTER_KEY (#2254), same pattern as the kits.
WOODWORKING_KEYWORD = 0x50154E1
WOODWORKING_BENCH = 0x50154E2
WOODWORKING_MODEL = r'_BYOH\Furniture\CraftingWorkbench01.nif'
WOODWORKING_BOUNDS = (-72, -10, -34, 81, 75, 64)
WOODWORKING_FULL = 'Woodworking Bench'

# Master recipes this plugin overrides onto the woodworking bench. Form ids are
# already in this plugin's numbering (Skyrim 00, Dawnguard 02, Dragonborn 04).
WOODWORKER_MASTER_RECIPES = (
    # Skyrim.esm bows
    (0x00108CF7, 'RecipeWeaponDaedricBow', 'Skyrim.esm'),
    (0x00108CF8, 'RecipeWeaponDwarvenBow', 'Skyrim.esm'),
    (0x00108CF9, 'RecipeWeaponEbonyBow', 'Skyrim.esm'),
    (0x00108CFA, 'RecipeWeaponElvenBow', 'Skyrim.esm'),
    (0x00108CFB, 'RecipeWeaponGlassBow', 'Skyrim.esm'),
    (0x00108CFC, 'RecipeWeaponOrcishBow', 'Skyrim.esm'),
    # Dawnguard.esm
    (0x02019824, 'DLC1RecipeWeaponDragonboneBow', 'Dawnguard.esm'),
    (0x02003987, 'DLC1RecipeArrowDaedric', 'Dawnguard.esm'),
    (0x02006928, 'DLC1RecipeArrowDragonbone', 'Dawnguard.esm'),
    (0x0200B64F, 'DLC1RecipeArrowIron', 'Dawnguard.esm'),
    (0x0200B650, 'DLC1RecipeArrowSteel', 'Dawnguard.esm'),
    (0x0200B651, 'DLC1RecipeArrowEbony', 'Dawnguard.esm'),
    (0x0200B652, 'DLC1RecipeArrowDwarven', 'Dawnguard.esm'),
    (0x0200B653, 'DLC1RecipeArrowGlass', 'Dawnguard.esm'),
    (0x0200B654, 'DLC1RecipeArrowOrcish', 'Dawnguard.esm'),
    (0x0200B655, 'DLC1RecipeArrowElven', 'Dawnguard.esm'),
    (0x0200F813, 'DLC1RecipeTechBoltSteel', 'Dawnguard.esm'),
    (0x0200F814, 'DLC1RecipeTechBoltDwarven', 'Dawnguard.esm'),
    # Dragonborn.esm
    (0x0402B077, 'DLC2RecipeWeaponStalhrimBow', 'Dragonborn.esm'),
    (0x0402B07F, 'DLC2RecipeWeaponNordicBow', 'Dragonborn.esm'),
    (0x0403CF53, 'DLC2RecipeArrowNordic', 'Dragonborn.esm'),
    (0x0403CF54, 'DLC2RecipeArrowStalhrim', 'Dragonborn.esm'),
)

LEATHER_STRIPS = 0x000800E4
TUNDRA_COTTON = 0x0003F7F8
STEEL_INGOT = 0x0005ACE5
REFINED_MOONSTONE = 0x0005AD9F
HISTCARP = 0x000106E18
RIVER_BETTY = 0x000106E1A
SLAUGHTERFISH_SCALES = 0x00003AD70
SILVERSIDE_PERCH = 0x000106E1C
CYRODILIC_SPADETAIL = 0x000106E19
ABECEAN_LONGFIN = 0x000106E1B
LEATHER = 0x000DB5D2         # Leather01, what the tanning rack makes from a hide
TANNING_KEYWORD = 0x007866A  # CraftingTanningRack
GARLIC = 0x00034D22          # a gatherer's at novice (game/data/harvests.json)
MUDCRAB_CHITIN = 0x0006BC00  # a hunter's off a mudcrab, novice (HUNTS_BY_BASE)
BLUE_MOUNTAIN_FLOWER = 0x00077E1C  # a gatherer's at advanced (game/data/harvests.json)
# The Physicker's potion ingredients (#3470), each with who gathers it and at
# what rank (game/data/harvests.json, hunts.json, ores.json).
IMP_STOOL = 0x0004DA23               # Gatherer, novice
WHITE_CAP = 0x0004DA22               # Gatherer, novice
CREEP_CLUSTER = 0x000B2183           # Gatherer, novice
EYE_OF_SABRE_CAT = 0x0006BC07        # Hunter, novice
SABRE_CAT_TOOTH = 0x0006BC04         # Hunter, novice
WHEAT = 0x0004B0BA                   # Farmer and Gatherer, advanced
SWAMP_FUNGAL_POD = 0x0007E8B7        # Gatherer, advanced
RED_MOUNTAIN_FLOWER = 0x00077E1D     # Gatherer, advanced
PURPLE_MOUNTAIN_FLOWER = 0x00077E1E  # Gatherer, advanced
GIANT_LICHEN = 0x0007E8C1            # Gatherer, advanced
SNOWBERRIES = 0x0001B3BD             # Gatherer, advanced
GLOWING_MUSHROOM = 0x0007EE01        # Gatherer, advanced
BLISTERWORT = 0x0004DA25             # Gatherer, expert
FIRE_SALTS = 0x0003AD5E              # Miner, expert, at the quarry
# MCE_CraftingLoom: MoreCraftableEquipment.esp's keyword, injected as Update.esm's
# 0x6CE000. Update.esm is this plugin's master 01. See THE LOOM at the top.
LOOM_KEYWORD = 0x016CE000
ALCHEMY_KEYWORD = 0x5042E6B  # ThornswoodCraftingAlchemy, this plugin's own lab

# The four Hearthfire house part recipes (#2258), in this plugin's numbering:
# HearthFires.esm is master 03. Each with the editor id the master gives it,
# which the override keeps and this checks.
HOUSE_PARTS = (
    (0x0300306D, 'BYOHRecipeNails'),
    (0x0300306E, 'BYOHRecipeHinge'),
    (0x0300306F, 'BYOHRecipeLock'),
    (0x03003036, 'BYOHRecipeFittings'),
)
HOUSE_PARTS_MASTER = 'HearthFires.esm'

# A condition that is never true (#2258). A CTDA is 32 bytes: the operator in
# the top three bits of the first byte (4 is '<', the enum in libespm CTDA.h),
# three bytes of nothing, the value to compare with (0.0), the function (47,
# GetItemCount, which the fork's server evaluates as well as Skyrim), two bytes
# of nothing, the first parameter (Gold001, 0xF in Skyrim.esm, master 00), the
# second (none), run on the subject (0, the person at the bench), no reference,
# and the third parameter, -1 for none. GetItemCount is never below 0.
GOLD = 0x0000000F
NEVER_TRUE = struct.pack('<B3sfHHIIIIi', 4 << 5, b'\x00\x00\x00', 0.0, 47, 0,
                         GOLD, 0, 0, 0, -1)

# Where the masters are read from, the first time a master record is copied in.
MASTERS_DIR = 'C:\\Thornswood\\Game\\Data'

# The subrecords a COBJ carries, and which hold form ids. A record copied in
# from a master with anything else in it stops the tool, because a form id in
# a field this does not know would keep the master's numbering.
COBJ_FORM_FIELDS = {b'CNTO': (0,), b'COED': (0,), b'CNAM': (0,), b'BNAM': (0,),
                    b'CTDA': (12, 16, 24)}
COBJ_PLAIN_FIELDS = (b'EDID', b'COCT', b'NAM1', b'CIS1', b'CIS2')

DEED_WORDS = (
    '<p align="center"><font size="30">Deed</font></p>'
    '<br><br>'
    'This deed sets out the holding of the property written on its cover.'
    '<br><br>'
    '<font size="18">Whoever carries it holds the place. There is no copy and no '
    'register but this. Keep it somewhere a thief will not look, or do not keep it '
    'at all.</font>')

# THE TEN PASSAGE BOOKS' WORDS (#3349, Patrick, 22 Oct, B on the page: "Plain
# town lines, from the tool"). Each book says what its town is, in plain words,
# and nothing else: no aside to the reader, no joke. The town is chosen on the
# creation panel since #2622 and nothing hands these books out or acts when one
# is read (gamemode.js mp.onReadBook), so the old last line, "Read this and you
# go. The other passages will burn.", is gone with the quips. The books stay
# because their form ids key CHARGEN.towns in gamemode.js
# (Remove-DeadRecords.ps1). Each is written over where it stands, FULL and all
# else kept; only its DESC is this.
def passage_words(title, line):
    return ('<p align="center"><font size="30">%s</font></p><br><br>%s' % (title, line))


PASSAGE_WORDS = {
    'ThornswoodPassageWhiterun': passage_words(
        'Passage to Whiterun',
        'Whiterun, in the middle of Skyrim. The roads out of it go four ways.'),
    'ThornswoodPassageRiften': passage_words(
        'Passage to Riften',
        'Riften, in the Rift. Fishing, the meadery, and the canal through the middle of the town.'),
    'ThornswoodPassageSolitude': passage_words(
        'Passage to Solitude',
        'Solitude, in Haafingar. Ships, trade, the court, and the one Imperial embassy in Skyrim.'),
    'ThornswoodPassageWindhelm': passage_words(
        'Passage to Windhelm',
        'Windhelm, in Eastmarch. Stone, snow and the docks, and the High King\'s seat.'),
    'ThornswoodPassageMarkarth': passage_words(
        'Passage to Markarth',
        'Markarth, in the Reach. Silver mines under the city, and the Forsworn in the hills above it.'),
    'ThornswoodPassageFalkreath': passage_words(
        'Passage to Falkreath',
        'Falkreath, in the pines. Its graveyard is bigger than the town.'),
    'ThornswoodPassageMorthal': passage_words(
        'Passage to Morthal',
        'Morthal, in the swamps of Hjaalmarch. A few houses and the Jarl\'s hall.'),
    'ThornswoodPassageDawnstar': passage_words(
        'Passage to Dawnstar',
        'Dawnstar, on the north coast. Ice, the mines, and a harbour that freezes.'),
    'ThornswoodPassageWinterhold': passage_words(
        'Passage to Winterhold',
        'Winterhold, what is left of it after the Collapse. The College stands above it.'),
    'ThornswoodPassageRavenrock': passage_words(
        'Passage to Raven Rock',
        'Raven Rock, across the water on Solstheim. The ash still falls there.'),
}

# What the recipes are made of and what they make. Every one of these was read
# out of a record already in this file or out of TOOLS in gamemode.js, never
# remembered.
FIREWOOD = 0x0006F993        # the CNTO of ThornswoodRecipeCharcoalTier1
IRON_INGOT = 0x0005ACE4      # the CNTO of ThornswoodRecipeWeaponPickaxe
SHOVEL = 0x000F5D05          # TOOLS.farmer.give in gamemode.js
KILN_KEYWORD = 0x501547F     # the BNAM of every charcoal recipe
FORGE_KEYWORD = 0x0088105    # the BNAM of the pickaxe and axe recipes

# A handle is worth a little more than the firewood it came from and weighs the
# same as a charcoal stick. Nothing in the rulebook sets either number.
HANDLE_VALUE = 5
HANDLE_WEIGHT = 0.5

# What a kit is worth and weighs. Nothing in the rulebook sets either number;
# an item has no gold price here, and these are cheap so the rank stays the
# dearest input's.
METAL_KIT_VALUE = 15
METAL_KIT_WEIGHT = 1.0
SEWING_KIT_VALUE = 10
SEWING_KIT_WEIGHT = 0.5

# What each treatment is worth and weighs (#1383). The rulebook sets neither;
# an item has no gold price here, and a bandage is light.
BANDAGE_VALUE, BANDAGE_WEIGHT = 2, 0.1
SPLINT_VALUE, SPLINT_WEIGHT = 5, 1.0
POULTICE_VALUE, POULTICE_WEIGHT = 5, 0.2
REMEDY_VALUE, REMEDY_WEIGHT = 15, 0.2

# ---------------------------------------------------------------------------
# TEA AND THE DRUNK SCREEN (#1382, Patrick's decisions 3 and 4 of 12 October
# 2026). Their form ids are 0x5018000 on, a range no version of this plugin
# has used, kept apart from the stations (0x5015500 on) and the furniture
# (0x5016000 on).
#
# TEA. docs/systems/exhaustion.md, A stimulant: "A tea holds the rest drain at
# half for 20 real minutes, then costs 15 rest". No record in the load order
# was a tea, so Patrick's decision 4 adds tea items to this plugin, brewable at
# a cooking pot. The server knows them by game\data\food-groups.json (group
# tea) and does the holding and the crash; the record only has to be something
# a person drinks. Each is two of one herb a gatherer brings in at novice or
# advanced (game\data\harvests.json), at the cooking pot, as Skyrim's own soups
# are made: the pot holds the water, no recipe of Skyrim's asks for it.
#
# Every ALCH in the five masters carries at least one effect, so a tea carries
# one too: ThornswoodTeaSteepEffect, a script effect with no script, which does
# nothing in the game. It says on the item what the server does. Its DATA is
# Skyrim.esm's VoiceStormCallEmptyAIScriptEffect (MGEF 0xECEB5): a script
# effect with no script, fire and forget, on the self. Its own flags say no
# duration, no magnitude and no area, and it is not hidden.
TEA_EFFECT = 0x5018000
TEA_EFFECT_FLAGS = 0x00000E00
TEA_EFFECT_WORDS = ('Rest drains at half for 20 minutes. When that is over, '
                    '15 rest is owed. A second cup in the window starts it again and owes it again.')
# VoiceStormCallEmptyAIScriptEffect's DATA as Skyrim.esm has it; the flags, its first four
# bytes, are written over with TEA_EFFECT_FLAGS where the record is made.
TEA_EFFECT_DATA = bytes.fromhex(
    '008000000000000000000000ffffffffffffffff000000000000000000000000000000000000000000000000'
    '000000000000000000000000000000000000000001000000ffffffff00000000000000000100000000000000'
    'ffffffff00000000000000000000000000000000000000000000803f00000000000000000000000000000000'
    '0000000000000000010000000000484200007042')
TEA_MODEL = 'Clutter\\GlazedCup01.nif'          # Skyrim's GlazedCup01 (MISC 0xB9BDC)
TEA_BOUNDS = (-5, -5, 0, 5, 5, 10)              # the cup's own
TEA_VALUE, TEA_WEIGHT = 5, 0.5
VENDOR_ITEM_FOOD = 0x0008CDEA                   # VendorItemFood, every drink of Skyrim's carries it
TEA_PICK_UP = 0x000FC21F                        # the jug of milk's pick up sound (BYOHFoodMilk YNAM)
TEA_DRINK = 0x0010E2EA                          # the jug of milk's drinking sound (BYOHFoodMilk ENIT)
COOKPOT_KEYWORD = 0x000A5CB3                    # CraftingCookpot, NEEDS.cookKeyword in gamemode.js
LAVENDER = 0x00045C28                           # a gatherer's at novice
JUNIPER_BERRIES = 0x0005076E                    # a gatherer's at novice
SNOWBERRIES = 0x0001B3BD                        # a gatherer's at advanced
TEAS = (
    # item       recipe     editor id                    name               herb
    (0x5018001, 0x5018011, 'ThornswoodFoodTeaLavender', 'Lavender Tea', LAVENDER),
    (0x5018002, 0x5018012, 'ThornswoodFoodTeaJuniper', 'Juniper Tea', JUNIPER_BERRIES),
    (0x5018003, 0x5018013, 'ThornswoodFoodTeaSnowberry', 'Snowberry Tea', SNOWBERRIES),
)
TEA_HERBS = 2

# SEASONAL FOOD AND DRINK (#3152). Patrick, 22 October 2026, A: a seasonal
# dish can be made any time with its ingredients, and the ingredients are what
# is seasonal. The server picks Lavender, Jazbay Grapes, Snowberries and
# Juniper Berries only in their two seasons each (game\data\food-groups.json
# inSeason), so each season has its own pair, and each season's festival dish
# and brew want that pair. Off season they are made from what was put by.
#
# A festival dish is a feast (docs/systems/food.md, the feast row): the server
# knows it by group feast in food-groups.json, with the help each one gives
# (feasts), and every cook of one comes out burnt, plain or fine as any dish
# does, so each has a fine record in the quality block, made by the quality
# pass below from the same look. A brew is ale (group ale), so it goes down
# the way any ale does. All are a Hearthcook's: none carries Gourmet.esp's
# dessert keyword, which this plugin does not master. The festivals are the
# calendar's own: First Planting, the Mid Year Celebration, Harvest's End and
# Saturalia.
#
# Each carries one effect of this plugin's own, the tea's kind (a script
# effect with no script), which says on the item what the server does. A
# feast wears a vanilla dish's mesh, bounds and weight, the ones this plugin's
# fine dish of it reads from the masters, so nothing new ships; a brew wears
# the tea's cup. Form ids 0x501A000 on, a range no version of this plugin used.
FEAST_EFFECT = 0x501A000
FEAST_EFFECT_WORDS = ('A festival feast. It fills more than a meal, and its help is twice as strong '
                      'for half as long.')
BREW_EFFECT = 0x501A001
BREW_EFFECT_WORDS = 'A festival brew. It goes down the way any ale does.'
OVEN_KEYWORD = 0x030117F7                       # BYOHCraftingOven, HearthFires.esm
FLOUR = 0x03003538                              # Sack of Flour, HearthFires.esm
BUTTER = 0x0300353C                             # Butter, HearthFires.esm
CHICKEN_EGG = 0x00023D77                        # Chicken's Egg, a farmer's
VENISON = 0x000669A2                            # Venison, a hunter's
SALT_PILE = 0x00034CDF                          # Salt Pile, a miner's
JAZBAY_GRAPES = 0x0006AC4A                      # a gatherer's at novice
WHEAT = 0x0004B0BA                              # a farmer's at advanced
FEAST_VALUE = 5
FEAST_EAT = 0x000CAF94                          # ITMFoodEat, the eating sound Skyrim's dishes carry
FEASTS = (
    # item       recipe     editor id                            name                    bench
    #   inputs; the mesh, its bounds and the weight, each a vanilla dish's
    (0x501A010, 0x501A020, 'ThornswoodFoodFeastFirstPlanting', 'First Planting Loaf', OVEN_KEYWORD,
     ((FLOUR, 1), (CHICKEN_EGG, 1), (LAVENDER, 1), (JUNIPER_BERRIES, 1)),
     '_BYOH\\Clutter\\Food\\BraidedBread01.nif', (0, 0, 0, 0, 0, 0), 0.2),          # Braided Bread
    (0x501A011, 0x501A021, 'ThornswoodFoodFeastMidyear', 'Midyear Jazbay Tart', OVEN_KEYWORD,
     ((FLOUR, 1), (BUTTER, 1), (JAZBAY_GRAPES, 2), (LAVENDER, 1)),
     '_BYOH\\Clutter\\Food\\Tart01.nif', (-20, -20, 0, 20, 20, 7), 0.2),             # Jazbay Crostata
    (0x501A012, 0x501A022, 'ThornswoodFoodFeastHarvestsEnd', "Harvest's End Roast", COOKPOT_KEYWORD,
     ((VENISON, 1), (SALT_PILE, 1), (JAZBAY_GRAPES, 1), (SNOWBERRIES, 1)),
     'Clutter\\Ingredients\\VenisonCooked.nif', (0, 0, 0, 0, 0, 0), 2.0),              # Venison Chop
    (0x501A013, 0x501A023, 'ThornswoodFoodFeastSaturalia', 'Saturalia Spice Cake', OVEN_KEYWORD,
     ((FLOUR, 1), (BUTTER, 1), (SNOWBERRIES, 1), (JUNIPER_BERRIES, 1)),
     'Clutter\\Food\\NuttyBread01.nif', (-5, -17, -4, 4, 14, 5), 0.1),               # Honey Nut Treat
)
# COOKING QUALITY (#2906). Patrick, 20 October 2026, B: a cook comes out
# burnt, plain or fine, the odds by the cook's rank, and every dish needs a
# fine record as well as the burnt one, because an item cannot carry per-copy
# data and the eat event only names a record. The server rolls the quality in
# mp.onCraft and names the record the craft gives (the engine's craftOutput,
# fork #92); what each one does when eaten is the needs block's
# (NEEDS.cookQuality in game\gamemode.js). Which dish has which fine record,
# and which record is the burnt meal, is game\data\food-groups.json's
# quality block, the table the server reads too.
#
# Each record carries one effect of this plugin's own, a script effect with no
# script that says on the item what the server does, as the tea's does: a
# dish's own magic is taken away by the server anyway (FOOD_GROUPS.strip).
# A fine dish wears its plain dish's look, read from the plugin that made the
# dish (its bounds, mesh, mesh textures, sounds, worth and weight), is named
# "Fine " and the plain dish's name from game\data\recipes.json, and carries
# VendorItemFood. The burnt meal wears Skyrim.esm's Cooked Beef. A record this
# plugin already holds is kept as it is; one it does not is made from the
# masters, which needs --masters the game's Data folder that first time.
FOOD_GROUPS_TABLE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                                                  'game', 'data', 'food-groups.json'))
RECIPE_TABLE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                                             'game', 'data', 'recipes.json'))
BURNT_EFFECT = 0x5019001
BURNT_EFFECT_WORDS = 'Burnt. Stamina recovers 10% slower for 10 minutes.'
FINE_EFFECT = 0x5019002
FINE_EFFECT_WORDS = 'A fine dish. The help a meal of it gives lasts 30 minutes, not 20.'
BURNT_MEAL_EDID = 'ThornswoodFoodBurntMeal'
BURNT_MEAL_NAME = 'Burnt Meal'
BURNT_MEAL_LOOK = '721e8:Skyrim.esm'            # Cooked Beef

# SPOILED FOOD (#3163). Patrick, 26 October 2026, C on his report page: food
# that runs out of days stays in the pack, named for what it was and
# "(spoiled)"; eating it fills nothing and starts food sickness, and no recipe
# takes it. The client names what it eats by record alone, so the engine
# cannot tell "Venison (spoiled)" from "Venison (3 days left)" when both are
# the Venison record: a spoiled piece has to be a record of its own for the
# server to know it was the spoiled one that went down. One record holds them
# all, each entry named for its food by the spoilage block in the gamemode;
# it is written from these numbers and wears the burnt meal's look, the
# Cooked Beef mesh, so nothing here reads the masters. It is worth nothing,
# carries no vendor keyword, and its one effect is a script effect with no
# script, as the burnt meal's is, saying what the server does.
SPOILED_FOOD = 0x5019100
SPOILED_EFFECT = 0x5019003
SPOILED_FOOD_EDID = 'ThornswoodFoodSpoiled'
SPOILED_FOOD_NAME = 'Spoiled Food'
SPOILED_EFFECT_WORDS = 'Spoiled. It fills nothing, and it turns the stomach.'
SPOILED_MODEL = 'Clutter\\Ingredients\\BeefMeatCooked.nif'
SPOILED_BOUNDS = (-5, -9, -2, 5, 9, 2)
SPOILED_WEIGHT = 0.5
SPOILED_EAT_SOUND = 0x000CAF94                  # the burnt meal's, Skyrim's eating sound
# The subrecords of a dish's look this copies, and in each the offsets that
# hold a form id. ENIT is worth, flags, addiction, addiction chance and the
# eating sound; the addiction is not copied, a dish has none.
LOOK_FIELDS = {b'OBND': (), b'MODL': (), b'MODT': (), b'YNAM': (0,), b'ZNAM': (0,),
               b'DATA': (), b'ENIT': (16,)}

# THE WELL BUCKET (#1382). Patrick, 12 October 2026: water is drawn at a well
# by activating it, and the 30 placed wells in the load order are statics,
# which raise no activation (game\data\wells.json). So the plugin stands a
# bucket beside each well, an activator wearing Skyrim's wooden bucket
# (Bucket02a, MISC 0x747FB, its mesh and bounds), and activating it fills an
# empty bottle at that well (NEEDS.wellActivators in gamemode.js). Where each
# one stands is game\data\station-sites.json, kind well, measured by
# scripts\dev\Build-StationSites.py.
WELL_BUCKET = 0x5018030
WELL_BUCKET_MODEL = 'Clutter\\Bucket02a.nif'
WELL_BUCKET_BOUNDS = (-18, -18, 0, 18, 18, 46)
# THE WATER BUCKET (#1382): the same bucket on a river's or a lake's bank, its
# own record so the server knows the water drawn there is a river's
# (NEEDS.riverActivators; Patrick, 20 October 2026: lake water is worth what
# river water is), placed where game\data\station-sites.json, kind river,
# measures.
RIVER_BUCKET = 0x5018031
# THE STUDY DESK (#1387). Patrick, 22 October 2026, A on #1387: a semester at
# the College is taken at a study desk in the College halls, not a command.
# Skyrim's NobleDesk01 (STAT 0xD70EC) is a static, which raises no activation,
# so the plugin stands an activator wearing its mesh and bounds in each of the
# four halls, and activating it is the semester (deskActivated in the college
# block of gamemode.js). Where each one stands is game\data\station-sites.json,
# kind study, measured by scripts\dev\Build-StationSites.py.
STUDY_DESK = 0x5018032
STUDY_DESK_MODEL = 'Furniture\\Noble\\NobleDesk01.nif'
STUDY_DESK_BOUNDS = (-44, -49, 0, 44, 12, 63)

# THE DRUNK SCREEN. docs/systems/drink.md: from the third ale "the client draws
# a sway and a soft edge". Skyrim has no drunk image space modifier (measured
# on #1382, 12 October), so this is Thornswood's own: a little double vision,
# a little blur, a soft radial blur at the edges and some motion blur, which
# is what smears into a sway as the head turns. No tint and no colour change.
# It is not animatable, so it holds its values for as long as it is applied;
# the front plugin applies it as the one cross fade modifier while the server
# says the character is drunk, and takes it off when that ends. The layout,
# every keyed list two keys long, is Skyrim.esm's dunSleepingTreeCampISMD
# (IMAD 0xE3CBC), the giants' camp haze, which is the same kind of thing: a
# static modifier held over the screen. The values are this plugin's own.
DRUNK_IMOD = 0x5018020
DRUNK_LOOK = {
    b'BNAM': 0.3,      # blur radius
    b'VNAM': 0.006,    # double vision strength
    b'RNAM': 0.12,     # radial blur strength
    b'SNAM': 0.0,      # radial blur ramp up
    b'UNAM': 0.35,     # radial blur start: the edges only
    b'NAM1': 0.0,      # radial blur ramp down
    b'NAM2': 0.0,      # radial blur down start
    b'WNAM': 0.0,      # depth of field strength
    b'XNAM': 0.0,      # depth of field distance
    b'YNAM': 0.0,      # depth of field range
    b'NAM4': 0.25,     # motion blur strength
}

# THE SCREEN LOOKS FOR HIGH, A HANGOVER AND WITHDRAWAL (#3153). Patrick, 22
# October 2026, on his report page: drunk, high, hangover and withdrawal each
# have visual effects ("I also want visual affects"). Each is laid out as the
# drunk screen is and drawn the same way, one at a time, by the front plugin
# (globalThis.thornswoodLook, lookNow in gamemode.js). A look names only what
# it changes; every other keyed list is neutral. TNAM is a tint as red, green,
# blue and how much; IAD is the HDR and cinematic lists by their index
# (xEdit's IMAD: 0x03 bloom scale, 0x11 saturation, 0x12 brightness, 0x13
# contrast), each a multiply, its add left at nothing.
#   high        colour and light turned up, a little bloom and a warm rose
#               wash, a soft edge: skooma's lift.
#   hangover    light too bright and glaring, colour drained, a little blur:
#               the morning after.
#   withdrawal  grey and hard, a cold wash, the edges closing in: the want.
HIGH_IMOD = 0x5018021
HIGH_LOOK = {
    b'VNAM': 0.002,    # double vision strength
    b'RNAM': 0.05,     # radial blur strength
    b'UNAM': 0.4,      # radial blur start: the edges only
    b'TNAM': (1.0, 0.72, 0.88, 0.10),
    'iad': {0x03: 1.6, 0x11: 1.5, 0x12: 1.08, 0x13: 1.08},
}
HANGOVER_IMOD = 0x5018022
HANGOVER_LOOK = {
    b'BNAM': 0.12,     # blur radius
    'iad': {0x03: 1.8, 0x11: 0.75, 0x12: 1.15},
}
WITHDRAWAL_IMOD = 0x5018023
WITHDRAWAL_LOOK = {
    b'RNAM': 0.08,     # radial blur strength
    b'UNAM': 0.45,     # radial blur start: the edges only
    b'TNAM': (0.7, 0.8, 1.0, 0.08),
    'iad': {0x11: 0.45, 0x12: 0.92, 0x13: 1.15},
}

# ---------------------------------------------------------------------------
# THE SALVAGED RECORDS, REMADE AS THORNSWOOD'S OWN (#2553)
#
# Every record below is written by this tool, field by field, from the numbers
# and names in this section. Nothing is read out of the plugin it rewrites,
# and nothing is cloned from a salvaged record: before #2553 most of
# Thornswood's own items here were clones of the salvaged charcoal and its
# recipe, and the station records were the salvaged ones. The deed is still
# made from Thornswood's own passage book, and the catches from Skyrim's clam. See the top of
# scripts\mods\List-SalvagedRecords.py for which records were salvaged, and
# scripts\mods\content-salvaged.json for what became of each.
#
# WHERE THE LINE IS DRAWN. A field that only points at Bethesda's game, a mesh
# path, a keyword, a sound, an ingredient, the bounds and furniture markers of
# the vanilla object whose mesh it wears, is taken from that vanilla record and
# named beside it here. That is Bethesda's, not the other server's. A field
# that is a choice, the name, what a recipe takes and makes and where, what an
# item is worth, whether a bench makes things, is Thornswood's and comes from
# its rulebook (docs/systems), named beside it too. What the salvaged records
# carried and Thornswood's design does not ask for is not written: the
# editor-only colours of the keywords and markers, the empty texture lists,
# the activate text of the hive.
#
# The form ids stay, because the gamemode, the recipe table, the economy
# tables and the saves name them. The editor ids stay, because the fire table
# and the harnesses do.

# The SSE record header's last eight bytes: no version control, form version 44.
FORM_TAIL = struct.pack('<IHH', 0, 44, 0)

# Keywords and records of Bethesda's that the remade records point at.
VENDOR_ITEM_TOOL = 0x000914EE         # the keyword Skyrim's own Charcoal carries
FURNITURE_FORCE_3RD = 0x000A56D8      # FurnitureForce3rdPerson
FURNITURE_SPECIAL = 0x0006E9C7        # FurnitureSpecial
RACE_TO_SCALE = 0x000FD0E1            # RaceToScale
IS_SMELTER = 0x0009C6C3               # isSmelter, the smelter's working animation
IS_ALCHEMY = 0x0002A40B               # isAlchemy, the alchemy lab's
IS_BLACKSMITH_WORKBENCH = 0x000D932E  # isBlacksmithWorkbench, the carpenter bench's
ACTOR_TYPE_NPC = 0x00013794           # ActorTypeNPC, who may use a bench
HONEYCOMB = 0x000B08C5                # BeeHoneyComb
HONEYCOMB_SOUND = 0x0010FD51          # ITMIngredientBeehiveHuskUp, the comb's own sound

# The festival brews (#3152, SEASONAL FOOD AND DRINK above), here because the
# first and the last want the comb.
BREWS = (
    # item       recipe     editor id                          name                      inputs
    (0x501A040, 0x501A050, 'ThornswoodFoodBrewFirstPlanting', 'First Planting Mead',
     ((HONEYCOMB, 1), (LAVENDER, 1), (JUNIPER_BERRIES, 1))),
    (0x501A041, 0x501A051, 'ThornswoodFoodBrewMidyear', 'Midyear Jazbay Wine',
     ((JAZBAY_GRAPES, 2), (LAVENDER, 1))),
    (0x501A042, 0x501A052, 'ThornswoodFoodBrewHarvestsEnd', "Harvest's End Ale",
     ((WHEAT, 1), (JAZBAY_GRAPES, 1), (SNOWBERRIES, 1))),
    (0x501A043, 0x501A053, 'ThornswoodFoodBrewSaturalia', 'Saturalia Mulled Mead',
     ((HONEYCOMB, 1), (SNOWBERRIES, 1), (JUNIPER_BERRIES, 1))),
)

# A bench's furniture marker numbers, as Skyrim's own benches carry them: one
# marker, entered from the front (MNAM, FNPR), and its WBDT, the kind of bench
# and the skill it uses (01 is a bench that makes things from a recipe list).
BENCH_MARKERS = struct.pack('<I', 0x40000001)
BENCH_ENTRY = bytes([1, 0, 2, 0])

# Skyrim.esm's Charcoal (MISC 0x33760): the stick every grade and every small
# Thornswood item wears, its bounds, worth and weight.
CHARCOAL_MODEL = 'Clutter\\Quest\\TG06CharcoalStick.nif'
CHARCOAL_BOUNDS = (-1, -1, -7, 1, 1, 7)
CHARCOAL_VALUE, CHARCOAL_WEIGHT = 2, 0.5
# The bounds of the vanilla records that wear the key's and the mold's meshes:
# RiftenConfiscatedGoodsChestKey (KEYM 0x10E7E6) and TGTQ01SilverMold
# (MISC 0x44E12).
KEY_BOUNDS = (0, -12, -2, 0, 12, 2)
MOLD_BOUNDS = (-12, -12, 0, 12, 12, 24)

# The four grades of charcoal. docs/systems/professions/woodworker/charburner.md:
# the kiln's ladder, what each grade takes and makes, and that the grades are
# how hot a forge burns (smith.md). An item has no gold price here, so each
# grade is worth and weighs what Skyrim's own charcoal does.
CHARCOAL_GRADES = (
    # item, recipe, item editor id, recipe editor id, name, firewood in
    (0x5015481, 0x5015480, 'ThornswoodCharcoalTier1', 'ThornswoodRecipeCharcoalTier1', 'Poor Charcoal', 2),
    (0x5015482, 0x5015486, 'ThornswoodCharcoalTier2', 'ThornswoodRecipeCharcoalTier2', 'Charcoal', 4),
    (0x5015484, 0x5015487, 'ThornswoodCharcoalTier3', 'ThornswoodRecipeCharcoalTier3', 'Charcoal Briquette', 7),
    (0x5015485, 0x5015488, 'ThornswoodCharcoalTier4', 'ThornswoodRecipeCharcoalTier4', 'Coke', 12),
)

# The two tools a smith makes (smith/edgewright.md): an iron ingot and a
# handle each, at a forge.
RECIPE_PICKAXE = 0x501548D
RECIPE_AXE = 0x501548E
PICKAXE = 0x000E3C16      # Skyrim's Pickaxe
WOODCUTTERS_AXE = 0x0002F2F4  # Skyrim's Woodcutter's Axe

# THE BENCH TRADES' TOOLS (#3162). Patrick's A, 22 October 2026: each bench
# trade needs its own tool, worn out after 50 uses like a gathering tool
# (TOOLS in game/gamemode.js). The smith's hammer and the cook's ladle are
# Skyrim's own MISC records and only want a recipe. Skyrim has no shears, no
# alembic and no enchanter's blade a person could carry under a name that
# fits, so those three are this plugin's own, each on the model of a Skyrim
# MISC that has one. Model, bounds, value and weight read off Skyrim.esm on
# the box with scripts/dev/List-ToolRecords.py, 26 October 2026:
#   RuinsScissor 0x034CD4   Clutter\Ruins\RuinsScissor01.nif     (-21, -6, -1, 21, 6, 1)    3, 0.5
#   MGR01Alembic 0x026C31   Clutter\TolfdirsAlembic01\AlchemyTolfdirsAlembic01.nif
#                                                               (-15, -13, 0, 20, 10, 23)  0, 2.0
#   RuinsScalpel 0x034CCE   Clutter\Ruins\RuinsScalpel01.nif     (-14, -2, 0, 14, 2, 1)     3, 0.5
# Tolfdir's own alembic is a quest item and keeps its name; this is another
# record on the same mesh, so carrying one is never carrying his.
#
# Recipes: the hammer, the shears, the alembic and the rune knife at a forge,
# a smith's; the ladle at the woodworking bench from firewood, a woodwright's
# (Build-RecipeTable.ps1 RECIPE_OWNER names both). The hammer takes the
# handle the pickaxe, the axe and the shovel take. The forge row that makes
# a hammer asks for no hammer (benchToolKey), so a smith whose hammer broke
# can forge another. Form ids 0x501B000 on, a range no version of this plugin
# used (the potion recipes of #3470 took 0x50154F0 to F9 first).
HAMMER = 0x0005CAE1       # Skyrim's BlacksmithHammer01, TOOLS.smith.give
LADLE = 0x000319E5        # Skyrim's WoodenLadle01, TOOLS.cook.give
SHEARS = 0x501B000
ALEMBIC = 0x501B001
RUNE_KNIFE = 0x501B002
RECIPE_HAMMER = 0x501B003
RECIPE_SHEARS = 0x501B004
RECIPE_ALEMBIC = 0x501B005
RECIPE_RUNE_KNIFE = 0x501B006
RECIPE_LADLE = 0x501B007
SHEARS_MODEL = 'Clutter\\Ruins\\RuinsScissor01.nif'
SHEARS_BOUNDS = (-21, -6, -1, 21, 6, 1)
ALEMBIC_MODEL = 'Clutter\\TolfdirsAlembic01\\AlchemyTolfdirsAlembic01.nif'
ALEMBIC_BOUNDS = (-15, -13, 0, 20, 10, 23)
RUNE_KNIFE_MODEL = 'Clutter\\Ruins\\RuinsScalpel01.nif'
RUNE_KNIFE_BOUNDS = (-14, -2, 0, 14, 2, 1)

# THE INSTRUMENTS (#4509). Patrick, 9 November 2026, option A: the flute, lute
# and drum people own are Skyrim's own clutter ones, which cannot be equipped,
# not PlayFluteLuteDrum.esp's weapons, whose equip and playing are record
# scripts our client never runs. Nothing in the load order made Skyrim's
# three, so the Woodwright carves them here at the woodworking bench, the way
# the ladle is. PlayFluteLuteDrum.esp's own recipes, which turned these into
# the weapons, are hidden by Thornswood-Last.esp: that plugin loads after this
# one, so an override here would lose. Form ids follow the ladle's.
FLUTE = 0x000DABA7        # Skyrim's Flute (MISC)
LUTE = 0x000DABAB         # Skyrim's Lute (MISC)
DRUM = 0x000DABA9         # Skyrim's Drum (MISC)
RECIPE_FLUTE = 0x501B008
RECIPE_LUTE = 0x501B009
RECIPE_DRUM = 0x501B00A

# THE STATIONS.
#
# The charcoal kiln (charburner.md) is Skyrim's smelter marker furniture
# (CraftingSmelterMarker1, FURN 0x9C6CE): its mesh, bounds, markers and
# working animation, made a bench that makes things from a recipe list, under
# Thornswood's kiln keyword in place of the smelter's.
KILN = 0x501547E
KILN_MODEL = 'Furniture\\SmelterMarker.nif'
KILN_BOUNDS = (-229, -149, -34, 212, 305, 254)
# The Physicker's alchemy lab (physicker.md, injury.md) is Skyrim's alchemy lab
# (CraftingAlchemyWorkbench, FURN 0xBAD0C), made a bench that makes things
# from a recipe list, which Skyrim's own cannot be, under Thornswood's keyword.
ALCHEMY_LAB = 0x5042E69
ALCHEMY_MODEL = 'Furniture\\AlchemyWorkbench.nif'
ALCHEMY_BOUNDS = (-60, -10, -34, 60, 123, 112)
# The salt quarry (miner.md) wears Skyrim's moonstone vein (MineOreMoonstone02,
# ACTI 0xA2C4F), pale like salt, and its bounds. It is furniture nobody sits
# at: no markers. The server answers the swing.
SALT_QUARRY = 0x5DDE4EF
QUARRY_MODEL = 'Dungeons\\Mines\\Ore\\MineOreMoonstone02.nif'
QUARRY_BOUNDS = (-178, -236, -16, 151, 265, 8)
# The placed beehive (farmer.md: a farmer verb, 1 Honeycomb) wears Skyrim's hive
# (TG02BeeHive, ACTI 0x25D94) and its bounds, and gives what Skyrim's hives
# give, with the comb's own sound.
BEEHIVE = 0x5DBF8B3
BEEHIVE_MODEL = 'Clutter\\BeeHive\\BeeHive01.nif'
BEEHIVE_BOUNDS = (-115, -115, -19, 115, 115, 275)
# The woodworking bench (#516) is Hearthfire's carpenter workbench
# (BYOHHouseCarpentersWorkbench, FURN 0x3003065): its mesh, bounds, markers,
# working animation and flags, under Thornswood's keyword and without
# Hearthfire's two building keywords, which would list the house parts.
WOODWORKING_FLAGS = 0x0002


def own_record(tag, fid, pairs):
    return Rec(tag, 0, fid, FORM_TAIL, pack_subrecords(pairs))


def bounds(b):
    return struct.pack('<6h', *b)


def keywords(kws):
    return [(b'KSIZ', struct.pack('<I', len(kws))),
            (b'KWDA', b''.join(struct.pack('<I', k) for k in kws))]


def kywd(fid, edid):
    """A keyword: its editor id and nothing else."""
    return own_record(b'KYWD', fid, [(b'EDID', zstr(edid))])


def misc(fid, edid, name, model, box, value, weight, kws=(VENDOR_ITEM_TOOL,)):
    return own_record(b'MISC', fid, [
        (b'EDID', zstr(edid)), (b'OBND', bounds(box)), (b'FULL', zstr(name)),
        (b'MODL', zstr(model))] + keywords(kws) + [
        (b'DATA', struct.pack('<If', value, weight))])


def cobj(fid, edid, inputs, out, bench, makes=1, conditions=()):
    """A recipe: what goes in, what comes out and how many, at which bench.
    conditions are CTDA bodies, written before the output where the game reads them."""
    return own_record(b'COBJ', fid, [(b'EDID', zstr(edid)), (b'COCT', struct.pack('<I', len(inputs)))] +
                      [(b'CNTO', cnto(base, count)) for base, count in inputs] +
                      [(b'CTDA', c) for c in conditions] +
                      [(b'CNAM', struct.pack('<I', out)), (b'BNAM', struct.pack('<I', bench)),
                       (b'NAM1', struct.pack('<H', makes))])


def acti(fid, edid, box, name, model):
    return own_record(b'ACTI', fid, [(b'EDID', zstr(edid)), (b'OBND', bounds(box)),
                                     (b'FULL', zstr(name)), (b'MODL', zstr(model))])


def bench(fid, edid, box, name, model, kws, flags=0, skill=0xFF):
    """A bench that makes things from a recipe list, used by people."""
    return own_record(b'FURN', fid, [
        (b'EDID', zstr(edid)), (b'OBND', bounds(box)), (b'FULL', zstr(name)),
        (b'MODL', zstr(model))] + keywords(kws) + [
        (b'FNAM', struct.pack('<H', flags)), (b'KNAM', struct.pack('<I', ACTOR_TYPE_NPC)),
        (b'MNAM', BENCH_MARKERS), (b'WBDT', bytes([1, skill])), (b'FNPR', BENCH_ENTRY)])


def look_imad(fid, edid, look):
    """A screen look (#1382 drunk, #3153 the rest): an IMAD laid out the way
    dunSleepingTreeCampISMD is, every keyed list two keys long, its values the
    look's and the rest neutral."""
    dnam = bytearray(244)
    struct.pack_into('<If', dnam, 0, 0, 1.0)           # not animatable; a duration of 1
    for at in list(range(8, 200, 4)) + [212, 216, 220, 228, 232, 236, 240]:
        struct.pack_into('<I', dnam, at, 2)             # how many keys each list holds
    struct.pack_into('<ff', dnam, 204, 0.5, 0.5)        # the radial blur's centre: the middle

    def keyed(value):
        return struct.pack('<4f', 0.0, value, 1.0, value)

    def colour(rgba=(1.0, 1.0, 1.0, 0.0)):
        # Time, red, green, blue, and how much, the same at both keys.
        return struct.pack('<5f', 0.0, *rgba) + struct.pack('<5f', 1.0, *rgba)

    pairs = [(b'EDID', zstr(edid)), (b'DNAM', bytes(dnam)),
             (b'BNAM', keyed(look.get(b'BNAM', 0.0))), (b'VNAM', keyed(look.get(b'VNAM', 0.0))),
             (b'TNAM', colour(look.get(b'TNAM', (1.0, 1.0, 1.0, 0.0)))), (b'NAM3', colour())]
    for tag in (b'RNAM', b'SNAM', b'UNAM', b'NAM1', b'NAM2', b'WNAM', b'XNAM', b'YNAM', b'NAM4'):
        pairs.append((tag, keyed(look.get(tag, 0.0))))
    # The HDR and cinematic lists: each one a multiply (times one unless the
    # look says) and an add (nothing).
    iad = look.get('iad', {})
    for i in range(21):
        pairs.append((bytes([i]) + b'IAD', keyed(iad.get(i, 1.0))))
        pairs.append((bytes([0x40 + i]) + b'IAD', keyed(0.0)))
    return own_record(b'IMAD', fid, pairs)


def needs_records():
    """Tea, its recipes and its effect (#1382), and the screen looks (#1382, #3153)."""
    data = bytearray(TEA_EFFECT_DATA)
    struct.pack_into('<I', data, 0, TEA_EFFECT_FLAGS)
    out = [own_record(b'MGEF', TEA_EFFECT, [
        (b'EDID', zstr('ThornswoodTeaSteepEffect')), (b'FULL', zstr('Steeped')),
        (b'DATA', bytes(data)), (b'SNDD', b''), (b'DNAM', zstr(TEA_EFFECT_WORDS))])]
    for item, recipe, edid, name, herb in TEAS:
        out.append(own_record(b'ALCH', item, [
            (b'EDID', zstr(edid)), (b'OBND', bounds(TEA_BOUNDS)), (b'FULL', zstr(name))] +
            keywords((VENDOR_ITEM_FOOD,)) + [
            (b'MODL', zstr(TEA_MODEL)), (b'YNAM', struct.pack('<I', TEA_PICK_UP)),
            (b'DATA', struct.pack('<f', TEA_WEIGHT)),
            # Worth, no auto calc and a food item, no addiction, the drinking sound.
            (b'ENIT', struct.pack('<iIIfI', TEA_VALUE, 0x3, 0, 0.0, TEA_DRINK)),
            (b'EFID', struct.pack('<I', TEA_EFFECT)), (b'EFIT', struct.pack('<fII', 0.0, 0, 0))]))
    for item, recipe, edid, name, herb in TEAS:
        out.append(cobj(recipe, edid.replace('ThornswoodFood', 'ThornswoodRecipe'),
                        [(herb, TEA_HERBS)], item, COOKPOT_KEYWORD))
    out.append(look_imad(DRUNK_IMOD, 'ThornswoodDrunkImod', DRUNK_LOOK))
    out.append(look_imad(HIGH_IMOD, 'ThornswoodHighImod', HIGH_LOOK))
    out.append(look_imad(HANGOVER_IMOD, 'ThornswoodHangoverImod', HANGOVER_LOOK))
    out.append(look_imad(WITHDRAWAL_IMOD, 'ThornswoodWithdrawalImod', WITHDRAWAL_LOOK))
    out += quality_effects()
    out += spoiled_records()
    # The verb on the crosshair says what activating it does.
    out.append(own_record(b'ACTI', WELL_BUCKET, [
        (b'EDID', zstr('ThornswoodActivatorWellBucket')), (b'OBND', bounds(WELL_BUCKET_BOUNDS)),
        (b'FULL', zstr('Well Bucket')), (b'MODL', zstr(WELL_BUCKET_MODEL)), (b'RNAM', zstr('Draw Water'))]))
    out.append(own_record(b'ACTI', RIVER_BUCKET, [
        (b'EDID', zstr('ThornswoodActivatorWaterBucket')), (b'OBND', bounds(WELL_BUCKET_BOUNDS)),
        (b'FULL', zstr('Water Bucket')), (b'MODL', zstr(WELL_BUCKET_MODEL)), (b'RNAM', zstr('Draw Water'))]))
    out.append(own_record(b'ACTI', STUDY_DESK, [
        (b'EDID', zstr('ThornswoodActivatorStudyDesk')), (b'OBND', bounds(STUDY_DESK_BOUNDS)),
        (b'FULL', zstr('Study Desk')), (b'MODL', zstr(STUDY_DESK_MODEL)), (b'RNAM', zstr('Study'))]))
    return out


def quality_effects():
    """The burnt meal's and the fine dish's effects (#2906), the tea's kind of
    effect: a script effect with no script, which says what the server does."""
    data = bytearray(TEA_EFFECT_DATA)
    struct.pack_into('<I', data, 0, TEA_EFFECT_FLAGS)
    return [own_record(b'MGEF', fid, [
        (b'EDID', zstr(edid)), (b'FULL', zstr(name)),
        (b'DATA', bytes(data)), (b'SNDD', b''), (b'DNAM', zstr(words))])
        for fid, edid, name, words in (
            (BURNT_EFFECT, 'ThornswoodBurntEffect', 'Burnt', BURNT_EFFECT_WORDS),
            (FINE_EFFECT, 'ThornswoodFineEffect', 'Fine', FINE_EFFECT_WORDS))]


def spoiled_records():
    """Spoiled food and its effect (#3163). See SPOILED_FOOD."""
    data = bytearray(TEA_EFFECT_DATA)
    struct.pack_into('<I', data, 0, TEA_EFFECT_FLAGS)
    return [
        own_record(b'MGEF', SPOILED_EFFECT, [
            (b'EDID', zstr('ThornswoodSpoiledEffect')), (b'FULL', zstr('Spoiled')),
            (b'DATA', bytes(data)), (b'SNDD', b''), (b'DNAM', zstr(SPOILED_EFFECT_WORDS))]),
        own_record(b'ALCH', SPOILED_FOOD, [
            (b'EDID', zstr(SPOILED_FOOD_EDID)), (b'OBND', bounds(SPOILED_BOUNDS)),
            (b'FULL', zstr(SPOILED_FOOD_NAME)), (b'MODL', zstr(SPOILED_MODEL)),
            (b'DATA', struct.pack('<f', SPOILED_WEIGHT)),
            # Worth nothing, no auto calc and a food item, no addiction, the eating sound.
            (b'ENIT', struct.pack('<iIIfI', 0, 0x3, 0, 0.0, SPOILED_EAT_SOUND)),
            (b'EFID', struct.pack('<I', SPOILED_EFFECT)), (b'EFIT', struct.pack('<fII', 0.0, 0, 0))])]


def quality_wanted(plugin_masters, plugin_name):
    """[(form id, editor id, name, the dish whose look it wears, effect)] for
    the burnt meal and every fine dish in food-groups.json's quality block."""
    table = json.load(open(FOOD_GROUPS_TABLE, encoding='utf-8'))
    quality = table.get('quality') or {}
    recipes = json.load(open(RECIPE_TABLE, encoding='utf-8'))['recipes']
    names = {}
    for row in recipes.values():
        names.setdefault(row.get('out'), row.get('name'))
    # The festival feasts are this plugin's own (#3152), named here before the
    # recipe table is built from the plugin that holds them.
    for item, recipe, edid, name, bench_kw, inputs, model, box, weight in FEASTS:
        names.setdefault('%x:%s' % (item & 0xFFFFFF, plugin_name), name)
    out = [(local_fid(quality['burnt'], plugin_masters, plugin_name), BURNT_MEAL_EDID, BURNT_MEAL_NAME,
            BURNT_MEAL_LOOK, BURNT_EFFECT)]
    for plain, fine in sorted(quality.get('fine', {}).items(), key=lambda kv: kv[1]):
        name = names.get(plain)
        if not name:
            raise SystemExit('STOP. %s has a fine record and no recipe makes it (game\\data\\recipes.json). '
                             'Nothing was written.' % plain)
        # An apostrophe is dropped, not a break: Harvest's End is HarvestsEnd.
        edid = 'ThornswoodFoodFine' + ''.join(w[:1].upper() + w[1:] for w in
                                               ''.join(c if c.isalnum() else ' '
                                                       for c in name.replace("'", '')).split())
        out.append((local_fid(fine, plugin_masters, plugin_name), edid, 'Fine ' + name, plain, FINE_EFFECT))
    return out


def dish_look(masters_dir, desc, plugin_masters, problems):
    """The look of a dish, as [(tag, bytes)] in this plugin's numbering, read
    from the plugin that made it. A form id from a file this plugin does not
    master is added to problems, and None comes back."""
    local, _, master = desc.partition(':')
    path = os.path.join(masters_dir, master)
    if not os.path.isfile(path):
        problems.append('%s is not in %s' % (master, masters_dir))
        return None
    buf = open(path, 'rb').read()
    src_masters = masters_of(buf)
    rec = record_in(buf, b'ALCH', (len(src_masters) << 24) | int(local, 16))
    if rec is None:
        problems.append('%s has no ALCH %s' % (master, local))
        return None
    data = rec.data
    if rec.compressed:
        data = zlib.decompress(data[4:])
    names = [m.lower() for m in plugin_masters]
    mapping = [names.index(m.lower()) if m.lower() in names else None for m in src_masters + [master]]
    out = []
    for t, b in subrecords(data):
        if t not in LOOK_FIELDS:
            continue
        b = bytearray(b)
        for o in LOOK_FIELDS[t]:
            v = struct.unpack_from('<I', b, o)[0]
            if not v:
                continue
            idx = v >> 24
            if idx >= len(mapping) or mapping[idx] is None:
                problems.append('%s %s names 0x%08X, from %s, which this plugin does not master'
                                % (desc, t.decode(), v, (src_masters + [master])[idx]
                                   if idx < len(mapping) else 'outside its masters'))
                return None
            struct.pack_into('<I', b, o, (mapping[idx] << 24) | (v & 0xFFFFFF))
        if t == b'ENIT':
            struct.pack_into('<If', b, 8, 0, 0.0)   # no addiction
        out.append((t, bytes(b)))
    got = [t for t, _ in out]
    for t in (b'OBND', b'MODL', b'DATA', b'ENIT'):
        if t not in got:
            problems.append('%s carries no %s' % (desc, t.decode()))
            return None
    return out


def quality_record(fid, edid, name, look, effect):
    """A burnt meal or a fine dish (#2906): the look, this plugin's name and
    keyword, and its one effect."""
    def field(t):
        return [(t2, b) for t2, b in look if t2 == t]
    pairs = ([(b'EDID', zstr(edid))] + field(b'OBND') + [(b'FULL', zstr(name))] +
             keywords((VENDOR_ITEM_FOOD,)) + field(b'MODL') + field(b'MODT') + field(b'YNAM') +
             field(b'ZNAM') + field(b'DATA') + field(b'ENIT') +
             [(b'EFID', struct.pack('<I', effect)), (b'EFIT', struct.pack('<fII', 0.0, 0, 0))])
    return own_record(b'ALCH', fid, pairs)


def feast_look(model, box, weight):
    """A festival feast's look (#3152), as [(tag, bytes)] the way dish_look
    answers one, so its fine record wears the same."""
    return [(b'OBND', bounds(box)), (b'MODL', zstr(model)), (b'DATA', struct.pack('<f', weight)),
            # Worth, no auto calc and a food item, no addiction, the eating sound.
            (b'ENIT', struct.pack('<iIIfI', FEAST_VALUE, 0x3, 0, 0.0, FEAST_EAT))]


def seasonal_records():
    """The festival feasts and brews, their recipes and their two effects
    (#3152)."""
    data = bytearray(TEA_EFFECT_DATA)
    struct.pack_into('<I', data, 0, TEA_EFFECT_FLAGS)
    out = [own_record(b'MGEF', fid, [
        (b'EDID', zstr(edid)), (b'FULL', zstr(name)),
        (b'DATA', bytes(data)), (b'SNDD', b''), (b'DNAM', zstr(words))])
        for fid, edid, name, words in (
            (FEAST_EFFECT, 'ThornswoodFeastEffect', 'Feast', FEAST_EFFECT_WORDS),
            (BREW_EFFECT, 'ThornswoodBrewEffect', 'Festival Brew', BREW_EFFECT_WORDS))]
    for item, recipe, edid, name, bench_kw, inputs, model, box, weight in FEASTS:
        out.append(quality_record(item, edid, name, feast_look(model, box, weight), FEAST_EFFECT))
    for item, recipe, edid, name, inputs in BREWS:
        out.append(own_record(b'ALCH', item, [
            (b'EDID', zstr(edid)), (b'OBND', bounds(TEA_BOUNDS)), (b'FULL', zstr(name))] +
            keywords((VENDOR_ITEM_FOOD,)) + [
            (b'MODL', zstr(TEA_MODEL)), (b'YNAM', struct.pack('<I', TEA_PICK_UP)),
            (b'DATA', struct.pack('<f', TEA_WEIGHT)),
            (b'ENIT', struct.pack('<iIIfI', TEA_VALUE, 0x3, 0, 0.0, TEA_DRINK)),
            (b'EFID', struct.pack('<I', BREW_EFFECT)), (b'EFIT', struct.pack('<fII', 0.0, 0, 0))]))
    for item, recipe, edid, name, bench_kw, inputs, model, box, weight in FEASTS:
        out.append(cobj(recipe, edid.replace('ThornswoodFood', 'ThornswoodRecipe'), list(inputs), item, bench_kw))
    for item, recipe, edid, name, inputs in BREWS:
        out.append(cobj(recipe, edid.replace('ThornswoodFood', 'ThornswoodRecipe'), list(inputs), item,
                        COOKPOT_KEYWORD))
    return out


def thornswood_records(passage, clam, passages):
    """Every record this tool writes from its own numbers, in the order it
    writes new ones. passage is the Whiterun passage book, Thornswood's own
    since 13 September, which the deed is made from; clam is Skyrim's Clam01,
    which the catches are made from; passages is the ten passage books by
    editor id, each written over with its PASSAGE_WORDS."""
    out = [
        kywd(KILN_KEYWORD, 'ThornswoodCraftingCharcoalKiln'),
        kywd(ALCHEMY_KEYWORD, 'ThornswoodCraftingAlchemy'),
        kywd(WOODWORKING_KEYWORD, 'ThornswoodCraftingWoodworking'),
        acti(BOARD, 'ThornswoodMessageBoard', BOARD_BOUNDS, 'Message Board', BOARD_MODEL),
        acti(DROP_BOX, 'ThornswoodDropBox', DROP_BOX_BOUNDS, 'Drop Box', DROP_BOX_MODEL),
        own_record(b'FLOR', BEEHIVE, [
            (b'EDID', zstr('ThornswoodFloraBeehive')), (b'OBND', bounds(BEEHIVE_BOUNDS)),
            (b'FULL', zstr('Beehive')), (b'MODL', zstr(BEEHIVE_MODEL)),
            (b'FNAM', struct.pack('<H', 0)), (b'PFIG', struct.pack('<I', HONEYCOMB)),
            (b'SNAM', struct.pack('<I', HONEYCOMB_SOUND)),
            # Every season: the server keeps the hive's clock (farmer.md).
            (b'PFPC', bytes([100, 100, 100, 100]))]),
        bench(KILN, 'ThornswoodCraftingCharcoalKilnMarker', KILN_BOUNDS, 'Charcoal Kiln', KILN_MODEL,
              (FURNITURE_FORCE_3RD, FURNITURE_SPECIAL, IS_SMELTER, KILN_KEYWORD, RACE_TO_SCALE)),
        bench(ALCHEMY_LAB, 'ThornswoodCraftingAlchemyWorkbench', ALCHEMY_BOUNDS, 'Alchemy Lab',
              ALCHEMY_MODEL,
              (FURNITURE_FORCE_3RD, FURNITURE_SPECIAL, IS_ALCHEMY, ALCHEMY_KEYWORD, RACE_TO_SCALE),
              skill=0x10),
        own_record(b'FURN', SALT_QUARRY, [
            (b'EDID', zstr('ThornswoodFurnitureSaltMine')), (b'OBND', bounds(QUARRY_BOUNDS)),
            (b'FULL', zstr('Salt Quarry')), (b'MODL', zstr(QUARRY_MODEL)),
            (b'FNAM', struct.pack('<H', 0)), (b'MNAM', struct.pack('<I', 0)),
            (b'WBDT', bytes([0, 0xFF]))]),
        bench(WOODWORKING_BENCH, 'ThornswoodCraftingWoodworkingWorkbench', WOODWORKING_BOUNDS,
              WOODWORKING_FULL, WOODWORKING_MODEL,
              (FURNITURE_FORCE_3RD, FURNITURE_SPECIAL, RACE_TO_SCALE, IS_BLACKSMITH_WORKBENCH,
               WOODWORKING_KEYWORD), flags=WOODWORKING_FLAGS),
    ]
    for item, recipe, item_id, recipe_id, name, logs in CHARCOAL_GRADES:
        out.append(misc(item, item_id, name, CHARCOAL_MODEL, CHARCOAL_BOUNDS,
                        CHARCOAL_VALUE, CHARCOAL_WEIGHT))
    for item, recipe, item_id, recipe_id, name, logs in CHARCOAL_GRADES:
        out.append(cobj(recipe, recipe_id, [(FIREWOOD, logs)], item, KILN_KEYWORD))

    def stick(fid, edid, name, value, weight):
        return misc(fid, edid, name, CHARCOAL_MODEL, CHARCOAL_BOUNDS, value, weight)

    out += [
        cobj(RECIPE_PICKAXE, 'ThornswoodRecipeWeaponPickaxe', [(IRON_INGOT, 1), (HANDLE, 1)],
             PICKAXE, FORGE_KEYWORD),
        cobj(RECIPE_AXE, 'ThornswoodRecipeWeaponAxe', [(IRON_INGOT, 1), (HANDLE, 1)],
             WOODCUTTERS_AXE, FORGE_KEYWORD),
        stick(HANDLE, 'ThornswoodMiscToolHandle', 'Tool Handle', HANDLE_VALUE, HANDLE_WEIGHT),
        cobj(RECIPE_HANDLE, 'ThornswoodRecipeToolHandle', [(FIREWOOD, 1)], HANDLE, KILN_KEYWORD),
        cobj(RECIPE_SHOVEL, 'ThornswoodRecipeToolShovel', [(IRON_INGOT, 1), (HANDLE, 1)],
             SHOVEL, FORGE_KEYWORD),
        clone(passage, DEED, 'ThornswoodBookDeed', sets={
            b'FULL': zstr('Deed'), b'DESC': zstr(DEED_WORDS)}),
    ] + [
        clone(passages[name], passages[name].fid, name, sets={b'DESC': zstr(PASSAGE_WORDS[name])})
        for name in PASSAGE_WORDS
    ] + [
        misc(KEY, 'ThornswoodMiscKey', 'Key', KEY_MODEL, KEY_BOUNDS, 0, 0.0),
        misc(MOLD, 'ThornswoodMiscKeyMold', 'Key Mold', MOLD_MODEL, MOLD_BOUNDS, 25, 1.0),
        cobj(RECIPE_MOLD, 'ThornswoodRecipeKeyMold', [(IRON_INGOT, 1)], MOLD, FORGE_KEYWORD),
        # Never listed (#2487): a key is cut by the server, named, at the forge's lock key.
        cobj(RECIPE_KEY, 'ThornswoodRecipeKey', [(IRON_INGOT, 1)], KEY, FORGE_KEYWORD,
             conditions=(NEVER_TRUE,)),
        stick(POLE_CRUDE, 'ThornswoodMiscPoleCrude', 'Crude Fishing Pole', 25, 1.0),
        stick(POLE_FINE, 'ThornswoodMiscPoleFine', 'Fine Fishing Pole', 80, 1.0),
        stick(POLE_MASTER, 'ThornswoodMiscPoleMaster', 'Master Fishing Pole', 200, 1.0),
        stick(FISH_TRAP, 'ThornswoodMiscFishTrap', 'Fish Trap', 10, 0.5),
        cobj(RECIPE_POLE_CRUDE, 'ThornswoodRecipePoleCrude',
             [(FIREWOOD, 2), (LEATHER_STRIPS, 1), (TUNDRA_COTTON, 2)], POLE_CRUDE, WOODWORKING_KEYWORD),
        cobj(RECIPE_POLE_FINE, 'ThornswoodRecipePoleFine',
             [(FIREWOOD, 2), (LEATHER_STRIPS, 1), (STEEL_INGOT, 1), (TUNDRA_COTTON, 3)],
             POLE_FINE, WOODWORKING_KEYWORD),
        cobj(RECIPE_POLE_MASTER, 'ThornswoodRecipePoleMaster',
             [(FIREWOOD, 3), (LEATHER_STRIPS, 2), (STEEL_INGOT, 1), (REFINED_MOONSTONE, 1)],
             POLE_MASTER, WOODWORKING_KEYWORD),
        cobj(RECIPE_TRAP, 'ThornswoodRecipeFishTrap',
             [(FIREWOOD, 3), (LEATHER_STRIPS, 2), (IRON_INGOT, 1)], FISH_TRAP, WOODWORKING_KEYWORD),
        # The bench trades' tools (#3162), THE BENCH TRADES' TOOLS above.
        misc(SHEARS, 'ThornswoodMiscToolShears', 'Shears', SHEARS_MODEL, SHEARS_BOUNDS, 3, 0.5),
        misc(ALEMBIC, 'ThornswoodMiscToolAlembic', 'Alembic', ALEMBIC_MODEL, ALEMBIC_BOUNDS, 0, 2.0),
        misc(RUNE_KNIFE, 'ThornswoodMiscToolRuneKnife', 'Rune Knife', RUNE_KNIFE_MODEL, RUNE_KNIFE_BOUNDS, 3, 0.5),
        cobj(RECIPE_HAMMER, 'ThornswoodRecipeToolHammer', [(IRON_INGOT, 1), (HANDLE, 1)], HAMMER, FORGE_KEYWORD),
        cobj(RECIPE_SHEARS, 'ThornswoodRecipeToolShears', [(IRON_INGOT, 1)], SHEARS, FORGE_KEYWORD),
        cobj(RECIPE_ALEMBIC, 'ThornswoodRecipeToolAlembic', [(IRON_INGOT, 2)], ALEMBIC, FORGE_KEYWORD),
        cobj(RECIPE_RUNE_KNIFE, 'ThornswoodRecipeToolRuneKnife', [(IRON_INGOT, 1), (LEATHER_STRIPS, 1)],
             RUNE_KNIFE, FORGE_KEYWORD),
        cobj(RECIPE_LADLE, 'ThornswoodRecipeToolLadle', [(FIREWOOD, 1)], LADLE, WOODWORKING_KEYWORD),
        # Skyrim's own instruments (#4509), THE INSTRUMENTS above.
        cobj(RECIPE_FLUTE, 'ThornswoodRecipeInstrumentFlute', [(FIREWOOD, 1)], FLUTE, WOODWORKING_KEYWORD),
        cobj(RECIPE_LUTE, 'ThornswoodRecipeInstrumentLute', [(FIREWOOD, 2), (LEATHER_STRIPS, 2)],
             LUTE, WOODWORKING_KEYWORD),
        cobj(RECIPE_DRUM, 'ThornswoodRecipeInstrumentDrum', [(FIREWOOD, 2), (LEATHER, 1), (LEATHER_STRIPS, 1)],
             DRUM, WOODWORKING_KEYWORD),
    ]

    def catch(fid, edid, name, produce):
        return clone(clam, fid, edid, sets={b'FULL': zstr(name), b'PFIG': struct.pack('<I', produce)})

    out += [
        catch(CATCH_HISTCARP, 'ThornswoodFishHistcarp', 'Histcarp', HISTCARP),
        catch(CATCH_RIVER_BETTY, 'ThornswoodFishRiverBetty', 'River Betty', RIVER_BETTY),
        catch(CATCH_SCALES, 'ThornswoodFishSlaughterfishScales', 'Slaughterfish Scales',
              SLAUGHTERFISH_SCALES),
        catch(CATCH_PERCH, 'ThornswoodFishSilversidePerch', 'Silverside Perch', SILVERSIDE_PERCH),
        catch(CATCH_SPADETAIL, 'ThornswoodFishCyrodilicSpadetail', 'Cyrodilic Spadetail',
              CYRODILIC_SPADETAIL),
        catch(CATCH_LONGFIN, 'ThornswoodFishAbeceanLongfin', 'Abecean Longfin', ABECEAN_LONGFIN),
        stick(WEAPON_KIT, 'ThornswoodMiscWeaponKit', 'Weapon Kit', METAL_KIT_VALUE, METAL_KIT_WEIGHT),
        stick(ARMOR_KIT, 'ThornswoodMiscArmorKit', 'Armor Kit', METAL_KIT_VALUE, METAL_KIT_WEIGHT),
        stick(SEWING_KIT, 'ThornswoodMiscSewingKit', 'Sewing Kit', SEWING_KIT_VALUE, SEWING_KIT_WEIGHT),
        cobj(RECIPE_WEAPON_KIT, 'ThornswoodRecipeWeaponKit', [(IRON_INGOT, 1), (LEATHER_STRIPS, 1)],
             WEAPON_KIT, FORGE_KEYWORD),
        cobj(RECIPE_ARMOR_KIT, 'ThornswoodRecipeArmorKit', [(IRON_INGOT, 1), (LEATHER, 1)],
             ARMOR_KIT, FORGE_KEYWORD),
        cobj(RECIPE_SEWING_KIT, 'ThornswoodRecipeSewingKit', [(TUNDRA_COTTON, 1), (LEATHER_STRIPS, 1)],
             SEWING_KIT, TANNING_KEYWORD),
        stick(BANDAGE, 'ThornswoodMiscBandage', 'Bandage', BANDAGE_VALUE, BANDAGE_WEIGHT),
        stick(SPLINT, 'ThornswoodMiscSplint', 'Splint', SPLINT_VALUE, SPLINT_WEIGHT),
        stick(POULTICE, 'ThornswoodMiscPoultice', 'Poultice', POULTICE_VALUE, POULTICE_WEIGHT),
        stick(REMEDY, 'ThornswoodMiscRemedy', "Physicker's Remedy", REMEDY_VALUE, REMEDY_WEIGHT),
        cobj(RECIPE_BANDAGE, 'ThornswoodRecipeBandage', [(TUNDRA_COTTON, 1)], BANDAGE, LOOM_KEYWORD),
        cobj(RECIPE_SPLINT, 'ThornswoodRecipeSplint', [(FIREWOOD, 1), (LEATHER_STRIPS, 1)],
             SPLINT, KILN_KEYWORD),
        cobj(RECIPE_POULTICE, 'ThornswoodRecipePoultice', [(TUNDRA_COTTON, 1), (GARLIC, 1)],
             POULTICE, ALCHEMY_KEYWORD),
        cobj(RECIPE_REMEDY, 'ThornswoodRecipeRemedy', [(MUDCRAB_CHITIN, 1), (BLUE_MOUNTAIN_FLOWER, 1)],
             REMEDY, ALCHEMY_KEYWORD),
    ] + [
        cobj(fid, edid, [(globals()[name], 1) for name in inputs], potion, ALCHEMY_KEYWORD)
        for fid, edid, potion, inputs in POTION_RECIPES
    ] + [
        misc(MASTER_KEY, 'ThornswoodMiscMasterKey', 'Master Key', KEY_MODEL, KEY_BOUNDS, 0, 0.0),
    ]
    # Tea, its recipes and the screen looks (#1382, #3153).
    out += needs_records()
    # Placeable furniture (#2679), one MISC and one woodworking recipe a row.
    out += furniture_records()
    out += quest_records()
    return out


# THE FURNITURE (#2679). game\data\furniture.json is staff data: each row is
# a piece a holder sets down in a building they may arrange, the MISC that
# carries it in a pack and the woodworking recipe that makes it. A row is
# written only while its type is on in limits.types, so a static (STAT, off
# until a dev check shows the server keeps a placed one) is never a thing
# somebody can make and not set down. The form ids are the row's own, so
# turning a type on or off renumbers nothing. The item is the charcoal stick in
# a pack, as every crafted MISC of this plugin is: the piece is what stands.
FURNITURE_CATALOG = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                                                 'game', 'data', 'furniture.json'))
FURNITURE_RANGE = (0x5016000, 0x5016FFF)


def furniture_rows(path=FURNITURE_CATALOG):
    """The catalog's rows whose type is on, each checked: its ids in the range
    this plugin keeps for furniture, its inputs Skyrim.esm records."""
    doc = json.load(open(path, encoding='utf-8'))
    types = (doc.get('limits') or {}).get('types') or {}
    rows, seen = [], set()
    for row in doc.get('pieces') or []:
        if not types.get(row.get('type')):
            continue
        item = 0x5000000 | int(row['item'], 16)
        recipe = 0x5000000 | int(row['recipe'], 16)
        for fid in (item, recipe):
            if not FURNITURE_RANGE[0] <= fid <= FURNITURE_RANGE[1] or fid in seen:
                raise SystemExit('STOP. furniture row %s: 0x%07X is outside 0x%07X-0x%07X or taken twice. '
                                 'Nothing was written.' % (row.get('key'), fid, FURNITURE_RANGE[0],
                                                           FURNITURE_RANGE[1]))
            seen.add(fid)
        inputs = []
        for desc, count in row['inputs']:
            local, _, master = desc.partition(':')
            if master.lower() != 'skyrim.esm' or int(count) < 1:
                raise SystemExit('STOP. furniture row %s takes %s x%s; an input is a Skyrim.esm record, '
                                 'one or more. Nothing was written.' % (row.get('key'), desc, count))
            inputs.append((int(local, 16), int(count)))
        rows.append((item, recipe, row['edid'], row['name'], int(row['value']), float(row['weight']), inputs))
    return rows


def furniture_records():
    out = []
    for item, recipe, edid, name, value, weight, inputs in furniture_rows():
        out.append(misc(item, edid, name, CHARCOAL_MODEL, CHARCOAL_BOUNDS, value, weight))
        out.append(cobj(recipe, edid.replace('ThornswoodFurniture', 'ThornswoodRecipeFurniture'),
                        inputs, item, WOODWORKING_KEYWORD))
    return out


# The register of the salvaged records (#2553), written by
# scripts\mods\List-SalvagedRecords.py.
SALVAGED_REGISTER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'content-salvaged.json')


def body_hash(data):
    """A record's subrecords without its editor id, hashed the way
    List-SalvagedRecords.py hashes every salvaged version."""
    import hashlib
    rest = b''.join(t + struct.pack('<I', len(b)) + b for t, b in subrecords(data) if t != b'EDID')
    return hashlib.sha256(rest).hexdigest()


def local_fid(desc, plugin_masters, plugin_name):
    """A descriptor (object id:plugin) as this plugin writes the form id."""
    obj, owner = desc.split(':', 1)
    names = [m.lower() for m in plugin_masters]
    if owner.lower() == plugin_name.lower():
        return (len(names) << 24) | int(obj, 16)
    return (names.index(owner.lower()) << 24) | int(obj, 16)


def drop_bare_parents(kids, dropped):
    """kids without a group that holds nothing, and without a CELL or WRLD
    record whose children group is gone. A cell record with no placements of
    this plugin's under it is an override of Bethesda's cell that changes
    nothing Thornswood needs. The form id of each record dropped is added to
    dropped.

    THE GROUPS GO FIRST, AND AN EMPTY ONE GOES HOWEVER IT GOT EMPTY (#2790).
    A placement the station table moves is taken out of its old cell with a
    plain remove from its list, which leaves that cell's temporary group with
    nothing in it. Until 21 October this judged the cell before its groups
    and kept any group that arrived empty, so the empty group held the cell
    record up: CELL 0x8ED5, DawnstarWesternMineExterior, copied for the
    Dawnstar kiln and salt quarry in #2629 and left when the station table
    put them in Dawnstar03Exterior, sat in the plugin identical to
    HearthFires.esm's, holding an empty group (Check-PluginClean.py, run
    against the dev server's masters)."""
    pruned = []
    for k in kids:
        if isinstance(k, Grup):
            k.kids = drop_bare_parents(k.kids, dropped)
            if not k.kids:
                continue
        pruned.append(k)
    out = []
    for i, k in enumerate(pruned):
        if not isinstance(k, Grup) and k.tag in (b'CELL', b'WRLD'):
            nxt = pruned[i + 1] if i + 1 < len(pruned) else None
            want = 6 if k.tag == b'CELL' else 1
            if not (isinstance(nxt, Grup) and struct.unpack_from('<I', nxt.label, 0)[0] == k.fid
                    and struct.unpack_from('<i', nxt.label, 4)[0] == want):
                dropped.add(k.fid)
                continue
        out.append(k)
    return out


def orphan_groups(kids, prev=None):
    """Children groups (a cell's, a world's) whose own record is not just
    before them. There should be none."""
    bad = []
    for k in kids:
        if isinstance(k, Grup):
            gt = struct.unpack_from('<i', k.label, 4)[0]
            label = struct.unpack_from('<I', k.label, 0)[0]
            if gt in (1, 6):
                want = b'WRLD' if gt == 1 else b'CELL'
                if not (isinstance(prev, Rec) and prev.tag == want and prev.fid == label):
                    bad.append(label)
            bad += orphan_groups(k.kids)
        prev = k
    return bad


def bethesdas_world_records(masters_dir, plugin_masters, wanted):
    """{(tag, fid): data} for the CELL and WRLD records in wanted, each the
    winning master's own record, every form id in this plugin's numbering and
    every localised name written in plain. Read with Build-LastPlugin.py's
    reader and copier, the ones Thornswood-Last.esp is made with. None when
    the masters are not in masters_dir."""
    import importlib.util
    paths = [os.path.join(masters_dir, m) for m in plugin_masters]
    if not all(os.path.isfile(p) for p in paths):
        return None
    spec = importlib.util.spec_from_file_location(
        'build_last_plugin', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Build-LastPlugin.py'))
    last = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(last)
    names = [m.lower() for m in plugin_masters]
    want = {(t, (names[f >> 24], f & 0xFFFFFF)) for t, f in wanted}
    win = {}
    plugins = []
    for i, (m, p) in enumerate(zip(plugin_masters, paths)):
        src = last.Plugin(p, m, i)
        plugins.append(src)
        for e in src.walk({b'CELL', b'WRLD'}):
            key = (e.tag, src.gid(e.fid))
            if key in want:
                win[key] = (src, e)
    tables = {}

    def strings(src, kind):
        if (src.name, kind) not in tables:
            tables[(src.name, kind)] = last.string_table(masters_dir, src.name, kind)
        return tables[(src.name, kind)]

    rn = last.Renumber()
    rn.masters = names
    out = {}
    for t, f in wanted:
        key = (t, (names[f >> 24], f & 0xFFFFFF))
        if key not in win:
            raise SystemExit('STOP. no master of this plugin has %s 0x%08X. Nothing was written.'
                             % (t.decode(), f))
        src, e = win[key]
        what = '%s %s 0x%08X' % (src.name, t.decode(), e.fid)
        # Where an interior or exterior cell sits among the groups: its block
        # and sub-block labels, the master's own, which are the same in every
        # file because they come from the cell's grid or its object id.
        ctx = None
        if t == b'CELL':
            world, block, sub, persistent = e.ctx
            if persistent or block is None or sub is None:
                raise SystemExit('STOP. %s is a worldspace\'s persistent cell, which this does not place in. '
                                 'Nothing was written.' % what)
            ctx = (block, sub, world is not None)
        out[(t, f)] = (e.flags & ~COMPRESSED,
                       last.pack_subrecords(last.copy_record(src, e, rn, strings, what)), src.name, ctx)
    return out


# THE STATIONS' PLACEMENTS (#2553). Patrick, 16 October 2026, A on #2553:
# Thornswood measures its own spots for its kilns, salt quarries, beehives and
# alchemy labs, the way the woodworking benches were placed, and this plugin
# places them. scripts\dev\Build-StationSites.py measures them over the load
# order into game\data\station-sites.json; each placement is written from that
# table and nothing else: its base, its point and its turn about the upright.
STATION_SITES = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                                              'game', 'data', 'station-sites.json'))
STATION_NAMES = {KILN: 'charcoal kilns', SALT_QUARRY: 'salt quarries', BEEHIVE: 'beehives',
                 ALCHEMY_LAB: 'alchemy labs', WELL_BUCKET: 'well buckets', RIVER_BUCKET: 'water buckets',
                 STUDY_DESK: 'study desks'}
STATION_BASES = set(STATION_NAMES)
QUEST_CONTENT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                                             'game', 'data', 'quest-content.json'))


def quest_content(path=QUEST_CONTENT):
    """The dedicated quest objects, not copies of vanilla quest/skill records."""
    doc = json.load(open(path, encoding='utf-8'))
    keys = ['satchel', 'ledger', 'signet', 'locket', 'case', 'dispatch', 'seal']
    sites = ['longfin%d' % n for n in range(1, 9)] + ['ledger']
    def vector(value):
        return (isinstance(value, list) and len(value) == 3 and
                all(isinstance(n, (float, int)) and not isinstance(n, bool) and math.isfinite(n) for n in value))
    if (doc.get('version') != 1 or not isinstance(doc.get('items'), list) or
            [r.get('key') for r in doc['items']] != keys or list(doc.get('sites', {})) != sites):
        raise ValueError('Invalid dedicated quest content catalogue')
    if doc.get('seaWater') != {'world': '3c:Skyrim.esm', 'height': -14000, 'depth': 32}:
        raise ValueError('Invalid measured sea water level')
    for i, row in enumerate(doc['items']):
        if (row.get('ref') != '%x:Thornswood-Content.esp' % (0x17000 + i) or row.get('weight') != 0 or
                row.get('edid') != 'ThornswoodQuest' + keys[i].title() or not row.get('name') or
                not isinstance(row.get('model'), str) or not row['model'].lower().endswith('.nif') or
                len(row.get('bounds', [])) != 6 or
                any(not isinstance(n, int) or isinstance(n, bool) or not -32768 <= n <= 32767 for n in row['bounds'])):
            raise ValueError('Invalid dedicated quest item: ' + keys[i])
    for i, key in enumerate(sites):
        row = doc['sites'][key]
        ledger = key == 'ledger'
        if (row.get('ref') != '%x:Thornswood-Content.esp' % (0x17200 + i) or
                row.get('base') != ('17100:Thornswood-Content.esp' if ledger else '154a5:Thornswood-Content.esp') or
                row.get('interior') is not ledger or row.get('angle') != 0 or
                not vector(row.get('pos')) or not vector(row.get('anchorPosition')) or
                not isinstance(row.get('anchor'), str) or not row['anchor'].endswith(':Skyrim.esm') or
                not isinstance(row.get('cell'), str) or not row['cell'].endswith(':Skyrim.esm') or
                row.get('space') != (row['cell'] if ledger else '3c:Skyrim.esm')):
            raise ValueError('Invalid dedicated quest placement: ' + key)
        expected = list(row['anchorPosition'])
        expected[2 if ledger else 0] += 12 if ledger else 48
        if not ledger:
            expected[2] = doc['seaWater']['height'] - doc['seaWater']['depth']
        if row['pos'] != expected or ledger and row['cell'] != '133c9:Skyrim.esm':
            raise ValueError('Quest placement differs from its measured anchor: ' + key)
    return doc


def quest_records():
    doc = quest_content()
    records = [misc(0x5017000 + i, row['edid'], row['name'], row['model'], row['bounds'], 0, 0.0, kws=())
               for i, row in enumerate(doc['items'])]
    ledger = doc['items'][1]
    records.append(acti(0x5017100, 'ThornswoodQuestLedgerSource', ledger['bounds'], 'Guild Ledger', ledger['model']))
    return records


def quest_identity(have, edid):
    if have is not None and have.editor_id() != edid:
        raise ValueError('A dedicated quest form ID belongs to another record: ' + edid)


def placement(fid, base, pos, angle, edid=None):
    """A placed station: its base and where it stands, turned angle degrees."""
    x, y, z = pos
    return own_record(b'REFR', fid, ([(b'EDID', zstr(edid))] if edid else []) + [(b'NAME', struct.pack('<I', base)),
                                     (b'DATA', struct.pack('<6f', x, y, z, 0.0, 0.0, math.radians(angle)))])


def group_type(g):
    return struct.unpack_from('<i', g.label, 4)[0]


def group_id(g):
    return struct.unpack_from('<I', g.label, 0)[0]


def placements_in(kids, cell=None):
    """(REFR, the list it sits in, its cell's form id) for every placement."""
    out = []
    for k in kids:
        if isinstance(k, Grup):
            out += placements_in(k.kids, group_id(k) if group_type(k) in (6, 8, 9, 10) else cell)
        elif k.tag == b'REFR':
            out.append((k, kids, cell))
    return out


def placed_ids(tree):
    return set(r.fid for r, _, _ in placements_in(tree))


def find_cell(kids, fid):
    """(the list a cell's record sits in, its index), or None."""
    for i, k in enumerate(kids):
        if isinstance(k, Grup):
            got = find_cell(k.kids, fid)
            if got:
                return got
        elif k.tag == b'CELL' and k.fid == fid:
            return kids, i
    return None


def find_world(tree, fid):
    top = next((k for k in tree if isinstance(k, Grup) and k.label[:4] == b'WRLD'), None)
    if top is None:
        return None
    for i, k in enumerate(top.kids):
        if isinstance(k, Rec) and k.tag == b'WRLD' and k.fid == fid:
            return top.kids, i
    return None


def new_group(label, gtype, stamp, kids=None):
    return Grup(label + struct.pack('<i', gtype) + b'\x00' * 4 + stamp, kids or [])


def children_of(kids, i, gtype, stamp):
    """The children group straight after the record at kids[i], made if missing."""
    rec = kids[i]
    nxt = kids[i + 1] if i + 1 < len(kids) else None
    if isinstance(nxt, Grup) and group_type(nxt) == gtype and group_id(nxt) == rec.fid:
        return nxt
    g = new_group(struct.pack('<I', rec.fid), gtype, stamp)
    kids.insert(i + 1, g)
    return g


def sub_group(kids, label, gtype, stamp):
    """The block or sub-block group with that label, made in its sorted place."""
    def key(lb):
        if gtype in (4, 5):
            return struct.unpack('<hh', lb)[::-1]
        return (struct.unpack('<i', lb)[0],)
    for k in kids:
        if isinstance(k, Grup) and group_type(k) == gtype and k.label[:4] == label:
            return k
    g = new_group(label, gtype, stamp)
    at = next((i for i, k in enumerate(kids) if isinstance(k, Grup) and group_type(k) == gtype
               and key(k.label[:4]) > key(label)), None)
    if at is None:
        at = max([i + 1 for i, k in enumerate(kids) if isinstance(k, Grup) and group_type(k) == gtype] or
                 [len(kids)])
    kids.insert(at, g)
    return g


def insert_pair(kids, rec, tag):
    """A CELL or WRLD record in its sorted place among its kind, before the
    next record of that kind (whose children group follows it)."""
    at = next((i for i, k in enumerate(kids) if isinstance(k, Rec) and k.tag == tag and k.fid > rec.fid),
              len(kids))
    kids.insert(at, rec)
    return at


def put_world(tree, rec, stamp):
    top = next((k for k in tree if isinstance(k, Grup) and k.label[:4] == b'WRLD'), None)
    if top is None:
        top = ensure_top_group(tree, b'WRLD')
    insert_pair(top.kids, rec, b'WRLD')


def put_cell(tree, rec, ctx, world, stamp):
    (bgt, blabel), (sgt, slabel), exterior = ctx
    if exterior:
        kids, i = find_world(tree, world)
        parent = children_of(kids, i, 1, stamp).kids
    else:
        top = next((k for k in tree if isinstance(k, Grup) and k.label[:4] == b'CELL'), None)
        if top is None:
            top = ensure_top_group(tree, b'CELL')
        parent = top.kids
    block = sub_group(parent, blabel, bgt, stamp)
    sub = sub_group(block.kids, slabel, sgt, stamp)
    at = insert_pair(sub.kids, rec, b'CELL')
    children_of(sub.kids, at, 6, stamp)


def put_placement(tree, rec, cell, stamp):
    kids, i = find_cell(tree, cell)
    children = children_of(kids, i, 6, stamp)
    temp = next((k for k in children.kids if isinstance(k, Grup) and group_type(k) == 9), None)
    if temp is None:
        temp = new_group(struct.pack('<I', cell), 9, stamp)
        children.kids.append(temp)
    at = next((j for j, k in enumerate(temp.kids) if isinstance(k, Rec) and k.fid > rec.fid), len(temp.kids))
    temp.kids.insert(at, rec)


def cnto(base, count):
    return struct.pack('<II', base, count)


class Rec(object):
    def __init__(self, tag, flags, fid, extra, data):
        self.tag, self.flags, self.fid = tag, flags, fid
        self.extra, self.data = extra, data

    def bytes(self):
        return (self.tag + struct.pack('<III', len(self.data), self.flags, self.fid)
                + self.extra + self.data)

    @property
    def compressed(self):
        return (self.flags & COMPRESSED) != 0

    def editor_id(self):
        if self.compressed:
            return ''
        for tag, body in subrecords(self.data):
            if tag == b'EDID':
                return body.rstrip(b'\x00').decode('ascii', 'replace')
        return ''


class Grup(object):
    def __init__(self, label, kids):
        self.label, self.kids = label, kids

    def bytes(self):
        body = b''.join(k.bytes() for k in self.kids)
        return b'GRUP' + struct.pack('<I', len(body) + 24) + self.label + body


def subrecords(data):
    """(tag, bytes) pairs. A subrecord longer than 65,535 bytes is preceded by
    an XXXX carrying its real size (a worldspace's large reference list can
    be); the pair comes back whole."""
    out, i, big = [], 0, None
    while i + 6 <= len(data):
        tag = data[i:i + 4]
        size = struct.unpack_from('<H', data, i + 4)[0]
        if tag == b'XXXX' and size == 4:
            big = struct.unpack_from('<I', data, i + 6)[0]
            i += 10
            continue
        if big is not None:
            size, big = big, None
        if i + 6 + size > len(data):
            break
        out.append((tag, data[i + 6:i + 6 + size]))
        i += 6 + size
    return out


def pack_subrecords(pairs):
    out = []
    for t, b in pairs:
        if len(b) > 0xFFFF:
            out.append(b'XXXX' + struct.pack('<HI', 4, len(b)) + t + struct.pack('<H', 0) + b)
        else:
            out.append(t + struct.pack('<H', len(b)) + b)
    return b''.join(out)


def zstr(s):
    return s.encode('ascii') + b'\x00'


def parse(buf, start, end):
    kids, p = [], start
    while p + 24 <= end:
        tag = buf[p:p + 4]
        size = struct.unpack_from('<I', buf, p + 4)[0]
        if tag == b'GRUP':
            kids.append(Grup(buf[p + 8:p + 24], parse(buf, p + 24, p + size)))
            p += size
        else:
            flags, fid = struct.unpack_from('<II', buf, p + 8)
            kids.append(Rec(tag, flags, fid, buf[p + 16:p + 24],
                            buf[p + 24:p + 24 + size]))
            p += 24 + size
    return kids


def every_record(kids):
    for k in kids:
        if isinstance(k, Grup):
            for r in every_record(k.kids):
                yield r
        else:
            yield k


def clone(src, fid, editor_id, sets=None, after=None, drop=None):
    """A copy of src with a new id and editor id, and named subrecords changed.

    sets    tag -> bytes, replacing the first subrecord with that tag.
    after   tag -> list of (tag, bytes) to insert after the last one with that tag.
    drop    tags to leave out.
    """
    sets, after, drop = sets or {}, after or {}, set(drop or ())
    pairs = [(t, b) for t, b in subrecords(src.data) if t not in drop]
    pairs = [(t, sets.pop(t, b)) if t in sets else (t, b) for t, b in pairs]
    if sets:
        raise SystemExit('nothing to replace for ' + ','.join(t.decode() for t in sets))
    out = []
    for i, (t, b) in enumerate(pairs):
        out.append((t, b))
        last = max(j for j, (tt, _) in enumerate(pairs) if tt == t) if t in after else -1
        if t in after and i == last:
            out.extend(after[t])
    out = [(t, zstr(editor_id)) if t == b'EDID' else (t, b) for t, b in out]
    return Rec(src.tag, src.flags, fid, src.extra, pack_subrecords(out))


def set_model(rec, model):
    """The record's MODL set to model and the old mesh's MODT/MODS dropped.
    True when that changed anything, so a second run is not an edit."""
    pairs = subrecords(rec.data)
    want = zstr(model)
    out = []
    for t, b in pairs:
        if t in (b'MODT', b'MODS'):
            continue
        out.append((t, want) if t == b'MODL' else (t, b))
    if not any(t == b'MODL' for t, _ in pairs):
        raise SystemExit('0x%07X has no MODL to set' % rec.fid)
    if out == pairs:
        return False
    rec.data = pack_subrecords(out)
    return True


def set_bnam(rec, keyword):
    """The recipe's BNAM set to keyword. True when that changed anything."""
    pairs = subrecords(rec.data)
    want = struct.pack('<I', keyword)
    if not any(t == b'BNAM' for t, _ in pairs):
        raise SystemExit('0x%07X has no BNAM to set' % rec.fid)
    out = [(t, want) if t == b'BNAM' else (t, b) for t, b in pairs]
    if out == pairs:
        return False
    rec.data = pack_subrecords(out)
    return True


def ensure_top_group(tree, tag):
    """The top GRUP for tag, made if this plugin has never had one."""
    for k in tree:
        if isinstance(k, Grup) and k.label[:4] == tag:
            return k
    sample = next(k for k in tree if isinstance(k, Grup))
    stamp = sample.label[12:16] if len(sample.label) >= 16 else b'\x00' * 4
    g = Grup(tag + b'\x00' * 8 + stamp, [])
    tree.append(g)
    return g


def plain(rec):
    """A record's subrecord bytes, inflated when it is compressed."""
    return zlib.decompress(rec.data[4:]) if rec.compressed else rec.data


def take_out(kids, fids):
    """kids without the records whose ids are in fids. A group that held
    records and is left with none goes as well; one that was empty already
    stays, so nothing else in the file moves."""
    out = []
    for k in kids:
        if isinstance(k, Grup):
            had = len(k.kids)
            k.kids = take_out(k.kids, fids)
            if had and not k.kids:
                continue
        elif k.fid in fids:
            continue
        out.append(k)
    return out


def is_text(body):
    """A subrecord that is one string: printable ASCII ending in a zero, the
    way an editor id, a model path or a description is written."""
    return (len(body) > 1 and body.endswith(b'\x00') and
            all(32 <= b < 127 for b in body[:-1]))


def other_server_names(rec):
    """Where the other server's name or one of its short forms is in one
    record: its editor id, a script its VMAD attaches, any other string, or,
    for the full name and the longer short form, any byte. A compressed record
    is inflated to be read, and never written back from here."""
    data = rec.data
    if rec.compressed:
        data = zlib.decompress(data[4:])
    found = []
    for tag, body in subrecords(data):
        low = body.lower()
        short = OTHER_SERVER_SHORT in low or OTHER_SERVER_LONGER in low
        if OTHER_SERVER_NAME in low:
            found.append('its full name, in ' + tag.decode('ascii', 'replace'))
        elif tag == b'EDID' and short:
            found.append('editor id ' + body.rstrip(b'\x00').decode('ascii', 'replace'))
        elif tag == b'VMAD' and short:
            found.append('a script it attaches')
        elif short and (is_text(body) or OTHER_SERVER_LONGER in low):
            found.append('a short form, in ' + tag.decode('ascii', 'replace'))
    return found


def other_server_in_header(head):
    """Whether the header carries the other server's full name or either short
    form, anywhere. It is a description, the masters' names and a handful of
    numbers, and every run reads it, so a chance hit among the numbers would
    be seen at once and not months later."""
    low = bytes(head).lower()
    return any(n in low for n in (OTHER_SERVER_NAME, OTHER_SERVER_SHORT, OTHER_SERVER_LONGER))


def described(head, description):
    """The header with description as its SNAM, its size field set to match,
    and whether that changed anything. A header with no SNAM gains one after
    CNAM, where the Creation Kit writes it."""
    pairs = subrecords(bytes(head[24:]))
    want = description + b'\x00'
    out, put = [], False
    for tag, body in pairs:
        if tag == b'SNAM':
            out.append((tag, want))
            put = True
        else:
            out.append((tag, body))
    if not put:
        at = next((i + 1 for i, (t, _) in enumerate(out) if t == b'CNAM'), 1)
        out.insert(at, (b'SNAM', want))
    body = pack_subrecords(out)
    new = bytearray(head[:24]) + body
    struct.pack_into('<I', new, 4, len(body))
    return new, bytes(new) != bytes(head)


def masters_of(buf):
    """The MAST names in a plugin's header, in order."""
    hs = struct.unpack_from('<I', buf, 4)[0]
    return [b.rstrip(b'\x00').decode('ascii', 'replace')
            for t, b in subrecords(buf[24:24 + hs]) if t == b'MAST']


def record_in(buf, tag, fid):
    """The record of that type and form id (the file's own numbering), or None.
    Only the top group of that type is walked."""
    hs = struct.unpack_from('<I', buf, 4)[0]
    p = 24 + hs
    while p + 24 <= len(buf):
        size = struct.unpack_from('<I', buf, p + 4)[0]
        if buf[p:p + 4] == b'GRUP' and buf[p + 8:p + 12] == tag:
            for r in every_record(parse(buf, p + 24, p + size)):
                if r.fid == fid and r.tag == tag:
                    return r
            return None
        p += size if buf[p:p + 4] == b'GRUP' else 24 + size
    return None


def renumbered(v, mapping, what):
    """A form id moved from the master's numbering into this plugin's."""
    idx = v >> 24
    if idx >= len(mapping):
        raise SystemExit('STOP. %s names 0x%08X, outside its file\'s masters. '
                         'Nothing was written.' % (what, v))
    return (mapping[idx] << 24) | (v & 0xFFFFFF)


def from_master(masters_dir, master, local_fid, plugin_masters, tag=b'COBJ'):
    """A copy of a master's record, in this plugin's numbering.

    local_fid is the id as this plugin writes it (the master's index here in
    the top byte). The master is read from masters_dir; its own records carry
    its own master count in the top byte, and every form id in the copy is
    moved from its numbering to this plugin's. Refuses a compressed record and
    a subrecord this does not know, rather than guess at what is in it."""
    path = os.path.join(masters_dir, master)
    if not os.path.isfile(path):
        raise SystemExit('STOP. %s is not in %s, and this needs it the first time. '
                         'Give --masters the game\'s Data folder. Nothing was written.'
                         % (master, masters_dir))
    buf = open(path, 'rb').read()
    src_masters = masters_of(buf)
    own = len(src_masters)
    rec = record_in(buf, tag, (own << 24) | (local_fid & 0xFFFFFF))
    if rec is None:
        raise SystemExit('STOP. %s has no %s 0x%06X. Nothing was written.'
                         % (master, tag.decode(), local_fid & 0xFFFFFF))
    if rec.compressed:
        raise SystemExit('STOP. %s %s 0x%06X is compressed. Nothing was written.'
                         % (master, tag.decode(), local_fid & 0xFFFFFF))
    names = [m.lower() for m in plugin_masters]
    mapping = []
    for m in src_masters + [master]:
        if m.lower() not in names:
            raise SystemExit('STOP. %s names %s, which is not a master of this plugin. '
                             'Nothing was written.' % (master, m))
        mapping.append(names.index(m.lower()))
    pairs = subrecords(rec.data)
    if pack_subrecords(pairs) != rec.data:
        raise SystemExit('STOP. %s 0x%06X does not read back as its own subrecords. '
                         'Nothing was written.' % (master, local_fid & 0xFFFFFF))
    out = []
    for t, b in pairs:
        if t in COBJ_FORM_FIELDS:
            b = bytearray(b)
            offsets = list(COBJ_FORM_FIELDS[t])
            # A CTDA whose flags say "use global" compares with a GLOB, not a number.
            if t == b'CTDA' and b[0] & 0x04:
                offsets.append(4)
            for o in offsets:
                v = struct.unpack_from('<I', b, o)[0]
                if v:
                    struct.pack_into('<I', b, o, renumbered(v, mapping, '%s %s' % (master, t.decode())))
            b = bytes(b)
        elif t not in COBJ_PLAIN_FIELDS:
            raise SystemExit('STOP. %s 0x%06X carries %s, which this does not know how to '
                             'renumber. Nothing was written.'
                             % (master, local_fid & 0xFFFFFF, t.decode()))
        out.append((t, b))
    return Rec(rec.tag, rec.flags, renumbered(rec.fid, mapping, master), rec.extra,
               pack_subrecords(out))


def never_listed(rec):
    """The recipe with NEVER_TRUE among its conditions, after any it has and
    before its output. True when that changed anything, so a second run is not
    an edit."""
    pairs = subrecords(rec.data)
    if any(t == b'CTDA' and b == NEVER_TRUE for t, b in pairs):
        return False
    at = max([i + 1 for i, (t, _) in enumerate(pairs) if t in (b'CTDA', b'CIS1', b'CIS2')] or
             [i for i, (t, _) in enumerate(pairs) if t == b'CNAM'] or [len(pairs)])
    pairs.insert(at, (b'CTDA', NEVER_TRUE))
    rec.data = pack_subrecords(pairs)
    return True


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.path.normpath(
        os.path.join(here, '..', '..', 'game', 'content')))
    ap.add_argument('--plugin', default='Thornswood-Content.esp')
    ap.add_argument('--check', action='store_true', help='say what would happen, write nothing')
    ap.add_argument('--masters', default=MASTERS_DIR,
                    help="the game's Data folder, read when a master's record is first copied in")
    args = ap.parse_args()

    path = os.path.join(args.data, args.plugin)
    raw = open(path, 'rb').read()
    print('The file')
    print('  %s' % path)
    print('  %s bytes' % format(len(raw), ','))

    header_size = struct.unpack_from('<I', raw, 4)[0]
    head = bytearray(raw[:24 + header_size])
    tree = parse(raw, 24 + header_size, len(raw))

    print('')
    print('Can the parser reproduce the file it was given')
    if bytes(head) + b''.join(k.bytes() for k in tree) != raw:
        print('STOP. the parse does not round trip. Nothing was written.')
        return 1
    print('  ok    parsed and written back byte for byte, %s bytes' % format(len(raw), ','))

    records = list(every_record(tree))
    by_edid = {}
    for r in records:
        e = r.editor_id()
        if e:
            by_edid[e] = r
    taken = set(r.fid for r in records)
    before = {r.fid: r.data for r in records}

    # THE SALVAGED REGISTER (#2553): every record that came with the salvaged
    # plugin, what became of it, and the hash of every version of it the
    # repository has held. What goes, goes; what is left is checked against it.
    register = json.load(open(SALVAGED_REGISTER, encoding='utf-8'))
    plugin_masters = masters_of(raw)
    salvaged_hashes = {}
    dropping, bethesdas, remade, same_by_design = set(), set(), set(), set()
    # A Bethesda's cell or worldspace whose winning master's own bytes the
    # register hashed: the record may be those bytes even where the salvaged
    # copy was too (List-SalvagedRecords.py, bethesdaSha256).
    bethesda_hash = {}
    gone_before = set()
    for row in register['records']:
        fid = local_fid(row['formId'], plugin_masters, args.plugin)
        for h in row['dataSha256']:
            salvaged_hashes.setdefault(h, set()).add(fid)
        d = row['disposition']
        if d == 'gone before #2553':
            gone_before.add(fid)
        elif d not in ('dropped', "Bethesda's", 'remade'):
            # Since Patrick's A of 16 October nothing salvaged waits on
            # anything: the 57 placements are the other server's spots and go.
            print('')
            print('STOP. the register keeps %s 0x%07X as "%s". Run scripts\\mods\\List-SalvagedRecords.py. '
                  'Nothing was written.' % (row['type'], fid, d))
            return 1
        elif d == 'dropped':
            dropping.add(fid)
        elif d == "Bethesda's":
            bethesdas.add(fid)
            if row.get('bethesdaSha256'):
                bethesda_hash[fid] = row['bethesdaSha256']
        elif d == 'remade':
            remade.add(fid)
            if row.get('sameByDesign'):
                same_by_design.add(fid)
    by_fid = {}
    for r in records:
        by_fid[r.fid] = r

    removing = set()

    # THE RECORDS THIS TOOL WRITES FROM ITS OWN NUMBERS (#2553). Each one that
    # is already in the plugin is written over where it stands; one that is
    # not is added. A name the plugin already gives another record stops it:
    # two records under one name is the kind of thing found months later.
    passage = by_edid.get('ThornswoodPassageWhiterun')
    if passage is None or passage.compressed or passage.tag != b'BOOK':
        print('')
        print('STOP. BOOK ThornswoodPassageWhiterun, which the deed is made from, is not here. '
              'Nothing was written.')
        return 1
    # Clam01 from Skyrim.esm, uncompressed, PFIG present, which the catches are
    # made from (#1379). Kept here so this script does not need the master open.
    clam_raw = bytes.fromhex(
        '464c4f52bd00000000000000805f08002f301e002c000b00454449440700436c616d303100'
        '4f424e440c00eeffe8fffeff12001800210046554c4c04001fdc00004d4f444c1200506c61'
        '6e74735c436c616d30312e6e6966004d4f44543c00020000000400000000000000aa2dbb27'
        '64647300f64c4bb969221e8664647300f64c4bb9b807509764647300262c333bd373171f64'
        '647300f64c4bb9504e414d040000000000524e414d0400dc070100464e414d020000005046'
        '4947040003ba0e00534e414d04002605100050465043040064646464')
    clam = Rec(b'FLOR', 0, 0x85F80, clam_raw[16:24], clam_raw[24:])
    passages = {}
    for name in PASSAGE_WORDS:
        book = by_edid.get(name)
        if book is None or book.compressed or book.tag != b'BOOK':
            print('')
            print('STOP. BOOK %s, whose words this writes, is not here as an uncompressed book. '
                  'Nothing was written.' % name)
            return 1
        passages[name] = book
    own = thornswood_records(passage, clam, passages)
    own += seasonal_records()
    if len({r.fid for r in own}) != len(own):
        raise ValueError('Two authored records share a form ID')
    unmade = sorted(remade - set(r.fid for r in own))
    if unmade:
        print('')
        print('STOP. the register says 0x%07X is remade and this tool does not write it. '
              'Nothing was written.' % unmade[0])
        return 1
    built, rewritten = [], []
    for r in own:
        name = r.editor_id()
        other = by_edid.get(name)
        if other is not None and other.fid != r.fid:
            print('')
            print('STOP. %s is already in this plugin as 0x%07X and this writes it as 0x%07X. '
                  'Nothing was written.' % (name, other.fid, r.fid))
            return 1
        have = by_fid.get(r.fid)
        if have is None:
            built.append(r)
            continue
        if have.tag != r.tag or have.compressed:
            print('')
            print('STOP. 0x%07X is a %s here and this writes a %s. Nothing was written.'
                  % (r.fid, have.tag.decode(), r.tag.decode()))
            return 1
        if 0x5017000 <= r.fid <= 0x5017100:
            quest_identity(have, name)
        if (have.data, have.flags, have.extra) != (r.data, r.flags, r.extra):
            rewritten.append((have, r))

    # The Hearthfire house parts (#2258), overrides of a master's records. One
    # already in this plugin is edited where it is; one that is not is copied
    # in from HearthFires.esm. See the top.
    house_new, house_have = [], []
    for fid, edid in HOUSE_PARTS:
        have = next((r for r in records if r.fid == fid and r.tag == b'COBJ'), None)
        if have is not None:
            if have.compressed or have.editor_id() != edid:
                print('')
                print('STOP. COBJ 0x%08X in this plugin is not %s as it should be. '
                      'Nothing was written.' % (fid, edid))
                return 1
            house_have.append(have)
            continue
        if fid in taken:
            print('')
            print('STOP. 0x%08X is already taken by something that is not a recipe. '
                  'Nothing was written.' % fid)
            return 1
        made_here = from_master(args.masters, HOUSE_PARTS_MASTER, fid, plugin_masters)
        if made_here.editor_id() != edid:
            print('')
            print('STOP. %s 0x%06X is %s, not %s. Nothing was written.'
                  % (HOUSE_PARTS_MASTER, fid & 0xFFFFFF, made_here.editor_id(), edid))
            return 1
        never_listed(made_here)
        house_new.append(made_here)
    house_bare = [r for r in house_have
                  if not any(t == b'CTDA' and b == NEVER_TRUE for t, b in subrecords(r.data))]

    # Master recipe overrides onto the woodworking bench (#516).
    wood_new, wood_have = [], []
    for fid, edid, master in WOODWORKER_MASTER_RECIPES:
        have = next((r for r in records if r.fid == fid and r.tag == b'COBJ'), None)
        if have is not None:
            if have.compressed or have.editor_id() != edid:
                print('')
                print('STOP. COBJ 0x%08X in this plugin is not %s as it should be. '
                      'Nothing was written.' % (fid, edid))
                return 1
            wood_have.append(have)
            continue
        if fid in taken:
            print('')
            print('STOP. 0x%08X is already taken by something that is not a recipe. '
                  'Nothing was written.' % fid)
            return 1
        made_here = from_master(args.masters, master, fid, plugin_masters)
        if made_here.editor_id() != edid:
            print('')
            print('STOP. %s 0x%06X is %s, not %s. Nothing was written.'
                  % (master, fid & 0xFFFFFF, made_here.editor_id(), edid))
            return 1
        set_bnam(made_here, WOODWORKING_KEYWORD)
        wood_new.append(made_here)
    wood_bare = [r for r in wood_have
                 if not any(t == b'BNAM' and struct.unpack_from('<I', b, 0)[0] == WOODWORKING_KEYWORD
                            for t, b in subrecords(r.data))]
    # COOKING QUALITY (#2906): the burnt meal and a fine record of every dish.
    # One already here is kept; one that is not is made from the masters, and
    # every dish that cannot be is listed before anything stops.
    quality_new, quality_have, problems = [], [], []
    try:
        quality = quality_wanted(plugin_masters, args.plugin)
    except (KeyError, ValueError) as e:
        print('')
        print('STOP. game\\data\\food-groups.json has no quality block this can read (%s). '
              'Nothing was written.' % e)
        return 1
    for fid, edid, name, dish, effect in quality:
        have = by_fid.get(fid)
        if have is not None:
            if have.tag != b'ALCH' or have.compressed or have.editor_id() != edid:
                print('')
                print('STOP. 0x%07X in this plugin is not ALCH %s as it should be. Nothing was written.'
                      % (fid, edid))
                return 1
            quality_have.append(have)
            continue
        other = by_edid.get(edid)
        if other is not None:
            print('')
            print('STOP. %s is already in this plugin as 0x%07X and this writes it as 0x%07X. '
                  'Nothing was written.' % (edid, other.fid, fid))
            return 1
        # A festival feast's fine record wears the feast's own look (#3152),
        # which is this plugin's and needs no master.
        feast = next((row for row in FEASTS if '%x:%s' % (row[0] & 0xFFFFFF, args.plugin) == dish), None)
        look = feast_look(*feast[6:]) if feast else dish_look(args.masters, dish, plugin_masters, problems)
        if look is not None:
            quality_new.append(quality_record(fid, edid, name, look, effect))
    if problems:
        print('')
        print('STOP. %d of the cooking quality records cannot be made from %s:' % (len(problems), args.masters))
        for line in sorted(set(problems), key=problems.index):
            print('  %s' % line)
        print('Nothing was written.')
        return 1
    built += house_new + wood_new + quality_new

    # WHAT THE REGISTER SAYS GOES (#2553): the placements and switched-off
    # Skyrim objects nothing of Thornswood's asks for, the cells and worlds left
    # holding nothing, and the one base record nothing names.
    going = set(f for f in dropping if f in by_fid)
    removing |= going

    # WHAT IS RETIRED GOES (#2962): the creation menus nothing shows.
    retiring = set()
    for obj, tag, edid in RETIRED:
        fid = (len(plugin_masters) << 24) | obj
        r = by_fid.get(fid)
        if r is None:
            continue
        if r.tag != tag or r.editor_id() != edid:
            print('')
            print('STOP. 0x%07X is %s %s, not the retired %s %s. Nothing was written.'
                  % (fid, r.tag.decode(), r.editor_id(), tag.decode(), edid))
            return 1
        retiring.add(fid)
    removing |= retiring

    # The cell and world records that stay hold the stations' placements.
    # Each is written from the winning master's own record, Bethesda's, never
    # the salvaged copy. That needs the masters; without them a record that is
    # already Bethesda's is left as it is, and one that is still the salvaged
    # copy stops the tool below.
    world_keep = [r for r in records if r.tag in (b'CELL', b'WRLD') and r.fid not in removing
                  and (r.fid >> 24) < len(plugin_masters)]
    world_new = bethesdas_world_records(args.masters, plugin_masters,
                                        [(r.tag, r.fid) for r in world_keep]) if world_keep else {}
    world_from = {}
    if world_new is not None:
        for r in world_keep:
            flags, data, src, ctx = world_new[(r.tag, r.fid)]
            world_from[r.fid] = src
            if (r.data, r.flags, r.extra) != (data, flags, FORM_TAIL):
                rewritten.append((r, Rec(r.tag, flags, r.fid, FORM_TAIL, data)))

    # WHERE THE STATIONS STAND (#2553, Patrick's A of 16 October): every
    # placement game\data\station-sites.json measures, and nothing else. A
    # placement already where the table puts it stays; one the table moved is
    # written over, or taken out of its old cell and put in its new one; a
    # cell or worldspace a placement needs that the plugin does not carry is
    # copied from the winning master's own record.
    sites = json.load(open(STATION_SITES, encoding='utf-8'))
    want, want_cell, want_world = {}, {}, {}
    own_index = len(plugin_masters)
    quest_doc = quest_content()
    quest_sites = quest_doc['sites']
    authored_sites = dict(sites['sites'])
    if set(authored_sites) & set(quest_sites):
        raise ValueError('A quest and a station share a site name')
    authored_sites.update(quest_sites)
    record_ids = {r.fid for r in own}
    for name, row in sorted(authored_sites.items()):
        fid = local_fid(row['ref'], plugin_masters, args.plugin)
        base = local_fid(row['base'], plugin_masters, args.plugin)
        cell = local_fid(row['cell'], plugin_masters, args.plugin)
        allowed_bases = {CATCH_LONGFIN, 0x5017100} if name in quest_sites else STATION_BASES
        if (base not in allowed_bases or (fid >> 24) != own_index or (cell >> 24) >= own_index or
                fid in want or fid in record_ids):
            print('')
            print('STOP. the station table\'s %s is not a placement of a station in this plugin, in a cell of '
                  'its masters, under a form id of its own. Nothing was written.' % name)
            return 1
        if fid in taken and fid not in placed_ids(tree):
            print('')
            print('STOP. the station table gives %s 0x%07X, which this plugin uses for something else. '
                  'Nothing was written.' % (name, fid))
            return 1
        edid = 'ThornswoodQuestSite' + name.title() if name in quest_sites else None
        if edid:
            quest_identity(by_fid.get(fid), edid)
        want[fid] = placement(fid, base, row['pos'], row['angle'], edid)
        want_cell[fid] = cell
        want_world[fid] = None if row['interior'] else local_fid(row['space'], plugin_masters, args.plugin)
    # A shifted sea marker must remain in its declared exterior grid. Verify
    # against Bethesda's CELL data, rather than assuming its anchor's cell.
    exterior = {(b'CELL', local_fid(r['cell'], plugin_masters, args.plugin))
                for r in quest_sites.values() if not r['interior']}
    exterior.add((b'WRLD', 0x3C))
    quest_cells = bethesdas_world_records(args.masters, plugin_masters, sorted(exterior))
    if quest_cells is not None:
        for name, row in quest_sites.items():
            if row['interior']:
                continue
            cell = local_fid(row['cell'], plugin_masters, args.plugin)
            data = dict(subrecords(quest_cells[(b'CELL', cell)][1]))
            if b'XCLC' not in data or len(data[b'XCLC']) < 8:
                raise ValueError('Quest sea marker has no native CELL grid: ' + name)
            grid = struct.unpack_from('<ii', data[b'XCLC'])
            if grid != tuple(math.floor(n / 4096) for n in row['pos'][:2]):
                raise ValueError('Quest sea marker crosses its declared CELL: ' + name)
            water = data.get(b'XCLW', b'')
            flags = data.get(b'DATA', b'')
            world = dict(subrecords(quest_cells[(b'WRLD', 0x3C)][1]))
            if len(water) != 4 or not flags or not flags[0] & 2 or len(world.get(b'DNAM', b'')) != 8:
                raise ValueError('Quest sea marker has no verified native water: ' + name)
            level = struct.unpack('<f', water)[0]
            if level > 3e38:
                level = struct.unpack('<2f', world[b'DNAM'])[1]
            if level != quest_doc['seaWater']['height']:
                raise ValueError('Native sea water changed; remeasure quest markers: ' + name)
    stays, moved, to_place = set(), set(), []
    for r, parent, cell in placements_in(tree):
        if r.fid in removing:
            continue
        if r.fid not in want:
            print('')
            print('STOP. REFR 0x%07X is a placement neither the station table nor the register knows. '
                  'Nothing was written.' % r.fid)
            return 1
        if cell != want_cell[r.fid]:
            moved.add(r.fid)
            continue
        stays.add(r.fid)
        if (r.data, r.flags, r.extra) != (want[r.fid].data, want[r.fid].flags, want[r.fid].extra):
            rewritten.append((r, want[r.fid]))
    to_place = [want[f] for f in sorted(want) if f not in stays]
    need = set()
    for r in to_place:
        cell = want_cell[r.fid]
        if cell in removing or find_cell(tree, cell) is None:
            if cell in removing:
                print('')
                print('STOP. the register says cell 0x%08X goes, and the station table places 0x%07X in it. '
                      'Run scripts\\mods\\List-SalvagedRecords.py. Nothing was written.' % (cell, r.fid))
                return 1
            need.add((b'CELL', cell))
        w = want_world[r.fid]
        if w is not None and find_world(tree, w) is None:
            need.add((b'WRLD', w))
    copies = {}
    if need:
        copies = bethesdas_world_records(args.masters, plugin_masters, sorted(need))
        if copies is None:
            print('')
            print('STOP. %d cell or worldspace record(s) the stations need are not in this plugin, and the '
                  'masters are not in %s. Give --masters the game\'s Data folder. Nothing was written.'
                  % (len(need), args.masters))
            return 1

    # A salvaged record that is not going and not written over is refused
    # here, before anything else: put back by hand, or by an old copy, it
    # would otherwise ride along with a run that has nothing else to do.
    replacing = set(o.fid for o, n in rewritten)
    for r in records:
        if r.fid in removing or r.fid in replacing:
            continue
        # One the register says left before #2553 (the skill manuals, the
        # Execution Block and its placement) is refused by its form id too,
        # however it was edited since.
        h = body_hash(plain(r))
        salvaged_bytes = h in salvaged_hashes and r.fid not in same_by_design and bethesda_hash.get(r.fid) != h
        if r.fid in gone_before or salvaged_bytes:
            print('')
            print('STOP. %s 0x%07X %s is a salvaged record (#2553), by its %s, and the register '
                  'keeps no such record. Nothing was written.'
                  % (r.tag.decode(), r.fid, r.editor_id(), 'bytes' if salvaged_bytes else 'form id'))
            return 1

    print('')
    print('What this tool writes from its own numbers (#2553)')
    for r in own:
        state = ('added' if r in built else
                 'rewritten' if any(n is r for _, n in rewritten) else 'as it is')
        print('  %s 0x%07X %-40s %s' % (r.tag.decode(), r.fid, r.editor_id(), state))
    for r in house_new:
        print("  COBJ 0x%08X %-30s HearthFires.esm's, never listed: GetItemCount(gold) < 0"
              % (r.fid, r.editor_id()))
    for r in wood_new:
        print('  COBJ 0x%08X %-30s %s override, BNAM -> woodworking bench'
              % (r.fid, r.editor_id(), next(m for f, e, m in WOODWORKER_MASTER_RECIPES if f == r.fid)))
    print('')
    print('Cooking quality (#2906, game\\data\\food-groups.json quality)')
    print('  %d already here, %d made now from the masters' % (len(quality_have), len(quality_new)))
    for r in quality_new:
        print('  ALCH 0x%08X %s' % (r.fid, r.editor_id()))
    if house_bare or wood_bare:
        print('')
        print('What changes')
    for r in house_bare:
        print('  COBJ 0x%08X %-30s gains the condition that is never true' % (r.fid, r.editor_id()))
    for r in wood_bare:
        print('  COBJ 0x%08X %-30s BNAM -> woodworking bench' % (r.fid, r.editor_id()))
    print('')
    print('Cells and worlds')
    if world_new is None:
        print('  the masters are not in %s, so the %d that stay are left as they are'
              % (args.masters, len(world_keep)))
    else:
        changed = sum(1 for o, n in rewritten if o.tag in (b'CELL', b'WRLD'))
        print('  %d stay, each written from its winning master, %d of them changed now'
              % (len(world_keep), changed))
    if removing:
        print('')
        print('What comes out')
    if going:
        kinds = {}
        for f in going:
            kinds[by_fid[f].tag.decode()] = kinds.get(by_fid[f].tag.decode(), 0) + 1
        print('  salvaged, nothing of Thornswood\'s asks for them (#2553): %s'
              % ', '.join('%d %s' % (n, t) for t, n in sorted(kinds.items())))
    for f in sorted(retiring):
        print('  retired, nothing shows or names it (#2962): %s 0x%07X %s'
              % (by_fid[f].tag.decode(), f, by_fid[f].editor_id()))
    print('')
    print('Where the stations stand (#2553, game\\data\\station-sites.json)')
    kinds = {}
    for r in want.values():
        b = struct.unpack_from('<I', dict(subrecords(r.data))[b'NAME'])[0]
        kinds[b] = kinds.get(b, 0) + 1
    print('  %s' % ', '.join('%d %s' % (kinds.get(b, 0), n) for b, n in sorted(STATION_NAMES.items())))
    print('  %d already where the table puts them, %d moved to another cell, %d placed now, %d cell and '
          'worldspace record(s) copied from the masters for them'
          % (len(stays), len(moved), len(to_place) - len(moved), len(copies)))
    # A cell or world the plugin carries with none of its records under it,
    # as the file stands; one a move empties is found when the move is made.
    going_bare = set()
    drop_bare_parents(copy.deepcopy(tree), going_bare)
    going_bare &= set(before)
    if going_bare:
        print('  %d cell or world record(s) hold none of this plugin\'s records and go: %s'
              % (len(going_bare), ', '.join('0x%07X' % f for f in sorted(going_bare))))

    # The description names what the written plugin will hold (#2993): what
    # stays, what is added, and the cells and worlds copied in for stations.
    holds = ([r for r in records if r.fid not in removing] + built + to_place)
    # A record carrying the other server's name is that, not a new kind of
    # record for the description to name, so it is said first. The written
    # file is read for it again below.
    left = [(r, w) for r in holds for w in other_server_names(r)]
    if left:
        print('')
        for r, w in left:
            print('STOP. %s 0x%07X still carries the other server\'s name: %s'
                  % (r.tag.decode(), r.fid, w))
        print('Nothing was written.')
        return 1
    keys = ['%s %s' % (r.tag.decode(), r.editor_id()) for r in holds]
    keys += ['%s ' % tag.decode() for tag, _ in copies]
    description, unnamed = description_of(keys)
    if unnamed:
        print('')
        print('STOP. %d record(s) the plugin would hold are named by no row of CONTENTS, so the header '
              'could not say they are here (#2993). Add a row for them. Nothing was written.' % len(unnamed))
        for key in unnamed:
            print('  %s' % key)
        return 1
    if len(description) + 1 > DESCRIPTION_MOST:
        print('')
        print('STOP. the header\'s description would be %d bytes with its end, and mod tools hold %d '
              '(#2993). Shorten the words in CONTENTS. Nothing was written.'
              % (len(description) + 1, DESCRIPTION_MOST))
        return 1
    new_head, head_changed = described(head, description)
    print('')
    print('The header')
    if head_changed:
        print('  its description becomes: %s' % description.decode('ascii'))
    else:
        print('  its description already reads as this tool writes it')

    if args.check:
        print('')
        print('  --check, so nothing was written.')
        return 0

    edited = set()
    for old, new in rewritten:
        old.data, old.flags, old.extra = new.data, new.flags, new.extra
        edited.add(old.fid)
    world_rewritten = set(o.fid for o, n in rewritten if o.tag in (b'CELL', b'WRLD'))
    # A house part already overridden here keeps or gains the condition (#2258).
    for r in house_have:
        if never_listed(r):
            edited.add(r.fid)
    # Woodworking bench overrides (#516).
    for r in wood_have:
        if set_bnam(r, WOODWORKING_KEYWORD):
            edited.add(r.fid)
    if not built and not edited and not removing and not head_changed and not to_place and not going_bare:
        print('')
        print('  Everything this writes is already in the plugin as it writes it. Nothing was written.')
        return 0
    old_head = bytes(head)
    head = new_head
    # The stations go in before anything comes out, so a cell that loses the
    # other server's placement and gains Thornswood's keeps its record.
    for f in moved:
        for r, parent, cell in placements_in(tree):
            if r.fid == f:
                parent.remove(r)
                break
    stamp = next(k for k in tree if isinstance(k, Grup)).label[12:16]
    built_world = []
    for (tag, fid), (flags, data, src, ctx) in sorted(copies.items(), key=lambda x: (x[0][0] != b'WRLD', x[0][1])):
        rec = Rec(tag, flags, fid, FORM_TAIL, data)
        built_world.append(rec)
        if tag == b'WRLD':
            put_world(tree, rec, stamp)
        else:
            w = next(want_world[f] for f in want if want_cell[f] == fid)
            put_cell(tree, rec, ctx, w, stamp)
    for r in to_place:
        put_placement(tree, r, want_cell[r.fid], stamp)
    built_world += to_place
    tree = take_out(tree, removing)
    bare = set()
    tree = drop_bare_parents(tree, bare)
    # A record this adds goes where it belongs in the order this tool writes
    # its records in, not at the end of its group: a house part copied back in
    # from HearthFires.esm lands before the woodworking overrides, where it
    # was, so the same records always make the same file.
    order = ([r.fid for r in own] + [f for f, _ in HOUSE_PARTS] +
             [f for f, _, _ in WOODWORKER_MASTER_RECIPES] + [q[0] for q in quality])
    rank = dict((f, i) for i, f in enumerate(order))
    for r in built:
        group = ensure_top_group(tree, r.tag)
        at = next((i for i, k in enumerate(group.kids)
                   if isinstance(k, Rec) and rank.get(k.fid, -1) > rank.get(r.fid, len(order))),
                  len(group.kids))
        group.kids.insert(at, r)
    built += built_world
    added = set(r.fid for r in built)
    kept_ids = set(r.fid for r in every_record(tree)) - added
    # A placement the table moved to another cell is in the file again, added.
    # A cell or world left holding none of this plugin's records goes with
    # its last placement (drop_bare_parents).
    gone_unasked = sorted(f for f in before
                          if f not in kept_ids and f not in removing and f not in moved and f not in bare)
    if gone_unasked:
        print('')
        print('STOP. 0x%07X went with nothing left under it, and the register does not say it goes. '
              'Nothing was written.' % gone_unasked[0])
        return 1
    kept = [r for r in records if r.fid in kept_ids]

    # The header's record count, which sits in HEDR after the version float.
    #
    # IT IS SET TO THE TRUE COUNT RATHER THAN ADDED TO, because the number in
    # the file is wrong and has been for as long as this repo has had the file.
    # Measured 21 September across three copies: before the conditions edit,
    # before the manual trim, and after, the header said 408 every time, while
    # the file actually held 392, 392 and 376. So neither the editor id rename
    # of 21 September nor Remove-DeadRecords.ps1 has ever touched it,
    # and the plugin has been shipping and working at 408 against 392, which is
    # the evidence that the engine does not read it. Adding three to a wrong
    # number would keep it wrong; this writes what is actually there.
    hedr = head.find(b'HEDR')
    if hedr < 0:
        print('STOP. no HEDR in the header. Nothing was written.')
        return 1
    claimed = struct.unpack_from('<i', head, hedr + 6 + 4)[0]
    struct.pack_into('<i', head, hedr + 6 + 4, len(kept) + len(built))
    if claimed != len(records):
        print('')
        print('The header record count was wrong before this ran')
        print('  it said %d and the file held %d. Setting it to %d.'
              % (claimed, len(records), len(kept) + len(built)))

    out = bytes(head) + b''.join(k.bytes() for k in tree)

    print('')
    print('Does the result verify')
    after_records = list(every_record(parse(out, len(head), len(out))))
    if len({r.fid for r in after_records}) != len(after_records):
        raise ValueError('The authored plugin contains duplicate form IDs; nothing was written')
    # The header: the other server's name and short forms nowhere in it, and
    # nothing changed but the description and the record count.
    out_head = out[:len(head)]
    if other_server_in_header(out_head):
        print('  STOP. the header still carries the other server\'s name or a short form of it. '
              'Nothing was written.')
        return 1
    def header_rest(h):
        return [(t, b) for t, b in subrecords(h[24:]) if t not in (b'SNAM', b'HEDR')]
    if header_rest(out_head) != header_rest(old_head) or out_head[8:24] != old_head[8:24]:
        print('  STOP. the header changed in more than its description and record count. '
              'Nothing was written.')
        return 1
    if struct.unpack_from('<I', out_head, 4)[0] != len(out_head) - 24:
        print('  STOP. the header\'s size field does not match the header. Nothing was written.')
        return 1
    if len(after_records) != len(kept) + len(built):
        print('  STOP. %d records in, %d out, expected %d. Nothing was written.'
              % (len(records), len(after_records), len(kept) + len(built)))
        return 1
    back = [r for r in after_records if r.fid in removing]
    if back:
        print('  STOP. 0x%07X was to come out and is still there. Nothing was written.'
              % back[0].fid)
        return 1
    seen = [r for r in after_records if r.fid not in added]
    for was_r, now in zip(kept, seen):
        if (was_r.fid != now.fid or was_r.tag != now.tag or
                (was_r.flags != now.flags and now.fid not in world_rewritten)):
            print('  STOP. 0x%07X changed identity. Nothing was written.' % was_r.fid)
            return 1
        if now.fid not in edited and now.data != before[was_r.fid]:
            print('  STOP. 0x%07X was not on the list and its bytes changed. '
                  'Nothing was written.' % now.fid)
            return 1
    made = dict((r.fid, r) for r in after_records if r.fid in added)
    for b in built:
        if made[b.fid].data != b.data:
            print('  STOP. 0x%07X did not come back as it was built. Nothing was written.'
                  % b.fid)
            return 1
    now_by_fid = dict((r.fid, r) for r in after_records)
    for r in own:
        if now_by_fid[r.fid].data != r.data:
            print('  STOP. 0x%07X is not what this tool writes for it. Nothing was written.' % r.fid)
            return 1
    if orphan_groups(tree):
        print('  STOP. a cell or world group is left without its record. Nothing was written.')
        return 1
    # THE PLACEMENTS ARE THE STATION TABLE'S, each in its cell, and no other.
    there = dict((r.fid, (r, cell)) for r, parent, cell in placements_in(tree))
    if sorted(there) != sorted(want) or any(there[f][0].data != want[f].data or there[f][1] != want_cell[f]
                                            for f in want):
        print("  STOP. the placements are not the station table's, each in its cell. Nothing was written.")
        return 1
    # NOTHING SALVAGED IS LEFT (#2553), but the four kiln recipes and the
    # pickaxe and the axe, every field of which the rulebook states (the
    # register's sameByDesign says which line).
    left_salvaged = []
    for r in after_records:
        h = body_hash(plain(r))
        if h in salvaged_hashes and r.fid not in same_by_design and bethesda_hash.get(r.fid) != h:
            left_salvaged.append(r)
    if left_salvaged:
        for r in left_salvaged:
            print('  STOP. %s 0x%07X %s is still a salvaged record, byte for byte.'
                  % (r.tag.decode(), r.fid, r.editor_id()))
        print('  Nothing was written.')
        return 1
    left = [(r, w) for r in after_records for w in other_server_names(r)]
    if left:
        for r, w in left:
            print('  STOP. %s 0x%07X still carries the other server\'s name: %s'
                  % (r.tag.decode(), r.fid, w))
        print('  Nothing was written.')
        return 1
    count = struct.unpack_from('<i', out, hedr + 6 + 4)[0]
    if count != len(after_records):
        print('  STOP. the header says %d records and there are %d. Nothing was written.'
              % (count, len(after_records)))
        return 1
    print('  ok    %d records in, %d out, same order, same ids'
          % (len(records), len(after_records)))
    print('  ok    %d added, %d edited, %d taken out, every other byte untouched'
          % (len(built), len(edited), len(removing)))
    if bare & set(before):
        print('  ok    %d cell or world record(s) left holding none of this plugin\'s records went: %s'
              % (len(bare & set(before)), ', '.join('0x%07X' % f for f in sorted(bare & set(before)))))
    print('  ok    every record this tool writes is what it writes')
    print("  ok    the %d placements are the station table's, each in its cell" % len(want))
    print('  ok    no salvaged record is left')
    print('  ok    the header record count reads %d, which is what is in the file' % count)
    print('  ok    no record carries the other server\'s name or its short forms, '
          'compressed ones included')
    print('  ok    the header carries Thornswood\'s description and not that name, '
          'and nothing else in it moved')

    open(path, 'wb').write(out)
    print('')
    print('  %s bytes -> %s bytes' % (format(len(raw), ','), format(len(out), ',')))
    print('  THIS IS A SHIPPED FILE. Its size changed, so this needs a release and')
    print('  every client will download it again.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
