# Thirst

Thirst is a meter from 0 to 100. It starts at 100. It falls twice as
fast as hunger.

## The clock

It empties in 1 hour and 30 minutes of real time. That is 66.67 points an hour.
Cold speeds it on the same steps as hunger: 1.25 when cold is weary,
1.5 at bad, 2 at spent. See [Temperature](temperature.md).

While in the world, from full to empty, with no drink and the same temperature
band throughout:

| Temperature band | Drain multiplier | Time |
| --- | --- | --- |
| Fine or any heat band | 1 | 1 hour and 30 minutes |
| Weary cold | 1.25 | 1 hour and 12 minutes |
| Bad cold | 1.5 | 1 hour |
| Spent cold | 2 | 45 minutes |

## The bands

| Meter | Band | What it does |
| --- | --- | --- |
| 50 and up | Fine | Nothing |
| 25 to 49 | Weary | -20 magicka, -3 speed |
| 10 to 24 | Bad | -40 magicka, -7 speed |
| 0 to 9 | Spent | -60 magicka, -12 speed, -30% magicka recovery |

## What a swallow is worth

| Thing | Thirst |
| --- | --- |
| An ordinary drink | 20 |
| The first ale | 30, then less. See [Drink](drink.md) |
| A soup, a stew or a chowder | 10, on top of its 25 hunger. See [Food](food.md) |
| A potion or a poison | 5 |

A poison counts as a sip because putting it on a blade and drinking it
are the same event.

A dry ration is food only, and gives no thirst.

## Water

Clean water is a well, an inn, or a skin bought or filled at a well. A
river is drinkable and better boiled. Marsh, a puddle, and standing
water you did not boil can foul you. The sea is salt: it quenches at
half a normal drink, 10, and can sicken. Swimming in that water is
temperature, not this meter. See [Disease](disease.md).

## Sleep

Logging out lying in a bed indoors stops the clock while you are away.
After a night away, your own bed or one you are allowed in adds 25
thirst, and an inn or temple bed nobody holds adds 15. Anywhere else,
thirst falls at half its pace while you are away and the time away
takes it no lower than 25. See [Exhaustion](exhaustion.md), Logging
out.

## Where this is

The clock, the bands, the 20, the ale curve and the potion sip of 5 are
in the server, and so is cold speeding thirst. So is where the water
came from: a bottle filled at a well is Glacier Water and one filled at
the water bucket is River Water, each an item of its own that keeps it
wherever the bottle goes, and a drink gives the thirst of the bottle
drunk. See [Drink](drink.md), Where this is. A
soup, stew or chowder adds its 10 thirst on top of its hunger, by its
group in game/data/food-groups.json. See [Food](food.md). The bed is
the one the server saw them lie down in, by whose it is, the same as
for rest. See [Exhaustion](exhaustion.md).
