# Food

A swallowed thing is hunger, thirst, or both. The food table says which
kind it is. The state says how good a meal it is.

## States

| State | Hunger | Also |
| --- | --- | --- |
| Raw meat or fish | 8 | Can start food sickness. What you eat with no fire |
| Burnt | 8 | Stamina recovery -10% for 10 real minutes |
| Spoiled | 0 | Starts food sickness. Food that ran out of days ([Spoilage](spoilage.md)) |
| Ordinary food the table does not special-case | 15 | Nothing else |
| Cooked | 25 | A small help for 20 real minutes, from what went in it (below) |
| A feast | 40 | A stronger help for 10 real minutes. The four festival dishes are the feasts (below) |

A cooked meal's help is one of these, not all of them: stamina recovery
+10%, or the temperature target 4 degrees warmer, or the chance of
catching a disease cut in half while it lasts. A feast is the same
list at double the help and half the time, so the disease chance is
a quarter. It is not a heal. A potion still does the healing.

Which help a meal gives (Patrick, 18 October 2026, #2682):

- A soup, a stew or a chowder warms. That is the only help a meal gives
  on its own. Any other cooked dish gives none.
- Stamina recovery or the disease guard comes only when the cook adds
  one extra ingredient at the pot: garlic for the disease guard, a salt
  pile for stamina recovery. The seasoned dish gives that help instead of
  warmth.
- The latest meal's help is the one that counts. A meal with no help
  leaves the one you have alone. A meal refused inside the 8 seconds, or
  eaten on a full stomach, gives no help.

## Food's own magic

Food does not carry its own magic. The regeneration boosts the game's
food records came with are gone, so the help above and the alchemist's
potions are what a meal or a bottle is for (Patrick, 18 October 2026).
Hunger and thirst are not touched.

Frostwheat Bread, the Sack of Frostwheat Flour and Snowberry Juice keep
their frost resistance. The Thornswood-Last.esp recipe removes their
original health and stamina recovery effects (#4612). Drugs, ale and
potions keep their own effects.

A soup, a stew or a chowder counts as cooked: 25 hunger and 10 thirst
(Patrick, 12 Oct 2026), so cooking a stew is never worse than cooking
a chop. A dry ration is food only.

## Seasonal food (#3152)

A seasonal dish can be made any time you have its ingredients. The
ingredients are what is seasonal (Patrick, 22 October 2026). Four herbs
are picked only in two seasons each, so every season has its own pair:

| Season | In season | Festival dish | Festival brew |
| --- | --- | --- | --- |
| Spring | Lavender, Juniper Berries | First Planting Loaf | First Planting Mead |
| Summer | Lavender, Jazbay Grapes | Midyear Jazbay Tart | Midyear Jazbay Wine |
| Autumn | Jazbay Grapes, Snowberries | Harvest's End Roast | Harvest's End Ale |
| Winter | Snowberries, Juniper Berries | Saturalia Spice Cake | Saturalia Mulled Mead |

Out of season the plant is bare: nothing is picked and it is no
piece of work ([Gatherer](classes/gatherer.md)). A festival dish out
of season is made from what was put by. The teas, crostatas and dumplings made from these herbs follow
the same seasons.

Each festival dish wants both of its season's herbs and is a feast:
40 hunger, and its help twice as strong for half as long. First
Planting and Harvest's End give stamina recovery +20% for 10 real
minutes, the Midyear tart the disease guard at a quarter of the chance
for 10, and the Saturalia cake the temperature target 8 degrees warmer
for 10. A fine one lasts 15. It comes out burnt, plain or fine like any
dish. A Hearthcook makes them: the loaf, the tart and the cake at the
oven, the roast at the cookpot. Each festival brew wants its season's
herbs too and is ale ([Drink and ale](drink.md)), brewed at the
cookpot.

## Time and a full stomach

Eating takes 8 seconds. Another meal in that window does nothing. At
90 hunger or above, another meal does not raise the meter and starts
food sickness instead. That is what stops a stack of stews replacing
potions.

## Who cooks

Hearthcook and Confectioner own the recipes. The rows are
[lists/cook-hearthcook.md](lists/cook-hearthcook.md) and
[lists/cook-confectioner.md](lists/cook-confectioner.md). Grand Chef
makes two of a batch. A hunter is who brings the meat. This page does
not move either verb.

## How a cook comes out

Every cook at the pot or the oven comes out burnt, plain or fine
(Patrick, 20 October 2026, #2906). The odds are by the cook's rank in
the half the recipe is:

| Rank | Burnt | Fine |
| --- | --- | --- |
| Novice | 1 in 5 | 1 in 20 |
| Advanced | 1 in 10 | 1 in 10 |
| Expert | 1 in 20 | 1 in 5 |
| Master | never | 7 in 20 |

The rest come out plain. A burnt cook is a Burnt Meal, the Burnt row
above. A fine dish is the plain dish with its help lasting 30 real
minutes instead of 20; it fills the same and its own magic goes the
same way. A Grand Chef's second portion is the same quality as the
first. A tea, the mill's flour and anything else that is not a dish
comes out as it is. There is no timing minigame.

The crafting menu shows the plain dish until it closes; the burnt or
fine one is what is in the pack after.

## Spoilage

Food spoils gently: raw in a real week, a dish in two, salted or smoked
food never. A pack spoils only while its owner is online; a chest
counts real days, and keeps food in a snowy climate and in the winter
week. Food that runs out is spoiled food, which fills nothing. A cook
salts or smokes raw meat and fish. See [Spoilage](spoilage.md).

## Where this is

The table that marks food, drink, ale, potion and poison is in the server, and an unknown edible is 15 hunger. The 8 seconds and the full-stomach sickness are in it too. The groups are in the server too (#1382), by record in game/data/food-groups.json: raw meat or fish is 8 and can start food sickness, cooked is 25 (the Homecooked Meal is cooked), a soup, stew or chowder counts as cooked and is 25 hunger and 10 thirst, and ingredients (vegetables, fruit, honey, butter, flour), prepared food (bread, cheese, sweets, spiced beef) and the six drugs are 15. The six drugs also take the stimulant in [Exhaustion](exhaustion.md). The Bee and Barb's mixed drinks, the Battle-Brew meads and Red Eagle's Rye are ale, milk and snowberry juice are drink, and Goodberry is a potion. Tea is a group of its own: the three teas are drinks, 20 thirst, and take the tea stimulant in [Exhaustion](exhaustion.md). The feast group is the four festival dishes and their fine records, and which help each gives is the same file's `feasts` (#3152); a feast's help is twice as strong for half as long, its guard the injury block's feast row. Which herb is picked in which season is the same file's `inSeason`, read by the harvest. The festival dishes and brews are the content plugin's own. Burnt is a cooking quality level, not a group: the Burnt Meal and a fine record of each of the 63 dishes are the content plugin's, named in the same file's `quality`, and the server rolls which one a cook gives in mp.onCraft and has the engine give it (#2906). The odds are in the server, `NEEDS.cookQuality`. The cooked help and food's own magic are in the server too (#2682), in the same file: which groups lose their own magic and the three frost foods exempt from whole-record scaling (`strip`), which group warms on its own and which extra ingredient gives which help (`season`). The disease guard is the injury system's, from [Disease](disease.md). The seasoned dishes are not in the content plugin yet, so until they are, only the warmth and the taking away of food's own magic are live.
