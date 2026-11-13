# Six trades in each hold

Patrick's requirements of 12 October 2026 replace the earlier unrestricted
trader count and locked quest lineup. This is the implementation contract;
it does not describe a completed release.

## Roster and tables

Patrick clarified during alpha testing that current merchant purses, stock
and pending trades are disposable. Preserving that test economy is not a
prerequisite for the sixty-merchant cut. Any one-time reset belongs to
a stopped-server rollout, never to recurring startup or a timed repair.

Deliver usable sections before the whole quest catalogue is complete. The
first runtime section assigns the selected sixty merchants their role names,
item tables and matching legacy quest offers. The next section applies the
sixty-only roster to the population generator and the matching last plugin.
It requires a coordinated content/client/server release. Empty alpha
merchant records initialize through ordinary first use, once per retained
merchant; no pre-funding or reset is required. If old pending test work blocks
admission, the explicit reset-data tool is available. Neither
section adds expanded quests. New offers
still need their own objective, eligibility and transaction checks.

Each of the ten existing book holds, including Raven Rock, has exactly six
guild NPCs: Smith, Woodworker, Tailor, Enchanter, Cook and Alchemist. There
is one of each, for 60 total. Reuse suitable authored identities. Exact
guild relocation remains separate. All other guild traders are retired.

Each role has an explicit item table, checked by the server for purchases,
sales and supply work. Hold price books remain the price authority; a role
table is permission to trade an item, not permission to invent a price.
Different roles have different tables. Stock stays finite and consists of
goods bought; purses remain finite. The alpha economy is disposable under Patrick's current instruction. Retirement does not require a migration or a second starting grant. Existing recovery checks remain in place.

The controller accepts server-compiled native item IDs for each role's buy,
sell and supply permissions. A declared role without verified tables refuses
setup. It copies permissions and reference bindings before interaction, so
later configuration edits cannot change an open controller's authority.
Both the panel and submitted actions check the actual resolved item ID;
stock must also match that ID, rather than its name alone. Supply permission
is separate from ordinary buying. Saved transfers recover their original
terms even if their goods are outside a later role's table. Startup binds the
sixty retained references to their verified role tables and display titles
before constructing a private writer or admitting interactions.

The panel has separate selling and buying sections. Selling shows only
carried items this merchant can buy at its submitted price, within its
current purse. A failed condition gives a clear reason and no sale rows.
Buying still shows stocked goods offered for sale even when the merchant
cannot buy anything. Quantity controls use the same authenticated settlement
and receipt checks as the existing transfer. A displayed quote never
authorizes a stale or forged request.

## Item catalogue and runtime admission

`game/data/merchant-role-tables.json` records the six distinct static item
tables and the source evidence behind each identity. Its authoring metadata
remains inactive; explicit startup admission validates the roster and winning
native records before compiling these permissions for the sixty merchants.
These are permissions, not starting stock or new gold, and a submitted hold
price is still required before an item can be traded.

| Trade | Buy identities | Sell identities | Supply identities |
| --- | ---: | ---: | ---: |
| Smith | 265 | 265 | 40 |
| Woodworker | 54 | 54 | 16 |
| Tailor | 269 | 269 | 23 |
| Enchanter | 406 | 406 | 16 |
| Cook | 116 | 116 | 53 |
| Alchemist | 70 | 70 | 68 |

Public work supplies its owning trade's outputs and ingredients. Crafting
fees never become goods. A cut duplicate smelt does not remove the ingot
made by the kept smelt; tempering does not establish a new source. Faction
rolls, removed goods, nonplayable equipment and currency are excluded.
The explicitly retained playable Riekling company goods stay with their
owning trade. Wardweaver bases use the same public wearable policy.
Enchanters also handle the measured ordinary soul gems. Existing enchanted
item metadata remains part of the original goods, without a new price bonus.

Alchemists accept verified ingredient records from plants, hunting, crops,
fish and dedicated stations, including eggs, honeycomb and salts, alongside
their medicine recipes. Additional Cook resource goods require verified
food records; its public authored outputs and ingredients, including
cooking materials such as fire paste, retain their owning trade. Unranked sources
are not imported wholesale, and potion-name text does not classify a good.
This static catalogue does not implement trading custom brews.

