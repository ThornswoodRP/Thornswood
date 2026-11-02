# Conjuration

Bound weapons, atronachs, and the dead raised. The school places 1
in Capacity. The mage profession also places 1 in Capacity, so taking
this school starts you at 2: +20 magicka. See
[Skill tree](../../skill-tree.md).

<!-- detail:begin -->

## The book

Generated from the spell book and the gamemode's `SPELL_IDS` table by `scripts/dev/Write-SystemLists.js`. Apprentice and Adept are both Advanced. A blank id means the name is in the book and not yet granted.

| Spell | Rank | Id |
| --- | --- | --- |
| Conjure Familiar | novice | `640b6:Skyrim.esm` |
| Raise Zombie | novice | `7e8e1:Skyrim.esm` |
| Bound Sword | novice | `211eb:Skyrim.esm` |
| Conjure Flame Atronach | advanced | `204c3:Skyrim.esm` |
| Reanimate Corpse | advanced | `65bd7:Skyrim.esm` |
| Bound Battleaxe | advanced | `211ec:Skyrim.esm` |
| Soul Trap | advanced | `4dba4:Skyrim.esm` |
| Conjure Frost Atronach | advanced | `204c4:Skyrim.esm` |
| Banish Daedra | advanced | `6d22c:Skyrim.esm` |
| Revenant | advanced | `96d94:Skyrim.esm` |
| Bound Bow | advanced | `211ed:Skyrim.esm` |
| Conjure Storm Atronach | expert | `204c5:Skyrim.esm` |
| Dread Zombie | expert | `96d95:Skyrim.esm` |
| Conjure Dremora Lord | expert | `10ddec:Skyrim.esm` |
| Expel Daedra | expert | `6f952:Skyrim.esm` |
| Command Daedra | expert | `6f953:Skyrim.esm` |
| Dead Thrall | master | `7e8df:Skyrim.esm` |
| Flame Thrall | master | `7e5d5:Skyrim.esm` |
| Frost Thrall | master | `7e5d6:Skyrim.esm` |
| Storm Thrall | master | `7e5d7:Skyrim.esm` |

<!-- detail:end -->

## What this school is not

A thrall made from a person's character is a death or a permanent
change. It needs the yes. A body the world placed is the spell.

Soul Trap on a person is the same line. A soul gem does not end a
character by itself, and it does not skip the agreement.

A bound weapon is a spell, not an Edgewright recipe, and it is not
a free smithing rank.

Command Daedra and the expel spells do not apply to a person playing
a dremora. Dremora is not a people you can pick. See
[Races](../../races.md).

## Where this is

These 20 names are the server's book.

The server refuses Dead Thrall on a person's body, and every other
spell that raises the dead: Raise Zombie, Reanimate Corpse, Revenant,
Dread Zombie, and a scroll or a staff of one. It knows them by the
game's own Reanimate effect, so a mod's raising spell counts too. A
spell is cast before the server hears of it, so the refusal is its
answer the moment the spell lands: the caster is told, and every
machine that sees the body puts it back down. The person's character
is not touched. A body the world placed is the spell working as
written. The yes on [Death](../../death.md) has no record in the
server, so the server cannot see one, and refuses every time.
