# Potions and restoration

A potion is a mouthful. It is not a meal and it is not a way to live.

## The sip

Every potion and every poison moves thirst by 5, including one you
brewed at the lab. Brewed potions are not in a plugin. They still count.

## Diminishing potions

Inside 60 seconds, the first potion does what it says. The second heals
or buffs at 50%. The third at 25%. The fourth and after do the sip of
thirst and nothing else. The window is from the first swallow.

## Restoration strain

Inside 30 seconds, each restoration spell after the first costs 25%
more magicka than the last. The fifth in that window is refused for 20
seconds, and stamina recovery and health recovery are at the weary
cold numbers from [Temperature](temperature.md) for those 20 seconds.

## Withered

Five potions in an hour, or ten restoration casts in an hour, sets
withered for 30 real minutes. Max health and max magicka are 80% of
what they were. Eating a cooked meal and resting in a bed, or waiting
the 30 minutes, clears it. A potion does not clear it.

## Where this is

The sip of 5 and restoration strain are in the server. The server hears
every restoration spell a person casts. It cannot refuse a cast,
because the game casts it before the server hears of it, so the strain
is the price: the second costs 25% more, the third 25% more again, and
after the fourth the price is past any magicka for 20 seconds, with
stamina and health recovery at -20%. The price moves through the value
the game's own Fortify Restoration moves. Nobody has yet cast five in a
row in the game to read the magicka each one asked for. The strain is
kept in memory, so a restart ends it, and when you come back into the
world the server sends your K panel as it stands at that moment, so
none of it is left on you (issue #1642).

Withered is in the server. The server hears every potion a person
drinks from their pack, a brewed one included, and every restoration
spell they cast, and keeps the hour's count and the end of a withering
on the character, so a relog or a restart does not end it early. The
fifth of max health and magicka it takes off is worked out from the
character's own most, what the race and the skill tree give, less what
hunger, thirst and the rest take off. A fortify from gear or a potion
running on you is not in that most, because the server cannot see it.
Waiting the 30 minutes clears it. An accepted cooked meal, soup or feast
during that withering, followed by a new rest in a bed or bedroll, also
clears it (#6239). The server uses the food and bed rules already in place.
Raw food, prepared food, burnt meals, a meal inside the eight-second meal
window and overeating do not qualify. Chairs and standing do not count as
bed rest. A meal from before the episode cannot clear it, and eating while
already in bed requires getting up and starting a new rest afterward.
The qualifying meal survives a relog or restart within the same withering;
a new episode starts with no qualifying meal. Recovery does not change the
normal potion or restoration counters.

The diminishing potions are in the server. The server counts the potions
in your minute and tells the engine how much of the next one to apply
before it lands: the second at half, the third at a quarter, the fourth
and after at nothing but the sip. A brewed potion counts. A restart
starts a new minute. The engine reads it through the change in skymp #62,
which is in the engine pin (`records/client-build.json`, fork commit
`ee67f972`) and in the engines both servers run: on 15 Nov 2026 the site's
credits page said the main server runs `ec8e20f9` and the test server
`50736fe6`, and both carry it.
