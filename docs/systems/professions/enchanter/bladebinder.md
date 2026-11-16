# Bladebinder

Staves whose spell is in the college book. Thirteen of them. The
other 147, and the Aetherial Staff, are held in
[Cut items](../../cut-items.md) and are not made.

The thirteen that stay:

| Staff | Spell in the book | Rank |
| --- | --- | --- |
| Staff of Flames | Flames | Novice |
| Staff of Frostbite | Frostbite | Novice |
| Staff of Sparks | Sparks | Novice |
| Staff of Firebolts | Firebolt | Advanced |
| Staff of Ice Spikes | Ice Spike | Advanced |
| Staff of Lightning Bolts | Lightning Bolt | Advanced |
| Staff of Ice Storms | Ice Storm | Advanced |
| Staff of Soul Trapping | Soul Trap | Advanced |
| Staff of Turning | Turn Undead | Advanced |
| Grand Staff of Turning | Turn Greater Undead | Expert |
| Staff of Incineration | Incinerate | Expert |
| Staff of Icy Spear | Icy Spear | Expert |
| Staff of Thunderbolts | Thunderbolt | Expert |

Heart stone is master mining, one place, because the book no longer
needs a novice to pull it. See [Miner](../../classes/miner.md).

A staff asks for its spell's rank in the book. Patrick, 4 October:
each college book staff at its spell's rank. You unlock a spell only
at a Bladebinder rank at least the spell's, so the recipe asks for
what the spell already asks for. Below master you cannot mine the
stone, so you buy it from a master miner.

The spell table in
[enchanter-bladebinder](../../lists/enchanter-bladebinder.md) is the
server book, all 161 rows. The column that says whether the spell is
in the college book is how a row is told apart from the thirteen
above.

The Aetherial Staff is cut with the Aetherium. It wanted an aetherium
crest, 2 dwarven metal ingots, 2 ebony ingots and 1 gold ingot. Worth
1250. The reference stays in the cut file.

## The spell the menu asks for

Every staff except the Aetherial Staff has a HasSpell condition. The
crafting menu will not show the row unless that spell is on you.
Unlocking it on K puts the spell on you for that reason.

13 of the 160 staves that ask for a spell name a spell in the college
book. The other 147 name a mod spell, Odin or Apocalypse, that the
book does not contain. The recipe can be novice and still be
unmakeable, because nothing grants that spell. Knowing the book's
Calm does not satisfy a condition that names the Odin spell of the
same idea. The plan is that only the college book is granted. Those
staves stay in the table so they can be marked wrong: either the book
grows, or the row should not be a staff we expect anyone to make.
The table below says which spell, and whether it is in the book.

## Staff spells

You start with 2 points. Each rank before master gives 1. Master gives
2. The spell's rank cannot pass your Bladebinder rank. A novice spell
needs none below it.

The schools those spells belong to are the mage book:
[Destruction](../mage/destruction.md),
[Restoration](../mage/restoration.md),
[Alteration](../mage/alteration.md),
[Conjuration](../mage/conjuration.md),
[Illusion](../mage/illusion.md).
A staff does not give you the school. It gives you that one spell on
a stick, and only if you unlocked it.

## What you are handed

The half places 1 in Potency. With no school held, that point does
not change a spell. A Bladebinder who is also a mage feels it in the
schools they hold.

## What you cannot do

You cannot enchant a cuirass here. That is Wardweaver, and your sister
half is that menu at novice, which means you may use the arcane
enchanter. It does not hand you Wardweaver's extra Ward point.

You cannot mine the heart stone until you are a miner of master
rank. The profession does not include the class.

Every recipe, by rank and with its id: [enchanter-bladebinder](../../lists/enchanter-bladebinder.md).

## Where this is

The 161 rows, the staff enchanter, and the unlock points are in the
server. Heart stone is master in the ore table. The thirteen staves ask for their spell's rank in the recipe table. Cut staves are out of the open recipe book. The references stay in the cut file.
