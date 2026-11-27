# Collection revisions

The collection is on revision 13 of 7essxf on Nexus Mods, as
`records/collection-plugins.json` records it, every plugin with its size and
sha256. `tests/test-4533-collection-revision-docs.js` holds this page and
every other page to that record, so a page that names an older revision as the
newest turns the gate red.

A new revision is made from `records/collection.json` by a pull request, and
the merge drafts and publishes it: [COLLECTION-CHANGES.md](COLLECTION-CHANGES.md)
says how. From Nexus to a release it goes like this:

1. The merge's run (`Publish-CollectionRecord.ps1`) drafts the revision, lays
   it out, holds it to the merged record and only then publishes it, and puts
   the rebuild on the board.
2. The records follow in a pull request of their own:
   `collection-plugins.json` (written by
   `scripts/mods/New-CollectionPluginRecord.ps1` from the revision's plugins),
   `collection-dropped.json`, `collection-permissions.json`,
   `collection-modlist.wabbajack` (the revision as the Wabbajack modlist the
   launcher installs from, #6244), the record's
   `revision`, and `load-order.json`, the order the servers run and every
   build reads. The `collection-record` artifact carries the new server
   `load-order.json`, computed from the verified layout and the prior server
   order. It is distinct from the unpacked `loadorder.txt`, which is the
   collection layout's order. `Set-LoadOrder.ps1 -Check` verifies the order
   once the other records have moved to the same revision.
3. The box builds again what is read from the plugins: the NPC catalogue
   (`game/data/npc-population.json`) and the Last plugin's recipe and record
   (`game/data/last-plugin.recipe`, `game/data/last-plugin.json`), through
   the content tables chain (`scripts/mods/content-tables.json`).
   `tests/test-2468-last-plugin.js` stays red until they name every plugin the
   record does. When the revision changes the order, the stations are measured
   again over it (`Build-Content -Stations`, docs/systems/station-placement.md)
   and their `game/data/station-sites.json` goes in a pull request of its own:
   until it does, `game/tests/test-2553-station-sites.js` stops every merge
   release's content checks.
4. The dev server takes the new order from the box's store of the revision
   (`scripts/deploy/CollectionStore.ps1`), and a dev release names the
   revision. Main follows from the feed only when Patrick says so for that
   build.

For revision 13, steps 1 and 2 are done. It takes out one plugin,
McmRecorder.esp, and leaves the order of every other plugin as revision 12
had it. The merge builds the content again on the box before its release,
the Last plugin with it.

## Revision 13

Published 27 November 2026 by [the collection record run](https://github.com/ThornswoodRP/Thornswood/actions/runs/45928907205).

MCM Recorder (61719) is taken out, as Patrick chose on #4511 (option A, 26
November). Its menu needs JContainers, which the collection does not carry,
and its loose SKI_ConfigBase.pex and SKI_ConfigManager.pex replaced SkyUI's
own, so every mod menu ran on a base that called into it. Those two scripts
go with it, and every SkyUI and MCM Helper menu runs on SkyUI's own base
again. Its plugin added only its menu and one item kept in a cell nobody can
reach, so the servers drop it (`records/collection-dropped.json`). No other
archive, plugin or order changed. Its entry listed no files, and the run
before this one stopped on that; the run now reads the files from the
archive (#4511).

## Revision 12

Published 26 November 2026 by [the collection record run](https://github.com/ThornswoodRP/Thornswood/actions/runs/45841963802).

The nine mods whose plugins the collection gives a light flag (Deadly Spell
Impacts, Better Container Controls, RaceMenu, More Craftable Equipment, SkyHUD,
XP32 Maximum Skeleton, CBBE, LSFX and Pandora) now list the files they install,
in place of their installer answers (#6888). Vortex patches only a copy it
installs from the collection, and up to 1.15 it took a copy of the same file
installed before as the collection's when the entry listed no files, so that
copy kept its author's flag. An entry that lists its files is matched only by
a copy with that list, so Vortex installs and patches its own. Somebody who
has these mods from an earlier revision gets them installed once more. No
archive, plugin, plugin index or order changed.

## Revision 11

Published 17 November 2026 by [the collection record run](https://github.com/ThornswoodRP/Thornswood/actions/runs/44198347972).

PapyrusUtil AE SE 4.6 keeps the same file as revision 10, with a new Vortex
reference tag so updating the collection replaces an installed 3.9 archive.
Revision 10 retained the old tag, which let Vortex accept that older archive
before comparing file identity. No archive contents, plugins or indices
changed. Native loading and the warning still need the matching dev check.

## Revision 10

Published 17 November 2026 by [the collection record run](https://github.com/ThornswoodRP/Thornswood/actions/runs/44181409514).

PapyrusUtil AE SE 4.6 replaces the incompatible 3.9 file from revision 9.
The author targets this file at Skyrim 1.6.1170, the runtime Thornswood pins.
It supplies the configuration reader the CBBE 3BA physics manager calls.
No collection plugin or plugin index changed. Native loading and the warning
still have to be checked on the matching dev release before main follows.

## Revision 9

Published 17 November 2026 by [the collection record run](https://github.com/ThornswoodRP/Thornswood/actions/runs/44159851290).

PapyrusUtil SE 3.9 was added as the physics manager's configuration reader.
That file targets Skyrim 1.5.97, while Thornswood runs 1.6.1170; it needs
the AE 4.6 file instead. No plugin or plugin index changed. The revision
also carries the recorded load-after rules for CBBE.esp,
RaceMenuMorphsCBBE.esp and Improved Eyes Skyrim.esp.

## Revision 8

Improved Eyes Skyrim's installer answers, written the way Vortex writes them
(every step and group of its script), so Vortex counts the copy it installs as
the collection's and does not put in a second one (#5531).

## Revision 7

Improved Eyes Skyrim SSE 1.6 (mod 9141, file 23215), its plugin loading below
CBBE.esp and RaceMenuMorphsCBBE.esp. Its first draft was discarded for a plugin
written below one it needs (#4603). It carried the installer's answers as the
record named them, which Vortex did not match.

## Revision 6

Thornswood Content 1.4, Atlas Map Markers SE out, and the cheddars_mashups.esl
rule that ended LOOT's cyclic interactions: [COLLECTION-REVISION-6.md](COLLECTION-REVISION-6.md).

## Revision 5

Published 21 October. It added KS Hairdo's Lite and Cheddar's Mashups
(`cheddars_mashups.esl`), with the rule for the .esl that revision 6 replaced,
and moved Open Animation Replacer to 3.2.1 (file 798222). Its record came in
#3206. It also
carried Atlas Map Markers SE, whose page does not allow it in a collection.

## Revision 4

Published 21 October. Against revision 3 it changes nine plugins (#2979).

## Revision 3

The Thornswood Client Runtime moves to 1.0.1 (file 823485). The plan of
29 September to put the Unofficial Skyrim Special Edition Patch in this
revision was dropped on 21 October and never published.

## Revision 2

The Vortex pass, step by step, and the plugin order a clean install lands in:
[COLLECTION-REVISION-2.md](COLLECTION-REVISION-2.md).

## Revision 1

The first revision of 7essxf: [COLLECTION-REBUILD-7ESSXF.md](COLLECTION-REBUILD-7ESSXF.md).
