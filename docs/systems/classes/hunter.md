# Hunter

Only a hunter loots an animal body. Everyone else walks past it.
People, bandits, draugr and dragons are not this list. A bandit and
a draugr are a warrior's kill, not a carcass to dress. See
[Warrior](../professions/warrior.md) and [Death](../death.md).

92 names, 336 placed bodies. Every name, every part, every yield:
[lists/hunter.md](../lists/hunter.md).

## The rank of a body

The rank on the row. A part has no gold price. What it sells for is
the price a person posts.

A pair of zeroes on the list means that rank may not work the body.
The yield is the least and the most of each part, novice first, then
advanced, expert, master. A novice rabbit is 1 to 2. A master on the
same body is 1 to 5. The same four pairs are on every row the table
allows that rank to touch.

## The body

An animal in the hunt table lies for 5 minutes. That is long enough
to dress it. Then it stands back up, which is the engine. A bandit,
a guard, a draugr and a dragon stand back up after 25 seconds, and
no hunter has a verb for them.

A 0-0 yield on your rank means you may not dress that body. You are
told the rank. The parts stay on the corpse for someone who has it.

## Hanging game

A pheasant on a hook is not a corpse. It is a plant-shaped record in
a camp, and loot does not see it. Press E. This is still the hunter,
and it is a different yield and a different wait from dressing a body.

| What hangs | Records | Rank of the rack |
| --- | --- | --- |
| Pheasant, gives Pheasant Breast | 2 (`38b0c`, `38b0d`, both Skyrim.esm) | Novice |
| Rabbit, gives Raw Rabbit Leg | 2 (`38b0e`, `38b0f`, both Skyrim.esm) | Novice |
| Charred skeever, gives Cooked Skeever | 1 advanced (`775fe:Skyrim.esm`), 2 expert (`52185`, `52189`, both Skyrim.esm) | The record's own rank |
| Dead horker in the Skaal village, gives what its record's list holds | 1 (`38a83:Dragonborn.esm`) | Advanced, the rank of a horker body |

The wait is the rack's rank, not yours. It is kept on the rack, not
on you: once a rack is picked, it is picked for every hunter until the
wait is over.

| Rack's rank | Wait |
| --- | --- |
| Novice | 10 minutes |
| Advanced | 30 minutes |
| Expert | 1 hour |
| Master | 4 hours |

What you take depends on your hunter rank, least and most: novice 1,
advanced 1 to 2, expert 1 to 3, master 2 to 4. A novice can take the
pheasant and the rabbit. A novice cannot take an expert skeever. One
press is one piece of work, whatever the count.

A restart does not clear the wait, because return times and shared
stock survive a restart ([People who are not people](../npcs.md)). The
carcass clock of 5 minutes does not apply to a rack, and the rack's
wait does not apply to a wolf on the ground.

One successful dressing is one piece of work. 100 to advanced, then
the count starts again at 250, then at 600. Rest costs 1.5, 1.2,
0.9, 0.6 by your rank. A party member in the same cell banks 15%
toward an extra piece, paid on the seventh.

## What you are handed

1 in Precision (+2 critical chance). The game may ignore it. You do
not get a profession's points from this class. If you are also a
smith, those are the smith page.

## What you cannot do

You cannot pull a flower, mine a seam, fish, or sow a plot. Leather
you did not dress yourself is somebody's, or it is a hide you were
given. Tanning the hide is anybody's work. Making the armour is a
platewright or a tailor.

You cannot loot a person's body for the hunter verb. Theft of what
they carried is the property rule, not this class.

## Where this is

The verb, the 5 minutes, the rank on the row, and the yields are in the
server. The list is that table. A rack's wait is kept on the rack,
shared by every hunter and kept through a restart (#1413), and a
picked-clean rack says how long is left in minutes and hours (#1826).
Until 5 October this page said the wait was your own and cleared by a
restart, which it was before #1413 (#1887).

A body that never lies on the ground is not on the list, whatever its
race (#1808): a spirit, an animal a spell brings, a mod's hidden actor
that nothing can strike, and a test netch the game never places.
`scripts/dev/Build-HuntTable.ps1` reads each of these off the record and
lists it in `game/data/hunts.json` under `skipped` with the reason. The
arena's animal gladiators stay: each is a bear, a wolf or a sabre cat
and gives that animal's parts.
