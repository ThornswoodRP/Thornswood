# Custom quests

Patrick expanded the requirements on 12 October 2026: six distinct merchant
roles per hold, different quests by hold and role, work at all four ranks,
coverage for every class and profession, and Master work for every half and
magic school. [Six trades in each hold](merchant-expansion.md) records that
contract and the implementation order. The tables below describe the older
authored work; they are no longer a restriction against adding quests.
The expanded roster and quest catalogue are not released yet.

Quests this server runs. Papyrus quests do not run, so a vanilla
quest journal does not open. The offer, the turn-in, and the unlock
are the server's. The vanilla quests themselves, and the gate, door and
arrival talk in them, are stopped from starting in each person's game by
`Thornswood-Last.esp` (#2468), except the creature voices; so are the
collection's own mod quests with that kind of talk
(`game/data/last-plugin-policy.json`).

A trader of that hold's [Merchant's Guild](merchants-guild.md) gives
them. Staff do not. The traders are the actors
on [People who are not people](npcs.md). You speak to the trader.
The server accepts the goods, because the actor's own scripts do
not run.

A new character's first errand, from the Cook of the town they start in, is
not one of these. It pays nothing and moves no goods, and it is on
[Creation](creation.md), under The first steps (#3166).

## What they are for

A supply quest moves goods. The trader asks for a count of an item
that hold already buys. The item is one on the price lists submitted
to that hold's box. There is no second list. The count is 5. The
cooldown is 6 hours. You bring it. The trader pays that hold's
buy price for the count, out of the trader's own purse, through the
same transfer as a sale to that trader. If the purse
cannot cover 5, the trader does not offer the quest. If no trader
buys the item, there is no supply quest for it. Prices are on
[Merchant's Guild](merchants-guild.md).

A scarce quest opens a place that is otherwise shut. The trader asks
for a count of the scarce item. The place holds more than that count.
You may take the asked amount and the extra. You turn in the asked
amount. The extra stays in your pack. Then the place shuts for you
until the cooldown ends.

Until the turn-in, the extra is not yours. Walking away returns the
remaining goods up to the recorded draw and shuts the place. Spending
some or all of that draw does not trap the open work. Missing goods start
that work's normal cooldown, so leaving cannot refresh a spent draw.
Giving back the whole draw, or leaving before drawing anything, starts
no cooldown.
You cannot take more from the place while the quest is unfinished.

The rare mine is this second kind. Ebony, the gems, stalhrim, and
heart stone are one place each, a building: ebony is Raven Rock Mine,
stalhrim and emerald are Kolbjorn Barrow, heart stone is Coldcinder
Cave, ruby is White Ridge Sanctum, and sapphire and amethyst are
Highpoint Tower. Every vein of that seam inside the building is the
place, and the same seam anywhere else stays shut. The trader's quest
opens it and the cooldown below shuts it again. Nothing else opens
it. See [Miner](classes/miner.md). The rank on the seam still
applies. These are the rest. A place holds
more than the asked count. You keep the extra. The rank on the work
still applies.

| Quest | Who | Ask | The place holds | Cooldown |
| --- | --- | --- | --- | --- |
| The ebony | Miner, master | 4 ebony ore | 12 | 24 hours |
| A gem | Miner, master | 2 of the gem they name | 6 | 24 hours |
| The stalhrim | Miner, master | 3 stalhrim | 8 | 24 hours |
| The heart stone | Miner, master | 3 heart stone | 8 | 24 hours |
| The longfin | Fisher, master | 2 Abecean longfin | 8 spots | 12 hours |
| The pearl bed | Fisher, expert | 1 pearl | 3 spots | 8 hours |
| The crimson | Gatherer | 3 crimson nirnroot | 8 | 12 hours |
| The mammoth ground | Hunter, master | Dress 1 mammoth | 3 mammoths | 24 hours |
| The orchard | Farmer, expert | 4 apples | 10 | 12 hours |
| The geode | Enchanter | 2 petty soul gems | 6 | 12 hours |

A scene quest is a deed, not a purchase. The trader does not buy
food, cooked meals, ore, or anything a person made. Those prices
stay with the people who sell them. A supply quest is the purchase.
Most scene quests are a retrieval, the same kind as the signet. The
others are a kill. The server can already see both: the quest item
in your pack, or the death.

The gold is the amount written on that quest. It is created when
you finish. It does not come out of the trader's 250, and it does
not run out. The same cooldown rules apply. These are open to
anyone. On a kill, what the body drops stays in your pack. You sell
that to a person, at their price. The quest does not take it.

A letter is not one of these. Letters are posted on the notice
board, and the sender pays the courier. See
[Notice boards](noticeboards.md). The dispatch below is the guild's
case, not a letter a person wrote.

| Quest | What the server checks | Gold | Cooldown |
| --- | --- | --- | --- |
| The satchel | A satchel in a sack they name, by a road in this hold. | 20 | 3 hours |
| The ledger | A book on a shelf they name. It grants no skill. | 30 | 6 hours |
| The signet | A ring in a chest they name. | 40 | 8 hours |
| The locket | A locket in an urn they name. | 45 | 10 hours |
| The case | A sealed case in a strongbox they name. It does not open. | 50 | 8 hours |
| The dispatch | That same kind of case, in a chest in this hold, handed to the trader in a hold they name. | 60 | 12 hours |
| The seal | A stamp in a chest in a ruin they name. | 70 | 14 hours |
| A wolf | You kill a wolf in the place they name in this hold. | 25 | 3 hours |
| A sabre cat | You kill a sabre cat in the place they name. | 40 | 6 hours |
| The camp | You kill three bandits in the camp they name. | 45 | 6 hours |
| A bear | You kill a bear in the place they name. | 50 | 8 hours |
| The barrow | You kill a draugr in the barrow they name. | 60 | 10 hours |
| A giant | You kill a giant in this hold. | 100 | 18 hours |

A retrieval is one item. It is not a craft, not food, not ore, and
it is not sold. You bring it back and it is taken. Walk away before
the turn-in and it goes back into that container. The cooldown does
not start. You do not keep a second one.

An interior place is its cell. Exterior places use the exact source objects
and bounded ground specified in [Custom quest places](quest-locations.md);
a runtime worldspace alone never names a whole quest area. A kill outside
the named place does not count. A retrieval
from anywhere else is not the item. A dragon is not on this list.
A richer deed waits longer. Another scene can be added the same
way: a retrieval, or a kill the server can check, a set amount of
gold, and its own cooldown. It still does not buy goods.

## Who may take one

The quest names the gates. It may require a class, a profession or
one half of it, and a race. A line it leaves blank is open. A quest
that names none of them is open to anyone who can speak to that
trader.

One copy at a time. You cannot take it again while it is open, and
you cannot take it again during the cooldown. The cooldown is yours.
Another person can hold the same quest.

## The cooldown

Each quest has its own cooldown. It starts when you finish. A richer
reward waits longer. The hours are written on that quest. There is
not one wait for every quest.

## Where this is

Scarce quests and scene quests from the tables above are in the
server. The counts, the cooldowns, and the lineup are those tables.
Supply is available on Dev through the merchant panel: look at a
trader and use the interaction button, then choose a supply turn-in.
The offer is five goods the hold already buys, paid from that trader's
finite purse, with a six-hour cooldown after completion. The server
checks the character, reach, submitted price, goods and purse before
accepting it. Goods and payment persist through reconnects and restarts.

The trader panel implements the four miner offers: ebony, a chosen gem,
stalhrim, and heart stone. It shows their places, draw limits, required
returns, progress, rank gates and personal cooldowns. Choose a gem before
taking its work. Turn in the required goods to finish, or give back what
you still carry of the draw to leave. If anything is missing, its normal
cooldown applies. These inventory steps require the
native transaction that saves the quest, inventory and receipt together.
An unfinished merchant transfer or unsaved inventory receipt holds them
until its exact save acknowledgement; no reward is inferred from a timer.
Six kill contracts are implemented for the selected wolf, sabre cat, bandit
camp, bear, barrow and giant sources. They count distinct authored lives
inside their named places and retain that history through reconnects and
restarts. Progress saves separately from inventory, so an outstanding goods
save does not discard a later kill. Rewards still wait for the inventory
save acknowledgement and are paid once with the completed quest.
These bindings await the matching native engine and gamemode release;
implementation does not establish availability on either server.
The [pearl bed](merchant-pearl-bed.md) is connected to its three selected sources, with Expert Fisher and pole rules and existing shared stock. The [seven retrievals](merchant-retrieval-work.md) connect exact specialists, source items and fixed rewards. The [mammoth ground](merchant-mammoth-work.md) now uses its three existing bodies, normal Master hunting goods and exact one-body return. The [orchard](merchant-orchard-work.md) connects its ten trees through existing Farmer claims, sowing, seasonal growth and complete harvest yields. Source implementation is not a deployment record.
Scene gold is created when the quest is finished. It is not taken
from a trader's purse. Walking
away returns what remains of the draw. Missing goods start its normal
cooldown; a full return does not. The rank on
a scarce row still applies.

The four miner rows are bound to the buildings named above, by each
building's cell, and every other vein of those seams is shut. The
cooldown is the server's, one for each person and quest, stamped at
the turn-in. The open quests, what each has drawn or killed, and the
cooldowns are kept on the character, so a restart of the server keeps
them. When a character's quests cannot be read, nothing is written
over them and their quest steps are refused until it is put right.
The remaining scarce places and scene objects have been selected in
[Custom quest places](quest-locations.md), with exact source references,
counts, cooldowns and the distinction between existing sources and the
dedicated markers now authored in Content. The existing Farmer orchard interaction is bound in source; availability still requires the merged sections to be delivered. A dragon is not a bounty. Papyrus
quests do not run.

The [crimson work](merchant-crimson-work.md) now connects its eight existing Blackreach plants to the Winterhold Alchemist, using the original Gatherer rules, shared ten-minute returns, ask 3/cap 8 and 12-hour personal rest. No orchard planting or cultivation mechanics are included. Source activation still requires a release.

The [geode work](merchant-geode-work.md) connects six existing Blackreach deposits, requiring Enchanter standing and yielding empty petty soul gems. Its ask 2/cap 6 and 12-hour personal rest follow the original table; selected sources share a documented thirty-minute return. Source implementation is not a deployment record.

The [longfin work](merchant-longfin-work.md) connects eight dedicated sea markers to Haafingar's Alchemist. Master Fishers with suitable poles draw one fish per shared four-hour return, up to eight per open quest. Returning consumes two, keeps extras and starts a twelve-hour rest. Original clams remain independent. It is live only once the matching Content is delivered and the runtime activated.
