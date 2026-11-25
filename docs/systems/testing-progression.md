# Testing progression

Playtesters can advance their own current class or profession on Dev and
Main. An admin can do the same for another character who is in the world.
Both uses need a proven chat connection and the launcher's current pass.

| Command | What it advances |
| --- | --- |
| `/rankup class` | The chosen gathering class, such as Miner or Hunter |
| `/rankup profession` | The chosen half of the current profession, such as Platewright |
| `/rankup profession destruction` | A mage's chosen Destruction school |
| `/rankup class for Dagny Iron Hand` | An admin advances that character's current class |
| `/rankup profession restoration for Dagny Iron Hand` | An admin advances that mage's chosen Restoration school |

A class has one rank. A non-mage profession has a chosen half whose rank
advances; the sister half and taught outside trades are left alone. A mage
has separate school ranks, so the command needs one of their chosen schools.
It does not invent a rank for the Mage profession as a whole.

Each request completes just the remaining work for one rank. It uses the
normal progression rules and saves the rank, skill and spell points, perks
and refreshed menus together. Normal cross-school study rewards still apply.
Master cannot advance further. A command does not choose a class, profession
or school that the character does not already hold.

Successful requests record who used the command, which character changed,
the progression key, and the old and new ranks in the moderation record.
The saved rank and its unlocks survive restarting the server.

This is an explicit testing exception to progression through ordinary work.
It does not change who may use the staff crafting tools.
