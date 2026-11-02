# Mixtures

The short list a lab may brew. It is the same shape as the college
spell book. An effect that is not named here is not a mixture, even
if two ingredients share it in the vanilla menu.

The profession is [Alchemist](professions/alchemist.md). Poisons are
[Blightbrewer](professions/alchemist/blightbrewer.md). Medicine is
[Physicker](professions/alchemist/physicker.md). Drinking one is
[Potions and restoration](potions.md): a sip of thirst 5, and the
falling heal inside 60 seconds.

You need the rank in that half. A sister half, or an outside trade,
stops at novice. One successful batch is one piece of work. Master
Chemist makes two bottles and it is still one piece.

The ingredients are what a class can take out of the world: a
gatherer's plants, a hunter's parts, and the fire, frost, and void
salts a miner can pull from the quarry at expert and master. Which
plant carries which effect is the game's own list. This page does not
invent a second one.

## Medicine

Physicker.

| Rank | Effect |
| --- | --- |
| Novice | Restore Health, Restore Stamina, Restore Magicka |
| Advanced | Fortify Health, Fortify Stamina, Fortify Magicka, Cure Disease |
| Expert | Resist Fire, Resist Frost, Resist Shock, Fortify Carry Weight |
| Master | Regenerate Health, Regenerate Stamina, Regenerate Magicka |

## Poison

Blightbrewer.

| Rank | Effect |
| --- | --- |
| Novice | Damage Health, Damage Stamina, Damage Magicka |
| Advanced | Lingering Damage Health, Ravage Stamina, Ravage Magicka |
| Expert | Weakness to Fire, Weakness to Frost, Weakness to Shock, Weakness to Poison |
| Master | Paralysis, Fear |

A poison that would kill a person is [Death](death.md). It does not
skip injury or disease.

## What you cannot brew

Invisibility, frenzy, calm, waterbreathing, and every other effect
the vanilla menu knows and this page does not name. Those are spells,
or they are not a bottle this server sells.

A bottle is not a meal. It does not fill hunger.

## Where this is

The lab is closed to the two alchemy halves. A batch is one piece of
work, counted the way every other piece is. Master Chemist puts a
second bottle on the same stack once the first is in the pack.

This list is in the server (`MIXTURES` in `game/gamemode.js`), keyed
by the game's alchemy effects, with the rank of each. The server
refuses a brew carrying an effect that is off it, or one above the
rank. The engine works out which effects a brew carries from the
ingredients it takes, the ones two or more of them share, and hands
them to the server with the craft
([#1389](https://github.com/ThornswoodRP/Thornswood/issues/1389)).

Every ingredient in a brew must be one your character has eaten, or
the brew is refused and the ingredients stay in the pack. A brew that
goes through is remembered on the character, with every effect it
showed, at any lab ([#3134](https://github.com/ThornswoodRP/Thornswood/issues/3134),
[Alchemist](professions/alchemist.md)).
