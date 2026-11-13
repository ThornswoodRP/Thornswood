# Merchant quest catalogue

There are **245 authored definitions** in
`game/data/merchant-quests.json` and `game/data/merchant-ranked-quests.json`, covering all 240 merchant/rank slots
for the 60 retained merchants. Four kill scenes are explicitly admitted
by the pinned activation manifest, along with 241 delivery commissions.
The aggregate authoring file stays `active:false` and
`complete:false`, so adding a draft does not enable it. Runtime includes the 23
legacy definitions and ten bound routes plus these 245 offers. Source
activation is not proof of a completed Dev deployment.

Four scenes give Novice and Advanced Warriors and Mages different work. Ten
Novice commissions request goods for specific trades and holds. Eight more
commissions add six Master offers, one Expert offer and one Novice Enchanter
offer in Whiterun. Thirteen further parcels complete all 24 Whiterun slots.
A further 69 parcels complete the Rift, Reach and Haafingar. A final 141 parcels complete Hjaalmarch, Falkreath, Eastmarch, the Pale, Winterhold and Solstheim. All ten holds now have all 240 unique merchant/rank slots;
the five class Novice extras share already covered slots. These are deliveries,
which can include goods obtained from other craftspeople; they do not assert
that the person returning them crafted them. Neither kind grants ordinary
buy, sell or supply permissions.

## First playable scenes

| Work | Offering trade and hold | Required standing | Exact objective | Gold | Personal cooldown |
| --- | --- | --- | --- | ---: | --- |
| A clear road for cloth | Whiterun Tailor | Novice Warrior | Defeat the one bound bandit in Redoran's Retreat | 15 | 6 hours |
| Coastal preparations | Winterhold Enchanter | Novice Mage | Defeat the one bound skeever on Winterhold's coast | 10 | 6 hours |
| Northwind work clothes | Rift Tailor | Advanced Warrior | Defeat both bound skeletons inside Northwind Mine | 35 | 6 hours |
| Shimmermist preparations | Whiterun Enchanter | Advanced Mage | Defeat both bound Falmer inside Shimmermist Cave | 40 | 6 hours |

The offering references are `1a684:Skyrim.esm` (base `13b9c:Skyrim.esm`,
book hold `whiterun`) and `1e7d6:Skyrim.esm` (base `1e7d5:Skyrim.esm`,
book hold `winterhold`). These are exact retained roster bindings. The
Advanced offers bind
`31efc3:Riften Expansion.esp` (base `1d0769:Riften Expansion.esp`, book hold
`riften`) and `1a672:Skyrim.esm` (base `13ba1:Skyrim.esm`, book hold
`whiterun`), respectively. Their saved profession gates require Advanced
Warrior or Mage standing. Neither is Master work or needs a Master half or
school. These fill the two planned Advanced exceptions; they do not replace
the class-gated Novice reservations or any owning-trade work.

## Targets and their existing returns

The target data copies the retained placements in `npc-population.json`.
No new actor, extra harvest, equipment grant or changed return rate is added.
Source positions and normal leashes are recorded in the JSON.

| Target | Exact reference and base | Runtime place | Source position | Normal leash | Existing return |
| --- | --- | --- | --- | ---: | --- |
| Bandit | `36ce1:Skyrim.esm`, base `1e79d:Skyrim.esm` | Interior cell `15224:Skyrim.esm` | `[-2136.4208984375, 1534.8690185546875, -212.0419921875]` | 2,048 | 45 minutes |
| Skeever | `ef60f:Skyrim.esm`, base `23ab7:Skyrim.esm` | Tamriel `3c:Skyrim.esm`, source cell `8dea:Skyrim.esm` | `[99232, 128672, -13824]` | 1,536 | 20 minutes |
| Northwind skeleton | `476c9:Skyrim.esm`, base `2d1fc:Skyrim.esm` | Interior cell `15294:Skyrim.esm` | `[407.26873779296875, 3681.330322265625, 159.30126953125]` | 1,536 | 45 minutes |
| Northwind skeleton | `476ca:Skyrim.esm`, base `2d1fd:Skyrim.esm` | Interior cell `15294:Skyrim.esm` | `[-145.48818969726562, 2940.852783203125, 153.1743927001953]` | 1,536 | 45 minutes |
| Shimmermist Falmer | `530c0:Skyrim.esm`, base `1e7b3:Skyrim.esm` | Interior cell `1521c:Skyrim.esm` | `[3485.25244140625, -723.4301147460938, -624.6600341796875]` | 1,536 | 45 minutes |
| Shimmermist Falmer | `530c4:Skyrim.esm`, base `1e7b4:Skyrim.esm` | Interior cell `1521c:Skyrim.esm` | `[5013.04150390625, -3487.726806640625, -631.1539916992188]` | 1,536 | 45 minutes |