`python scripts/dev/Build-MerchantRoleTables.py` generates source data from
the recorded load order and repository-owned plugins. It never writes game
files or ledger state. `--check` rederives the lists without an installed
game, checks input source hashes and plugin pins, and reads repository-owned
item records to verify their winning identity, type, flags and food status.
An unrelated own-plugin art or quest edit does not change item permission;
a contributing record change requires regenerated evidence. CI runs the
derivation and source-evidence regressions before its broader harnesses.

## Quests

Every NPC has Novice, Advanced, Expert and Master work. Both the trade and
the hold select the quests: Whiterun's Smith and Riften's Smith must differ
in objectives, locations and text, not just their displayed hold name.
Additional quests are authorized. Difficulty and rewards increase with
tier; every row records exact objectives, rewards and cooldowns before it
is enabled. Scarce resource limits and ordinary tool/rank gates still apply.

Across the catalogue, every profession and every class has at least two
distinct quests that explicitly require it. Higher rank satisfies a lower
rank gate. Each profession half has at least one Master quest requiring
mastery in that named half. Class Master work requires Master rank in that
class and no profession half. Mage Master work requires at least one known
Master spell of the named school, not merely a school selection or a tome
in the pack. Each of the five schools has such work.

The coverage check enumerates Warrior, Mage, Alchemist, Cook, Smith,
Enchanter, Tailor and Woodworker; Hunter, Fisher, Gatherer, Miner and Farmer;
all fourteen non-Mage halves; and all five magic schools. A cosmetic text
label does not count as a server gate. Quest eligibility and quest ownership
are separate: changing a rank, merchant or session cannot duplicate a
reward, erase old work or allow a different trader to take its turn-in.

Supply still moves goods at the submitted price from a finite NPC purse.
Scene work pays its authored reward once through the quest transaction.
New reward totals and repeat cadence must be checked against the economy;
adding many offers must not create an uncapped new daily gold faucet.

## Existing accepted work

The ten currently bound contracts have retained-trade routes before any old
trader is retired. Their existing quantities, rewards and cooldowns stay saved;
these routes do not add new tiers or enable the thirteen unbound contracts.

| Legacy work | Retained trade | Hold rule |
| --- | --- | --- |
| Ebony, stalhrim, heart stone | Smith | Existing any-hold mine return |
| Gem | Enchanter | Existing any-hold mine return |
| Wolf | Tailor | Whiterun |
| Sabre cat | Tailor | Eastmarch |
| Bear | Tailor | the Rift |
| Camp, giant | Smith | Whiterun |
| Barrow | Smith | Falkreath |

The panel and submitted quest actions use the same role routes. Direct live
quest calls also require a captured trader conversation. Its ownership check
travels through the quest commit and is checked after native lookups, immediately
before changing the character. Closing or replacing that conversation refuses
the old action. This check is kept only in the working request, never saved on
the character. Existing actor identities and inventory receipts remain fenced
by the native transaction. The current roleless roster keeps its earlier offers
until the six-trade roster and its item tables are explicitly activated together.

Quest rank checks read the saved character record without initializing or
migrating it. A missing, unreadable or malformed record refuses eligibility;
opening an offer cannot replace progression after a failed read. Only a valid
saved rank qualifies. Existing character initialization owns migration. This
does not enable the expanded profession, half and school quest catalogue.

`game/quest-eligibility.js` supplies the shared eligibility contract.
`createQuestEligibility({table, spellIds})` captures the canonical progression
`TABLE` and `SPELL_IDS`; it does not read or write a character. `validate(gate)`
returns a copied, frozen definition or throws. Gates are exactly `{open:true}`,
`{classKey,rank}`, or `{profession,rank,half?,school?}`. Unknown, mixed or
inherited fields cannot grant work. Master profession work names its owning
half, or a school for Mage. Master class work has no half.

`allows(gate,state)` returns a boolean from a saved version 1 character snapshot.
The chosen class/profession and canonical standing must match. An earned sister
half counts, while a taught outside trade is not a chosen profession. Mage
Master work additionally requires an exactly named, mapped rulebook Master
spell in the learned book for the named selected school. Staff permissions,
tomes, lower spells and unknown metadata do not count. No migration, repair,
spell grant or input mutation occurs. The source bundler embeds the module;
the custom quest controller validates each definition before it starts. The
existing scarce work has explicit gates, and legacy scenes are explicitly
open. Both scarce and kill offers and acceptance use the same evaluator over
non-migrating character reads fenced by the original owner and controller.

