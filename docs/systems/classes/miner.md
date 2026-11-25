# Miner

A pickaxe in the pack, not necessarily equipped. Any pickaxe except a
war pick. 50 uses. When it breaks, a smith makes the next one.
Nothing hands you another.

18 names, 581 veins. Every name:
[lists/miner.md](../lists/miner.md).

| Ore | Rank | Veins | One swing, if you may work it |
| --- | --- | --- | --- |
| Clay | Novice | 5 | 1, and a chance of one more |
| Iron | Novice | 82 | 1, and a chance of one more |
| Quarried stone | Novice | 1 | 1, and a chance of one more |
| Corundum | Advanced | 81 | 1, and a chance of one more |
| Orichalcum | Advanced | 76 | 1, and a chance of one more |
| Quicksilver | Advanced | 76 | 1, and a chance of one more |
| Shellbug chitin | Advanced | 1 | 1, and a chance of one more |
| Silver | Advanced | 76 | 1, and a chance of one more |
| Gold | Expert | 76 | 1, and a chance of one more |
| Malachite | Expert | 7 | 1, and a chance of one more |
| Moonstone | Expert | 76 | 1, and a chance of one more |
| Amethyst | Master | One place | 1, and a chance of one more |
| Ebony | Master | One place | 1, and a chance of one more |
| Emerald | Master | One place | 1, and a chance of one more |
| Ruby | Master | One place | 1, and a chance of one more |
| Sapphire | Master | One place | 1, and a chance of one more |
| Stalhrim | Master | One place | 1, and a chance of one more |
| Heart stone | Master | One place | 1, and a chance of one more |

A rank below the row cannot work that seam. The swing, when it is
allowed, takes 1 ore of that seam. It is one piece of work, not one
per piece of ore.

Each rank above novice spends less rest on the swing, and has a
higher chance that the same swing also drops one extra ore. The extra
can be a different metal. The rest costs are the ones on
[Professions](../professions.md): 1.5, 1.2, 0.9, 0.6. A further cut
was not named.

The extra is one ore. The tiers are iron, clay, and quarried stone,
then corundum, silver, orichalcum, and quicksilver, then gold,
moonstone, and malachite. Ebony, the gems, stalhrim, and heart stone
are never an extra. They stay the one place below. Shellbug chitin
is never an extra from another seam.

| Your rank | Same ore | Next tier | Two tiers up |
| --- | --- | --- | --- |
| Novice | 5% | | |
| Advanced | 10% | 2% | |
| Expert | 15% | 5% | 1% |
| Master | 20% | 8% | 2% |

An empty cell is no roll. Two tiers up from iron is how an iron seam
hands a gold ore, a moonstone, or a malachite. The ore inside a tier
is an equal chance among the names in that tier. A roll that would
land on ebony, a gem, stalhrim, or heart stone does not happen. The
same-ore roll still does.

Heart stone is master, by its price. The staves that still ask for it
are the ones left in the college book. See
[Bladebinder](../professions/enchanter/bladebinder.md).

A new ore is given a rank when it is added. The rank is not a gold
price. An ore has no gold price.

## The seam

A seam holds 20. One swing takes 1, and sometimes 1 more, and is one
piece of work. Five full seams of 20 is the 100 to advanced. Expert
is 250 swings after that, master 600 after that.

The seam comes back for everybody at once, not per person.

| Seams | Back in |
| --- | --- |
| Iron | 15 minutes |
| Gold | 20 minutes |
| Corundum, silver | 10 minutes |
| Clay, quarried stone, orichalcum, quicksilver, moonstone, malachite, shellbug | 30 minutes |
| Ebony, the gems, stalhrim, heart stone | One place each, below. A scarce quest opens it. The counts and the cooldown are on [Custom quests](../quests.md). The rank on the seam still applies. |

Clicking again while the pick is still in the air is not a second
swing. Nothing is said. The ore is not given twice.

Smelting the ore into an ingot is anybody's work, at a forge, and the
forge burns a charcoal. See [Smith](../professions/smith.md).

## The one place

Each rare seam is one building. Every vein of that seam inside it is
the place. The same seam anywhere else, in another building or on open
ground, stays shut.

| Seam | The one place |
| --- | --- |
| Ebony | Raven Rock Mine |
| Stalhrim | Kolbjorn Barrow |
| Heart stone | Coldcinder Cave |
| Ruby | White Ridge Sanctum |
| Sapphire | Highpoint Tower |
| Emerald | Kolbjorn Barrow |
| Amethyst | Highpoint Tower |

A guild trader gives the scarce quest that opens it. Nothing else
opens it. The place holds the count on [Custom quests](../quests.md),
across all of its veins of that seam. Once you turn the quest in, the
place is shut to you until that quest's cooldown ends. The cooldown
is kept by the server and it is yours: another person holding the
same quest still works the place.

## The salt quarry

One quarry this server placed, `dde4ef:Thornswood-Content.esp`. It is
not one of the 581 veins and it does not use the deposit of 20.

Any miner, from novice. A pickaxe, the same 50 uses. One swing is
one piece of work. The "always 1" rule above is the ore seams. This
quarry still uses the pairs in the table.

| Your rank | Salt |
| --- | --- |
| Novice | 1 to 2 |
| Advanced | 1 to 3 |
| Expert | 1 to 4 |
| Master | 1 to 5 |

From expert up, a swing can also bring 1 Fire Salts, Frost Salts, or
Void Salts. The chance is 12% at expert and 24% at master. Advanced
and novice bring salt only.

The quarry's own wait is 20 seconds, not 10 minutes and not 30. It
is stamped when the swing starts. A click during the swing is not a
second strike. A restart clears it. The salt is `34cdf:Skyrim.esm`.

## What you are handed

1 in Might (+0.05 melee). A smith who is also a miner stacks this on
the smith's Might.

## Ores that come only from the Pale

Malachite and quicksilver are the Pale's own ores (Patrick, 22 Oct
2026, #3150: each hold has plants or ores of its own). Their seams
are only in the Pale. Mine them there, or trade for them anywhere
else. Outside the Pale the seams are not in the world at all. Every
other hold's own are plants: see [Gatherer](gatherer.md).

## Where this is

The server has 581 veins and a deposit of 20. A swing takes 1, and
the chance of one more is the rank table above, out of the same 20.
The common seams come back on the clock above. Heart stone is master.
The pickaxe has 50 uses. Each rare seam is bound to the
building in the table under The one place, by that building's cell in
`game/data/mine-buildings.json`, and every other vein of that seam is
shut. A scarce quest is the only way in, and its cooldown starts at
the turn-in. A swing at a scarce place gives 1, without the chance of
one more. The open quest, what it has drawn, and the cooldown are
kept on the character, so a restart of the server keeps them. No
trader offers the quest in the game yet, so every rare vein still
answers shut in play. The table in [lists/miner.md](../lists/miner.md)
is that server book. The numbers on this page are the plan.
