# People who are not people

Actors the world placed. They are not characters. They do not wake in
a temple, they do not hold a profession, and a kill of one can be a
warrior's work. A kill of a person cannot. See
[Death](death.md) and [Warrior](professions/warrior.md).

The server must load the surviving cast and own its position, activity,
combat, death and return. The same identity is shown to everyone. Work
continues when nobody is nearby. An actor without safe navigation waits
under server authority instead of walking through a wall.

## Who stays

Bandit camps, bandit ambushes, giant camps, dungeon enemies and wildlife
stay. Skeletons, draugr, wolves, bears and other hostile creatures belong
in suitable places: wilderness, caves, dungeons, sewers and encounters
beside roads. Camps are not removed to make towns smaller.

Specially named animals and enemies are cut too. Their generic species and
enemy families remain. Traders and transport workers stay as services.
Transport NPCs display their function: nine Coach Drivers, sixteen Ferry
Operators and two Ship Captains. Their original source names remain in the
catalogue for reference; server-owned display titles are applied during
admission and persist for current and later arrivals. Routes, identities and
population counts stay unchanged. The sixty guild traders display their
trade the same way: in each hold one Smith, Woodworker, Tailor, Enchanter,
Cook and Alchemist, the roster's role and the role table they trade by.
This includes named pets and dungeon bosses whose records lack the Unique flag.

An actor stays in its habitat and home region. Wolves do not roam a city
market. Bears do not populate a farmyard. Horkers belong on suitable
coasts, fish in suitable water, livestock on farms, and sewer creatures
below the streets. A road encounter stays beside its road. Returning
after death uses its home, not the nearest person or a temple.

Only Merchant's Guild traders and a small, suitable animal population
belong inside city walls. Vanilla courts, priests, guards, soldiers and
other town fillers are cut. Wildlife or enemies that vanilla did not
place in the city do not belong on its streets. A dungeon or sewer under
a city is its own habitat, not permission to spawn its enemies above it.
The rule also applies to towns without a separate city worldspace.

