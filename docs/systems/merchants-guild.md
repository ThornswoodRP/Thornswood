# Merchant's Guild

Patrick's 12 October requirement is one Smith, Woodworker, Tailor, Enchanter,
Cook and Alchemist in each of the ten book holds, 60 guild NPCs total, each
with its own trade table and hold-specific quest work. See
[Six trades in each hold](merchant-expansion.md). The 249-trader count below
describes the current controller, not the requested final roster. Retirement
must preserve its existing purse, stock and unfinished transfer records.

The Merchant's Guild is the merchant NPCs of each hold. People cannot
join it. There is no membership roll, join fee, dues, factor appointment,
strike command or membership discount. Corrected by Patrick on 2 October
2026. Earlier requirements for those systems are withdrawn.

Each hold's traders use that hold's submitted price lists. A merchant
has no profession verb and no recipes. The NPCs remain under server
authority. Each hold has one guild site, recorded below. A later walk
can move a spot. Traders are not relocated by that record. Their current
numbers and placements are on [People who are not people](npcs.md).

A person's shop is a claim, as [Property](property.md) says. Anyone may
post at the board or trade with an NPC. Notice and job fees stay 20 and
30 gold for everybody. Two people still agree their own price when they
[trade](trade.md).

## What the traders charge

A guild trader buys and sells at the hold's price. The numbers come
from the price lists in faction and business books, submitted at
that hold's drop box. See
[Factions and businesses](factions.md) and [Property](property.md).

Only a line with both a buy and a sell price sets a trader's prices
(Patrick, 12 Nov 2026). For each item, the buy price is the average
of the buy prices on those lines submitted to that hold, and the sell
price is the average of the sell prices on the same lines, so a trader
never pays more for an item than it sells it for. 0 is free, and it
counts. The average is rounded to the nearest gold. A half rounds up.

A line with one side blank stays in the book and still shows in J,
but no trader uses it. A book line cannot buy above its own sell: the
book refuses it when the price is set. Two names for the same item,
such as Iron Ingot and Iron Ingots, are one item.

A hold with no line of its own for an item uses the other holds'
prices, buy and sell together, never one side alone. A hold that did
submit its own uses that, so two holds can differ.

An item whose only lines are one-sided, anywhere, is not traded by the
guild until someone submits a line with both.

## The trader's purse

Each guild trader starts with 250 gold. It is once, when that trader
is first stood up. After that the purse
changes only when they buy and sell, the way a person's purse does.
They do not mint. They do not receive the starting 40. An empty
purse refuses a buy. An empty shelf refuses a sale.

They start with gold and no goods. Stock is what they have bought.
The quests they give are on [Custom quests](quests.md). A supply
quest pays out of this same purse. A scene quest does not. Its gold
is created, at the amount written on that quest, and it does not
run out. A letter is not a quest of theirs. The sender pays the
courier, on the notice board.

## Guild sites

One spot a hold, taken from the notice-board seeds. Raven Rock's board
is seeded at the town inn, at Geldis Sadri on the trader list, and its
site is the same spot. A later walk
can move any of these. Traders are not relocated by this list.

| Hold | Book hold | Spot |
| --- | --- | --- |
| Haafingar | solitude | Solitude, the notice board |
| Whiterun | whiterun | Whiterun, the notice board |
| the Rift | riften | Riften, the notice board |
| Eastmarch | windhelm | Windhelm, the notice board |
| the Reach | markarth | Markarth, the notice board |
| Falkreath | falkreath | Falkreath, the notice board |
| Hjaalmarch | morthal | Morthal, the notice board |
| the Pale | dawnstar | Dawnstar, the notice board |
| Winterhold | winterhold | Winterhold, the notice board |
| Solstheim | ravenrock | Raven Rock, the town inn, at Geldis Sadri |

## Where this is

The hold's box is the drop box on its notice board, and guild ledgers
are that hold's business. A price list is not an item put in the box.
Someone with Prices stands at the board and submits a copy, and the average of those copies is kept for that
hold. A failed save keeps both the previous saved file and the
previous live prices. Failed book edits, disbands and membership saves
also restore the previous live state. Empty buy and sell columns keep
their positions; zero is a free offer. Prices must fit the server's
whole-gold inventory range, from 0 through 2,147,483,647.

An unreadable book, invalid permission relationship or submission without
its matching book prevents the book service from loading. A reload revokes
the old service before checking the saved state, including any retained
reference to that service. It does not start an empty ledger. Renaming a
book or editing its prices keeps its earlier submitted copy valid.

Posting is 20 and 30 for everybody. Rent is the only debt the box pays
down. The 249 retained, authored traders receive their one-time 250 balance
and empty stock when admitted by the Dev server controller. The authoritative
ledger is in the private folder, with atomic replacement, integrity checking
and a record of references not yet initialized. The per-NPC property mirrors
it. A lost NPC save restores the ledger balance, including zero, rather than
handing out 250 again. Missing or damaged ledger state refuses service.
The initial merchant total is 62,250 gold across those 249 references. The
server's minute report lists the verified count and first-time grants.
Failed startup revokes the new service; paths into served resources, including
Windows junctions, are refused before any ledger is written.

Buying and selling use the hold's submitted price. The trader's purse
falls when it buys and rises when it sells. Purchased goods stay on that
trader's shelf. An empty purse refuses a buy. An empty shelf refuses a
sale. A supply turn-in is five of an item at that same buy price, paid
from the same purse. Each character waits six hours after its completed
supply before that trader offers the same supply again.
Scene quests are not paid from the purse.

The person must be the authenticated character and within 400 of that
trader in the same place. Press E on the trader, then use the panel's
buy, sell or supply buttons. The panel requests the trade; the server
checks its price, reach, purse, stock and character identity. People
cannot join, and there is no due or discount.

Settlement uses the native inventory comparison and exact saved receipts. The
engine validates the complete resulting inventory with the same count,
byte and metadata checks it uses for mutation. The complete offer is
saved in the private ledger before outgoing goods or
gold are removed. Incoming payment or goods wait for that exact debit
to be saved. The purse and shelf then change together in the ledger,
and the incoming inventory is credited. Completion waits for its exact
saved receipt. Other inventory earned or spent during the save is kept.
Item names, condition, charge and other inventory details stay with the
goods. A reload resumes the saved offer without paying twice. The record limit is
512 KiB. Before removing anything, the server reserves space for both
recovery inventory snapshots at their full 128 KiB limits. After the
outgoing inventory is saved, its redundant snapshots are retired in the
same durable commit as the merchant's purse and stock. A trade whose
complete recovery record cannot fit is refused before anything is taken.

At most 25 transfers may wait across the server, including offline
characters and unloaded traders. One person and one trader may each
have only one pending transfer. An older unresolved record without a
verified character identity prevents new admission. A definite refused
debit frees its reservation; an uncertain result keeps it. An uncertain
ledger write stops the current service until the ledger is loaded again.

The native writer flushes a new exclusive temporary file and replaces the
private ledger before acknowledging it. It refuses served-directory
aliases and linked ledger files. Startup and reload revoke old trading
services before checking the server channel or loading new state. The
ordinary NPC property is a projection of the private ledger and cannot
replace it as the authority.

Exact counts and places are in [Merchant trader counts](merchant-traders.md).
Pressing E on a trader opens the panel. The two CWGuardTemplates
quartermasters are priced: the Imperial one as Haafingar, the Stormcloak
one as Eastmarch. Their cell is not in a hold. The guild site for each
hold is below. A later walk can move a spot. Traders are not moved by it.
