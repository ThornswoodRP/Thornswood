# Blackreach geode work

The Winterhold Enchanter (`1e7d6:Skyrim.esm`) offers the original geode work
to a novice-or-higher Enchanter. No Miner class, new tool requirement, work
credit, gold or purse refill is added. Existing configured Enchanter tool
rules still apply. Another hold's Enchanter does not repeat this new offer.

| Rule | Amount |
| --- | --- |
| Existing selected geodes | 6 |
| One draw | 1 Empty Petty Soul Gem (`2e4e2:Skyrim.esm`) |
| Shared return per selected geode | 30 minutes |
| Personal open-work limit | 6 gems |
| Turn-in consumes | 2 gems; keep the extras |
| Completion rest | 12 hours |
| Abandonment | Consume the entire outstanding draw, no personal rest |

The source table specified the personal rest but no shared return. The chosen
thirty minutes matches the common mineral-seam return and bounds these six
sources at 288 gems per day globally. Personal quest limits apply separately.
This is a documented source rate choice, not an assertion of an earlier timer.

The six deposits keep base `10e93b:Skyrim.esm` and stay in Blackreach
(`1ee62:Skyrim.esm`). Each must remain within 128 units of its measured position;
the character must share that world and stand within 400 units of the deposit.
The native item must retain SLGM type, SOUL 0 and SLCP 1. Filled gems do not count
as the selected reward. Positions come from the winning enabled references
under the 103-plugin population load order pinned by the manifest.

| Existing reference | Winning position |
| --- | --- |
| `10fc57:Skyrim.esm` | `[10850.224609375, 6743.7685546875, 1174.552734375]` |
| `10eb24:Skyrim.esm` | `[4929.0908203125, 18396.95703125, 1021.5740966796875]` |
| `10e994:Skyrim.esm` | `[7638.52783203125, 17578.05078125, 1624.3555908203125]` |
| `10e955:Skyrim.esm` | `[6554.4755859375, 17093.744140625, 1441.29345703125]` |
| `10e8bb:Skyrim.esm` | `[6002.3837890625, 17703.9375, 1296.7362060546875]` |
| `10fc4c:Skyrim.esm` | `[14032.8125, -3727.707763671875, -1492.2423095703125]` |

Selected IDs are intercepted before native queries, even when the quest
controller, source lookup or notification fails or a base is substituted.
Other source references keep their ordinary path. The existing native actor
session/profile/life identity and inventory/property CAS protect each draw;
a source reservation precedes that commit and stays held on an unknown outcome.
Static source evidence is rechecked immediately before commit. No hosted-NPC
ownership API is invented for a stationary ACTI reference.

Automated tests exercise actual activation and draw paths, native empty-gem
fields, generated production exports, actor replacement, actual profession,
late eligibility changes, stock, caps, extras, abandonment and write refusals.
The pearl, crimson and geode work have their own harnesses,
`game/tests/test-merchant-pearl-bed.js`, `game/tests/test-merchant-crimson.js`
and `game/tests/test-merchant-geode.js`, beside the quest and trade ones.
A release can follow only after the source merges with required green CI.
