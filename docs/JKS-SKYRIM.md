# The cities

Decided 15 September 2026. Thornswood's cities and towns are built by JK's
Skyrim, the all in one version, rather than by the collection of separate city
mods that was there before.

This is written down because properties, locks, keys and notice boards all get
placed in these cells, and anybody adding them later needs to know what is
underneath and why, without having to work it out again.

## What went in

    JKs Skyrim.esp                            JK's Skyrim all in one v1.7
    CWE - JK - United.esp                     Capital Windhelm patch
    Riften Expansion - JK's Skyrim Patch.esp  Riften Expansion patch
    CFTO-JK-Patch.esp                         Carriage and Ferry patch
    JK's Castle Volkihar.esp                  Outskirts series
    JK's Markarth Outskirts.esp               Outskirts series
    JK's Riften Outskirts.esp                 Outskirts series

## What came out, and how that was decided

Not by reading mod descriptions. Every plugin was parsed and its overridden
records compared, counting a record as shared when both plugins override the
same form id from the same master.

    JKs Whiterun.esp          155 own overrides, 155 shared with JK's  (100%)
    JK's Riverwood.esp        143 own overrides, 138 shared with JK's  (97%)

Those two are the older standalone versions of work the all in one already
contains. One would silently have overwritten the other. Both off.

    JK's Whiterun's Outskirts.esp   581 own overrides, 6 shared  (1%)

That is the separate Outskirts series and it sits alongside. Stays on.

## The Great Cities, and why it could not stay

    The Great Cities - Minor Cities and Towns.esp
        2,219 own overrides, 413 shared with JK's, 82 of them navmeshes

Clutter conflicts look wrong. Navmesh conflicts make guards walk into walls and
fall through floors, and on a co-op server that is everybody's problem at once,
so 82 of them is not something to live with.

The patch exists: The Great Cities of JK's North, mod 33687, already on this
machine. It cannot be used. Its masters are

    The Great Cities - Minor Cities and Towns.esp
    JKs Skyrim.esp
    COTN - Dawnstar.esp
    COTN - Falkreath.esp
    COTN - Morthal.esp
    COTN - Winterhold.esp
    The Great City of Winterhold v4.esp

and two of those, COTN Falkreath and COTN Morthal, each master four Creation
Club plugins:

    ccBGSSSE001-Fish.esm
    ccQDRSSE001-SurvivalMode.esl
    ccbgssse037-curios.esl
    ccBGSSSE025-AdvDSGS.esm

Creation Club content cannot be shipped to anybody, so that whole branch is
closed. The author confirms there is no version for Great Cities plus JK's
alone. It was one or the other, and JK's won.

## Conflicts that remain, unpatched

    Populated Cities Towns Villages   76 shared, 4 navmeshes   no patch exists
    Solitude Arena                    20 shared, 7 navmeshes   no patch exists
    Skyrim Sewers                     30 shared, 7 navmeshes   patch available

The Skyrim Sewers one is in JK's Skyrim Patch Collection, mod 154077. Worth
getting. The other two have nothing, so either live with them or drop the mod.

## Two plugins switched off

`GourmetFishing.esp` needs `ccBGSSSE001-Fish.esm`, which is not in the build.
`Riften Expansion - JK's Skyrim Patch.esp` needed `JKs Skyrim.esp`, which is
why it was off before today. It is back on now.

## The rule that makes any of this safe

The server compares plugin lists positionally. When this page was written,
`Deploy-Gamemode.ps1` left every light plugin out of the server's list so that
the server's indices equal the game's normal indices. That only held while no
normal plugin masters a light one: such a plugin got dropped server side,
because libespm will not load a plugin whose master is absent, while the game
keeps it and gains an index. Checked on 15 September against all 95 enabled
plugins: none. The count was 61 full on both sides.

Since #1715 the engine loads light plugins (`"lightPlugins": true` in
`records\server-build.json`), so `Deploy-Gamemode.ps1` lists every plugin the
game loads, light ones included, each in the game's own FE slot, and leaves
nothing out. The server keeps its light order from deploy to deploy and every
machine is held to it: [LIGHT-ORDER-DRIFT.md](LIGHT-ORDER-DRIFT.md), "Why what
is stored from now on does not drift".

## And the rule that killed optional mods

Light plugins are numbered FE 000 upwards by their position among the other
light plugins. Take one out and every light plugin after it shifts.

This was measured, not assumed. `atlas map markers.esp` was FE (025) in the
morning and FE (027) after two light plugins were added ahead of it.

SkyMP syncs appearance mostly as form ids: raceId and headpartIds are form ids,
while hairColor, skinColor and the tint colours are plain RGB values, so load order
cannot change them (#491). A beard from Khisartin or a hairstyle from
HammerHair is a form id in that FE space. Two people with different optional
choices would therefore see each other wearing the wrong face. Light plugins
are now in the server's list with their order kept, and the launcher and the
client's own load order check hold every machine's light list to it, so a
machine missing one is told rather than let in with its own order
([LIGHT-ORDER-DRIFT.md](LIGHT-ORDER-DRIFT.md)).

So every mod in the collection that carries a plugin is Required. Optional is
only ever safe for a mod with no plugin at all.