Traders you buy from and sell to. They are the merchant's guild of
the hold they stand in. The guild is these NPCs; people cannot join it.
Their prices are the average of the price
lists submitted to that hold's drop box. Their purse starts once,
and after that they buy and sell the way a person does. An empty
purse does not pay. An empty shelf does not sell. Stock is what
they have bought. See [Merchant's Guild](merchants-guild.md) and
[Custom quests](quests.md). A guild trader is handed 250 when they are
first stood up, once, and not again. Supply rewards debit this purse.
Scene rewards create the amount named on the quest, subject to its
cooldown. See [Gold](gold.md). Each hold has one recorded guild site. A later walk can move it.
Traders are not relocated by that record. See [Merchant's Guild](merchants-guild.md).
The 60 guild traders, one of each of the six roles in every hold, are listed by role, hold, place and reference in
[Merchant trader counts](merchant-traders.md).

Carriage and ferry drivers stay at stops outside city walls. They are
the workers of the hold the stop sits in. The fare is that hold's. See
[Carriages and ferries](carriages.md).

Thalmor patrols. 2 to 4, on the roads, at most 3 patrols, no coin.
See [The Thalmor](thalmor.md).

Animals in the hunt table, the fish, the seams, the plants, the
crops. Those are the classes, not this cast.

## What an NPC carries

Body loot comes from the server's assigned body piles and Hunter yields,
not the NPC record's pockets or death-item list. Inherited armour, weapons,
ammunition, scrolls and carried lights remain internal equipment for
appearance and combat. They cannot be taken alive or dead, sold as stock,
or dropped for somebody to pick up. Returning after death does not add a
new vanilla pile. See [Dungeon loot](dungeon-loot.md#bodies).

Deliberate assignments remain separate, even when they use the same item
as an inherited weapon. Guild purses and purchased stock still belong to
the merchant ledger. Custom guard equipment, Thalmor patrol assignments
and trade-ship crews retain their appearance and combat equipment. A
ship's cargo remains in its cargo register, not in its crew's pockets.

## Difficulty and population

Caves and dungeons have a fixed tier assigned to the place. Entering with
a stronger character does not silently raise it. The location list names
the tier, enemy families, population cap and return interval. A chest in
that place pays from the same tier. A camp enemy carries a little on the
body. Any other dead body rarely carries anything good. See [Dungeon loot](dungeon-loot.md).
Some places have more enemies and stronger ones. Ordinary routes and
beginner places remain usable; higher tiers are a choice, not the whole map.

Bandit camps share one bandit-camp baseline. Giant camps share one
giant-camp baseline. A giant camp can be harder than a bandit camp, but
neither kind has a ladder of tiers between its camps. Road ambushes have
small limits and a shared wait before another can pay out.

The caps count living actors and bodies waiting to return. They do not
grow with each connection or create a second wave for each person. A
return replaces a dead identity at its home; it does not stack another
copy on its body. Return times and shared stock survive a restart.

Hunting and fishing locations list the hold, habitat, species, population
or stock, and replenishment rate. Cold coasts, rivers, lakes, forests,
marshes, farms and caves do not all supply the same animals or fish.
Some locations supply only their named species. See [Hunter](classes/hunter.md)
and [Fisher](classes/fisher.md). Enough common supplies must circulate for
food and trades; rare goods remain limited. There is no fixed gold price
on an animal, fish or item, and increasing density does not mint coin.

## Who does not stay

The jarl's court as the game wrote it, priests who are not a person,
Bethesda guards and soldiers, and other ambient town fillers are cut.
Animals are limited by suitable habitat and a shared cap; they are not
removed as a whole. Bandits and other enemies outside the city surface
stay in their proper encounters.

The embassy's 20 are people on a roll, not actors. See
[The Imperial Embassy](embassy.md).

There are no NPC guards. A hold's guards are people in a guard role,
an office the hold sets ([Offices](offices.md)); Patrick decided on
11 October that guards are people and no NPC guard comes back (#502).
A Thalmor marker is a reason to start a fight. No bounty is added for
anything, a killing, a blow, a theft, a pickpocket or a trespass: there is
no crime gold and no stolen tag the server tracks. Theft is the rule on the site: take
something, take a good thing, leave the rest.

## Where this is

Patrick changed this policy on 1 October: preserve hostile camps,
encounters and wildlife in natural habitats, cut town fillers, limit city
animals, and implement merchant quests. The earlier instruction to remove
bandit camps is superseded. Guild sites are recorded and can move later.

Release 1.2.3 runs the population cut on both dev and main: the shared
controller, population catalogue, habitat limits and difficulty tiers are live.
Guards, courts, priests, town fillers and named creatures are not placed.
Stock controls and merchant quests are still being implemented and verified.

No bounty for anything (#502): Patrick, 12 October, "the whole bounty
system should be removed in its entirety". The bounty was Skyrim's own
crime system in each person's game, and nothing of ours added one. Once a
game is loaded, the front plugin sets all six ignore flags (murder, assault,
stealing, trespass, pickpocket, werewolf) on every faction that tracks
crime, 83 of them, so a crime of any kind against a member, or against
something the faction owns, is not a crime against it. The list is read out
of the load order by `scripts\dev\Build-CrimeTable.py` into
`game\data\crime-factions.json`, which also lists every script that adds a
bounty or sends somebody to jail by itself (guard dialogue, quest stages)
and why none of them can run here. Escaping jail has no flag; the game adds
it only to somebody it jailed, and with no NPC guard it jails nobody.
See [Shared NPC activity](../NPC-SERVER-ACTIVITY.md) for verification.
The [population catalogue](../NPC-POPULATION.md) lists authored counts, locations,
caps and return times. Its coordinate files and the server policy come from the
same winning-record inventory.
