# Trade carts

Goods go between holds on carts that people drive. A cart is loaded at a
cart stop, driven down a road to another stop by somebody who has goods on
it, and emptied there by whoever the goods are for. On the road, the cart is
with its driver, and anybody who catches up with the driver can raid it.

Decided by Patrick on 22 Oct ([#3158](https://github.com/ThornswoodRP/Thornswood/issues/3158)):
people drive the carts that move goods between holds, and a shipment is lost
only when people raid it, never by chance. Nothing on the road takes a piece
by itself: no chance, no clock, no weather.

It is not a haul and it is not a ship. A haul is a job on a notice board
with a pay ([Free Skyrim Trading Company](trading-company.md)); a cart is how
a lot of goods go at once, whoever carries them and whatever they are paid.
Ships carry cargo between ports on their own clock (#511); a cart moves only
as fast as the person driving it.

## The cart stop

A cart stop is a container already in the world, by a stable or a market,
that staff picked. E on it opens the stop's panel and never the container.
No plugin adds anything for it.

At a stop you see each cart standing there and how many of its 24 lines are
used. Anybody may load a cart: pick what to load from your pack, how many,
and who it is for, from the people in the world. Coin is not cargo. You see
the lines that are for you and the lines you loaded; the rest are counted,
not named.

What you loaded you can take back at the stop you loaded it, while the cart
is still there.

## Driving

Somebody with goods of their own on a cart may drive it. Drive, beside a
road on the stop's panel, sends it off with you. One person drives one cart
at a time.

The cart then goes where you go. Walk or ride the road; there is nothing to
steer. At the far stop, press its crate: the cart is on its way there, and
Pull in brings it in. Each road has a least time a loaded cart takes on it,
which staff set. A carriage ride or anything else that moves you faster does
not bring the cart in sooner; until that time has passed, the stop says how
many minutes are left.

Once it is in, whoever the goods are for collects them at that stop with
Collect. Goods for somebody who is not there wait on the cart.

## The raid

While a cart is on the road, Raid cart shows beside its driver under Near
you on P. It opens the cart for anybody within about 10 metres of the
driver, with both in the world: every piece on it, without whose it is, and
Take for each. Step further away and nothing more can be taken. What is taken goes into the raider's pack and is written
down as taken by them. The driver is told that somebody takes it, and not
who. Whether it was a robbery, a toll or a favour is roleplay, the same rule
ships have at a dock.

The driver cannot raid their own cart. A cart standing at a stop is not on
the road and cannot be raided.

A driver who leaves the world on the road takes the cart with them for now,
and it cannot be raided until they come back. Patrick decided on 26 Oct that
the cart stays where they left and can be raided there; that is
[#3531](https://github.com/ThornswoodRP/Thornswood/issues/3531).

## Staff

Cart stops and roads, on the Office page of K, opens the staff side. Open a
container at a stop, then that page within a minute, to make it a cart stop
or move a stop's crate. Add a road between two stops with its least minutes;
the way back is its own road. Every edit is a draft: the server says what
confirming it would change, and refuses one that would strand a cart.

Put a cart here, beside a stop, puts a new cart there. On the road lists the
carts being driven, how long their road has left and whether their driver is
still named. Bring it in brings one in at its stop: a cart whose driver was
deleted, or one that has to come in for a reason staff know.

## Where this is

In the server: the trade carts block of `game/gamemode.js`, with
`game/trade-carts.js` (the stop, the road and the raid) and
`game/trade-cargo.js` (the manifest, created driven). The register is
`private/trade-carts.json` on each server, which names characters by form
id and profile and never by name. `"thornswoodTradeCarts": false` in
`server-settings.json` switches the carts off; they are on otherwise, and
with no cart stop on the list nobody meets one. The panel is the trade
ships' panel, `game/ui/thornswood-ship.js`. Raid cart is on P, and Cart
stops and roads on the Office page of K for staff.

A deleted, reset or wiped character comes off every line and every cart
they drive, and every piece stays where it was (the part `carts` of the
release of deleted characters). `Wipe-Saves.ps1` sets the register aside
with the other registers that name characters.

`tests/test-3158-trade-carts.js` holds all of this.