Acceptance revalidates at the transaction's final admission boundary. Caller
callbacks run first, then the character snapshot is the last native read.
Only callback-free service flags, pure evaluation and the captured session
check follow it. The native CAS owns the final body/record fence. This prevents
an identity callback from invalidating standing after it was checked, or a
panel closed during a read from authorizing work. Scarce harvesting also keeps
its existing class-rank gate at the final inventory write.
Turn-in, cancellation and kill credit preserve accepted work without rechecking
eligibility. No new quest, unbound objective, roster cut or reward is enabled.

## Build order and checks

| Part | Responsibility | Requires |
| --- | --- | --- |
| merchant-panel | Separate eligible pack sales and stocked shelf purchases | Existing settlement |
| merchant-history | Separate historical purse identities from active interaction references | Existing private ledger and receipt recovery |
| merchant-roster | Six identities per hold and safe retirement of others | Ledger migration checks |
| merchant-tables | Explicit role item permissions on every server path | Roster |
| merchant-quests | Hold/role/tier objectives, gates and economy limits | Tables and native quest transactions |

First reproduce and fix the item-offer UI with server fixtures and a local
browser fixture. Then validate the roster and ledger migration before
cutting identities. Add table checks to view and command paths together.
The purse controller accepts an explicit `merchantHistory` manifest of
reference/base pairs for retirement recovery. A retired identity cannot be
prepared for interaction or receive a starting purse; its existing pending
transfer can finish against the private ledger without loading its NPC.
The purse controller has one writer per ledger namespace within the server
runtime. Replacing it revokes the old controller across all merchants. A
synchronous mutation locks the namespace through its durable save and
native projection; nested mutation or replacement is refused explicitly.
Each commit starts from the controller's latest document, so another
merchant's saved change survives an older prepared offer.
Before recovery, trade admission, supply-history cleanup or another inventory
writer proceeds, settlement checks the whole pending list. Merchant references,
transaction identities, humans and receipts must be exclusive; each saved intent
must match its world, merchant and current debit or credit state. An invalid
list stops settlement without deleting records or changing inventory, including
malformed non-null intents. Runtime human descriptions use the native local
hexadecimal form; numeric aliases share the same reservation. Debit recovery
checks the original preceding receipt as well as the debit and final receipts.
Legacy intents without a supply map compare as an empty map throughout recovery;
invalid maps are rejected. Recovery applies only merchant snapshot fields,
preserving unrelated saved state.
Full saved trade snapshots must conserve goods, gold, stock labels and item
metadata using their original terms. Zero-price transfers remain valid. New
intents retain fixed-size terms and inventory digests through compaction,
including the original cooldown-history digest. Compact records validate
their retained supply transition before recovery or retirement readiness,
within the same initial and recovery size limits. Recovery attempts must add
exactly the saved credit to their expected inventory. Supply keys bind to the
human and the outer item label, separate from the native item's name.
Legacy intents gain no new summary bytes. Full legacy snapshots are checked
where available; genuine old compact credit keeps its bounded receipt-based
recovery because its discarded original deltas cannot be reconstructed.
The settlement canRetire readiness check refuses any remaining legacy pending
intent without retained terms. This readiness check still needs integration
with the explicit roster activation step before a cut; no population change
is included here. Unresolved legacy transfers retain their records and block
activation rather than being reset or reissued.
New intents use format 3 and require their retained terms; format 2 identifies
genuine pre-summary legacy work. Dropping terms cannot downgrade a new record.
Legacy array cooldown keys still require a nonempty item label; original
item-only legacy keys keep their compatible saved meaning.
Without an explicit history manifest, the current active roster remains the
manifest. The sixty-merchant roster keeps all 249 historical identities while
retiring 189 extras. Writer ownership and pending-intent checks remain.
Existing-world admission refuses null or missing retained purses before any
initial grant. The explicit alpha roster permits empty retained entries to
follow ordinary one-time first-use initialization; it neither resets a saved
purse nor grants anything to retired identities. Missing ledger entries or
initialization evidence still refuse. A genuinely new world still requires
explicit initialization; an alpha population cut is not a new world.
Merchant runtime startup requires its existing private ledger and initialization
marker. Missing evidence stops service without creating a fresh manifest or
resetting purses. It checks again before durable writer dispatch, after privacy
checks and serialization. Recover missing existing-world evidence from its
original records; do not treat a restart or repair as new-world authorization.
The explicit offline initializer remains a prerequisite for a genuinely new world. Existing
native replacement of a known valid document and dungeon-ledger initialization
keep their existing behavior.