Northwind Mine's location identifier is `fdbdf:Skyrim.esm`; Shimmermist
Cave's is `1929d:Skyrim.esm`. Both already have population tier two and a
site cap of 12. Neither cap changes or promises all targets will be available
at once. Both selected Falmer are ordinary retained placements, not the
ambush or the deeper chamber's centurion. The work-party and warding
survey are reasons for these kill objectives, not additional escort,
shipment or survey mechanics. Population tier is not a measured guarantee
of combat balance for the quest rank. No connected balance test ran.

Population location identifiers such as `19295:Skyrim.esm` identify a named
place; they are not the runtime cell or worldspace. The future adapter must
use the actual cell/world, exact reference and base, current life and body
identity, species, authored leash, kill attribution and original conversation
and transaction fences. A similarly named bandit or skeever elsewhere does
not count. Existing camp difficulty and animal habitat remain unchanged.

## Finite-purse commissions

The [regional delivery catalogue](merchant-regional-deliveries.md) lists the 69 additions in the Rift, Reach and Haafingar, with their exact references, source records, counts, gates and personal rest periods. The [remaining-hold catalogue](merchant-all-hold-deliveries.md) lists the final 141 additions and complete Master-half/school allocation. Whiterun's first complete set is below.

### Complete Whiterun rank coverage

Every retained Whiterun specialist now has at least one Novice, Advanced,
Expert and Master offer. The following thirteen additions complete that
coverage. Their full source references, counts, gates and recipe conditions
are pinned in `merchant-ranked-quests.json`. No existing published terms change.

| Trade | Rank and requirement | Work | Complete parcel | Personal rest |
| --- | --- | --- | --- | --- |
| Smith | Advanced Edgewright | Steel for the work rack | 1 Steel Sword, 2 Steel Daggers | 12 hours |
| Smith | Expert Platewright | A glass defence set | 1 Glass Shield, 1 Glass Helmet | 24 hours |
| Woodworker | Novice Fisher class | A first water kit | 1 Crude Fishing Pole, 1 Fish Trap | 6 hours |
| Woodworker | Advanced Woodwright | An orcish bow kit | 1 Orcish Bow, 24 Orcish Arrows | 12 hours |
| Woodworker | Expert Charburner | Fuel and spare handles | 3 Charcoal Briquettes, 2 Tool Handles | 24 hours |
| Tailor | Advanced Hunter class | Ribbons for a hunt feast | 2 Wedding Wreaths, 4 Thread | 12 hours |
| Tailor | Expert Haberdasher | White fur and gilded trimmings | 2 White Fur Cloaks, 2 Gilded Wristguards | 24 hours |
| Enchanter | Expert Wardweaver | A shield and cloak for the workbench | 1 Glass Shield, 1 Brown Fur Cloak | 24 hours |
| Cook | Novice Farmer class | A meal parcel for field work | 2 Potato Soups, 2 Cooked Beef | 6 hours |
| Cook | Advanced Hearthcook | Tomato soup and bread | 2 Tomato Soups, 2 Bread Loaves | 12 hours |
| Cook | Expert Confectioner | Two apple courses | 2 Apple Pies, 2 Apple Dumplings | 24 hours |
| Alchemist | Novice Gatherer class | Lavender and cotton | 3 Lavender, 3 Tundra Cotton | 6 hours |
| Alchemist | Advanced Blightbrewer | A fungal collection | 3 Fly Amanita, 3 Swamp Fungal Pods | 12 hours |

