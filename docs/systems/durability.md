# Durability

Worn gear has a condition, from 0% to 120%. Repair is a kit. It is
not the grindstone and it is not the armour table.

Three kits. Smiths and tailors make them.

| Kit | Who makes it | What it repairs |
| --- | --- | --- |
| Weapon Kit | Edgewright | Weapons |
| Armor Kit | Platewright | Armour |
| Sewing Kit | Haberdasher | Clothing, robes, cloaks, capes |

Liverywright is the Haberdasher's sister half. Novice livery is
already theirs. A Sewing Kit is the Haberdasher's recipe. A
Liverywright makes one when the sister-half rules on
[Masters and apprentices](apprenticeship.md) say they may do
Haberdasher work.

## What a kit is made of

Patrick, 4 October: use a suggested recipe. These are the ones
picked. Each takes two cheap Skyrim goods that a class already
supplies at novice, so the half that makes the kit can gather the
makings from day one. All three are novice.

| Kit | Made of | Bench | Who |
| --- | --- | --- | --- |
| Weapon Kit | 1 Iron Ingot, 1 Leather Strips | Forge | Smith, Edgewright |
| Armor Kit | 1 Iron Ingot, 1 Leather | Forge | Smith, Platewright |
| Sewing Kit | 1 Tundra Cotton, 1 Leather Strips | Tanning rack | Tailor, Haberdasher |

The bench also burns fuel for each, besides the makings, the way every
forge burns charcoal of the grade the metal asks for
([Smith](professions/smith.md)). Iron asks for Poor Charcoal. The
tanning rack burns nothing.

| Kit | The bench burns |
| --- | --- |
| Weapon Kit | 1 Poor Charcoal |
| Armor Kit | 1 Poor Charcoal |
| Sewing Kit | Nothing |

The Sewing Kit was first offered as linen wrap and leather strips.
No class supplies linen wrap, so tundra cotton, a gatherer's, takes
its place. The tanning rack, because the loom comes from a mod and
these recipes use only Skyrim's own records.

## Using a kit

The person holding the kit can use it on a piece they are repairing,
when it is their trade's work and they are standing at its bench
(Patrick, 21 October). A piece is mended by the profession that makes
it, at the bench it is made at: smiths mend weapons and armour at the
forge, tailors mend clothing at the loom, a woodworker mends a bow at
the woodworking bench. Either half of that profession may mend it. A
piece nobody makes, a unique or a dungeon find, is mended where its
kit is made, by the trade that makes the kit. Anywhere else, the
repair says where the piece is mended and by whom, and nothing is
used. One kit mends one piece, and the kit is used up. The result
depends on who they are.

| Who uses the kit | Condition after |
| --- | --- |
| An Edgewright at Master, with a Weapon Kit | 120% |
| A Platewright at Master, with an Armor Kit | 120% |
| A Haberdasher at any rank, with a Sewing Kit | 120% |
| Anyone else, including that half below Master for the two smith kits, and the other half of the same profession | 100% |

