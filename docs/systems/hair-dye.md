# Hair dye

Issue #2675. A dye is made at a cooking spot from things people already
gather, and it changes the colour of somebody's hair in the world. Nobody's
hair changes without their own press. The colours, what makes them and who
may make them are the staff's list, `game/data/hair-dyes.json`; the code
names none of it. Making a dye is a tailor's job (Patrick, 18 October);
using one is anybody's.

## What a dye does

- **Who makes one.** A Tailor, either half, Haberdasher or Liverywright,
  from novice. That is the list's `who`, in the benches' shape, the same
  two halves the loom names. Anybody else who presses E at the cooking spot
  with a dye's inputs is told it is a Haberdasher's or Liverywright's work,
  and nothing is taken. Their water still boils.
- **Making one.** At a cooking spot (the same bench keyword water boils at),
  carrying a bottle of water and one dye's inputs, a dye steeps for
  `steepSeconds`, a minute in the list as it ships. Press E on the cooking
  spot to start it and stay by the fire: walking away before it is done
  loses the steep and takes nothing, the way a boil is lost. When it is
  done the inputs are taken and the dye is in the pack. If the pack holds
  the inputs of more than one dye, the first in the list is made. One steep
  at a time, and a relog loses one under way.
- **Why the cooking spot and not the loom.** A dye steeps in hot water,
  and the steep keeps the boil's rule that walking away from the fire loses
  it. The loom is the Tailor's own bench but has no fire, so a dye steeps at
  the cooking spot. `steepAt` moves it if staff ever decide otherwise.
- **The bottle of water.** The bottle a dye takes comes out of the server's
  count of where your water came from, by the rule a drink uses: the worst
  water carried first. So a dye takes an unboiled bottle before a boiled one,
  and the count never names a bottle you no longer carry.
- **A dye and a boil on one press.** Carrying a dye's inputs and unboiled
  water, one press at the fire starts both. When the dye is done it takes
  its one bottle first, and the boil then turns whatever unboiled water is
  left into boiled. If the dye took the last unboiled bottle, the boil has
  nothing to do and says nothing.
- **What it is carried as.** One vanilla misc record, the Bowl
  (`98626:Skyrim.esm`), with the dye's name on the entry, the way a deed is
  a named entry. Nothing else in the game reads that record, and the server
  keeps the two apart anyway: giving or taking plain bowls and a merchant
  buying them leave a dye alone, and the take limit counts a stack of one
  dye apart from the plain bowls beside it. A plain bowl is never a dye and
  a dye is never a plain bowl.
- **The colour.** Each channel of the hair colour goes `strength` of the way
  from the colour already there to the dye's colour, then moves by up to
  `wander` either way. The same dye on two heads comes out a little different,
  and never quite clean. A second coat goes on top of the first.
- **Washing out.** A dye marked `wash` has no colour of its own. It goes
  `strength` of the way back to the colour that character was made with,
  which the server keeps from their first dye on.
- **Using one.** Your own hair from the Hair dye page of the K panel,
  anywhere. Somebody else's either from that page with them in front of you
  (look at them and press K, "Dye their hair"), or from Dye hair beside them
  under Near you on the P panel. That is an offer: they press Accept or
  Refuse on their own prompt, and nothing is used and nothing changes until
  they press Accept. You have to stand within `reach` of them when you offer
  and again when they accept. Either way the dye is used up.
- **Hair, beard and brows.** The game gives a character one hair colour, so a
  dye colours all three.
- **No fading.** A colour stays until somebody dyes or washes it.

## The list

| Field | What it is |
| --- | --- |
| `item` | The record a dye is carried as. |
| `steepSeconds` | How long a dye steeps, in real seconds. |
| `steepAt` | The bench keyword a dye steeps at. |
| `reach` | How close, in game units, you stand to dye somebody else's hair (above 0, at most 2000). Ships as 300. |
| `who` | Who may steep: `anyone` true, or `halves`, each half at the lowest rank that may (novice, advanced, expert or master), the same shape as the benches. Ships as the Tailor's two halves, `haberdasher` and `liverywright`, each from novice. |
| `dyes` | Each dye: `id`, `name` (what the entry is called), `colour` (#rrggbb, lower case) or `wash: true`, `strength` (above 0, at most 1), `wander` (0 to 64), and `inputs` (each a record and a count). |

A list with any problem is refused whole, never half used: a key nobody
reads, a colour that is not #rrggbb, two dyes with one id or name, an input
named twice, or a dye that can never be made because an earlier dye takes
less of the same things.

## Where this is

- The list and the colour sums: `game/hair-dye.js`, checked by
  `game/tests/test-2675-hair-dye.js`.
- The steep, the offer and the one write: the hair dye block of
  `game/gamemode.js`, which carries the list and the sums between its
  `HAIR_DYES` markers. After changing either file, run
  `node scripts/dev/Build-HairDyeGamemode.js`;
  `game/tests/test-2675-hair-dye-wiring.js` fails until the two match.
- The Hair dye page of K: `game/ui/thornswood-skills.js`. Dye hair under Near
  you and the offer's words: `game/ui/thornswood-party.js`. The look prompt's
  "Dye their hair": `game/plugins/thornswood-front.js`.
- Not in yet: your own hair keeps its old colour on your screen until the
  next load, because the engine does not redraw hair whose colour changed
  (#2867, a fork change). The colour is on your character from the moment
  it is dyed.
- Every dye written puts one line in the server log: `hair dye:`, who did it,
  whose hair, which dye, and the colour before and after.
