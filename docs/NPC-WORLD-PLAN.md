# NPC world work

Patrick authorized the town cut, habitat rules, location difficulty,
hunting and fishing rates, and merchant quests on 1 October. Exact
Merchant's Guild relocation is deferred. This replaces the earlier
instruction to postpone thinning and the old plan to remove bandit camps.

| Module | Responsibility | Depends on |
| --- | --- | --- |
| npc-authority | Shared identities, safe activity, combat and dynamic enrollment | Existing native world |
| npc-population | Winning-record catalogue, city cut, habitat and home limits | npc-authority |
| encounter-balance | Fixed dungeon tiers, camp baselines, shared return intervals | npc-population |
| resource-stock | Ecological hunting and fishing locations, persistent shared supply | npc-population |
| merchant-economy | Hold price lists, one-time purses and finite stock | npc-population |
| merchant-quests | Authored supply, scarce and scene contracts with server verification | resource-stock, merchant-economy, encounter-balance |

Build in this order. Each capability needs regression evidence, passing
checks and a runtime check before its board entry is closed. Existing
system pages supply the quest counts and rewards. No extra quest lineup or
fixed item prices are introduced. Read each issue's complete acceptance
criteria before claiming that related human role work is finished.

## Contract

- Catalogue the installed plugin order and winning identities, including
  template-derived race and faction membership. Keep provenance and a reason
  for each inclusion or exclusion. Do not modify plugins or use a person's
  position as an NPC spawn point.
- Apply the cut before activity preparation and on later loads. Saved fillers
  cannot bypass it. Dynamic encounters and farm actors also need authority.
- Preserve valid traders, outside transport stops, camps, dungeon enemies and
  ecological wildlife. Limit city animals; distinguish sewers from streets.
- Assign fixed tiers to named cave and dungeon locations, with separate
  uniform bandit-camp and giant-camp baselines. Keep suitable enemy families,
  beginner routes and deliberate difficult places.
- Replace the default 25-second enemy return and per-person resource rewards
  with bounded shared supply. Save deadlines and stock. A restart cannot
  refill them. One carcass is dressed once per life. Failed grants do not
  consume stock; successful grants cannot pay another connection twice.
- List every hunting and fishing location with source identity, habitat,
  species, tier or rank, cap, rate and access gates. Validate locations from
  the installed records instead of inventing coordinates.
- Implement the quests page's lineup and quantities. Supply rewards debit
  the offering trader; scene rewards mint once after a verified deed; scarce
  access cannot let unfinished extra goods escape. Save progress and waits.
  Validate proximity, identity, location, rank and inventory on the server.
- Preserve native authority and navigation checks. Measure the full data set
  before and after the cut. Keep the 2 GiB offline RSS gate, bounded scheduled
  work, actual activity and reload checks.
- Ship a complete dev release, restart dev, verify capture and persistence,
  and publish the required Discord announcement. Main deployment needs a
  separate authorization. Two-person visual verification remains separate.

## Source and checks

Source: `game/gamemode.js`, catalogues in `game/data`, native fork under
`engine/skymp`. Checks live under `tests` and the fork's `unit`.
Run `node game/tests/test-npc-shared-runtime.js` and
`node game/tests/test-npc-shared-native.js <addon path> <installed settings path>`.
The latter reads installed plugin paths and creates an isolated offline
world. Never print the private settings or credentials. It holds each
callback to its CPU time read to the cycle (`tests/thread-clock.js`, which
builds `tests/thread-clock.c` into `out\tests` the first time with the Visual
Studio C compiler the engine build uses). CPU time also depends on the
machine: on One the same load took twice as long on a low power core as on a
performance core, and nearly five times as long beside three other runs
(#2032), so run it with nothing else heavy going on.

Related entries include #504, #1397, #501, #510, #1287, #1288, #1274,
#1267, #1277, #1112, #1379, #1375, #505, #1373 and #506. A mention of an
NPC does not mean unrelated security, launcher or human office work is done.
