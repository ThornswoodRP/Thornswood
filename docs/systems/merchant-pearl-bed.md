# Pearl-bed work

The Solstheim Enchanter at `177da:Dragonborn.esm` offers the original pearl-bed
work to an Expert Fisher. It asks for one Pearl, permits three personal draws,
and starts an eight-hour personal rest after completion. Completion consumes
one and keeps the extra two. Abandoning removes the entire outstanding draw
and starts no personal rest. There is no gold reward or purse change.

These three existing Pearl Oysters use base `3828c:Dragonborn.esm`, give
`854fe:Skyrim.esm` (an ingredient), and stand in world `800:Dragonborn.esm`.
Each successful draw gives one Pearl. All fishers share one collection from a
source every 60 minutes; personal quest limits do not refill shared stock.

| Exact existing reference | Winning position |
| --- | --- |
| `3828e:Dragonborn.esm` | `[27197.439453125,33044.234375,-82.0891342163086]` |
| `38894:Dragonborn.esm` | `[27077.59765625,28003.259765625,-167.68028259277344]` |
| `3919c:Dragonborn.esm` | `[25586.798828125,33730.1015625,280.6593017578125]` |

Normal Fisher class, Expert rank, suitable pole and pole coverage remain
required. The source must stay enabled, retain its exact native identity and
base, and remain within 128 units of its winning position in the same world.
The character must approach within 400 units. Startup rejects unverifiable
native evidence. A missing or failed quest service keeps these selected
oysters shut; oysters elsewhere retain ordinary fishing behavior.

The draw and its quest counter commit in one native inventory/property
transaction against the original snapshot. Refused writes give nothing and
leave the source available. Successful draws use normal fishing progress and
tool wear once. No source, item, NPC, spawn, recipe, yield table, asset or
engine change is added. Alpha quest/trade state is disposable; this section
introduces no historical-state migration or preservation work.

The other nine scarce works and all seven retrievals have their own
appointed specialists ([Appointed specialists for original work](merchant-legacy-offers.md)).
`node game/tests/test-merchant-pearl-bed.js` holds this work.