NPC startup now constructs trading, population policy and shared activity
in suspended mode. Property registration and initial timer registration
finish before the native exclusion commit is attempted. The trading service
cannot interact or recover while suspended, and a required retirement gate
cannot be bypassed by omitting the suspension option. Genuine legacy work
still recovers under its compatible source before a retirement that it blocks.
The alpha reset-data generator is available to discard such test
work during a stopped-server maintenance step, as Patrick authorized.

A failed constructor cancels its owned timers and reaches startup cleanup.
Each startup owns its local controllers; an older callback cannot stop or
clear a replacement. Population exclusions have one commit attempt. An
uncertain native result revokes that policy instead of retrying it. Failure
after the commit attempt stops the new services; it does not claim to undo
native exclusions or durable receipt work.

Native callbacks, including navigation reads, check that their runtime is
still active before and after calling the engine. Teardown snapshots old
controller identities before callbacks run, attempts all owned cancellations
and service shutdowns, and refuses new startup after a teardown error or an
unexpected replacement. A failing cancellation leaves its callback revoked.
Trading closes before timer cancellation can call back or throw. A reentrant
startup still finishes every captured old service without clearing its
successor. Population and purse preparation check the calling runtime too,
including native lookups, returns and the durable initialization boundary.
Cancelling that caller alone leaves the shared services available to others;
an uncertain durable write retains the existing writer revocation rule.

`game/data/merchant-roster.json` records the 60 role bindings and all 249
historical identities. The production generator checks every binding before
changing any source row, then emits exactly 60 traders, descriptive titles,
history, counts and location tables. The matching last plugin disables the 189
extra traders at the record. Matching client/server content must ship
together with strict client admission; a gamemode-only change and
server exclusions cannot suppress native client copies deterministically.
Implement quests in complete, source-bound slices with coverage checks for
all trades, holds, tiers, classes, professions, halves and schools. No accepted alpha work needs migration; existing recovery paths remain available without becoming a rollout prerequisite.

A full saved trade must fit the remaining pack together with its incoming
goods, using the same native size and count limits as a new trade. Checking
the two inventories separately is insufficient. Validation does not rewrite
the record; compact credit records keep their existing recovery checks.

`game/merchant-roster-admission.js` provides read-only ledger inspection.
It accepts copied ledger, marker and roster bytes, the original world identity,
and trusted isolated native record and inventory validators. It checks the
complete historical manifest, retained purses, stocks and pending transfers,
then returns counts and hashes without exposing private rows or paths. The
record resolver must verify each winning placement and its base; decoding a
form descriptor alone is insufficient. Unit fixtures are not operational proof.

This component performs no file or server operation and cannot authorize a cut.
A future caller still needs private-file and alias checks, a stopped world and
completed saves, native build and load-order binding, a fresh hash check,
coordinated plugin delivery and strict client admission. The component is not
imported into startup and does not itself change the roster or initialize
new ledger state. It remains an optional existing-world evidence inspector,
not a prerequisite to preserving disposable alpha merchant records. `node game/tests/test-merchant-ledger-inspection.js` checks it.

`game/merchant-ledger-native.js` binds an already isolated native reader to
that inspection interface. It checks each winning actor placement and its
NPC base, translating record-local IDs through the owning plugin's mapping.
Light-plugin IDs must fit their local width; masked aliases are refused.
It also uses the native inventory validator. The adapter creates no server,
loads no actors and supplies no cut authorization or population-policy check.
Interface fixtures in `game/tests/test-merchant-ledger-native.js` cover full and
light plugins and overridden records; compiled native acceptance is separate.

Local checks include `node game/tests/test-merchant-trading.js`,
`node game/tests/test-merchant-settlement.js`,
`node game/tests/test-merchant-pending-preflight.js`,
`node game/tests/test-merchant-conservation.js`,
`node game/tests/test-merchant-deployment.js` and
`node scripts/dev/Build-MerchantGamemode.js --check`.
These source changes include no game playtests or operational steps. Changes
merge only after the required exact-head Launcher builds gate, and no change
is described as live before its release.