The half that makes the kit is the half the person picked. The
sister half is never it, at any rank, even past novice under a
master (Patrick, 4 October). The two smith kits give 120% only at
Master, because that repair is the Smith's Master perk, Mastercraft
(Patrick, 26 October, #3442). The Sewing Kit is not the Tailor's
Master perk, which is Master Weaver, so a Haberdasher of any rank
mends to 120% with it.

120% is what allows a buff. 100% is a sound repair and nothing more.

| Piece | At 120% |
| --- | --- |
| Weapon | 5% more damage |
| Armour | 5% more of that piece's armour rating |
| Clothing, robes, cloaks, capes | The higher condition, and no buff |

## Wear

Worn gear loses 1% of its condition on each hit that reaches it
(Patrick, 4 October: per hit). A hit reaches:

- the armour and clothing worn by the person hit, a shield included;
- the weapon the hit was landed with;
- the weapon that blocked it, when the hit was blocked and no shield
  was worn.

A weapon is not worn down when its holder is hit, only when it lands
a hit or blocks one (Patrick, 4 October, asked again in plainer
words: the suggested answer).

At 0%, a piece that is being worn has a 10% chance to break on a hit
that reaches it, instead of losing 1%. An hour of standing around
does not roll it. A piece at 0% that is sitting in a chest is not
worn, and this chance does not apply to it.

Glass, ebony, and stalhrim take the same kits as iron. They are
scarce to make. They are not a different repair.

Condition on a piece that was made or bought, and then left in a
container, is the Dull rule on [Gold](gold.md). 5% per real day, in
a shop chest or a house container. A pack does not dull. Worn gear
uses the wear rule above, not this clock.

## What this replaces

Tempering, the armour table and the sharpening wheel, is not how a
piece is repaired. Those 1809 rows are in
[Cut items](cut-items.md). The recipe book still lists them. A temper
at either bench is refused, the ingot stays in the pack, and it is not
counted as work. They are held so a temper can come back for an
event. `recipes.json` is not edited by that list.

Mastercraft was the smith's master perk for tempering past the metal.
The 120% repair is that idea now: a smith at Master in the right half
can put a piece past a plain repair, and below Master mends to 100%
like anybody else (#3442). The perk is not a second system on top of
the kit.

## Testing repair

`/repairgear` restores carried equipment below 100% for a playtester on Dev or Main. Admins can add `for <person>` to repair another character's equipment. The testing command leaves stronger pieces at their existing condition and retains each item's other saved details. It uses one authoritative inventory and equipment update so the worn names match the pack. It is unavailable on a server without that native operation. [Staff commands](../guide/staff-commands.md#repair-equipment-for-testing) has the permissions and refusal behavior.

## Where this is

In the server. A piece's condition is written on its name when it is
not 100%: Iron Sword (85%). A piece made crude or masterwork at a
bench carries that before its condition, Iron Sword (Masterwork) (85%),
and keeps it through every repair ([Professions](professions.md)). A plain piece is at 100%, and so is every
piece as it is made. Rings, amulets and circlets carry no condition.
The pickaxe, the woodcutter's axe and the shovel wear out by use
instead, 50 uses each, and so do the fishing pole and the bench trades'
hammer, shears, ladle, alembic and rune knife (#3162). A trade hands a piece over at the condition on
its name, and the pieces left in your pack keep theirs.

The three kits are records in the plugin, with the recipes above
(`scripts/mods/Add-ContentRecords.py`). Open the inventory with a kit
in it and a line at the bottom names a key, U unless it was changed.
The key shuts the inventory and opens the repair panel: every piece
you carry that is not at 100%, and every sound piece your own kit
would raise to 120%, worst first, each with the kit it takes and
what a repair by you comes out at. Mend uses one kit on one piece,
to 120% for the half that makes that kit (at Master, for the two
smith kits) and to 100% for anyone else. A piece already at or above that number has no button, and the
row says why. A piece that is not your trade's work, or whose bench
you are not standing at, has no button either, and the row says where
it is mended and by whom. The server finds the bench itself: a bench
of that kind within a few steps of you, in the same place (#4578). No
command does any of this.

Each hit takes 1% off the armour and clothing worn by the person hit,
off the weapon it was landed with, and off the weapon that blocked
it when no shield was worn. At 0%, a piece the hit reaches has the
10% chance to break instead. A broken piece is gone.

A chest or container in a claimed building keeps its own day from the
first time it is opened. Each day that turns takes 5% off everything
in it with a condition, and the loss is written when it is next
opened. Opening it does not move its day.

The grindstone and the armour table do not open, for anybody. Pressing
either says that tempering is not done there and that a piece is
mended with a repair kit, and the crafting menu never comes up, so it
never lists a piece to temper (#1384). The server shuts both before
the menu, because nothing can be made at either. A temper that
reaches it anyway is still refused, and it is not counted as work.

Release 1.2.3 (11 October) carries all of it, on the main server and
in the launcher's files. The kits are in its plugin. The recipe table
names whose work each kit is, at novice for the half in the table
above, and the Weapon Kit and the Armor Kit burn one Poor Charcoal at
the forge (#1622).

A change to a piece's condition shows in its holder's inventory at
once, in the same session, and a worn piece stays worn: the game
renames the piece where it lies instead of taking it off and giving it
back, and the record of what is worn follows the new name (#1651).
Before 1.2.3 the inventory kept the name a piece had when it reached
the pack until the next login. The repair panel always has the number.

Not yet:

- The 5% more damage and armour at 120% is not applied, because the
  engine works damage out on its own.
- A piece that is not at 100% cannot be enchanted, because the engine
  takes a plain piece for an enchantment.
- The shut grindstone and armour table are on main and not in a
  release yet. Until a release carries them, both still open the
  crafting menu and only the temper is refused.
