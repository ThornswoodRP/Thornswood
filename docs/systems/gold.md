# Gold

Coin enters the world as the 40, as a trader's 250, and as the set
reward on a scene quest. The 40 and the 250 happen once. The scene
reward is created each time that quest is finished, and the cooldown
on the quest is what spaces it. A scene quest is a retrieval or a
kill in the named place. It does not buy goods. A supply quest does not create
coin. It pays from the trader's 250. A letter does not create coin
either. The sender pays the courier. After that, coin moves, or it
leaves.

## Where coin comes from

Every character is handed 40 gold, once, the first time they are in
the world. That is enough for a meal and a bed on the first evening.
It is not a wage, and it is not paid again on a later login.

The record is the base game's gold, form `0xF`.

The world does not mint the rest by leaving coin where it grew. A
chest, a barrel, a sack, or any other container starts empty: the
world puts nothing in it, coin or anything else. A draugr's gold is
stripped. Nothing lies on the floor at all: no coin, no coin purse,
no weapon or armour, nothing a person could pick up that the world
put there. What a person made, traded, or was given by another
person stays, in a pack or in a container. What a person drops lies
where they dropped it for 2 minutes, with everything it carried, and is
then gone, a server restart in between included. At most 10 of one
person's drops lie at once, and an 11th takes the oldest away. Patrick decided this on his report page on 27
October (A, [#3498](https://github.com/ThornswoodRP/Thornswood/issues/3498)).
To leave something for somebody, put it in a container or a drop box.

A chest in a dungeon, a cave, or a sewer is a different door. Opening
one creates a small sum, on that place's tier, and the same chest
does not pay again until the place has rested. That is the same kind
of mint as a scene quest's reward. There is no other coin in the
chest. A dead body can also create a little coin,
much less than a chest, and most bodies create none. See [Dungeon loot](dungeon-loot.md).

## What counts as gold

Loose gold in a pack is gold. A coin purse a person was handed by
another person counts as gold when a fee or a trade looks at the pack.

## What it pays

A trade moves gold from one pack to the other. Both people put an
amount on the table and both agree. You cannot put up more than you
are holding.

Gold pays, when the system that asks for it exists:

| What | Gold | Where it goes |
| --- | --- | --- |
| The first purse | 40, once | The new character |
| A guild trader's purse | 250, once | That trader, when they are first stood up |
| A scene quest | The amount on that quest | The person who finished it. Created. Not the trader's purse |
| A letter | 15, from the sender, plus a board fee of 20 | The 15 to the courier on delivery. The fee to the hold's ledger |
| A notice | 20 | The hold's ledger |
| A job, including a haul's posting fee | 30 | The hold's ledger |
| A haul's pay | Whatever was posted | The hold's ledger, then out to the hauler minus the company's tenth |
| Rent | Whatever the steward set, every 7 real days | That hold's ledger |
| A carriage | 10 to a stop in the same hold, 20 to another hold | The departure hold's drop box, as gold |
| A ferry | 10, Solstheim's own ferry included | The departure hold's drop box, as gold |
| The crossing to Solstheim, the Northern Maiden between Windhelm and Raven Rock | 40 | The departure hold's drop box, as gold |

The rows that are not in the server yet are said at the bottom of the
page they belong to. The amounts are the plan's amounts. The Merchant's
Guild is the NPC traders; people cannot join it and pay no guild dues.

## What gold does not buy

Gold does not buy a rank, a class, a profession, a spell, a skill
point, or a claim. A claim is free. A rank is work.
See [Professions](professions.md) and [Skill tree](skill-tree.md).

Gold does not buy a second purse. Dying does not pay the 40 again.

## The two purses

A person receives 40, once. A guild trader receives 250 when they
are first stood up, once. See [Merchant's Guild](merchants-guild.md).
A trader who goes broke is not paid the 250 again. A scene quest
creates the gold written on it, each time it is finished, and that
gold does not come out of the 250. The quests and the amounts are
on [Custom quests](quests.md). Fees destroy it from a pack
and count it on the hold's ledger. A payout, when one exists, creates
it back into a pack and subtracts the same count from that ledger. The
coin was already in the world. A payout is not a second mint.

Two things destroy coin without putting it on a ledger. A company
event can buy a thing and the thing leaves the world. When the company
buys from someone, the worker who handled it takes 10% of the price,
rounded down, and another 10% leaves the server rather than staying
in a pack or a box. The seller receives what is left. A price under
10 gold pays the whole price, and neither cut is taken. See
[Free Skyrim Trading Company](trading-company.md). An item has no
gold price of its own. What it sells for is the price a person posts.

## Dull

A crafted good or a shop good that sits loses condition. That is
[Durability](durability.md). It loses 5% of its condition per real
day. The containers are a shop chest and a house container. A pack
does not dull. Worn gear does not dull this way. Opening the chest
does not reset the day.

See [Property](property.md) for the box, and
[Free Skyrim Trading Company](trading-company.md) for the payout.

## Where this is

The 40, the mark that stops a second purse, and trade between two
people are in the server. The containers that start empty are in the
server settings, and the coin and purses that no longer lie on the
floor are switched off in Thornswood-Last.esp. A dungeon chest pays its tier's gold on that place's rest.
A guild trader's 250 is not. A scene quest creates its gold when it is finished, and that
gold is not taken from a trader's purse. Rank is not for sale. A weapon, armour or clothing in a chest or
container in a claimed building loses 5% a day, written when the chest
is next opened. See [Durability](durability.md). Notice fees, job fees, letter fees, and a haul's fee and pay are counted
on the ledger. Carriage and ferry fares, and gold people put in the drop
box, rent among it, are real gold in the hold's drop box (#2298), which
the hold's officers take out. The payouts are a
letter's 15, to the courier on delivery or back to the sender when
they take it down, and a haul's pay, to the hauler less the company's tenth
when it is confirmed, or back to the poster when it comes down. A
company sale, the trade panel's Buy for the company, pays the seller
from the worker's pack, destroys its 10%, and the thing sold leaves
the world.
