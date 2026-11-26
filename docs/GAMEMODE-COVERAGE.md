# Gamemode coverage map

Which test in tests/ drives each event handler in game/gamemode.js, each
plugin in game/plugins/, and the chat words. Made 10 October 2026 by
grepping tests/*.js for each name, then reading the closest test.

## Event handlers

| Handler | Line (at ba910a3) | Tests that drive it |
|---|---|---|
| mp.onDying | 5780 | test-audit-handlers, stand-in-server |
| mp.onDeath | 5793 | test-audit-handlers, test-1383-injury, test-1385-perks, test-1386-warrior, test-1831-dead-waits, test-join-pass-trust, and 3 more |
| mp.onRespawn | 5984 | test-npc-death-policy (drives it), test-audit-handlers, test-1383-injury |
| mp.onActivate | 8299 | 15 files: test-audit-handlers, test-1603-beds, test-1733-injury-gate, test-1909-own-worlds, test-626-tundra-cotton, and more |
| mp.onCraftWork | 11285 | test-audit-handlers |
| mp.onCraft | 27679 | 12 files: test-1389-lists, test-1390-embassy, test-1398-fuel, test-1400-smith-tan, test-1676-rest-gate, and more. Left alone in this sweep: #1648 lands here |
| mp.onThornswoodLogin | 15006 | test-join-pass-game, stand-in-server |
| mp.onSpellCast | 39424 | test-audit-handlers |
| mp.onUpdateEquipmentAttempt | 46859 | test-1387-college (drives it), test-audit-handlers |
| mp.onEquipItemAttempt | 47315 | test-audit-handlers |
| mp.onReadBook | 47249 | test-spell-tomes, test-1127-unplaceable-tomes, test-1149-pick-spell-tome, test-enchanter-staff-spells, test-audit-handlers, test-join-pass-trust |
| mp.onPutItem | 51231 | test-2298-box-retired (drives it: no container has a rule since #2298, only the join pass refuses), test-coffers, test-join-pass-trust |
| mp.onTakeItem | 51522 | test-take-limit (drives it), test-audit-handlers, test-join-pass-trust |
| mp.onDropItem | 51536 | test-audit-handlers, test-1384-condition, test-join-pass-trust |
| mp.onUpdateAppearanceAttempt | 51634 | test-body-shape, test-unpublished-until-appearance, test-audit-handlers, test-join-pass-trust |
| mp.onEatItem | 56553 | test-1383-injury (drives swallowed()), test-audit-handlers |

Every handler has at least one test that runs it, not just a test that
checks its source text.

## The plugins

| Plugin | Test files |
|---|---|
| thornswood-front.js | 81 files, starting with test-1033-pulse-cost and test-1157-session-ends |
| thornswood-voice.js | 24 files, starting with test-1304-voice-tls-only and test-1869-voice-negotiation |
| thornswood-emotes.js | 14 files, starting with test-1918-emote-cap-close and test-bard-instruments |
| thornswood-mark.js | 6 files: test-arrivals, test-creation-close, test-mold-key, test-thornswood-keys, test-whose-game-gate, test-1633-help-panel |

## Money

| Function | Tests |
|---|---|
| deposit | test-deposit, test-1393-company, test-1394-fares |
| mayWithdraw, withdraw, heldOn, noticeHolds | test-1393-company, test-one-mint |
| payout, payHeld | test-one-mint |
| boxPutGold (paying rent through the drop box) | test-2298-dropbox |

## Chat words

Of the 91 words handle() and the blocks answer, 89 were already in some
test. These two were not:

- /shutdown: no test ever sent it. Only /restart showed up, and only in
  lists of words. Now covered by test-chat-refusals: an admin and playtester
  typing /restart or /shutdown, in any case and with or without trailing
  words, gets the refusal sentence, the refusal is logged, and no restart
  file is written.
- /deeds: now covered by test-chat-refusals, which checks it gives the same
  answer as /deed.

test-chat-refusals also checks that /give and /spawn are refused for
somebody on no list even with an admin online, that the uppercase word gets
the same refusal, and that an unproven line under the join pass places
nothing.

## Left out on purpose

- The durability block (#1384), which belongs to Anvil.
- mp.onCraft, where Anvil's 9ce36701 (#1648) lands.

## Fixed along the way

- A gated word (/give, /spawn, /tp, /goto, /where and the staff words) from
  somebody on no list whose character was not in the world yet was held with
  "That will run as soon as you arrive" and refused 90 seconds later.
  dispatch() now hands it to handle() at once, so the refusal comes first.
  A listed tester is still held as before. test-chat-refusals failed 7 of 35
  before the change and passes all 35 after.
