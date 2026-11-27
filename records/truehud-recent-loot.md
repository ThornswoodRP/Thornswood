# TrueHUD recent loot: settings, source defaults and permissions

Issue #6019. The recent loot widget runs on TrueHUD's own defaults because
Thornswood ships no override. This note says where TrueHUD reads those
settings, which keys there are, what the source falls back to, and what the
mod's page lets Thornswood do with its files. It changes nothing in the
collection, the load order or what ships.

## The mod

- TrueHUD - HUD Additions, by Ersh: Nexus mod 62775, file 798218, the main
  file in `records/collection.json`. The page gives version 1.1.10, last
  updated 31 August 2026 (read 26 November 2026).
- Source: https://github.com/ersh1/TrueHUD at commit
  727e051f5b1935c2981e858d8145752a3e688675, the newest on its default branch
  when read. The repository has no tags or releases, so nothing there names
  1.1.10.
- Not cross-checked against the package. The Nexus download needs a sign-in,
  and nothing here signs in. So every value below is what the source at that
  commit falls back to, and has not been confirmed against the INI the
  1.1.10 archive carries.

## Where it reads the settings

`Settings::ReadSettings` in `src/Settings.cpp` reads two INI files, in this
order, each one overriding the values before it:

1. `Data/MCM/Config/TrueHUD/settings.ini`, the defaults the mod ships for
   MCM Helper.
2. `Data/MCM/Settings/TrueHUD.ini`, what a person saved in the mod's menu.

A key missing from both keeps the value compiled into `src/Settings.h`.
The second file is one machine's saved menu, which Ship already keeps out of
what ships (`Test-ShipOneMachine` in `scripts/release/Ship-Rules.ps1`).

## The keys

The General section switches the widget on. Every other key is in the
RecentLoot section. Each value is the compiled fallback in `src/Settings.h`.

| Section | Key | Fallback | What it does |
| --- | --- | --- | --- |
| General | bEnableRecentLoot | true | The widget is on |
| RecentLoot | bRecentLootHideVanillaMessage | true | Hides the game's own "added" message |
| RecentLoot | bRecentLootHideInInventoryMenus | false | Hides the widget while an inventory menu is open |
| RecentLoot | bRecentLootHideInCraftingMenus | false | Hides the widget while a crafting menu is open |
| RecentLoot | uRecentLootMaxMessageCount | 10 | Most rows shown at once |
| RecentLoot | fRecentLootMessageDuration | 5.0 | Seconds a row stays |
| RecentLoot | fRecentLootScale | 1.0 | Size of the widget |
| RecentLoot | bRecentLootUseHUDOpacity | true | Uses the game's HUD opacity |
| RecentLoot | fRecentLootOpacity | 1.0 | Opacity when the HUD's is not used |
| RecentLoot | uRecentLootListDirection | 0 | 0 is up, 1 is down (`VerticalDirection`) |
| RecentLoot | fRecentLootX | 1.0 | Horizontal place, a fraction of the screen |
| RecentLoot | fRecentLootY | 0.85 | Vertical place, a fraction of the screen |

There is no key for the width of a row or for fitting a row to its text.
A change to either is a change to the mod itself, which the permissions
below do not allow without asking.

## What the permissions allow

From the mod's page, "Credits and distribution permission" (read 26
November 2026):

- Upload: "You are not allowed to upload this file to other sites under any
  circumstances." So neither Thornswood's site nor its launcher may carry a
  copy of `settings.ini`, changed or not.
- Modification: "You must get permission from me before you are allowed to
  modify my files to improve it." So a changed copy of the mod's own
  `settings.ini` needs Ersh's permission first.
- Assets: they may be used with credit, but not in anything sold.

What that leaves without asking: the collection installs the mod's own files
from Nexus as they are. A recent loot setting that Thornswood wants to be
different for everyone needs either Ersh's permission for a changed
`settings.ini`, or Thornswood's own file. Which one is a separate decision,
and this note is not that override.