These additions also bring each class and each profession to at least two
distinct authored jobs across the catalogue. Source checks enforce both that
coverage and all 24 Whiterun merchant/rank slots. The full catalogue now covers all 240 slots, every 14 non-Mage mastered half, all five Master schools and each Master class. Displayed payments use the offering
hold's submitted buy prices and existing finite purse; no default quote,
additional money, stock refill, source placement or yield is added.

Each new item set differs from every earlier commission, independent of
quantities or titles. Recipe quantities align with finished goods; a single
orcish arrow batch makes 24 arrows. Accepted terms, complete-parcel settlement
and original cooldowns use the same reviewed bundle protocol as the eight
ranked parcels below. The Enchanter's delivery uses only its existing public
wearable permission and makes no particular enchantment claim.

### Ranked parcels in Whiterun

These eight additional jobs keep their complete item lists and original quoted
payments. The six Master offers each belong to a different trade. The source
file records exact merchant bases, item records, recipe conditions and
producer ranks. No location or return rate changes.

| Work | Exact offering reference | Requirement | Complete parcel | Personal rest |
| --- | --- | --- | --- | --- |
| An ebony seam's account | Smith `1a67c:Skyrim.esm` | Master Miner class | 4 Ebony Ore, 4 Silver Ore, 1 Pickaxe | 48 hours |
| An outfitter's last reserve | Woodworker `1a681:Skyrim.esm` | Master Woodwright half | 1 Master Fishing Pole, 24 Ebony Arrows | 48 hours |
| Winter vestments for a caravan | Tailor `1a684:Skyrim.esm` | Master Liverywright half | 3 Ragged Robes, 3 Snowy Sabre Fur Cloaks | 48 hours |
| A ward tutor's demonstration stock | Enchanter `1a672:Skyrim.esm` | Master Alteration standing and at least one learned, mapped Master Alteration spell | 2 Ebony Shields, 2 Ragged Robes | 48 hours |
| A mammoth supper for the hall | Cook `1a66e:Skyrim.esm` | Master Hearthcook half | 2 Mammoth Steaks, 2 Mammoth Stews | 48 hours |
| Remedies for the ash-road expedition | Alchemist `1a66d:Skyrim.esm` | Master Physicker half | 2 Physicker's Remedies, 4 Ash Creep Clusters | 48 hours |
| A field medic's travelling case | Alchemist `1a66d:Skyrim.esm` | Expert Physicker half | 2 Physicker's Remedies, 4 Nirnroots | 24 hours |
| Clothes for the commission rack | Enchanter `1a672:Skyrim.esm` | Novice Wardweaver half | 1 Clothes, 1 Shoes | 6 hours |

Payment is the sum of each required count times that item's submitted buy
price in Whiterun. No number is invented when a price is missing or ambiguous;
that offer explains why it cannot be accepted. Zero submitted prices remain
valid. Other shelf stock remains for sale. Acceptance sets aside the whole
sum from the finite purse, and a partial parcel transfers nothing. Original
payments and per-job rest periods survive price/rank changes and restart.
The rest begins when the final ledger settlement succeeds.

Ebony and ash supplies are Master producer sources; Nirnroot is Expert.
The pole and arrows are two Master batches. The Tailor order is six
production batches including three Expert cloaks, rather than an invented
Master clothing recipe. The shield order includes two Master batches.
Recipe conditions such as smithing perks, cooking knowledge and loom settings
remain exactly as authored. These are delivery orders, so goods from other
craftspeople qualify; the quest does not bypass those conditions, promise
unenchanted blanks, or create resources. Gatherer and Miner source references
identify existing producer evidence, not a requirement to use one particular
plant or seam.

Only a new bundle reservation changes the private commission map to version 2.
Existing single-good promises and numeric six-hour cooldowns remain readable
without changing their bytes. Bundle promises retain every quoted item and
their 6/12/24/48-hour cadence; their cooldown stores its own cadence. Pending
transfer version 4 remains compatible with earlier full and compact records.
Rolling back to old code while any version 2 map exists requires disposing
of the disposable alpha work with the instance stopped. No automatic reset,
refill or migration runs.

### First ten Novice deliveries

