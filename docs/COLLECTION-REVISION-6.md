# Collection revision 6: Thornswood Content 1.4, Atlas out, and the cheddars_mashups.esl rule

Revision 6 carries three changes in one run, so everybody updates once:

- Thornswood Content 1.4 (Nexus file 829844), through -DropPatch (#2793);
- Atlas Map Markers SE taken out with -Remove 24104, because its page does
  not allow it in a collection (#3649);
- cheddars_mashups.esl loading after RaceCompatibility.esm (#4070), from
  [collection-revision-6-rule.json](../records/collection-revision-6-rule.json).

## Why the rule changes

Revision 5's -Add gave cheddars_mashups.esl the rule "load after Immersive
Weapons.esp, Hothtrooper44_ArmorCompilation.esp and ZIA_Complete Pack.esp".
The game loads an .esl as a master, before every plugin that is not one, so
the rule can never hold. On every install LOOT showed a "Cyclic interaction"
box for each of the three and offered to remove the rule. Measured on
27 October over the headers of all 98 enabled plugins: revision 5 has exactly
those three loops, and with the new rule it has none. RaceCompatibility.esm is
the last master, so the .esl goes on the end of the masters
(LIGHT-ORDER-DRIFT.md: a new plugin goes on the end of its own kind).

The server order does not change. ServerOrder.ps1 puts every plugin the game
loads as a master first, in the order it has, so cheddars_mashups.esl gets the
same light index wherever the list puts it.

## The run, from the cloud

The first draft of revision 6 (823950, 30 October) had the first two changes
and not the rule. The second (824557, 31 October) carried Content 1.3 (file
828696), and #5072 and #5073 changed Thornswood-Content.esp after 1.3 went
up, so the collection would have named a plugin the release does not carry.
A draft cannot be changed once it is made. So, on 31 October (Patrick's page
answer q-3649-content-14, A), each step through Nexus-Run.ps1 from main
89dfd743, first with -WhatIf:

1. Send-NexusFile put main's Thornswood-Content.esp up as Content 1.4, file
   829844 (96,295 bytes, md5 96ef97f874f2d8bd0e281746f99df0ad).
2. `New-NexusRevision -Discard 6` threw draft 824557 away.
3. `New-NexusRevision -Mod 192001 -FileId 829844 -DropPatch
   192001:Thornswood-Content.esp -Remove 24104 -Rule
   records/collection-revision-6-rule.json` made draft 825936.
4. `Install-NexusRevision -Revision 6` installs the draft and stops on any
   rule that goes round with the game's own order, as draft 823950's would.
5. records/collection-permissions.json names file 829844, through
   `node scripts/release/collection-permissions.js update <draft 6
   collection.json> --revision 6`.
6. `New-NexusRevision -Publish 6`. Main takes revision 6 with no wipe
   (#3649).

Then the servers and the feeds, from the box, with nothing of One's (#4069):

7. `Deploy-DevGamemode -LoadOrder -FromRecord -ShipFollows` through the
   deploy gate writes last-plugin.json's order over the dev server's, with
   the plugins from the box's store of revision 6, fetched from Nexus
   through Nexus-Run (scripts/deploy/CollectionStore.ps1).
8. `Ship-Dev` moves the dev feed from revision 2 to 6: its plugin list is
   last-plugin.json's order, held to the dev server's, and SkyUI's menu
   check reads revision 6's own files from the same store.
9. Main once dev carries revision 6: a Ship from the feed moves main only
   then. The main server's own move to the order is the last part of #4069.
