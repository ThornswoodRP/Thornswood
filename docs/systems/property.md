# Property

A building is claimed at its door. The claim is whose it is. The deed is
the paper in a pack. Locks and keys are how the door behaves. Rent, when
a steward sets it, is what the hold is owed.

Shops, halls and palaces are buildings. Claiming one costs nothing. You
may hold more than one. A dispute about who should have it is the
court's, and the server does not pick a side.

## A claim

Open the door. For the next minute, while one of that building's doors
is under the crosshair, a line names the lock key, X unless you changed
it, and says what it will do there. At a building nobody holds it says
Claim, and pressing it claims the building. Nothing is typed. The door
you opened is the building. A door opened more than a minute ago does
not count, so a door you passed on the way across town is not the one
you claim from a field.

If nobody holds it, it is yours. A building you hold offers Lock or
Unlock instead. A building somebody else holds offers nothing, and the
key does not take it off them.

The claim lapses 14 real days after the last time the holder opened one
of its doors. Living there keeps it. When it lapses, the register drops
the claim and the doors unlock. What is in the chests stays in the
chests. Rent owed on it, counted up to the day it lapsed and no further,
stays owed by the holder (#3950, see Stewards and rent).

When somebody's account is deleted at their request, the game lets go of
what their characters held at its next start (#2351): a building or a farm
they held is free, as a lapsed one is, their bed nights end, and a master key
record cut for them comes off. The drop box keeps every coin they put in, for
the hold's officers, with their name off it.

A farm plot has its own claim, made in the field, and it lapses 14 real
days after the last work on it. The two clocks use the same 14 days. A
house and the ground outside its front door are one claim (Patrick, 21
Sep: "the farm and property being one property in the code"). The
ground is written on the house's claim when it is claimed, and a field
within the farm's claim radius of that door answers to the house while
it is held, so nobody claims it in the field. Ground with no building
on it is a farm claim of its own.

## The deed

Claiming hands you a deed there and then, and the building's master
key with it (see The master key, below). Every building uses one book.
The name on that copy is the building and its hold: Deed to Breezehome,
Whiterun is not Deed to Honeyside, Riften. Some names are carried by more
than one building (six Halls of the Dead), so the hold is what tells them
apart, and where two in one hold share a name a number follows it, as on
a master key: Warehouse, Windhelm, no. 2. Keys and key molds are named the
same way, and a key, mold or deed opens and hands over only the one
building its name says.

What you hold is on the property page of the K panel: each building,
whether it is locked, the rent owed on it, and your farm with the days
it has left. The page is there once you hold something or carry a key.

The register is the record that decides the holder. It lives with the
server, not in the pack. A deed can be stolen, and carrying it through
one of the building's doors is presenting it: the building is the
carrier's from then on, sold, given or stolen alike, and the server
does not tell those apart. A book somebody renamed by hand is not a
deed, because the server never issued it.

A deed changing hands keeps the rent and the debt (Patrick, 27 Oct,
#3893). The building keeps the rent its steward set, at the same amount
and on the same clock, so the next rent falls due on the day it would
have. The new holder starts at nothing owed. What the old holder owed
stays theirs: the steward sees it at the door on the Office page, the
old holder sees it on their property page of K and at the door with
the rent, and it is paid the same ways as any rent (see Stewards and
rent). So handing the deed to another of your characters, or to a
friend, does not clear a debt.

## Locks and keys

The holder locks and unlocks it with the same key at the door. On an
unlocked door the line says Lock, on a locked one Unlock, and the key
does what the line says. Whoever carries the deed may turn it too. A
lock reaches everybody on the next moment the list changes. A door
whose cell was not loaded yet is caught within 4 seconds of it loading.

A key comes off a key mold. A smith forges a blank mold at a forge out
of one iron ingot. Look at the door with a blank in your pack and a line
names the mold key, U unless you changed it. Press it and the blank goes
into the lock: it is that building's mold now, in the holder's pack. The
holder has to be the one pressing or be standing there.

A smith carrying the mold looks at a forge, and the lock key's line says
Cut a key. It costs one iron ingot, the same as the Key in the forge's
own list, and the key goes into the smith's pack, named for the
building. The mold is kept for the next one. The key opens that
building.

A key can be lifted, the same as any other thing in a pack. The server
does not change which key a door wants.

## The master key

Patrick, 12 Oct, on #2254. Claiming a building hands its holder a
master key beside the deed: Master key to Breezehome, with a number
after it. Whoever carries it gets through the building's locked doors,
like a key, and turns its lock at the door, like the deed, without
being the deed. So the deed, which is what takes the house, can sit in
a chest, and the holder, or a partner they hand the master key to,
carries the master key day to day. An ordinary key still only opens.
It counts as a key for the beds too: a bed you are allowed in.

It works only while the person it was cut for holds the building. When
the claim lapses, a steward evicts, or somebody presents the deed at
the door, it opens nothing any more, so an old holder cannot lock the
new one out. Whoever holds the building after a deed is presented is
handed a master key of their own. Somebody who held a building before
master keys existed is handed theirs the next time they open one of its
doors.

A lost one is cut again at a forge, from the building's mold, by a
smith, with the holder standing there, for 2 iron ingots. A smith
carrying the mold looks at a forge, and under the lock key's Cut a key
the line has a second row, the mold key, U unless you changed it: Cut a
master key. The smith pays the ingots and the master key goes to the
holder, because it is cut for them. The new one replaces the old: the
master key cut before it stops opening anything, wherever it is.

The number is how the server tells the master key that works from an
older one: a key here is its name, and each master key is cut with the
next number, never used twice.

## Stewards and rent

A steward is whoever holds a hold's "Steward of <Hold>" Discord role,
which that hold's Jarl gives, and the Jarl of a hold keeps it as its
steward too (#2551, [Offices](offices.md)). Only a steward can evict, and only at the
door: open it, then press Evict on the Office page of the K panel
within a minute. A steward evicts and sets rent only in their own
hold (Patrick, 16 Oct, #2551): Riften's steward settles Riften's
buildings and no other's. A building's hold is the hold its doors
open onto, measured from the game's own records (see Where this
is). At another hold's door the page says whose it is and offers
nothing to press. A few buildings answer to no hold at all, and no
steward settles those.

Staff end claims and set rent at any building, those with no hold
included (Patrick, 17 Oct, #2551). Staff hold no office by being staff,
so this is not a steward's office: it is the same Evict, Set rent and
No rent on the Office page of K, which staff get at every door, saying
they act as staff there. Staff are who the staff commands take (the
Owner, Dev, Gamemaster, Moderator and Loremaster roles, and the admins),
and a press needs what a staff command needs: the chat proved who they
are and the launcher's pass is on hand. Every press is one line in the
staff log, the one the staff commands write, which the bot says in the
staff channel: who pressed, whose claim, the building and its hold, the
rent set, and when. Staff who are the Steward or Jarl of a building's
hold settle it as its steward, like anybody who keeps it.

Eviction ends the claim. It does not empty the house. It does not
take a key back, so a tenant who kept one can still walk in. That is a
person's problem, handled like a person. It does not end the debt
either: rent the tenant owed stays theirs (#3950).

A claim ending never ends a debt (Patrick, 27 Oct, #3893 and #3950).
When the deed goes to somebody else, a steward evicts, or the claim
lapses, whatever its holder owed, counted up to that moment, stays
owed by them. Rent is never counted past the day a claim lapses. The
steward sees it at that door on the Office page, the person sees it on
their property page of K, and it is paid like any rent, below. A
steward who forgives it marks it paid.

Rent is optional. A steward opens the door, then on the Office page
sets 50 and the place owes 50 gold every 7 real days, or presses No
rent and it owes nothing. Setting a new amount on a place that already
pays rent changes what the coming weeks cost: what is owed stays owed,
and the clock goes on. The page shows the steward who owes what there:
the holder, and anybody who held it before and still owes from then.

The server counts the debt. It does not take the gold out of a pack.
Rent is handed to a steward, or put in the hold's drop box. Gold put in
the drop box pays rent owed by that person first, what they owe on a
place they no longer hold before the rest. Taking it back out makes
that rent owed again, by them.

Rent handed to a steward in person is counted with Rent paid (Patrick,
27 Oct, #3895). On the Office page, beside each person who owes at
that door, the steward types how much they were handed, or leaves it
empty for all of it, and presses Rent paid. What that person owes goes
down by it, never below nothing. It is one line in the hold's drop box
record, beside the box's own payments: who was handed it, by whom, how
much and for which building. Staff who press it at a door are in the
staff log too.

Paying never moves the rent clock (#3891, #3895). The next rent falls
due 7 days after the last one did, however early or late it was paid,
and taking gold back out of the box does not move it either.

## The hold's box

Each hold has one box, the drop box on the shelf of its notice board's
right post. The nine mainland towns already have a spot each, the
coordinates given for the boards, and Raven Rock's is at its inn. You
are at the box when you are within 400 of that spot. A steward of that
hold who moves the board moves the box with it. What goes in it, who
sees what, and who may take what out are on
[Notice boards](noticeboards.md), under The drop box.

There is no other box. A steward used to be able to mark any container
as their hold's box from the Office page of the K panel. Patrick
decided on 15 Oct to retire it (#2298): a chest that was marked is an ordinary
container again, and Skyrim decides what goes in it.

A price list is not dropped in as an item. Someone with the Prices
permission on a faction or business book stands at the board and
submits the list. The guild of that hold keeps the copy. The rules
are on [Factions and businesses](factions.md) and
[Merchant's Guild](merchants-guild.md).

The number the board panel shows as paid in is the hold's ledger, a
record on the server of the fees paid at its board. A fee taken for a
notice or a job is counted on the ledger and is never in the drop box.
Nothing withdraws from the ledger except the payouts named on
[Free Skyrim Trading Company](trading-company.md), and a letter's 15,
which goes to its courier or back to its sender.
See [Notice boards](noticeboards.md), [Gold](gold.md),
[Merchant's Guild](merchants-guild.md).

## What a home is for

Your own bed is the best rest on [Exhaustion](exhaustion.md), 80 an
hour. A bed you are allowed in is 50. Log out lying in either and
nothing runs down while you are away, and after a night you come back
with rest full and 25 back on hunger and on thirst. A bed in an inn
or a temple nobody holds is 40 an hour, 45 with a fire in reach, and
logging out in it is the same, with 15 back instead of 25 (Patrick,
12 Oct, #2246). A bed or bedroll in any other building nobody holds,
or out on the road, is nobody's to lend: 25 an hour, or 45 with a fire
in reach. Logged out there, hunger, thirst and rest fall at half their
pace and the time away takes none below 25, and a night leaves rest at
least 50. The whole table is on [Exhaustion](exhaustion.md), Logging
out. A bed in a
building somebody else holds, who has not let you, is no rest at all.
Lying down in the bed is how you rest in it, and there is nothing to
type.

The holder names who may sleep there. Look at somebody inside a
building you hold, and the prompt that names them offers Let sleep
here on the key mold's key, U unless you changed it. Press it and they
may sleep in any bed of that building for one night, 8 hours from then.
Press it on them again, Stop letting sleep here, or press Stop beside
their name on the property page of the K panel, and the night ends
then. Anybody carrying the building's key or its deed is allowed as
well, so somebody who lives there carries a key.

The server does not sell a night. Patrick, 4 Oct: "they pay from a
regular trade and then the owner can grant bed access". The guest pays
the holder in an ordinary [Trade](trade.md), and the holder lets them
sleep there. An inn is this rule: the person who holds the inn is paid
in the trade and lets the guest sleep.

The fire in the hearth is a fire. It warms the way any fire does on
[Temperature and weather](temperature.md). A claim does not make it
hotter.

Chests and barrels in the building are storage. A claim does not add
slots. The server already owns containers. When a claim ends, the
containers stay as they are for the next holder.

A crafting bench in a building you hold draws from its chests (#3159,
Patrick, 22 Oct). Every chest and barrel in the building counts,
furniture chests you set down included, and only for the holder: a
guest or a partner with the master key works from their own pack. If
the building changes hands while you are at the bench, a craft that
needs the chests is refused and the bench has only what you carry.
[Professions](professions.md) says how a craft takes from them.

An outhouse or a pot would be relief for the optional meter on
[The body](body.md). That meter is not built unless a vote after the
server is fully live says to add it. Until then the server does not
treat an outhouse or a pot as furniture.

## Furniture

A holder can furnish the place (#2679). Chairs, benches, a bar stool,
beds, a bedroll and chests are items: a Woodwright makes them at the
woodworking bench, and anybody can sell or buy one in an ordinary
[Trade](trade.md). They are on
[the Woodwright's list](lists/woodworker-woodwright.md).

Inside a building you hold, or whose deed or master key you carry, the
inventory shows Arrange furniture on the lock key, X unless you changed
it. It opens the furniture panel, which lists the pieces you carry.
Place sets one down in front of you, facing you. Look at a piece set
down there and the line under it offers Move on the key mold's key, U
unless you changed it, and Pick up on the lock key. Move puts it in
your hands for a minute: U sets it down in front of you, X turns it.
Pick up puts the item back in your pack; a chest has to be empty
first. There is nothing to type. A plain key lets you in and does not
let you move the furniture.

Furniture belongs to the building, not to whoever set it down. It is
still there after a restart. When a claim lapses, the holder is
evicted or the deed changes hands, it stays for the next holder, the
same as the chests that were already there, and the next holder can
move it or pick it up. Deleting or resetting a character ends their
claims and leaves the furniture where it stands. A wipe takes it with
the world.

How many pieces a building takes, how far in front of you a piece is
set, how near you have to be to move one, how long it stays in your
hands and how far one press turns it are staff numbers in
`game/data/furniture.json`, with the catalog. Tables, shelves and other
statics are in the catalog and switched off until a dev check shows
the server keeps one that was set down.

## A shop

A shop is a claimed building and a notice on the hold's board. No rank
mints a vendor, and the guild does not own the counter. Prices are
what the two people agree when they trade. Coin moves as
[Gold](gold.md) says.

A stall in a town's market is claimed the same way, for nothing, and
its keeper names the prices on it; it sells only while they stand at it.
That is [Market stalls](stalls.md).

## What is not a house

Nails, hinges, a lock, and iron fittings are refused at the forge.
They are parts for building a house, and a house here is a place
already standing. The four recipes are in
[the refused list](lists/refused.md).

The Hearthfire building rows, 487 of them, stay out of
[Cut items](cut-items.md). They are not a public craft and they are
not company wares.

## Word to the holder

Patrick, 17 Oct, decision 6B on #507. When somebody picks the lock of a
building you hold, or presents its deed at its door, you are sent word
in the world, so you can answer it through RP. Nothing is typed.

The word comes late, on purpose, so a theft is not an alarm. A runner
from the steward's office of the building's hold finds you 20 minutes
after a pick, or 10 after a deed. A building no hold covers sends word
by a neighbour. If you are away, the word waits and reaches you the next
time you are in the world.

You learn what happened, which building, and roughly when, such as
"about 3 hours ago". You also learn what the person looked like: race
and sex only, such as a Nord man. You never learn their name. That is
for RP to bring out, through a witness or the court.

The word decides nothing. No claim changes and no lock turns. Nobody is
marked or punished. The office takes no side, and a grievance is the
court's. A deed presented at the door still moves the building, as it
always has.

Limits on picks, so nobody can spam you:
- The same person at the same building counts once in 6 hours.
- A second pick before the word reaches you is added to that word, and
  the word says it happened more than once.
- You get at most 6 words of picks a day, and at most 20 wait for you.
- Word that cannot reach you within 14 days, the lapse, is dropped.

A deed's word is never held back, because it is one word for one
transfer. All of these numbers are staff data.

## Where this is

Claims, deeds, the 14 day lapse, locks, molds, keys, master keys,
stewards, eviction, rent, the hold's drop box and furniture are in the server. The register
is `private/property.json`, with the rent still owed by somebody who no longer holds the place
under `arrears` (#3893), and the furniture's is `private/furniture.json`, which
names no person (the furniture block in `game/gamemode.js`). Eviction and the rent are
the Office page of the K panel, for a steward (the Steward or the Jarl
of a hold, by the Discord role); see
[Offices](offices.md). The rent owed is on that page for the steward at the
door, and on the property page of K for the holder.

Which hold a building is in is `BUILDING_HOLD` in the property block,
written with `game\data\building-holds.json` by
`scripts\dev\Build-BuildingHolds.py` out of the plugins (#2551). A hold
is a location record (WhiterunHoldLocation and the other eight, and
DLC2SolstheimLocation for Raven Rock), and a place is in a hold when
its location's parents reach that record. A building takes the hold
of the places its doors open onto: an exterior cell's location, or its
worldspace's, or a room's own, walking through a room with none, such
as a cellar, to where its doors open. Two holds there, the building's
own location picks between them; none, the building's own location
answers. Measured 17 Oct: 828 of the 850 buildings have a hold, and all
601 that `DATA.cellToHold` names agree with it. The 22 left out (the
Soul Cairn, Apocrypha, the Forgotten Vale, Sovngarde, test and Creation
Club cells, and Misty Grove, whose only door starts disabled) open onto
places no hold's location covers, and the table says why for each. No
steward evicts or sets rent at those; staff do.

Staff at a door (#2551) are `settleAs` in the property block: a
steward of the building's hold acts as its steward, and anybody else
must be staff by the chat block's `isStaff` (`__thornswoodIsStaff`) and
pass the staff block's `unproven` on the line the press arrived on.
`staffRecord` writes the press through the staff block's `record`:
thornswood.log, and `for-bot\moderation.log` with `did` evict, rent,
norent or rentpaid, `by`, `byName`, `who`, `whoName`, `why` (the building and its
hold, and the rent set or paid), `building`, `buildingName`, `hold` and `at`.
A press is refused when that log cannot be reached.
`tests\test-2551-building-holds.js` drives it at all 850 buildings.

Skyrim and the collection's mods put 17 more buildings on Tamriel's
ground in no hold. Patrick, 17 Oct, decision 2 = B on #2551, gave them
one, and `Thornswood-Last.esp` carries it (the policy's `placeHolds` in
`game\data\last-plugin-policy.json`, built by
`scripts\mods\Build-LastPlugin.py`): Castle Volkihar's location and
Jakob's and Frederik's houses' are put in Haafingar, Nightingale Hall's
and Dayspring Canyon's (Fort Dawnguard's valley) in the Rift, with Dead
Drop Falls' put in the valley, Ironbind Barrow's in Winterhold and
Darkfall Cave's in the Reach. Three rooms have no location at all and
are given one: Oar's Rest's utility room takes Oar's Rest's, which the
mod puts in Falkreath Hold, Mossy Glen Cave the valley's, and the Lost
Hut the Reach's own. Each is a copy of the record that wins the load
order with only its parent or its location changed, so the game, the
server and this table all read the same hold. The roster's place name,
the main menu's Last location and the launcher's "last seen in", reads
the same parents and names the hold: "Volkihar Keep, Haafingar".

Claiming, locking, unlocking and cutting a key are the lock key, with
nothing typed (#1637). The server writes the door's word, Claim, Lock or
Unlock, and that building's doors to the person on every door of a
building they open and again after every press, and the front plugin
draws the line while one of those doors is under the crosshair. The key
sends the server what the line said and the door's id. At a forge it
sends the forge's id, and the server checks that it is one of the
forges the bench table knows and that the smith is standing at it, as
it checks a door for the mold key. The lines it sends are in
[Chat commands](commands.md), and no help names them. The property page
on K lists each building with the rent owed on it, and the farm. Until
#1717 the page looked for that list in its own table instead of on the
panel view the server sends, so it never appeared for anybody. The
suggested answers on #1637 are what is built until Patrick answers
there: one key that locks and unlocks and says which, what you hold on
K, the same key to claim at a door and to cut at a forge, and one iron
ingot for each key it cuts.

The master key (#2254) is one record in the content plugin, Master Key,
on the key's mesh, with no recipe, named per copy like the key. The
claim in `private/property.json` names the number it was cut with and
the profile it was cut for, and the register keeps the last number cut
(`masters`), so a number is never handed out twice. Until the server's
content plugin carries the record, a claim hands the deed alone and no
master key is cut. The line the mold key at a forge sends is in
[Chat commands](commands.md).

A bed counts only when the server saw the person press it and they
are still beside it, and the rest stops when they leave it, the night
runs out, or the holder ends it. The holder sleeps at 80. A guest of
the night, and anybody carrying the building's key, its master key
or its deed, sleeps at 50. The look prompt offers Let sleep here only to the holder, only
while the person is in the same building, and the server checks both
again when the key arrives. A night is 8 real hours from the key press
and covers every bed in that building. The property page in the K
panel lists tonight's guests under each place you hold, each with a
Stop. Guests are in `private/beds.json`, and each names the holder who
let them in, so a building that changes hands does not keep them.
There is no night price and no gold moves for a night. The book from
before held prices, paid nights and gold kept for holders who were
away. The prices are gone. A night already paid runs to its end as a
guest. Kept gold is handed to its holder once, the next time they are
in the world, and that is the last gold the book holds.
Outhouses and pots stay unknown until the vote on
[The body](body.md). The company payouts that
withdraw from the ledger are built: a haul's pay to its hauler, less
the company's tenth, or back to its poster. A withdrawal never leaves
less on the ledger than the open letters and hauls still hold, and
what a haul holds for somebody away. The four house parts are
already refused. The drop box stands on the notice board's post, and
E on it opens its own panel (#2298). Standing at the board and clicking
it opens the board's panel. A price list is left from that
panel. The book stays in the journal. The guild average of those
copies is kept.

Word to the holder (#2680) is the property block's word section. When
a door the server shut to you opens on your machine, the front plugin
sends `/tspicked` with the door's id. The lock script takes a door off
its published list before it opens that door itself, so only a pick is
reported. The server counts a report only when all of these hold:
- the door is a property door, not a way out and not a cell
- the building is held and locked
- you have no key, master key or deed
- you are within `reach` of the door in its cell, or already inside
  the building
- you carry a lockpick in the server's copy of your pack

Every report is logged as `[property] word:`, with who reported it, so
staff and the court can see it. `claim()` records a deed's word for the
old holder. The limits are `game/data/property-word.json`: per kind
`on`, `delayMinutes`, `describe`, and for picks `samePickerMinutes`, plus
`bundle`, `perHolderPerDay` (0 means no limit), `maxPending`, `keepDays`,
`reach`, `needLockpick` and `everySeconds`. Anything missing or wrong
there keeps the default and is logged. The words wait in the register,
`private/property.json`, under `word`, so a restart keeps them and a
wipe moves them aside. A word that has gone out is kept only while the
limits count it. `game\tests\test-2680-holder-word.js` drives all of it.
