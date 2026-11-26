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
| `/setclass hunter` | Replace your gathering class with Hunter at Novice |
| `/setclass farmer for Dagny Iron Hand` | An admin replaces that character's gathering class |
| `/setprofession cook hearthcook` | Replace your profession with Hearthcook at Novice |
| `/setprofession mage destruction,restoration` | Choose Mage and two schools at Novice |
| `/setprofession enchanter bladebinder for Dagny Iron Hand` | An admin changes that character's profession |

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

## Changing class

A replacement class starts at Novice with no work toward the next rank. The
old class rank and its work are removed. Spent skill points, free earned
points, the profession and its school or half ranks, and carried equipment
stay. Starting tools and seeds are not handed out again.

The points placed by the old choices are rebuilt from the current choices
through the normal allocation rules. This removes the old class's bonus,
adds the new class's bonus, and keeps spent points under the same caps.
Switching back and forth does not stack bonuses or award skill points.
Gathering gates and the character panel use the new class immediately.

## Changing profession

The new profession and its chosen half or schools start at Novice. The old
profession's ranks, work and placed attribute bonuses are removed through
the normal allocation rules. Your gathering class, spent skill points,
free earned skill points and carried equipment stay. An active apprenticeship
or teaching relationship must end through its normal K page first.

Learned spell and staff knowledge stays in saved history. Only knowledge
allowed by the current profession, chosen schools and rank is active in
the book and engine. Switching back restores eligible historical spells;
advancing the current rank restores higher-rank knowledge as it becomes
eligible. Each profession's unspent spell points are kept separately, so
returning to it does not award starting points again.

For a previously taught outside school or Bladebinder half, the usual
Novice and two-spell limits still apply. If history offers more than two
eligible choices, the command refuses and lists them. Add `spells Flames,Sparks`
or `staffspells <comma-separated names>` to choose up to two, or use `none`.
An admin adds `for <person>` after these choices when changing somebody else.

The engine commits the character record, active spell set and authoritative
membership flag in one live change and one queued save. A stale identity,
record or spell set refuses the whole request. The flag enforces membership
when equipping and casting, including spells that were already equipped.
Unrelated abilities and blessings stay. This requires the matching engine
binding; an older engine refuses rather than performing a partial change.
Legacy ordinary spells outside the current book and staff catalogue stay in
history by their form descriptors, with native membership removed. They do
not become active unless current canonical rules allow them. An unreadable
spell type refuses the entire change.
The atomic writer reads the full learned set through the matching engine
getter, including explicitly stored inherited abilities. Papyrus spell
enumeration intentionally omits those entries and cannot supply that snapshot.

Ordinary tome learning keeps the engine's existing book consumption path.
Its requested eligible book and history save first; a failed read or save refuses the
tome. The native book event then grants the new spell and consumes the book.
If that study also raises a rank, additional eligible spells stay in history
until the next atomic character refresh or login activates them in the book
and engine together.
Reading a tome for that newly eligible retained knowledge performs one normal
atomic refresh first. The spell is then already known, so its point and book
are not spent a second time. A refused refresh keeps both.
