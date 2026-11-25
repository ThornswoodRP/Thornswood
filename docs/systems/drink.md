# Drink and ale

Water is thirst. Ale is thirst, hunger and rest, and then a drunk.

## Ale

Inside 45 real minutes, each ale is worse than the last.

| Which | Thirst back | Rest | Hunger |
| --- | --- | --- | --- |
| 1st | 30 | -8 | -6 |
| 2nd | 22 | -13 | -10 |
| 3rd | 15 | -18 | -13 |
| 4th | 7 | -22 | -17 |
| 5th and on | 0 | keeps climbing by the same step | the same |

The step is 0.6 more cost each time, and 0.25 less thirst each time.
After 45 minutes with none, the count starts over.

The first two also give +0.05 melee damage for 5 real minutes. The
third and after do not. There is no speech check to hang a bonus on.

Drunk, from the third ale until you sleep or the 45 minutes pass: the
client draws a sway and a soft edge. Chat is not garbled for you.

When the 45 minutes pass, being drunk wears off into a hangover:
stamina recovers 25% slower for 10 real minutes, and the screen is too
bright and drained of colour while it lasts. Logged out drunk and
back after the 45 minutes, it starts the moment you are in the world.
A night in a bed
sleeps it off, being drunk and a hangover already running alike, and
a remedy an alchemist made ends it early (Patrick, 22 Oct 2026).

## Festival brews

Four ales are made by people: a Hearthcook brews one for each season's
festival at the cookpot, from that season's herbs (#3152). First
Planting Mead, Midyear Jazbay Wine, Harvest's End Ale and Saturalia
Mulled Mead each go down as an ale does, on the curve above. Their
herbs are on [Food](food.md), "Seasonal food".

## Water

A novice Hearthcook can make an Empty Wine Bottle at a cooking pot from one
Jug of Milk. This pours the milk away: it gives no food, thirst or drink
effects. The existing empty bottle is the container used for water; the milk
jug does not introduce another bottle model. A novice Farmer can milk a
living cow in any season, with the usual wait between milkings, so the first
container does not depend on already having water. The normal Cook rules
and ladle still apply, including Grand Chef's doubled yield for an eligible
Master Cook. Fill the empty bottle at a well or water bucket.

| Source | Thirst | Risk |
| --- | --- | --- |
| Well, inn, a filled skin | 20 | None |
| River, unboiled | 20 | 15% fouled water. Boiled, none |
| Marsh, puddle, standing water | 15 | 80% fouled water. See [Disease](disease.md) |
| The sea | 10 | Salt. 40% fouled water |
| A lake | 20 | As a river: 15% fouled water. Boiled, none (Patrick, 20 Oct 2026) |

Boiling is a cook fire, a minute at it, and it clears the risk. It is
not a new station.

## Where this is

The ale curve, the 45 minutes, and the chat line that says which drink
it was are in the server, and so are the damage help of the first two
and the hangover, its 10 minutes and its slower stamina, which a night
in a bed or a physicker's remedy ends sooner. The remedy is given from
the wounds panel, which a hangover opens the way a wound does. A bed or a bedroll, whoever's it is, is a bed for a night's sleep: log out lying in one and come back before a night, and you are still drunk until the 45 minutes pass (#3136). A seat is not a bed. Drunk is in the server too: from the third ale until a night's sleep or the 45 minutes pass, the server says so and the client draws Thornswood's own drunk screen, a little double vision and blur, soft at the edges, smearing as you turn (Patrick, 12 Oct 2026). While you are drunk a tankard icon sits just above the left end of the needs bars, and it goes when drunk does (Patrick, 22 Oct 2026, #3143). The hangover's screen, and the high's and withdrawal's on the [Exhaustion](exhaustion.md) page, are drawn the same way, one at a time: a high over being drunk, and either over an after-effect. A night in a bed starts the ale count over. Water is tagged by where you filled it, and it is done in the world, never by a command. Activating a well with an empty wine bottle fills it, at the game's normal activation range. The vanilla wells are statics and raise no activation, so the content plugin stands a well bucket beside each well it can: 18 of the 30 in the load order (two wells side by side at Oar's Rest share one), and [Station placement](station-placement.md) says where and why the others have none. Activating the bucket draws the water. A second bucket, the water bucket, stands at the edge of the river by Riverwood and of Lake Honrich at Riften (the other towns have no river within reach of their forge, see the same page), and fills a bottle with river water, which must be boiled; no cooldown. Water you stand in does not fill: no server hook sees it. Once you fill at a well it is done for you for one in-game day (72 real minutes); other wells still work. The server keeps where each bottle came from, and drinking takes the worst you carry first. Activating a cooking spot (the CraftingCookpot bench) while carrying unboiled water starts a boil; a minute later it is boiled, and leaving the fire before then loses the boil. The cooking menu still opens. Well water and Frostreach ice water are safe without boiling (Patrick, 12 Oct 2026). A bottle the server never saw filled, like one bought at an inn, is safe. Every other non-ale drink is 20.