The five profession deliveries require the named Novice half. Five additional
deliveries require a Novice class, independently of crafting profession.
All ten have a six-hour cooldown after the trade settles. Each row copies its complete offering roster identity
and either its selected public recipe's owner, half, rank, output, amount,
bench, inputs and conditions, or its canonical Gatherer harvest evidence.
Their goods already belong to that trade's ordinary
buy table. That does not grant legacy supply or commission permission.

| Work | Offering reference and trade | Required half | Delivery | Recipe reference |
| --- | --- | --- | --- | --- |
| Straps for the forge | Whiterun Smith `1a67c:Skyrim.esm` | Platewright | 6 Leather `db5d2:Skyrim.esm` | `1033de:Skyrim.esm` |
| Arrows for the hunt | Rift Woodworker `19dd0:Skyrim.esm` | Woodwright | 24 Iron Arrows `1397d:Skyrim.esm` | `b64f:Dawnguard.esm` |
| Thread for mourning cloth | Falkreath Tailor `1939ba:aaaGraniteHill.esp` | Haberdasher | 4 Thread `6ce001:Update.esm` | `84a:MoreCraftableEquipment.esp` |
| A supper for the docks | Haafingar Cook `198a0:Skyrim.esm` | Hearthcook | 2 Salmon Steak `64b3b:Skyrim.esm` | `f4310:Skyrim.esm` |
| Poultices for the marsh road | Hjaalmarch Alchemist `1aa61:Skyrim.esm` | Physicker | 2 Poultice `154c2:Thornswood-Content.esp` | `154c6:Thornswood-Content.esp` |

These five class offers are additional work at the same merchants. A class
has no profession half. Delivering goods from another craftsperson is valid;
the customer need not be a Smith, Woodworker, Tailor or Cook.

| Work | Offering reference and trade | Required class | Delivery | Recipe reference |
| --- | --- | --- | --- | --- |
| A spare pick for the mine | Whiterun Smith `1a67c:Skyrim.esm` | Novice Miner | 1 Pickaxe `e3c16:Skyrim.esm` | `1548d:Thornswood-Content.esp` |
| A spare pole for the lake | Rift Woodworker `19dd0:Skyrim.esm` | Novice Fisher | 1 Crude Fishing Pole `15498:Thornswood-Content.esp` | `1549c:Thornswood-Content.esp` |
| Boots for the trail | Falkreath Tailor `1939ba:aaaGraniteHill.esp` | Novice Hunter | 1 Boots `d1921:Skyrim.esm` | `928:MoreCraftableEquipment.esp` |
| Soup for the field hands | Haafingar Cook `198a0:Skyrim.esm` | Novice Farmer | 2 Potato Soup `353d:HearthFires.esm` | `3542:HearthFires.esm` |
| Cotton for marsh-road dressings | Hjaalmarch Alchemist `1aa61:Skyrim.esm` | Novice Gatherer | 3 Tundra Cotton `3f7f8:Skyrim.esm` | Harvest `bb947:Skyrim.esm`, no crafting recipe |

The source checker preserves these five exact merchant/class allocations.
Recipe ownership and buy permission still belong to the merchant's trade.
For profession deliveries the named half must still match the recipe.
The class allocation is separate from the exact authored goods in the JSON;
the compiler derives commission authority from that reviewed
catalogue, never from every item that could pass a source check. All five
planned class-Novice slots now have playable definitions. The completed catalogue also supplies the second distinct quest for each class, Master work and every merchant/rank slot.

The pickaxe recipe makes one from one Iron Ingot and one Tool Handle. The
pole makes one from two Firewood, one Leather Strips and two Tundra Cotton.
The boots make one from one Leather and one Thread. Potato Soup makes one
from one Salt Pile, one Potato and one Leek; two bowls need two batches.
Their complete copied recipe proof retains the owning half, bench and
Novice input supply provenance. The boots use a vanilla output, without
adding any permission-held armor assets or changing creation equipment.

Cotton's proof copies the produce, name and Novice rank from the canonical
Gatherer `harvests` table in `game/data/harvests.json`. Its source is
`TreeFloraTundraCotton01`, a `TREE` record, not a crafting recipe. Only a
Gatherer-gated delivery may use this proof type; crop, fish, game, detail or
unranked records do not substitute for a canonical harvest entry. The
requested item must match its produce and the Alchemist's buy permission.
This is a delivery from any legitimate supplier, with no particular harvest
event required. It adds no plant, stock, yield, coordinates or return rate
and does not claim cotton is newly placed in Hjaalmarch or currently ready
to harvest. Only its explicit published quest grants this delivery authority.

