# Dungeon loot

A chest in a dungeon, a cave, or a sewer pays from the tier of that
place. The tier is the place's, not the person's. Walking in with a
stronger character does not raise it. Camps are not on the chest
table. A bandit camp and a giant camp have no tier. A camp enemy
carries a little on the body instead.

No container in the world holds anything the world put there. A
chest, a barrel, a sack, or a cupboard starts empty, and holds only
what a person puts in it. Nothing the world placed lies on the floor
of a dungeon or anywhere else. What this pays is created by the
server, the same way a scene quest creates its reward, and goes into
the pack of the person who opened the chest. See [Gold](gold.md).

## What opens

A chest, an urn, a coffin, a sarcophagus, a strongbox, a coffer, a
safe, or a knapsack. A barrel, a sack, a cupboard, a dresser, a
shelf, or a crate does not pay. A burnt body left in the world is a
person, not an urn, and does not pay. A container somebody placed does
not pay. The world's copy of that container does.

The same container pays once, to the person who opens it. Everybody
else shares that pile by handing it over themselves. It pays again
after the place has rested. The rest is the population rest for that
tier.

| Tier | Gold | Rest | Tome | Exclusive | Tomes |
| --- | --- | --- | --- | --- | --- |
| 1 | 5 to 15 | 30 minutes | 22 in 100 | 5 in 100 | novice |
| 2 | 12 to 35 | 45 minutes | 32 in 100 | 9 in 100 | novice |
| 3 | 25 to 70 | 60 minutes | 42 in 100 | 14 in 100 | novice, rarely master |
| 4 | 50 to 120 | 90 minutes | 55 in 100 | 22 in 100 | novice, or master |

The boss chest at the end of a place pays one tier above the place:
its gold, goods, tome and exclusive rolls are the next row's. A boss
chest in a tier 4 place has no row above it and pays tier 4, with the
exclusive roll made a second time. Every boss chest holds a spell tome
or a dungeon exclusive for certain: when neither roll comes up, one of
the two is put in, the tome or the exclusive in proportion to their
chances on that row. It rests for the place's own time, like every
other chest there. A boss chest is one whose record Skyrim names as
the boss's: 33 containers in the load order, such as the draugr,
bandit, Falmer and Riekling boss chests. Decided by Patrick on 12
October 2026.

Gold is always in the chest pile, inside those spans. Two draws are
made for ordinary goods. The pile is food, drink, ore, gems,
ingredients, soul gems, and ordinary weapons and armour. Lower tiers
are mostly the common supplies and iron or hide. Higher tiers keep
those and add steel, silver, better gems, more of the healing
ingredients, and, at the top, ebony, glass, and a grand soul gem. The
richer goods are the rarer ones.

