# Exhaustion

The bar is labelled Rest. 100 is rested. 0 is spent. It is about
sleeping, not about a single fight.

## The clock

It empties in 8 hours of real time. That is 12.5 points an hour, before
work.

A swing of your own work costs rest on the swing:

| Rank | Cost |
| --- | --- |
| Novice | 1.5 |
| Advanced | 1.2 |
| Expert | 0.9 |
| Master | 0.6 |

Under 15, crafting is refused. Mining, chopping, fishing and the other
class verbs still happen, and they still cost the swing.

## The bands

| Meter | Band | What it does |
| --- | --- | --- |
| 50 and up | Fine | Nothing |
| 25 to 49 | Weary | -10 stamina, -10 magicka, -2 speed |
| 10 to 24 | Bad | -15 health, -25 stamina, -25 magicka, -5 speed, -0.05 melee damage |
| 0 to 9 | Spent | -30 health, -45 stamina, -45 magicka, -10 speed, -0.15 melee damage |

## Where you rest

You are resting only while the place is true. Saying it in the street
does not count. Sitting down or lying down is how you rest, and there
is nothing to type. Sit on the [emote wheel](emotes.md) is sitting on
the ground, and the ground is a seat.

| Place | Per real hour |
| --- | --- |
| A seat | 20 |
| A bed or bedroll nobody can lend you | 25 |
| A seat with a fire in reach | 35 |
| A bed or bedroll nobody can lend you, with a fire in reach | 45 |
| An inn or temple bed nobody holds | 40 |
| An inn or temple bed nobody holds, with a fire in reach | 45 |
| A bed you are allowed in: a night the holder gave you, or its key or deed carried | 50 |
| Your own bed | 80 |

Patrick, 4 Oct: "use some common sense". A bed is better than a
campfire. A bed or bedroll nobody lends you is a little better than
sitting. A campfire with a bedroll is better than a campfire alone. And
so on up to your own bed. Whose bed it is decides the rate, not whether
it is a bed or a bedroll. A fire in reach is one close enough to warm
you, the way [Temperature and weather](temperature.md) measures it. A
bed in a building somebody else holds, who has not let you sleep there,
is no rest at all. See [Property](property.md).