Leather's selected recipe produces two from one Novice Deer Hide. Iron
Arrows produce 24 from one Firewood and one Iron Ingot. Thread produces one
from two Tundra Cotton. Salmon Steak produces one from one Salt Pile and one
Salmon Meat. Poultice produces one from one Tundra Cotton and one Garlic.
Every listed input has Novice supply provenance in the public recipe table.
These producer facts do not add placed resources or alter shared stock and
returns. Current ingredient availability and accepted price are not measured.

The copied recipe conditions matter. Leather requires at least one
`DeerHide02`. Salmon Steak requires at least one `MAG_FoodSalmon` and no
`MAG_FoodUpgradePerk03`. Their `canBeMadeOnDayOne:false` flag does not mean
their ingredients have no Novice producer. It also does not prove every
qualified customer can personally run that recipe. No condition or rank is
changed for these offers. Potato Soup also retains its requirement for
`MAG_RecipePerkPotatoSoup` and exclusion of `MAG_FoodUpgradePerk03`. Novice
Farmer standing alone does not establish those recipe conditions; this is
a delivery request and does not require personal crafting.

Commission payment is the accepted submitted hold price multiplied
by the original quantity, from the merchant's finite purse. No default price,
fixed bonus or new gold is granted here. Missing price, unsupported goods or
insufficient unreserved purse must explain why new acceptance is refused.
Customers need not own the goods when accepting work. Existing and traded
goods are valid; acceptance does not claim they were freshly crafted or harvested.
The transaction reserves the promised purse amount and preserves the accepted quote
through its exact conserved pending-transfer protocol. At delivery, missing
matching inventory refuses completion while keeping the work and its purse
reservation. A changed current price or lack of other spendable purse money
must not invalidate that accepted promise. Ordinary stock for sale remains
visible. The panel shows promised purse money separately; ordinary purchases
and supplies use only the remainder. A submitted zero price remains valid;
there is no invented fallback price or reward bonus.

Authored commissions have an explicit source-derived authority keyed by
their exact reviewed quest and merchant, plus their own conserved transfer
kind, cooldown persistence and recovery. Several finished goods are absent
from ordinary supply. This does not widen that table, treat all buy goods as approved
commissions or pass these rows as legacy supply. Its existing five-good and
six-hour dynamic rules remain intact. The scene reward allowance does not
apply to these transfers of existing purse gold.

## Reward and activation limits

One finish of each scene candidate creates **100 gold**. Their cooldowns alone permit
at most **400 gold** in a half-open 24-hour window if all four could be completed
by one character. This is an arithmetic upper bound before eligibility,
travel, target availability and competition, not an approved aggregate
economy budget or measured income. These scene rewards are
created at completion, like legacy scene rewards; they are not supply
purchases from a finite purse. The bundled scene-accounting
reserves rewards within 150 gold per character per rolling 24 hours.
That additional limit is not a reason
to call the 400-gold cooldown bound actual earnings or an account/world cap.
The ten commissions transfer existing purse
money at their accepted submitted prices, which are not invented or
included as newly created gold in that bound.

Further definitions need their own source evidence, reward/cadence review,
bounded state, exact bindings and explicit pinned admission. Two remaining scarce-resource interactions and seven retrieval interactions are unfinished; aggregate authoring flags remain false. Existing
accepted quests keep their original terms. Editing a draft or changing the
aggregate flags does not enable another quest. Published definitions use
stable hashes and IDs; changing an objective or reward needs a new ID.

## Commission persistence and admission

The private merchant ledger owns each original promise and its monotonic
action token. A character may hold three commissions across the complete
merchant namespace, including retired identities. Each merchant admits at
most 100 promises and 1024 combined promises and active cooldowns, reserving
space for each accepted job's later cooldown. Expired cooldowns may be pruned;
active ones and accepted promises are never evicted for capacity. This is
separate from the three-open-scene limit and scene mint allowance.