No potion is in the pile. A bottle the alchemy lab brews is a new form,
never one of Skyrim's potion records, so a potion found here was one
nobody could make. Each of the ten the pile paid is an ingredient with
the same effect that a Gatherer or a Hunter gathers: imp stool, swamp
fungal pod and eye of sabre cat for healing, red mountain flower for
magicka, purple mountain flower for stamina, snowberries for fire and
glowing mushroom for shock. Decided by Patrick on 26 October 2026
(#3470).

## Spell tomes

This is how a tome gets into a pack when nobody handed one over. The
chest rolls novice tomes, and at tier 3 and tier 4 it can also roll a
master tome. Apprentice, adept, and expert tomes are not in this roll.

A person who is not a mage can learn from a tome only after a master
has apprenticed them, and then only a novice spell, and only two, in
one school. A tome past that stays in the pack. See
[Magic and the College](magic.md).

A mage who picks a master spell on K needs that spell's master tome
in the pack, master rank in that school, and a spell point. The tome
is spent. Reading the tome is the other door, and that book is already
in hand. The spell one rank below is still required.

The tomes are the college spells from the base game, including
Guardian Circle. A mod spell is not in this pile.

## Dungeon exclusive

These are found on this table and nowhere else on it. They are not
the ordinary weapon pile, and they are not a company ware. The
company keeps its own goods the same way, from its own source. See
[Free Skyrim Trading Company](trading-company.md).

- Ancient Nord Amulet, from tier 1
- Ancient Nord Sword, Ancient Nord War Axe, Ancient Nord Arrow, from tier 2
- Ancient Nord Bow, Ancient Nord Helmet, Ancient Nord Armor, Ancient Nord Boots, Ancient Nord Gauntlets, from tier 3
- Ancient Nord Greatsword, Ancient Nord Battleaxe, Black Soul Gem, from tier 4

One of them, when the exclusive roll hits. The world puts nothing
in a container of its own. Ordinary iron, steel, and the
rest of the gear list above are created by the chest, and the burial
set is created only from this list.

The Ancient Nord burial set is dungeon only: no bench makes any of it
(Patrick, 26 October 2026, #4676). Its weapons and amulet have no
recipe, and its helmet, armour, boots and gauntlets, which Skyrim makes
at the Skyforge, are in the cut file
([Cut items](cut-items.md)).

## Mines

A mine is on the chest table only when the population catalogue gives
that place enemies. The mines that already have a dungeon tier all
have enemies. Raven Rock Mine is tier 4. A wilderness mine with no
dungeon tier stays off. A mine that is only a bandit camp is not a
dungeon chest. Those enemies use the body pile.

## Bodies

An NPC gives only the loot Thornswood assigns: the body pile below,
the Hunter carcass table, or goods deliberately handed to that NPC by
a server system. Its plugin's pockets and death-item list do not add
gold, potions or other loot. Its inherited clothes and weapons remain
owned inside the engine so it can dress and fight, but cannot be taken,
traded or dropped. An assigned copy of the same weapon is separate and
can still be handed over. This applies alive, dead and after returning.
Nothing strips a corpse after death; the native initialization and
transfer rules prevent the extra loot at its source.

Every dead body that is not a person, and not a hunter carcass, can
be searched. The pile is rolled when that actor dies and stays on
that life. The first person to search it takes what is there. If the
death was missed, the search rolls it then. Standing back up clears
it, so the next life is a new roll. A later search of the same life
is silence.

No body is ever empty (Patrick, 26 Nov 2026: "nothing should ever drop
nothing atleast something small or common or whatever"). A roll that
comes up with no gold and nothing else takes one common supply, so
every first search hands something over.

A bandit camp enemy or a giant camp enemy carries a little:

- 80 in 100, 1 to 6 gold
- 65 in 100, one common supply
- 8 in 100, one better supply
- 15 in 1000, ordinary gear up to steel, or a novice tome
- 2 in 1000, a master tome or a burial piece

Any other dead body is stingy, and when none of these comes up it
carries one common supply. Anything good on it is rare:

- 20 in 100, 1 to 4 gold
- 12 in 100, one common supply
- 2 in 100, one better supply
- 5 in 1000, ordinary gear up to steel, or a novice tome
- 5 in 10000, a master tome or a burial piece

A person is not searched. A hunter carcass stays on the hunter path
and is not paid again here.

## Where this is

The roll, the rest, and the pay into the pack are in the server. The
chest places are the interiors whose names match a dungeon, a cave,
or a sewer in the population catalogue. A place the catalogue has not
named does not pay a chest. A camp does not pay a chest.

This reward service runs on both servers, Main and Dev. A living human must be within 400
units. A chest return is saved in the private ledger before the complete
gold and goods bundle is queued into one inventory write. The return
belongs to that container, shared by everyone, and survives reload.
The ledger is the only record of when a chest paid; nothing is written
on the chest itself. A body return is the same ledger, marked
as a body, with coin from 0 to 6. It is cleared when that actor stands
up. Missing or damaged private state refuses rewards. A failed save
mints nothing.

The native inventory save is asynchronous. If that write fails or is lost
in a crash after reservation, the reward can be missing. The reservation
is retained and is not automatically replayed; its exact reward is saved
for diagnosis. This prevents another payout from an uncertain write but
does not claim a durable inventory acknowledgement.
