# Alchemist

Poisons and medicine. Skyrim has no alchemy recipe records. A potion
is whatever the ingredients share, worked out in the alchemy menu.
The server cannot hold you to a row that does not exist. It holds you
to the bench.

- [Blightbrewer](alchemist/blightbrewer.md) makes poisons.
- [Physicker](alchemist/physicker.md) makes medicine.

The lab is closed furniture. Blightbrewer or Physicker, from novice.
Anyone else is turned away, including a cook and a mage, unless a
master alchemist has taught them this as one of their two outside
trades. That teaching is novice and stops there.

Both halves may use the lab. The split is what you are for, not a
second door on the furniture. The day bench recipes exist, the poison
rows go to Blightbrewer and the medicine rows go to Physicker. Until
then the menu is the work.

A batch is two or more ingredients that share an effect on the short
list. The effects that are allowed, and the rank each one asks for,
are [Mixtures](../mixtures.md). An effect that is not on that list is
refused, even if the ingredients share it. This repo does not have a
table of which ingredient carries which effect, so this page cannot
honestly list "nightshade makes this poison" as if that row had been
measured.
The ingredients you can take out of the world are the gatherer's
plants, the hunter's parts, and the salts a miner can pull from the
quarry at expert and master. See [Gatherer](../classes/gatherer.md)
and [Miner](../classes/miner.md). Buying them is the other way.

A bottle the lab creates is not a record in the food table. It is
still a potion for thirst: the sip of 5 on
[Potions and restoration](../potions.md). It is not a meal. The food
table's poison and potion names are not usable as a catalogue. Most
of them did not survive as words. They are not repeated here.

## Eat it first, and your character remembers

Decided by Patrick on 22 Oct
([#3134](https://github.com/ThornswoodRP/Thornswood/issues/3134)).
An ingredient goes in a brew only once your character has eaten one.
Eating it teaches its first effect, the game's own rule. A brew with
an ingredient you have never eaten is refused before anything is
taken, and the line names the ingredient. The ingredients stay in
your pack.

Mixing different ingredients makes different things: a brew is the
effects two or more of its ingredients share. Once you have brewed a
mix, your character remembers it at any alchemy lab: the mix, what it
made, and every effect of each ingredient it showed you. The server
keeps that on your character, so a relog or a restart forgets
nothing, and every time you come into the world your game is taught
it again, so the alchemy menu shows it. A known effect is not a rank.

The Alchemy journal page of the K panel
([#3142](https://github.com/ThornswoodRP/Thornswood/issues/3142)) shows
the same record anywhere, away from a lab: every mix you have brewed,
what it made and how many times, and every ingredient you have eaten,
with how many of its effects you know and the names of the ones a brew
here makes. The page appears once you have eaten an ingredient.

## Master Chemist

At master, either half. Every batch yields two instead of one. One
craft is still one piece of work.

## What you are handed

1 in Toughness (+10 poison resistance and +10 disease resistance) and
1 in Clarity (+10% magicka recovery). The half places one more.

## The ladder

100, then 250, then 600, the count resetting. A successful batch is
one piece. There is no recipe list to climb by, so the work has to be
the batch the server sees. See the bottom of each half.

## Where this is

The lab gate is in the server. A batch is one piece of work, and
Master Chemist's second bottle goes on the same stack once the first
is in the pack. The mixtures list is in the server and asks the
effects the engine names for each brew (see [Mixtures](../mixtures.md)).
What your character has eaten and brewed is the alchemy block in
`game/gamemode.js`: it hears an ingredient eaten from the engine's own
eat, refuses a brew with one you never ate, and teaches your game what
you know at every arrival. There is no item list, because there are
no recipe rows.
