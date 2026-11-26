# Hunger

Hunger is a meter from 0 to 100. It starts at 100. It only falls,
except when you eat or when a night in a real bed puts a little back.

## The clock

It empties in 3 hours of real time. That is 33.33 points
an hour. Work and combat do not speed it. Cold does.

While the cold band in [Temperature](temperature.md) is weary, the clock
runs at 1.25. At bad, 1.5. At spent, 2. Heat does not speed it.

While in the world, from full to empty, with no food and the same temperature
band throughout:

| Temperature band | Drain multiplier | Time |
| --- | --- | --- |
| Fine or any heat band | 1 | 3 hours |
| Weary cold | 1.25 | 2 hours and 24 minutes |
| Bad cold | 1.5 | 2 hours |
| Spent cold | 2 | 1 hour and 30 minutes |

## The bands

| Meter | Band | What it does |
| --- | --- | --- |
| 50 and up | Fine | Nothing |
| 25 to 49 | Weary | -20 stamina, -0.05 melee damage |
| 10 to 24 | Bad | -40 stamina, -0.10 melee damage |
| 0 to 9 | Spent | -60 stamina, -0.20 melee damage, -20 health |

A band is said when it gets worse, and when it comes all the way back
to fine. The steps in between on the way up are quiet.

## What food is worth

An ordinary meal is 15. A drink is not hunger. Ale costs hunger: 6 on
the first, and more with each one. See [Drink](drink.md).

Raw, burnt, spoiled, cooked and a feast change the 15. See [Food](food.md).
Anything the food table does not know is 15, so a pie nobody classified
is a small meal rather than nothing.

Eating when the meter is already full does not add past 100. It sickens.
See [Disease](disease.md).

## Sleep

Logging out lying in a bed indoors stops the clock while you are away.
After a night away, your own bed or one you are allowed in adds 25
hunger and fills rest, and an inn or temple bed nobody holds adds 15.
Anywhere else, hunger falls at half its pace while you are away and the
time away takes it no lower than 25. The bed has to be a bed. The whole
table is on [Exhaustion](exhaustion.md), Logging out. See
[Property](property.md).

## Where this is

The clock, the four bands, the 15, the ale cost and the logout table
are in the server. So are the cold multipliers, and a meal at 90 or above
starts food sickness instead of raising the meter. So is the state of
the meal: raw is 8, a burnt meal 8, spoiled food 0, cooked 25 and a
feast 40, by the food's group and the way the cook came out. See
[Food](food.md), Where this is.

A bed counts only when the server saw the person press it and they are
still beside it. Lying down tells the server by itself, and nobody
types anything. The 25 and the 15 come with a night: log out lying in
the bed, stay away at least 24 minutes, and the time away is settled
first, then they go back on hunger and on thirst and rest is full. A
bed or bedroll nobody can lend you puts nothing back on hunger. The
24 minutes are the suggested answer on #1606, and the rest of the table
is Patrick's of 12 Oct on #2246. See [Exhaustion](exhaustion.md) and [Property](property.md).
