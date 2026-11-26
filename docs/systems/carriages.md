# Carriages and ferries

Fast travel is off. The way between holds is a driver.

The ride is a fade. You are at one stop, you pay, you are at the
other. It is one position change. An animated cart that parents you to
a moving actor is not used: the server does not sync that actor, so
everyone else would watch you stand still, and a save made during the
ride does not reload.

## The fare

You stand within 400 of the driver, the same reach as a notice board,
and press E on them. A panel names every stop that driver goes to and
its fare, with a Ride button beside each. Ride takes the fare and moves
you. Walking away closes the panel. Nothing is typed in the chat.

| Trip | Gold | Where it goes |
| --- | --- | --- |
| A ferry, one stop to another on its water, Solstheim's own ferry included | 10 | The departure hold's drop box |
| A carriage to a stop in the same hold | 10 | The departure hold's drop box |
| A carriage, one hold to another | 20 | The departure hold's drop box |
| The crossing between the mainland and Solstheim, the Northern Maiden between Windhelm and Raven Rock | 40 | The departure hold's drop box |

Decided by Patrick on 4 Oct (#1394): 40 is only that crossing. A ferry
ride between Raven Rock, Skaal Village and Tel Mithryn is 10 like any
other ferry, and a carriage ride inside one hold is 10.

If the gold is not in the pack, you do not move and nothing is taken.
The panel says so and stays open. Dying does not refund a fare already
paid.

A dead person or someone frozen by staff cannot ride. The refusal takes
no fare and does not move them, including when they opened the panel
before dying or being frozen. Rides are refused when the server cannot
verify the current character's state.

The driver is a worker of the hold the stop sits in. The fare is that
hold's, counted the way a notice fee is counted. See [Gold](gold.md)
and [Property](property.md).

The route list is the one the carriage and ferry mod already ships:
a carriage in every hold, ferries on the rivers. A stop that is not on
that list does not take gold and does not move you. The server does
not teleport you a second time on top of the fade.

There is no word that skips the driver. The map does not offer fast
travel.

## What a ride is not

A ride is a person changing holds. It is not a crate, and it does not
pay the company's tenth. Goods go by
[Free Skyrim Trading Company](trading-company.md), which is a job and
a pack, not a seat on the cart.

The fare is not a wage for a profession. Standing at the driver is not
work toward a rank.

## The cities as they are rebuilt

The drivers are patched for the rebuilt city gates, so they stand at
the stop and not inside a wall. A stop that is still wrong is moved
the way a board is moved: somebody stands where it should be. Until
that word exists for a driver, the mod's placement is the placement.

## Where this is

Fast travel is off. The carriage and ferry mod is in the collection.
The patch that keeps drivers out of the rebuilt gates is in the
collection with it.

The server keeps the route list: the 27 drivers the collection
places. That is nine carriages, the North Coast, Lake Honrich, Lake
Ilinalta and Solstheim ferries, and the Northern Maiden between
Windhelm and Raven Rock. Pressing E on a driver opens the panel of
that driver's stops and fares (`game/ui/thornswood-ride.js`, #1635).
Ride takes the fare into the departure hold's drop box, as real gold
(#2298), and moves you,
once. A short pack is refused and keeps its gold, and the panel stays
open with the reason. Walking out of reach of the driver closes it.
The fares are the table above.

The stops nobody drives from are on the list too: the villages, the
Hearthfire homes, the Thalmor Embassy, and the small ferry landings
(Windstad Manor and Frostflow Lighthouse on the coast, Honeyside on
Lake Honrich, Lakeview Manor and Ilinalta's Deep on Lake Ilinalta,
Bujold's Retreat and Northshore Landing on Solstheim). Each puts you
down on the mod's own arrival marker. A village belongs to the hold
the mod files it under, so Whiterun's carriage takes you to Riverwood
or Rorikstead for 10, and every other carriage takes you there for 20.
Nobody drives from one of these, so the ride back starts at a driver.
Icewater Jetty is not on the list: the mod sails there only for
somebody who talks their way to Castle Volkihar.

The mod's own conversation still opens on the same press, and it does
not ask the ledger. The panel waits for it and opens when it closes.
Its fade does not land: the server refuses a move it did not make and
puts you back where you were.