A bed in an inn or a temple nobody holds is a place of its own (#2246).
Djinn asked on 26 Sep for an inn or a temple to give back more than the
wild. Patrick set it on 12 Oct: 40 an hour, 45 with a fire in reach,
better than a bedroll on the road and under a bed you are allowed in.
Every town's inn is a short walk from where a new character arrives
(#2622), so it is the first bed most of them find.

Someone playing in the same cell adds 25 on top of whatever place you
are already in, while they play and for 5 minutes after. Playing is the
lute, the flute or the drum on the [emote wheel](emotes.md), with that
instrument in the pack, or Sing on the wheel, which needs nothing.
Patrick, 4 Oct: "if they do an emote with an instrument have that count
as /bard, and also add a singing emote for people that are only
singing". There is no bard profession. The check is that the server
sees them playing.

Sleeping on open ground is sitting, 20 an hour, and it can start a
chill. See [Disease](disease.md).

## Logging out

Where you are lying or sitting when you log out decides what the time
away costs and what a night away gives back. Patrick, 12 Oct, on #2246:

| Where you logged out | While you are away | After a night away |
| --- | --- | --- |
| Your own bed | Nothing runs down | Rest 100, 25 back on hunger and on thirst |
| A bed you are allowed in | Nothing runs down | Rest 100, 25 back on hunger and on thirst |
| An inn or temple bed nobody holds, by a fire or not | Nothing runs down | Rest 100, 15 back on hunger and on thirst |
| A bed or bedroll nobody can lend you, by a fire or not | Half the clock, never under 25 | Rest at least 50 |
| A seat, by a fire or not, or on your feet | Half the clock, never under 25 | Nothing |

Half the clock is hunger, thirst and rest falling at half their pace
for the whole time away, up to 48 hours. Never under 25 means the time
away takes no meter below 25; one that was already under 25 when you
left stays where it was. A night is 8 hours on the game clock, which
is 24 real minutes. Away for less is no night: only the middle column
applies. What comes back is put on what the time away left. It is not
a stat bonus for logging out at a clever hour. It is a rule about where
you sleep.

A new character who eats and drinks nothing in their first hour is at
Hunger 58, Thirst 17, Rest 88. Lying down in their arrival inn's bed
and logging out for the night, they come back at Hunger 73, Thirst 32,
Rest 100. In their own bed, 83, 42 and 100. Logging out on their feet,
25, 17 and 38. Before 12 Oct every one of these but the two beds came
back at 0, 0 and 0.

The Body page on K says, under Rest, what logging out where you are
now would do.

## A stimulant

A tea holds the rest drain at half for 20 real minutes, then costs 15
rest more than those 20 minutes would have. Skooma holds the drain at
zero for 10 minutes, then costs 30 rest and 10 hunger. Neither replaces
a bed. A second dose inside the window does not stack. It refreshes the
clock and adds the crash again.

While a dose holds, you are high, and the screen shows it: colour and
light turned up, a warm wash and a soft edge. Withdrawal comes after
three doses in a day, the last 24 real hours: when the window of the
third or a later one ends, stamina and magicka recover 10% slower for
30 minutes, on top of the crash, and the screen goes grey and cold at
the edges until it passes. Logged out before the window ends, it
starts the next time you are in the world (Patrick, 22 Oct 2026).

## Where this is

The 8 hour clock, the per-swing costs, the craft gate at 15, the eight
rest rates, the bard's +25, and the logout table are in the server.
Sitting down and lying down tell the server by themselves, and nobody
types anything. The server counts only furniture it saw the person
press and that they are still beside. A chair, bench, stool or throne
is a seat. A bed or bedroll is a bed, and whose it is decides the rate.
Any other furniture, such as a forge or a chopping block, is not a
rest. The fire is the distance the game already reports for warmth.
All of it is measured again every 5 seconds, so walking away, losing a
key, a night running out or moving away from the fire stops the rest
or changes its rate. See [Property](property.md). Sit on the emote
wheel is a seat on the ground, by a fire or not: the server reads the
last animation the game sent for the person, which ends the moment they
stand up, walk or play anything else. The bard is read the same way,
every 20 seconds: the wheel's lute, flute or drum with that instrument
in the pack, or Sing. It helps people resting with the bard: in the same
building or cave, or outdoors near enough to be in their Near you list. The logout fill is
counted once, the first time the server reads your meters after you
come back into the world, whatever reads them first. The server
counts you as up then, not lying in the bed. Coming back from any
logout, on a seat or in a bed, with or without a server restart, you
are up: nobody comes back into the world sitting or lying down, so a
rest counts again once you sit or lie down again (#1734). The time you
were away gains no rest at the place's rate, whatever you logged out
on (#1764): what it does is the logging out table above, and the night
is the one thing a place gives for it. The 24 minutes are the suggested
answer on #1606. What the time away costs, and what a night gives back
to rest, hunger and thirst, is one table in the server with a row for
each place above and one for somebody on their feet (#2246), and the
Body page's line is worked out from the same row. An
inn or a temple is read off the room's own records: its location carries
the game's inn or temple mark, and a house the game sells as a home never counts as one.
Skooma is in the server (#1382): all six drugs (Skooma, Redwater Skooma, Double-Distilled Skooma, Balmora Blue, Eversnow and Sleeping Tree Sap) hold the rest drain at zero for 10 real minutes, resting still gains, and when the window ends each dose taken inside it costs 30 rest and 10 hunger. While that window is open you are high, and a star icon sits just above the left end of the needs bars until it closes (Patrick, 22 Oct 2026, #3143). Tea is in the server too (#1382): Lavender Tea, Juniper Tea and Snowberry Tea are Thornswood's own items (Patrick, 12 Oct 2026), each brewed at a cooking pot from two of its herb. A cup is a drink, 20 thirst, and holds the rest drain at half for 20 real minutes; when the window ends each cup taken inside it costs 15 rest. While skooma and tea both run, the drain is held at zero.
Sleeping on open ground, an hour on a seat with no roof over you and
no fire in reach, starts a chill. See [Disease](disease.md).
The craft gate is asked at every bench's own menu, brews, enchanting
and tempering included, the kiln's charcoal too, and at a key cut at a
forge, before anything is taken, and the line says your Rest
is under 15. The same check asks first whether you are too sick or too
hurt to work (see [Injury](injury.md)), and when you are, that line is
the one said. It has not been extended to mining or chopping, and this
plan does not extend it.
