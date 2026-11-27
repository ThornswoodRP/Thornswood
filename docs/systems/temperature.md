# Temperature and weather

One meter. 0 is freezing. 100 is as hot as it goes. 50 is comfortable.
It moves both ways, toward whatever the place is worth.

## Contents

- [What you see](#what-you-see)
- [What it costs](#what-it-costs)
- [How fast it moves](#how-fast-it-moves)
- [The place](#the-place)
- [Weather, wind, night, height](#weather-wind-night-height)
- [Storms on the road](#storms-on-the-road)
- [The season and the sky](#the-season-and-the-sky)
- [On the map](#on-the-map)
- [Fire](#fire)
- [Water](#water)
- [Clothing](#clothing)
- [A meal](#a-meal)
- [Where this is](#where-this-is)

## What you see

| Reading | Word |
| --- | --- |
| Under 15 | Freezing |
| Under 30 | Cold |
| Under 42 | Chilly |
| 42 to 58 | Fine |
| Up to 70 | Warm |
| Up to 85 | Hot |
| Above 85 | Burning |

The Body page on K says the reading, whether you are warming or
cooling, the target, the roof, the night, the fire, what weather and
height are worth, and every worn piece it can see.

## What it costs

Cost is a distance from 50.

| Distance | Band | On the meter | Cold | Heat |
| --- | --- | --- | --- | --- |
| Under 20 | Fine | about 30 to 70 | Nothing | Nothing |
| 20 | Weary | about 30 or 70 | -20% stamina recovery, -2 speed | -15% stamina recovery |
| 30 | Bad | about 20 or 80 | -40% stamina recovery, -6 speed, -20 stamina | -35% stamina recovery, -20% magicka recovery, -15 stamina |
| 40 | Spent | 10 or below, or 90 or above | -60% stamina recovery, -12 speed, -40 stamina, -25 health | -55% stamina recovery, -40% magicka recovery, -35 stamina |

Heat does not take health. Freezing can. Cold at weary or worse also
speeds hunger and thirst. See [Hunger](hunger.md) and [Thirst](thirst.md).

## How fast it moves

Warming covers half the remaining gap in 30 seconds. Cooling covers
half the gap in 90 seconds. In winter, under the sky, cooling is a
quarter faster: half the gap in 72 seconds. A roof ignores the
winter, the same way it ignores the sky. Warming is the same in every
season. A fire is obvious while you stand in it.
Snow is not an emergency in the first few seconds. An unknown place is
comfortable. A room nobody has classified is not a trap.

It does not move while you are logged out. You come back at the reading
you left with, and it moves from there toward wherever you are standing.
The place you logged out in is not where you spent the time away, so
logging out in the snow does not bring you back freezing (#3154).

## The place

These are the targets before clothing, fire and weather.

| Place | Target |
| --- | --- |
| Indoors | 58 |
| Outdoors, nothing falling | 40 |
| Rain | 34 |
| Wading, about waist deep or less | 26 |
| Snow on the ground | 16 |
| Swimming | 8 |

A roof stops weather, night, wind and height. A campfire is not a roof.

Snow is the ground under your feet, read in your game from the land's own
material (the one footsteps are played from): deep snow on a clear day is
the snow place, and a snowfall on a bare road is outdoors with the falling
snow on top (#4653). Snow underfoot wins over rain falling.

## Weather, wind, night, height

Only with no roof. Degrees on or off the place.

| Factor | Worth |
| --- | --- |
| Wind, up to a full gale | as much as 14 colder, scaled by that weather's own wind |
| Snow falling | 6 colder, on top of the place |
| Rain falling | 4 colder |
| Overcast | 1 colder |
| A clear day, not at night | 4 warmer |
| Night | 6 colder |
| Height above 6,000 units | 1.2 colder per thousand, and no more than 14 |

Wind is scaled against this load order's weather table, not against
255. The blizzard `SkyrimStormSnow` is the check that the wind byte is
still the wind. The aurora flag on a weather is ignored.

The tundra is near zero. Ivarstead is about 3,000. High Hrothgar is
about 12,000. The Throat of the World is past 25,000, and the cap of
14 means the summit does not get colder than that from height alone.

Open blizzard is the worst place there is: snow's 16, less a gale's 14
and the falling snow's 6, is 0 before clothes, as cold as the meter
goes. Swimming in it is 0 as well.

Rain and swimming leave you wet for 3 minutes after you are under a
roof or out of the water. The exposure from rain or from the water
place fades across those 3 minutes. It does not snap off at the door.

There is no temperature by hold. The Pale is cold when it is high, it
is night, and it is snowing.

## Storms on the road

A blizzard or a heavy storm makes travel 15% slower while you are out
in it with no roof over you. That is 15 off a speed of 100, on top of
anything the cold already takes. Under a roof it stops at once.

The cold and the wet are the lines above: a blizzard is snow, falling
snow and the wind; a heavy storm is rain. The right gear is what keeps
those out, the same as any other weather. No coat takes away the
slowdown, because that is the storm and not the cold.

A storm is a rainy or snowy weather whose record is named a storm.
The weather record has no storm mark of its own, and its wind and kind
cannot tell one: in this load order a heavy storm and overcast rain
both blow at 85 and both are rain. The names can: `SkyrimStormRain`
and `SkyrimStormSnow` are storms, and `SkyrimOvercastRain` and
`SkyrimOvercastSnow` are not. Of the skies the season rolls, the
storms are Cathedral's storm rain and its three storm snows, so about
half of rain and over half of snow is a storm. The Body page on K says
so when you are in one. The slowdown is on the person: a horse keeps
its own pace, because nothing in the server sets a horse's speed yet.

## The season and the sky

The season is the one on [Farmer](classes/farmer.md): four of them, 7
real days each, one for the whole province. It changes three things:
the outdoor target, the sky, and in winter how fast you cool (above).
It does not pick a single sky and hold it for the week. It also
changes what a harvest gives: a quarter more in summer and a quarter
less in winter, on [Farmer](classes/farmer.md),
[Gatherer](classes/gatherer.md) and [Fisher](classes/fisher.md).

A season shifts the outdoor target, before clothing, fire, and the
sky. Indoors ignores it, the same way a roof ignores the sky.

| Season | On an outdoor target |
| --- | --- |
| Spring | 0 |
| Summer | 4 warmer |
| Autumn | 2 colder |
| Winter | 6 colder |

The sky is a roll. Clear, cloudy, rain, and snow can all come up in
every season. Winter makes snow more likely. It does not make snow
certain, and a clear winter day is still a clear day. Summer makes
snow rare. It does not forbid it.

The chances are out of 100.

| Season | Clear | Cloudy | Rain | Snow |
| --- | --- | --- | --- | --- |
| Spring | 30 | 30 | 35 | 5 |
| Summer | 40 | 30 | 28 | 2 |
| Autumn | 25 | 30 | 35 | 10 |
| Winter | 20 | 35 | 25 | 20 |

A snowy climate moves 10 from clear onto snow. Clear does not go
under 10. If it would, the rest comes off rain. Winterhold, the Pale,
and the high mountains are the snowy climates. A mild climate moves 5
from snow onto clear, and snow may land on 0. Whiterun, the Rift, and
Falkreath are the mild climates. Every other climate uses the table
as it is written.

One roll is one climate, and everybody standing in it has that sky.
It lasts 20 to 60 real minutes, a whole number of minutes, each
length as likely as the others. Then it rolls again. The next sky is
not announced.

A sky whose weather is still loading is not considered applied. Once
that weather is available, the same shared sky is applied without a new
roll. A sky already applied is left alone on unchanged frames.

The records are Cathedral Weathers, the mod already in the collection.
Each record is already clear, cloudy, rain, or snow, which is what
the meter reads. A season mod that follows the game's months, or that
turns winter into snow and summer into sun, is not this roll. The 7
days are real days, and a week of one sky is not the point.

Falling snow is still the snow line in the table above, 6 colder, on
top of the season. A clear winter day does not take that 6. The snow
place, target 16, is standing in snow on the ground. A clear sky over
bare ground is not that place.

## On the map

The map menu shows a strip at the top while it is open (#3156, Patrick's
C of 22 Oct 2026):

- The date, the game's own: the day and the month are today's in UTC,
  and the year is 4E 252 in 2026, turning with the real year. No day of
  the week, because the game counts that on its own for each person.
- The season, the next one, and how long until it turns.
- The server clock: the box's own time, Mountain time, which is the
  clock staff give times in. Your own clock beside it when your zone is
  different.

The season does not follow the date's month. Frostfall can be spring.

## Fire

At your feet a fire adds 34. At 300 units it adds nothing. Forges,
smelters, cooking spits and campfires count, including Embers XD.
Unlit versions do not.

A master woodworker's fire or kiln adds 48 at your feet and still
nothing at 300. A blizzard still applies. The fire does not delete the
weather.

Standing in the coals deals about 7 health a second. That is the flame,
not the meter. You can read Burning and also be on fire.

Being on fire supplies the same 34 warmth as a normal fire at your feet,
even after you leave the coals or catch fire from someone else. It uses the
stronger of that heat and a nearby fire, rather than adding both. The target
changes with the fire; the reading still follows the half-gap curve above.
When the fire ends, its warmth ends too. A delayed reading counts only the
time that fire was active. Time logged out gains no warmth from it.

The Body page names a fire on you separately from a nearby fire and its
distance. Its current reading, target and worn pieces are the server's
snapshot when K opens or you press Read again.

Fire spreads. Someone burning sets alight anyone in the same cell
within about two paces (220 units). The caught burn lasts 5 seconds
unless they stay next to the person who is alight. It does not run
through a town.

People nearby see flames on the person who is burning, including when
that person comes into view after the fire began. The flames stop when
that fire ends. An old fire does not return after death, a disconnect,
or a server restart.

## Water

Only while swimming or wading. Wading follows a placed water plane's actual
rotation and scale. Its surface must be above the feet and less than 70 game
units above them; standing beside its transformed edge or above its surface
is dry. A reference whose current transform cannot be read supplies no guessed
water footprint.

| Class | On top of the water place |
| --- | --- |
| Lava | +90. It is not water |
| Puddle | +12 |
| Still water | +10 |
| Marsh | +6 |
| Deep water, the sea, most lakes | 0 |
| A river | -5 |
| Ice | -8 |

There is no general ice water. The cold-named records are Dawnguard's
Frostreach. The sea off Dawnstar is the same water as the sea off
Riften. A freezing swim is the weather, the hour and the height on top
of being in the water.

## Clothing

Every worn piece counts on its own.

| Slot | Share of a dressed person |
| --- | --- |
| Body | 0.26 |
| Pelvis | 0.09 |
| Head | 0.10 |
| Back, a cloak | 0.10 |
| Feet | 0.07 |
| Calves | 0.05 |
| Hands | 0.05 |
| Chest | 0.05 |
| Legs | 0.04 |
| Neck | 0.04 |
| Arms | 0.04 |
| Hair | 0.03 |
| Shoulders | 0.03 |
| Circlet | 0.01 |
| Ears | 0.01 |

| Material | How well it keeps weather out |
| --- | --- |
| Fur | 1.00 |
| Leather | 0.75 |
| Light armour | 0.55 |
| Cloth | 0.50 |
| Heavy armour | 0.45 |
| None | 0 |

An unknown material counts as cloth. The total is capped at 0.80, so a
cuirass and a cloak on the same torso cannot add without limit.

Warm clothes pull a cold place back toward 50 by that fraction. In a
hot place they push further away, at half that fraction (the heat
factor is 0.5). Full kit at a forge is worse than a shirt.

A master tailor's garment woven for warmth ignores 4 degrees of
exposure on top of the table, and does not weigh more than clothing.
It does not replace fur. The tailor can weave a garment for hidden
armour instead, which is not this meter. See
[Tailor](professions/tailor.md).

A bad burn, from [Injury](injury.md), one that has taken 30 health or
more, means everything you wear counts at half for warmth until the burn
heals. The server is not told where the fire touched, and the flames
cover the whole body, so it is everything worn and not one part.

The server reads equipment. A piece handed to the client inside its own
game and never seen by the server cannot count. The Body page on K
says so.

## A meal

A soup, stew or chowder warms: the target is 4 degrees warmer for 20
minutes, or 30 minutes for a fine one. Other cooked food gives no
warmth of its own, and a cook's extra ingredient at the pot gives
stamina or the disease guard instead. One help at a time: a later
meal's help replaces the one before it.

Of the four festival feasts, only the Saturalia Spice Cake warms: 8
degrees warmer for 10 minutes, or 15 minutes for a fine one. The First
Planting Loaf, the Midyear Jazbay Tart and the Harvest's End Roast give
stamina or the guard, not warmth. See [Food](food.md).

## Where this is

The place targets, the weather numbers, the fire of 34 at 300 units,
the water classes, the clothing table, the cap of 0.80, the heat factor
of 0.5, the settle times, the on-fire damage, the spread, and the Body
page on K are in the server.

In it: the season shift on an outdoor target, the roll of the sky, the
winter's quarter faster cooling under the sky (#3144), the
master woodworker's 48, the master tailor's 4 degrees, the cold link
into hunger and thirst, the 3 minutes of wet, a storm's 15% on
the road, the bad burn halving what is worn, and a meal's warmth.
