# scripts/mods

Scripts that build, verify and manage Thornswood's plugins, recipes and mod assets.

| Script | Purpose |
| --- | --- |
| [Add-ContentRecords.py](Add-ContentRecords.py) | Writes Thornswood-Content.esp from its sources, Bethesda override records and station placements (#5191). |
| [Audit-ArmorSlots.py](Audit-ArmorSlots.py) | Reads armor records straight out of plugins and reports conflicting biped slots that cause unequipping. |
| [Audit-ModMenus.js](Audit-ModMenus.js) | Audits mod settings menu persistence across MCM Helper ini files, global variables and scripts. |
| [Audit-Mods.ps1](Audit-Mods.ps1) | Measures the build and says which parts carry a plugin and which are pure assets. |
| [Build-ContentOnBox.ps1](Build-ContentOnBox.ps1) | The deploy gate's Build-Content verb: builds content plugin and tables on the VPS box (#5191). |
| [Build-Generated.ps1](Build-Generated.ps1) | Builds Thornswood's animation and body files with Pandora Behaviour Engine+ and BodySlide. |
| [Build-LastPlugin.py](Build-LastPlugin.py) | Builds Thornswood-Last.esp from the installed plugins and repository tables (#2468). |
| [Build-ModMenus.py](Build-ModMenus.py) | Writes launcher\app\FromGameModMenus.cs with byte patches for SkyUI, SkyHUD and moreHUD menus (#3113, #3127). |
| [Build-NoticeBoard.py](Build-NoticeBoard.py) | Generates launcher\app\FromGameBoard.cs recipe for notice board and drop box meshes (#2298, #2827). |
| [Build-SpriteFont.py](Build-SpriteFont.py) | Builds Barlow-SemiBold.spritefont from Barlow SemiBold font for on-screen text (#1317). |
| [Build-StartMenu.py](Build-StartMenu.py) | Writes launcher\app\FromGameMenu.cs with byte patches for Skyrim's main menu without Bethesda logo (#2827). |
| [Check-CleanInstall.ps1](Check-CleanInstall.ps1) | Checks that installing the Nexus collection into a clean Vortex profile produces the expected load order. |
| [Check-CollectionRules.ps1](Check-CollectionRules.ps1) | Whether the plugin rules the Nexus collection carries hold a clean install to a plugin list's order. |
| [Check-CoveredBodies.ps1](Check-CoveredBodies.ps1) | Says whether every character body in the game folder is covered by underwear. |
| [Check-CreationForms.js](Check-CreationForms.js) | Checks whether plugins or gamemode require Creation Club records not in base Special Edition (#479). |
| [Check-Editions.ps1](Check-Editions.ps1) | Does anything in the load order need the paid Anniversary upgrade? |
| [Check-FromGame.ps1](Check-FromGame.ps1) | Verifies menus and notice board meshes made from game archives match byte for byte (#2827, #3113). |
| [Check-Manifest.ps1](Check-Manifest.ps1) | Says what load order the game server is actually handing out, and how it compares to local files. |
| [Check-PluginClean.py](Check-PluginClean.py) | Verifies Thornswood plugins have no identical overrides, deleted references or format errors (#2790). |
| [Check-Plugins.ps1](Check-Plugins.ps1) | What is enabled that should not be, and what is missing that should be there. |
| [Check-SkyUIMenus.js](Check-SkyUIMenus.js) | Verifies SkyUI menu files carry the version expected by ski_main.pex (#960). |
| [ContentPaths.ps1](ContentPaths.ps1) | What a content build on the box reads and writes, worked out from content-tables.json (#5191). |
| [Find-MissingMasters.ps1](Find-MissingMasters.ps1) | Reads the TES4 header of every plugin in Data and reports any master that is no longer present. |
| [Generated.ps1](Generated.ps1) | Shared helpers for building and checking Thornswood's animation and body files. |
| [last_recipe.py](last_recipe.py) | Recipe generator for Thornswood-Last.esp from installed plugins (#2791). |
| [List-SalvagedRecords.py](List-SalvagedRecords.py) | Writes content-salvaged.json tracking records remade from the salvaged plugin (#2553). |
| [LoadOrder.ps1](LoadOrder.ps1) | The load order as the game counts it, and how to put a plugin list into the server's order. |
| [Make-LastPlugin.py](Make-LastPlugin.py) | Makes Thornswood-Last.esp from its recipe on the box or client (#2791). |
| [New-CollectionPluginRecord.ps1](New-CollectionPluginRecord.ps1) | Writes records\collection-plugins.json with size and sha256 for collection plugins (#2019). |
| [New-ScriptPack.py](New-ScriptPack.py) | Packs Papyrus scripts from game and archives into papyrus-scripts.zip for the box (#3105). |
| [OnBox.ps1](OnBox.ps1) | Helper scripts sent to the box by Run-OnBox.ps1 (#2899). |
| [PluginRuleLoops.ps1](PluginRuleLoops.ps1) | The plugin rules of a collection that LOOT can never keep because of game load order constraints. |
| [Rebuild-ContentTables.ps1](Rebuild-ContentTables.ps1) | Rebuilds tables read out of load order plugins after content changes. |
| [Run-OnBox.ps1](Run-OnBox.ps1) | Runs content tools on the VPS box and brings back generated files. |
| [Send-GameArchives.ps1](Send-GameArchives.ps1) | Puts Skyrim game archives and string tables into the VPS store. |
| [Set-LoadOrder.ps1](Set-LoadOrder.ps1) | Writes records\load-order.json, the load order the servers run and every content build reads (#5191). |
| [SteamLibrary.ps1](SteamLibrary.ps1) | Finds the Steam copy of Skyrim Special Edition without changing any files. |
