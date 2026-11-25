# Longfin work on Haafingar's northern coast

Haafingar's Alchemist (`198d2:Skyrim.esm`) offers the original longfin quest
to a Master Fisher carrying a suitable pole. The Alchemist's verified buying
table includes Abecean Longfin (`106e1b:Skyrim.esm`); the Cook's does not.
The same new offer is not repeated by another hold's specialist.

| Rule | Amount |
| --- | --- |
| Dedicated northern sea markers | 8 |
| Each successful cast | 1 Abecean Longfin |
| Shared return per marker | 4 hours |
| Personal open-work limit | 8 fish |
| Returning the work | Consume 2, keep extras |
| Completion rest | 12 hours |
| Abandonment | Consume the outstanding draw; no personal rest |
| Maximum yield across all 8 markers | 48 fish per 24 hours |

Markers `17200` through `17207:Thornswood-Content.esp` use FLOR base
`154a5:Thornswood-Content.esp`. Exact final positions, CELLs and original
clam anchors are in `quest-content.json` and [the content specification](merchant-quest-content.md).
They stand 32 units below the recorded northern sea level at -14032, rather
than at their anchors' seabed heights. Original clam sources and stock remain
independent. No additional fish markers or actors are spawned at runtime.

The manifest is derived from those eight authored placements. Native source
validation checks enabled REFR/FLOR/INGR/WRLD types, original NAME and DATA,
the FLOR's actual PFIG ingredient, live base and world, a128-unit source bound
and 400-unit interaction reach on every draw. Substituted ingredients refuse.
Only a successful quest draw earns normal fishing work credit and pole wear.
No gold reward or merchant purse refill is added.

A frozen reference register intercepts selected water before native lookup.
Missing actors, failed queries, missing services and failed notifications
cannot allow ordinary activation at these references. Longfin's dedicated base
also refuses ordinary fishing when its quest controller is missing. Other fish
and clams keep their normal path. The existing native actor session/life,
inventory receipt and metadata transaction protect each one-item draw, and the
shared reservation remains held on an unknown commit outcome.

Automated checks exercise real fishing and activation, Master class and pole
gates, exact appointed merchant, source and ingredient substitution, actor
replacement, shared waits, limits, extras, abandonment, failed writes and
ordinary activation. Native source tests exercise the generated production
exports. The pearl, crimson and geode work have their own harnesses,
`game/tests/test-merchant-pearl-bed.js`, `game/tests/test-merchant-crimson.js`
and `game/tests/test-merchant-geode.js`, and this work's is
`game/tests/test-merchant-longfin.js`.
These are source checks; connected acceptance is a separate test.

Matching Content reaches Dev's server before the matching client bytes are
released, and this runtime section is then activated with the same Content
fingerprint. The normal server-first release parity checks are mandatory.
These source changes include no release, installation, Vortex action or game playtest.
