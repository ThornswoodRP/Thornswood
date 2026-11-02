# Farmer

A shovel in the pack, 50 uses. Skyrim has no hoe. The shovel is what
a smith forges, and it is what this class asks for.

10 crops, 14 placed records:
[lists/farmer.md](../lists/farmer.md).

| Rank | Crops |
| --- | --- |
| Novice | Cabbage, leek, potato, gourd, carrot |
| Advanced | Wheat, ash yam, tomato |
| Expert | Green apple, red apple |
| Master | Everything on that list |

Ranked by how hard it is to grow, not by the price. A novice can carry
an apple and eat it. A novice cannot sow one or bring one in.

## A plot

A plot is one crop in a field. The first time anyone touches it, it is
empty. There is no startup sweep that fills the farms. Emptiness is
the absence of a record.

Look at a plot and a line under the crosshair says what is in the
ground and whose farm it is. Press an empty plot with the crop in your
pack to sow it, and the line names that press when it would sow: E,
Sow a Cabbage. The crop is its own seed: a cabbage plants a cabbage.
Bringing it in is the press when it is ripe. The plot is empty again.
It does not grow back. Sow another. Nothing is typed.

One sow or one bring-in is one piece of work. 100, then 250, then 600.

The garden planters of a HearthFires homestead are plots too. The
cabbage, gourd, leek, carrot, potato and wheat planters take the same
crop, rank and time as that crop in a field. Their own produce is a
sack only a game script opens, so nobody is ever handed the sack.

## How long, and how many

The base wait is on the crop, for a novice multiplier of 1. Cabbage,
leek, potato, gourd, carrot, ash yam, tomato, and both apples are 75
minutes. Wheat is 135 minutes. The rank shortens it, once, at sowing,
and the answer is kept on the plot:

| Rank | Multiplier | A 75 minute crop | Wheat |
| --- | --- | --- | --- |
| Novice | 1 | 75 minutes | 135, and a novice cannot sow it |
| Advanced | 0.85 | 63.75 minutes | 114.75 minutes |
| Expert | 0.7 | 52.5 minutes | 94.5 minutes |
| Master | 0.55 | 41.25 minutes | 74.25 minutes |

What you bring in is more than the one you sowed:

| Rank | Back from one plot |
| --- | --- |
| Novice | 2 |
| Advanced | 3 |
| Expert | 4 |
| Master | 5 |

The season at the bring-in moves that by a quarter, on average: a
quarter more in summer, a quarter less in winter, and as written in
spring and autumn. What is left over after the whole number comes up
as often as it is worth. A master's 5 in summer is 6.25, so 6 three
times in four and 7 once; in winter it is 3.75, so 4 three times in
four and 3 once. A novice's 2 in winter is 1 or 2, half the time
each, and never nothing. The line says "Summer gives more." or
"Winter gives less." A plot that ripened before winter can still be
brought in during it, at the winter share. Compost's one more, below,
comes on top, whatever the season.

## Compost

Spoiled food is compost ([Spoilage](../spoilage.md)). Press a plot you
sowed while it is still growing, with spoiled food in your pack, and
one piece goes into the ground. The line names that press:
E, Work in spoiled food.
The wait from sowing to ripe is a quarter shorter, and the plot gives
one more when you bring it in. A plot takes compost once a sowing, and
the line says "composted" after.