Acceptance and abandonment use a guarded ledger revision compare-and-set.
The namespace writer lock stays held across native identity callbacks, the
last current-conversation/character/rank/quote/count check and synchronous
private write. A stale button cannot release a newer promise. Abandonment
removes one authenticated owner's token without payment, preserving other
jobs, cooldowns and the serial. Malformed state refuses changes instead of
recreating a purse or dropping payment evidence.

Commission-bearing transfers use an explicit version 4 pending format.
Normal trades retain the promises; a commission transfer removes exactly
its original quantity, conserves each inventory entry's metadata in merchant
stock, transfers its reserved gold and releases its promise. Full and compact
recovery bind the original terms. Previous version 2/3 pending formats retain
their exact snapshot and digest representation, tested against serialized
pre-change full and compact fixtures.

Each job's cooldown starts at successful final NPC-ledger settlement,
after the exact final native inventory receipt has reached storage. If a
crash delays reconciliation, the job remains pending until settlement and
then begins its full original rest period. This is not the native receipt's timestamp, which
the current protocol does not preserve. Reconnecting does not move an already
committed cooldown. Pending saves, missing goods and native inventory/stock
capacity refusals preserve the accepted job and its original payment.

The hundred commissions add no actor, spawn, harvest, purse refill, new currency
or character inventory grant. Native inventory, pending-record and private
ledger byte limits remain in force. No alpha reset is required for this slice.

`node game/tests/test-merchant-quest-catalogue.js` checks actual rulebook gates,
exact merchant and retained-target bindings, distinct objectives, source
positions and returns, exact commission recipe/harvest/gate/role evidence, distinct
goods bundles and the explicit activation boundary. It does not construct a server,
touch a private world or establish connected acceptance. Operational steps
follow only after their source prerequisites are complete.

## Runtime admission and recovery

The four published scene IDs and their full authored hashes are pinned in
`merchant-quest-activation.json`. Published definitions are immutable; new
deeds or rewards need new IDs while the old definitions remain available
for accepted work. These are the four scene IDs admitted to the hot-reload bundle;
the hundred commissions have their separate permanent publication contract above.

At acceptance, the server reserves the original reward in the same character
property transaction as its objective and copied terms. At completion,
verified kills, that reservation, gold and the cooldown change in one native
inventory/property transaction. A failed write changes none of them. The
rolling 24-hour allowance is 150 gold per character across all newly admitted
scenes, counting paid gold plus every outstanding reservation. Holds do not
expire. A delayed payout is dated when it succeeds, never when it was reserved.
This is not an account or world cap and does not include legacy scene rewards.

Abandoning well-formed saved payment evidence removes only that current
job's own liability, without payment or a completion cooldown. It can also
reconcile copied terms or progress that no longer match, including an orphan
reservation, without releasing a different job's token or removing payout
history. Structurally corrupt payment evidence refuses changes and needs
trusted staff recovery; it is never erased or rebuilt by a retry.

There are at most three open expanded combat jobs. This first runtime section has
20 owned target references in total, including the 14 legacy references. The
complete representative character property with three original-term jobs,
all 20 maximum-generation histories, 23 legacy cooldowns, the largest valid
remaining paid list and 1024 retained unknown bytes is 3523 UTF-8 bytes. Native
property capacity remains 16384 bytes. Oversized existing records refuse new
acceptance without deleting unknown or legacy fields. This is a source and
synthetic transaction measurement, not a connected playtest.

The [crimson work](merchant-crimson-work.md) now connects its eight existing Blackreach plants to the Winterhold Alchemist, using the original Gatherer rules, shared ten-minute returns, ask 3/cap 8 and 12-hour personal rest. No orchard planting or cultivation mechanics are included. Source activation still requires a release.

The [geode work](merchant-geode-work.md) connects six existing Blackreach deposits, requiring Enchanter standing and yielding empty petty soul gems. Its ask 2/cap 6 and 12-hour personal rest follow the original table; selected sources share a documented thirty-minute return. Source implementation is not a deployment record.

[Longfin work](merchant-longfin-work.md) now has its dedicated sea-marker interaction, Master Fisher/pole gates and exclusive Haafingar Alchemist offer. Its shared four-hour wait and bounded personal draw create no gold or purse refill. It is live only once the matching Content and runtime are released.
