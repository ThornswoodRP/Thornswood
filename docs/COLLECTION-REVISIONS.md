# Collection revisions

The collection is on revision 9 of 7essxf on Nexus Mods, as
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
   build reads, which `pwsh scripts/mods/Set-LoadOrder.ps1` moves to the new
   revision once the others are its (`tests/test-5191-load-order.ps1` stays
   red until it does).
3. The box builds again what is read from the plugins: the NPC catalogue
   (`game/data/npc-population.json`) and the Last plugin's recipe and record
   (`game/data/last-plugin.recipe`, `game/data/last-plugin.json`), through
   the content tables chain (`scripts/mods/content-tables.json`).
   `tests/test-2468-last-plugin.js` stays red until they name every plugin the
   record does.
4. The dev server takes the new order from the box's store of the revision
   (`scripts/deploy/CollectionStore.ps1`), and a dev release names the
   revision. Main follows from the feed only when Patrick says so for that
   build.

For revision 9, steps 1 and 2 are done. Its collection plugins and their
load order are unchanged from revision 8. The merge builds the content again
on the box before its release.

## Revision 9

Published 17 November 2026 by [the collection record run](https://github.com/ThornswoodRP/Thornswood/actions/runs/44159851290).

PapyrusUtil SE 3.9 supplies the configuration reader used by the CBBE 3BA
physics manager. It adds no plugin and changes no plugin index. The revision
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