Patrick decided this on his report page on 26 October 2026 ("A+B",
[#3526](https://github.com/ThornswoodRP/Thornswood/issues/3526)).

Only your own sowing, and not the orchard trees of the orchard work,
which counts what it hands over against the work's own hold.

## The claim

At a plot on ground nobody holds, the line names the lock key, X
unless you changed it: Claim this farm. One farm at a time, a circle
1200 units out from that plot, same cell. That is 2400 across, a farm
and not the village behind it. Claims do not overlap. A plot is never
in two. Claiming a second lets the first go, and the line says so
before you press it.

14 real days with nothing sown and nothing brought in, and the claim
is gone. Work refreshes it. Anyone with the class may use a farm
nobody holds. That is where a new farmer starts.

This circle is not the building claim. A house and its field can be
two records. See [Property](../property.md). The 14 days is the same
number.

## Season, weather, and a cook's start

A field starts empty. A cook is not handed a starter pack. The
first meals come from a harvest, a trade, or a hunt.

A crop grows or it does not by the temperature, the weather, and the
kind of place, the same meters as
[Temperature and weather](../temperature.md). The hold's name does
not decide it. Whiterun is not the wheat hold.

Four seasons, 7 real days each, the same week as rent. The province
shares one season. It starts in spring the first time the server
counts one. The hold's name does not pick it.

| Season | What grows | What a bring-in gives |
| --- | --- | --- |
| Spring | Every rank. The grow clock runs. | As written |
| Summer | Every rank. | A quarter more |
| Autumn | Novice and advanced. An expert crop waits. | As written |
| Winter | No rank. A sown plot stays sown. The clock does not run. | A quarter less |

Winter stops a crop even on a warm day. It does not lock the sky to
snow. The odds, and the colder outdoor target, are on
[Temperature and weather](../temperature.md). Spring, summer, and
autumn still need the temperature and the weather. A plot that waited
through winter finishes in spring from where the clock stopped.

## Butter, milk, and the nest

These are farmer verbs. They have no rank gate. A novice does them.
Each successful press is one piece of work on the farm ladder, and
each waits 10 minutes, the same wait as a picked reagent, keyed to
you and that object. A restart clears it.

| What | Where | You receive | Who else |
| --- | --- | --- | --- |
| Butter churn | `bc0:HearthFires.esm` | 1 Butter (`353c:HearthFires.esm`) | Told it is farm work |
| Living cow | Six bases: `6681e`, `c39f1`, `9da4b`, `23a90` in Skyrim.esm, `f9a9:Dawnguard.esm`, `ea867:ZIA_Complete Pack.esp` | 1 Jug of Milk (`3534:HearthFires.esm`) | The press does nothing. A dead cow is a hunter carcass, not a milking |
| Chicken nest | `1062d1:Skyrim.esm` | 1 Chicken's Egg (`23d77:Skyrim.esm`) | Told it is farm work, so the engine cannot hand the egg to anyone else |
| Beehive | The placed hive `dbf8b3:Thornswood-Content.esp`, and a world beehive on the harvest list | 1 Honeycomb | Told it is farm work |

Goats are not milked. A beehive is. A mammoth cheese bowl is not a farmer verb.
It is anybody's: whoever presses it gets the bowl.

Wild eggs are not this nest. Pine thrush, rock warbler, and hawk
eggs are reagents on the gatherer list. A chicken nest that the
harvest pass filed as unranked is this verb, not a sixth plant.

Butter is an ingredient on a large share of the cook's rows. The
farmer is who makes it. See [Hearthcook](../professions/cook/hearthcook.md).

## Seed

At the moment you pick the class: 3 cabbage, 3 leek, 3 potato. All
novice, all the base game's own records.

If the pack holds no crop at all, pressing an empty plot hands a few
of those three again, and not more often than every 12 hours. It is a
way back. It is not a wage. Nine vegetables against an empty pack,
while one ripe plot pays more than that.

After the first handout, seed is a crop you kept, or one you were
given. Barrels in a hold are not a shop. Another farmer is the usual
answer for wheat and apples.

## What you are handed

1 in Endurance (+10 stamina). The shovel. The nine vegetables.

## What you cannot do

You cannot mill flour. That is a Hearthcook, one sack, novice, at the
grain mill. Your wheat is advanced, so a novice farmer cannot even
grow what the flour is made of. See
[Hearthcook](../professions/cook/hearthcook.md).

You cannot treat a wild reagent as a crop. That is the gatherer.

The emote of sweeping is not farm work.

<!-- detail:begin -->

## Every record

Generated from the work tables by `scripts/dev/Write-SystemLists.js`. The same rows are in [farmer](../lists/farmer.md).

| Name | Rank | Records | You receive | Grow minutes |
| --- | --- | --- | --- | --- |
| Cabbage | novice | 1 | Cabbage | 75 |
| Carrot | novice | 2 | Carrot | 75 |
| Gourd | novice | 1 | Gourd | 75 |
| Leek | novice | 2 | Leek | 75 |
| Potato | novice | 1 | Potato | 75 |
| Ash Yam | advanced | 1 | Ash Yam | 75 |
| Tomato | advanced | 1 | Tomato | 75 |
| Wheat | advanced | 1 | Wheat | 135 |
| Green Apple | expert | 2 | Green Apple | 75 |
| Red Apple | expert | 2 | Red Apple | 75 |

<!-- detail:end -->

## Where this is

Empty plots, the claim circle, the 14 days, the waits, the yields,
and a shovel of 50 uses are in the server.
A farmer is handed 3 cabbage, 3 leek and 3 potato as seed. A cook
is not handed a pack, in the plan or on the server. The season is
in the server: four of them, 7 real days each, starting in spring.
Winter stops the crop clock and the plot stays sown. The season's
quarter on a bring-in is in the server (#3144). A placed hive
is a farmer verb: 1 Honeycomb, 10 minutes, one piece of work, no rank
gate. Spring, summer and autumn do not yet stop a crop for temperature.
The page names that and gives no degree. The cold link into hunger
and thirst is not here.

The line at a plot is in the front plugin and the farming block
(#1636). A crop that stays under the crosshair asks the server, which
answers that person alone with what is in the ground, whose farm it is,
whether pressing it would sow it and whether the lock key would claim
the farm, and asks again every 10 seconds while it is looked at. The
server only offers what its own rules would let through, and checks
them all again on the press: the class, the shovel, the rank, the crop
in the pack, whose ground it is, one farm a person, and that the plot
is within 400 of the person. Pressing a plot draws its line again. The
lines the client sends are in [Chat commands](../commands.md), and no
help names them. Your farm, with the days it has left, is on the
property page of the K panel.
