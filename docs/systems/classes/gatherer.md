# Gatherer

Reagents out of the world. Food plants are the farmer's. 46 names,
105 placed plants.

Every name: [lists/gatherer.md](../lists/gatherer.md).

## The rank of a plant

The rank on the row. A plant has no gold price. What it sells for is
the price a person posts.

A plant above your rank is refused by name. You are told the rank it
takes. You keep standing there. Nothing is picked.

## The season of a plant

Four plants give only in their two seasons (#3152): Lavender in spring
and summer, Jazbay Grapes in summer and autumn, Snowberries in autumn
and winter, Juniper Berries in winter and spring. Out of season the
plant is bare. Nothing is picked, it is no piece of work, and it keeps
no wait. The line says which seasons it gives in. Every other plant
gives all year. The season is the farmer's, one for the province. Why
these four: [Food](../food.md), "Seasonal food".

## What one pick gives

One. The rank does not grow the handful. It only opens the plant.
A master and a novice both take 1 blue mountain flower off a plant
the novice is allowed to touch. The extra yield pairs on a carcass,
a seam, a fish and a plot are not this verb.

The season moves the one by a quarter, on average (#3144). In summer
a pick gives 2 a quarter of the time, and the line says "Summer gives
more." In winter a plant is bare a quarter of the time: nothing is
picked, it is no piece of work, and the plant still waits its ten
minutes, so pressing it again does not take the quarter back. The
line says it has nothing to pick, and "Winter gives less." Spring and
autumn give the one.

One successful pick is one piece of work. There is no deposit of 20
the way a seam has, so a hillside of flowers is more pieces per hour
than one iron vein. The ladder is still 100, then 250, then 600. If
gatherers climb faster than miners, the cause is the hillside, not a
different ladder.

## The wait

Ten minutes after a pick, that plant, for everybody. The key is the
plant, not the person. The flower beside it is a different plant.

A press from someone who is not a gatherer does not pick it. The
plant stays. They are told it is not their work. A gatherer below
the plant's rank is the same: nothing is taken.

## Wheat, nirnroot, and the hive

Wheat (`bb953:Skyrim.esm`, TreeFloraWheat01) is in the reagent table
at advanced, gold 5, and it is also a crop with a 135 minute grow.
The crop wins. A gatherer who presses it is not handed the wheat.
See [Farmer](farmer.md).

Nirnroot that the plant table ranked is expert, because the produce
sells above 12 gold. Red nirnroot (`b6fb9:Skyrim.esm`) is an activator
the plant pass does not read. It is answered by hand, with no rank:
any gatherer, 1 red nirnroot, the same ten minutes. The ordinary
nirnroot activator (`e1fb2:Skyrim.esm`) is the same kind of record.
If the generated table already has that base, the table's rank is
the one that applies. If it does not, the hand row has no rank and
any gatherer may take it.

The beehive this server placed (`dbf8b3:Thornswood-Content.esp`) is
the farmer's, the same as a world beehive on the harvest list. See
[Farmer](farmer.md). A press from a gatherer does not take the comb.

## Torchbugs

Only a Gatherer can catch a torchbug. Other classes leave the insect intact
and receive a refusal. While the character is still loading, wait before
catching one. A class change or a new character clears the old permission.

The local insect keeps its own collection script. The class gate does not
send a catch claim or ask the server to create ingredients.

## What you are handed

1 in Burden (+15 carry weight).

## What you cannot do

You cannot take a cabbage, a leek, a potato, wheat, or an apple off
a farm plot. Those are [Farmer](farmer.md). You cannot pick a flower
and have it be cooking. The cook buys or is given what you picked.

Some world records were filed with no rank:
[lists/unranked.md](../lists/unranked.md). A record whose produce is
already on this ladder takes that produce's rank. Blue mountain
flower, purple mountain flower, and red mountain flower are advanced.
Lavender, juniper, jazbay, thistle, tundra cotton, spiky grass, imp
stool, creep cluster, namira's rot, and white cap are novice. Canis root,
deathbell, dragon's tongue, fly amanita, giant lichen, glowing
mushroom, mora tapinella, scaly pholiota, snowberry, and swamp fungal
pod are advanced. Bleeding
crown, blisterwort, and nightshade are expert. Rot scale, screaming
maw and thorn hook are Creation Club plants, and Thornswood is Special
Edition only, so nobody gathers them.

Cabbage, carrot, gourds, leek, potato, and wheat are the farmer's
crops, in a homestead's garden planter as much as in a field. A
chickens' nest and a churn are farmer verbs. A beehive is the
farmer's. See [Farmer](farmer.md). A clam and the fish laid out
and hung up in Windhelm are the fisher's. A dead horker in the Skaal
village is the hunter's. A coin purse and an estate key are not a
harvest. A bowl of mammoth cheese is anybody's. A mead barrel and
Bashir's clam at Oar's Rest are nobody's: nothing comes away.

## Plants that grow only in their own hold

Each hold has plants of its own (Patrick, 22 Oct 2026, #3150). They
grow only in that hold. Pick them there, or trade for them anywhere
else. Outside their hold they are not in the world at all: nobody
sees them and nothing is refused.

| Hold | Its own plants |
| --- | --- |
| Whiterun | Tundra cotton, lavender |
| Haafingar | Grass pod, garlic |
| The Rift | Scaly pholiota, canis root, pine thrush egg |
| The Reach | Juniper berries, rock warbler egg |
| Eastmarch | Dragon's tongue, jazbay grapes, creep cluster |
| Falkreath | Thistle branch, mora tapinella |
| Hjaalmarch | Swamp fungal pod, giant lichen, deathbell |
| Winterhold | Chaurus eggs, Nordic barnacle |

The Pale's are ores (see [Miner](miner.md)). Each one is the plant
whose placements already stood mostly in that hold, so the fewest
were taken out. The list and what was measured for each are
`holdOnly` in `game/data/last-plugin-policy.json`, and
`scripts/mods/Build-LastPlugin.py` switches the rest off.

## Where this is

The verb, the ranks, the ten minutes, the four herbs' seasons, the
season's quarter, and the
list are in the server.
The wait is the plant, for everybody: the next person cannot take it
early. A press from someone who is not a gatherer is refused before
the plant is consumed, and a gatherer below the plant's rank takes
nothing either. World records filed with no rank take the ranks under
"What you cannot do" when the record is a gatherer's plant.
