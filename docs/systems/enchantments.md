# Enchantments

The short list an arcane enchanter may put on a piece. It is the same
shape as the college spell book. An enchantment that is not named
here is not granted, even if disenchanting a found item would have
taught it.

The profession is [Enchanter](professions/enchanter.md). A weapon
enchantment is Bladebinder. Armour and clothing are Wardweaver. The
sister half is novice of the other list. An outside trade is novice
and stops there.

A staff is not this list. A staff is a recipe, on
[Bladebinder](professions/enchanter/bladebinder.md).

The strength of the enchantment is the soul gem, not a second ladder.

| Soul | Rank you need |
| --- | --- |
| Petty | Novice |
| Lesser | Advanced |
| Common | Expert |
| Greater, Grand, Black | Master |

A greater gem in a novice's pack does not make a novice enchantment
stronger. The bench refuses it. A petty gem is legal at every rank,
and it is the weak one.

One enchantment on a piece, until Twin Souls at master, which is two.
Three is never. See [Wardweaver](professions/enchanter/wardweaver.md).

## On a weapon

Bladebinder.

| Rank | Enchantment |
| --- | --- |
| Novice | Fire Damage, Frost Damage, Shock Damage, Soul Trap |
| Advanced | Absorb Health, Absorb Stamina, Absorb Magicka, Turn Undead |
| Expert | Banish, Fear |
| Master | Paralyze |

Soul Trap on a person is [Death](death.md). It is not a way to fill a
gem off somebody you were standing next to.

## On armour and clothing

Wardweaver.

| Rank | Enchantment |
| --- | --- |
| Novice | Fortify Health, Fortify Stamina, Fortify Magicka |
| Advanced | Resist Fire, Resist Frost, Resist Shock, Fortify Carry Weight |
| Expert | Muffle, Waterbreathing |
| Master | Fortify Health Regen, Fortify Stamina Regen, Fortify Magicka Regen |

## What you cannot put on a piece

Fortify smithing, fortify alchemy, fortify destruction, and the rest
of the vanilla catalogue. A rank is work. An enchantment does not
sell one. See [Gold](gold.md).

## Where this is

The arcane enchanter is closed to the two enchanter halves. Twin Souls
is the second slot: a master Enchanter is handed the game's Extra
Effect perk, so the menu offers a second enchantment, and it is put
back on every spawn.

This list is in the server (`ENCHANTMENTS` in `game/gamemode.js`),
keyed by the game's enchanting effects, with the rank of each. As
soon as the engine says what went on a piece, the server refuses an
enchantment that is off it, one above the rank, and a second one
without Twin Souls, and counts the rest as one piece of work for the
half that owns it. The engine does not say yet: the craft message
from the client names the piece and not its enchantment, so the menu
still applies whatever Skyrim would. [#1389](https://github.com/ThornswoodRP/Thornswood/issues/1389)
says what the engine has to pass.

The soul gem table above is checked ([#1648](https://github.com/ThornswoodRP/Thornswood/issues/1648)):
the engine hands the gamemode the craft's inputs, and a gem above your
rank in the half that owns the piece is refused with the gem and the
piece left in your pack. The size of the gem is what is judged. The
server does not keep a list of learned enchantments, because it is
never told about a disenchant.
