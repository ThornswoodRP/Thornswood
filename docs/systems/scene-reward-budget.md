# Expanded scene reward accounting

`game/scene-reward-budget.js` projects the accounting record used by the
four explicitly admitted merchant kill scenes. It is bundled with the quest
controller. The pure helper writes no state and grants no gold; only the
controller's fenced native actor transaction can commit either. Existing
legacy quests and accepted terms remain outside this allowance. The complete
merchant catalogue and account/world economy assessment remain unfinished.

The allowance is 150 gold per character in a half-open rolling 24-hour window,
shared by all newly admitted scenes. It is not an account or world cap. At acceptance, reserve the original reward of
10 through 150 gold. Recent payouts plus all outstanding reservations cannot
exceed 150. There can be at most three held scenes. Reservations never expire;
completion moves their original amount into payout history, while cancellation
releases it without payment. The quest controller saves personal cooldowns alongside the completion.

The record is `{v:1,clock,serial,held,paid}`. Each held ID maps to
`{gold,at,token}`. The counter never resets when reservations empty, and both
completion and cancellation require the exact reservation token. An old
request cannot consume a newer reservation under the same quest ID. Paid
entries are ordered `[timestamp,gold]` pairs. Their minimum amount limits an
active window to 15 entries. Only expired entries owned by this accounting
record are removed in a successful projection; no legacy fields or kill
history enter this module.

| Operation | Successful result | Required caller work |
| --- | --- | --- |
| `reserve(state,id,gold,now)` | Detached `next` and new `token` | Validate the offer and original terms; atomically save acceptance and reservation |
| `complete(state,id,token,now)` | Detached `next` and original `gold` | Prove the objective and atomically save completion, accounting and that inventory reward |
| `cancel(state,id,token,now)` | Detached `next` and zero `gold` | Apply original cancellation rules and atomically release the reservation |
| `inspect(state,now)` | Paid, reserved and available gold, plus open count | Display only after the current ownership and conversation checks |

Every refusal returns `{ok:false,why}` without changing its inputs. Missing
state starts an empty budget; present null, unknown fields/versions, malformed
or inherited evidence and accessors refuse. Timestamps and counters must be
safe integers. Time cannot move backward. Saved accounting must be consistent
at its saved clock before expiry is considered. Payouts exactly 24 hours old
are outside the window. Successful outputs are detached from their inputs.

The controller preserves unknown quest fields and keeps accounting,
accepted original terms, progress and any inventory change in the same actor
property transaction. Two projections from one snapshot are alternatives;
the existing native expected-record CAS must admit only one. A projection
does not establish ownership, eligibility, objective completion, durability
or authority to pay. Never write it separately or infer a committed reward
from a lost reply. Existing legacy work is not retroactively charged.

`node game/tests/test-scene-reward-budget.js` exercises arithmetic, boundaries,
tokens, corruption and small operation sequences. The synthetic transaction
fixture in `node game/tests/test-quest-transactions.js` carries the budget
through the real JavaScript adapter with modeled native comparisons, including
competing reservations, an inventory refusal and a stale repeated payout.
These are source tests, not a game/server or connected acceptance test.
The production-controller fixture in `node game/tests/test-merchant-expanded-scenes.js`
checks all four objectives, gates, original terms, allowance, cancellation and
recovery, competing writes and full-property capacity. Dev delivery can follow
once this playable section passes CI and merges; the complete catalogue need
not finish before that delivery.
