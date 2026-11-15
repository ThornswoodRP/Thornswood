# Collection revision 2: installation and shipping

Patrick published [revision 2](https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf/revisions/2)
on 3 October 2026. This page records that revision and the checks required
to turn it into a release. The collection contains 115 mod packages:
113 from revision 1, four removed, six added. Main and Dev keep their own
feeds, server ports, release records and generated game folders.

## Contents

- [1. Select the published collection](#1-select-the-published-collection)
- [2. Keep the removals and exclusions](#2-keep-the-removals-and-exclusions)
- [3. Retain the covered body installer choices](#3-retain-the-covered-body-installer-choices)
- [4. Keep Estate and Runtime at the published versions](#4-keep-estate-and-runtime-at-the-published-versions)
- [5. Preserve the rebuilt Content base](#5-preserve-the-rebuilt-content-base)
- [6. Keep the collection's plugin rules](#6-keep-the-collections-plugin-rules)
- [7. Check the six added packages](#7-check-the-six-added-packages)
- [8. Refresh a separate own folder](#8-refresh-a-separate-own-folder)
- [9. Build behaviors and bodies in each channel's own folder](#9-build-behaviors-and-bodies-in-each-channels-own-folder)
- [10. Check the complete release inputs](#10-check-the-complete-release-inputs)
- [11. Publish and validate Dev first](#11-publish-and-validate-dev-first)
- [12. Publish Main and its installer](#12-publish-main-and-its-installer)
- [13. Deploy the site, docs and supporting services](#13-deploy-the-site-docs-and-supporting-services)
- [14. Verify channel separation](#14-verify-channel-separation)
- [15. Keep the historical loose-file audit](#15-keep-the-historical-loose-file-audit)

## 1. Select the published collection

Install revision 2 in Vortex's **Thornswood** profile. Leave **Skip plugin rules**
off. Keep its pinned versions and installer choices.
Patrick already signed in and published it; this release does not require
another upload or another collection.

Check: the collection is 7essxf, revision 2, with 115 packages.

## 2. Keep the removals and exclusions

Revision 2 removes CBPC 1.7.2, its 3-Bone configs, Start On Save 2.8.0 and
Skyrim Souls RE 3.2.0. Their downloaded archives were removed too.
Styles of Skyrim Mashups (154063) is excluded. Do not install children's
clothes or the VOR Default archive. Optional Base Object Swapper and Dynamic
Armor Variants notices do not authorize adding those mods.

Check: none of those four removed packages is installed or in the collection.
CBPC's DLL is absent. CBBE 3BA's mandatory installer component can leave
configuration text; that does not mean CBPC is installed.

## 3. Retain the covered body installer choices

CBBE 3BA 2.48 uses Base install and Nevernude, with Pre-built Body mesh off.
The collection records Same Installer Choices. Its mandatory CBPC base
component cannot be unticked; optional CBPC configuration installation is off.
Use the recorded SMP choices. CBBE.esp and RaceMenuMorphsCBBE.esp stay off.
The release builds the covered meshes from the collection's BodySlide
projects, rather than relying on old prebuilt meshes.

Check: both plugins are off and the generated-body check in step 9 passes.

## 4. Keep Estate and Runtime at the published versions

Elysium Estate stays 5.0.1, Nexus file 45193. The row's old 4.3.5 title does
not describe that file. ElysiumEstate.esp is 956,423 bytes.
ElysiumEstateSSE.esp must not exist. Thornswood Client Runtime stays 1.0.0,
Nexus file 809366; there is no Runtime 1.1 upload in this revision.

| What | Published collection | Release behavior | Wins | Why |
| --- | --- | --- | --- | --- |
| Elysium Estate | ElysiumEstate.esp, 5.0.1 | Position 22 | Collection | The old SSE name was an obsolete server copy. |
| Covered bodies | CBBE 3BA and HIMBO projects | Recorded covered builds | Thornswood | Nobody's genital body mesh is shipped. |
| CBBE.esp and RaceMenuMorphsCBBE.esp | Off | Off | Thornswood | Neither belongs to the server's 48 full plugins. |
| Runtime | 1.0.0 | Recorded runtime updates | Thornswood | The release's client build record identifies its own engine files. |

Check: Estate's filename, size and position match the table below.

## 5. Preserve the rebuilt Content base

The published Content patch is the rebuilt repository file Patrick identified:
141,023 bytes, SHA-256
4b004dce782573445381ef013be7e6984c4df09c31a3af7234242f6f2acc7f58.
It removes the Execution Block from Solitude. Runtime stays separate.
Completed Content work already on main, including fishing and the collapsed
Dwarven scrap recipes, must be retained in the release built from that base.
The release record and server manifest identify the resulting plugin bytes.

Check: run node tests/test-content-names.js and the fishing and Dwarven
recipe tests before packing the resulting plugin.

## 6. Keep the collection's plugin rules

| Plugin | Rule to remove | Rule to add |
| --- | --- | --- |
| ElysiumEstate.esp | none | load after aaaGraniteHill.esp |
| Triumvirate - Mage Archetypes.esp | load after ElysiumEstateSSE.esp | load after ElysiumEstate.esp |
| AHZmoreHUD.esp | none | load after Immersive Patrols II.esp |

The obsolete ElysiumEstateSSE.esp load-after rule is removed too. Sort Now
and Deploy; do not drag the list. FNIS.esp generated by Pandora is light
(TES4 flag 0x200), so it takes no normal position.

Check: every full plugin matches this order; light plugins are not counted.
The table below is the full plugins only, the list a server's manifest gives
as mods. The light ones, among them the Skyrim.ccc plugin _ResourcePack.esl
that the game loads straight after the five masters, take no position here;
a server's settings list them among the full ones, and the manifest lists
them apart, under light.

<!-- order:start -->
| Position | Plugin | What to do |
| --- | --- | --- |
| 1 | Skyrim.esm | The game loads the five base masters itself. |
| 2 | Update.esm | Base master. |
| 3 | Dawnguard.esm | Base master. |
| 4 | HearthFires.esm | Base master. |
| 5 | Dragonborn.esm | Base master. |
| 6 | Water for ENB.esm | Keep. |
| 7 | Embers XD.esm | Keep. |
| 8 | RaceCompatibility.esm | Keep. |
| 9 | Immersive Sounds - Compendium.esp | Keep. |
| 10 | IcePenguinWorldMap.esp | Keep. |
| 11 | JKs Skyrim.esp | Keep. |
| 12 | WindhelmSSE.esp | Keep. |
| 13 | CWE - JK - United.esp | Keep. |
| 14 | JK's Whiterun's Outskirts.esp | Keep. |
| 15 | The Great City of Solitude.esp | Keep. |
| 16 | Embers XD.esp | Keep. |
| 17 | Riften Expansion.esp | Keep. |
| 18 | Odin - Skyrim Magic Overhaul.esp | Keep. |
| 19 | Hothtrooper44_ArmorCompilation.esp | Keep. |
| 20 | AnotherOakwood.esp | Keep. |
| 21 | aaaGraniteHill.esp | Keep. |
| 22 | ElysiumEstate.esp | **Switch on** (step 4). Elysium Estate 5.0.1, as the collection installs it; loads after aaaGraniteHill.esp. The servers had ElysiumEstateSSE.esp here until the deploy. |
| 23 | Triumvirate - Mage Archetypes.esp | **Change.** Loads after ElysiumEstate.esp. |
| 24 | Apocalypse - Magic of Skyrim.esp | Keep. |
| 25 | CommonClothes.esp | Keep. |
| 26 | Cloaks&Capes.esp | Keep. |
| 27 | UIExtensions.esp | Keep. |
| 28 | chfshVariousActions.esp | Keep. |
| 29 | Cathedral Weathers.esp | Keep. |
| 30 | FishingInSkyrim.esp | Keep. |
| 31 | Thornswood-Content.esp | **New file** (step 5). Same place. |
| 32 | Populated Cities Towns Villages Legendary.esp | Keep. |
| 33 | SkyrimSewers.esp | Keep. |
| 34 | Solitude Arena.esp | Keep. |
| 35 | ZIA_Complete Pack.esp | Keep. |
| 36 | CFTO.esp | Keep. |
| 37 | Arena - Markarth Side.esp | Keep. |
| 38 | Immersive Weapons.esp | Keep. |
| 39 | DIS_Heavy_Legion.esp | Keep. |
| 40 | OarsRest.esp | Keep. |
| 41 | North Keep.esp | Keep. |
| 42 | Immersive Patrols II.esp | Keep. |
| 43 | AHZmoreHUD.esp | **Change.** Add: loads after Immersive Patrols II.esp. |
| 44 | HappyLittleTrees.esp | Keep. |
| 45 | PlayFluteLuteDrum.esp | Keep. |
| 46 | Skyrim Unbound.esp | Keep. |
| 47 | Water for ENB (Shades of Skyrim).esp | Keep. |
| 48 | Playable Rieklings.esp | Keep. |
<!-- order:end -->

## 7. Check the six added packages

<!-- adds:start -->
| Mod | Nexus id | File to install | Replaces |
| --- | --- | --- | --- |
| Pandora Behaviour Engine+ | 133232 | 5.0.0-beta | The behavior generator |
| Dynamic FNIS AA functions | 175362 | 3.1.1 | Required Pandora bridge |
| Expressive Facial Animation - Male Edition | 19532 | Main file, 1.21 | Male face and beard morphs |
| CBBE 3BA Vanilla Outfits Redone | 109194 | Vanilla and CC prebuilt files, 5.5.1 | Fitted hoods and robes |
| Assorted Mesh Fixes | 32117 | Main file, 0.145 | Noble end table |
<!-- adds:end -->

VOR contributes two packages; the other rows contribute one each. Assorted
Mesh Fixes loads before Happy Little Trees and CBBE in the file rules.

Check: all six packages are installed, enabled and deployed. The published
revision adds no new full plugin to the 48-position order.

## 8. Refresh a separate own folder

Vortex deploys into the Steam copy of Skyrim Special Edition. That is the
collection source for every own folder on the machine: Main's, the dev
build's and each release folder. From 3 to 11 October Vortex deployed into
C:\Thornswood-DevBuild\Game instead, as this step used to say. Vortex
deploys by hard link, so every file there was a second name of Vortex's own
copy, and each refresh of that folder made the 7,500 Nemesis patches it
keeps as copies its own again until Vortex linked them at its next deploy
(issue #2210). Since Patrick's decision of 12 October the launcher refuses a
Thornswood game folder as Vortex's folder: it does not make or refresh from
one, Choose Vortex's folder will not take one, and the log says at every
start to point Vortex back at the Steam copy. Leave the launcher's Vortex
folder setting empty unless Vortex deploys into another Steam folder.
Refresh Main's own folder and a separate Dev own folder from that deployment.
A release folder is made by OwnGame's own Make, through
scripts\release\Update-ShipRoot.ps1 (issue #2019), never by hard linking an
install's folder.
Never generate directly inside a folder containing vortex.deployment.json.
The release's Dev own folder is local\release-devbuild in the repository
folder, C:\Thornswood-Repo\local\release-devbuild on
One since 5 October (C:\Thornswood-Release-DevBuild before); its launcher
and server still use Dev's channel and ports. Record it once with
scripts\release\Setup-ShipMachine.ps1 -Channel dev -Root C:\Thornswood-Repo\local\release-devbuild,
so Ship, Check-ShipReady and Build-Generated take it without -Root; Ship
refuses any folder Vortex deploys into before anything is built
(issue #1692).

Check: each release folder has Profile\OwnGame\files.txt, records the
actual Vortex source in made.txt, and has no Vortex deployment manifest.

## 9. Build behaviors and bodies in each channel's own folder

<!-- 1247:start -->
Since #3715 (27 October 2026) the launcher builds these on each computer
before Play and no release carries them; Ship asks a dry run whether the
collection installed on the shipping machine can build them. To see a
collection change build by hand, run
scripts\mods\Build-Generated.ps1 -Root <own-install> -NoPause.
Pandora 5.0.0-beta runs from a scratch copy with explicit game and output
paths. The recorded recipe enables Precision and the three True Directional
Movement patches. BodySlide builds CBBE 3BBB Amazing NeverNude, HIMBO Body -
Vanilla Nevernude and CBBE Vanilla - Body - Astrid at their defaults.
No RaceMenu morph output is built. The burned body replaces the old mesh
containing genital shapes. The script records 29 generated files for this
recipe and installed mod list.
<!-- 1247:end -->

Check: the generated record is current and
scripts\mods\Check-CoveredBodies.ps1 -Game <own-install>\Game exits 0.

## 10. Check the complete release inputs

Run scripts\mods\Check-CleanInstall.ps1 against each server after its deploy,
pointing its Data and plugin-list parameters at the corresponding own folder.
Keep 48 full plugins, Content at position 31 and Estate at position 22.
The collection revision in the release feed must be 2.

Check: tests\test-collection-revision-2.ps1 validates the order against local
settings and both server manifests; a final release requires matching live
manifests rather than treating an old server as finished.

## 11. Publish and validate Dev first

Prepare the local server with Deploy-Gamemode.ps1 -Vortex -NewOrder only when
the full order is changing and a world migration is intended. With the same
48-position order, use the explicit own-folder Data and plugin list instead.
Deploy-DevGamemode.ps1 -LoadOrder updates Dev's gamemode and the plugins its
own load order names on ports 7787/7788, preserving its own settings. When
the order itself moves, add -Dist with the dist\server folder Deploy-Gamemode
wrote, so that build's order is written over Dev's (#2309). Ship -Channel dev
from Dev's own release folder and the committed source/build records.

Check: Dev answers, its manifest matches, its generated record is current,
and its feed serves every asset recorded in the new Dev release.

## 12. Publish Main and its installer

Patrick authorized Main on 3 October. Merge completed work through reviewed
PRs with green Launcher builds, bump the launcher version through a PR,
and ship from clean main. Deploy the recorded server build and gamemode,
then Ship -Channel main -Package. Sign release executables normally.

Check: Main answers on ports 7777/3000, its manifest matches the game,
and its feed and installer carry the published release and revision 2.

## 13. Deploy the site, docs and supporting services

Deploy-Docs.ps1 -Site publishes the site and generated documentation while
preserving hosted editable pages. Deploy changed bot and voice code through
their existing deployment scripts, preserving their private settings.

| Item | Reaches people through | Where it belongs | Why |
| --- | --- | --- | --- |
| Pinned mods | Nexus collection | Vortex source | Their authors supply their files. |
| Client runtime and launcher | Signed release | Thornswood own folder | Build records tie them to source. |
| Content records | Collection base and owned release updates | Same bytes as server | Fishing, crafting and Creation Kit records must match. |
| Behaviors and covered bodies | Recorded generated pack | Each channel's own folder | The collection cannot run generators on behalf of a release. |
| Hosted documents | Site deployment | Editable hosted pages | Deployment preserves existing edited documents. |

Check: public pages, bot and voice service health are verified after deploy.

## 14. Verify channel separation

Capture the Dev feed before publishing Main and compare it afterwards.
A Main Ship must not reset Dev's launcher version, packs, release id or feed.
Main and Dev retain distinct releases even when they use the same source.

Check: Main has its own new release; Dev's feed remains the independently
published Dev release.

When both channels ship the same clean Main commit, both use the committed
three-part launcher version. Ship Main first, then Dev so Dev reads Main's
published version and source. A separate Dev branch retains its fourth-part
version; promotion must bump Main above every published Dev version.

Revision 2 enables FNIS.esp and disables CBBE.esp, RaceMenuMorphsCBBE.esp and
the three plugins from the excluded Default 3BA Vanilla Outfits package.
Keep Profile/OwnGame, Profile/Default and the live profile aligned. The
publisher refuses enabled plugin references whose files are absent from Data.
Both channels must pass the launcher's Scan and the 48-position server check.

The NPC runtime and durable dungeon rewards run on Main and Dev, using each
server's own private ledgers and world. Merchant quotes are available;
buying and selling remains disabled because native transfers are unfinished.
Dev news promotion is checked against Main's published source ancestry rather
than matching headlines. A failed Main feed read preserves the prior status.

## 15. Keep the historical loose-file audit

The table below records 424 files measured on 29 September. Held files stop
shipping at revision 2. Styles was subsequently excluded, so its old loose
children's meshes are dropped and the baseline collection's meshes show.
The 140 outfit builds retained until #1259 remain a separate recorded task;
the new body recipe does not claim to rebuild those outfits.

<!-- loose:start -->
| Files | Count | Where they come from | What happens |
| --- | --- | --- | --- |
| RaceMenu's menus and translations (`Interface\racesex_menu.swf`, `racemenu\`, `vr\`, `Translations\racemenu_*`) | 18 | RaceMenu (19080), in the collection: the same bytes are inside its RaceMenu.bsa | Out now; the collection installs them |
| Travel clothes, the same bytes as Common Clothes' archive | 30 | Common Clothes (5063), in the collection | Out now; the collection installs them |
| Skyrim Sewers' countess dress, an Elysium Estate book texture | 2 | Skyrim Sewers (9320), Elysium Estate (4119), in the collection, same bytes | Out now |
| Male face expressions and beards (`character assets\MaleHead.tri`, `EyesMale.tri`, `faceparts\`, `mouth\`, `beards\`) | 77 | Expressive Facial Animation - Male Edition (19532) | **Held**: revision 2 adds the mod |
| Fitted vanilla hoods, and the fishing and apprentice robes (`clothes\robemythicdawn\`, `clothes\thalmor\`, `creationclub\bgssse001\clothes\`) | 14 | CBBE 3BA Vanilla Outfits Redone (109194), its prebuilt meshes | **Held**: revision 2 adds the mod |
| Children's clothes (`clothes\childrenclothes\`, `_byoh\clothes\childrenclothesvariants\`) | 10 | Styles of Skyrim Mashups - Children Clothes Variations and Mesh Fixes (154063), Vanilla Mesh Fixes Standalone | **Held** historically; excluded from revision 2, so the collection's original children's meshes show |
| A noble end table (`furniture\noble\nobleendtable04.nif`) | 1 | Assorted Mesh Fixes (32117) | **Held**: revision 2 adds the mod |
| The message board Thornswood-Content.esp used to place (`missiveboardcotnd.nif`, in a folder named with the other server's prefix, dev packs only) | 1 | No mod at this path; kept from the other server's records | Out since #2298: the plugin's board is Thornswood's own mesh, `thornswood\noticeboard01.nif`, and the held line came out on 16 October (#400) |
| Travel clothes built in BodySlide | 120 | Built on some other machine from Common Clothes and Armors 3BA BodySlide (83980), for a body and preset nothing records | **Ours for now (#1259)**: still ships until Thornswood builds the outfits itself from the collection's BodySlide projects |
| Bosmer armour built in BodySlide (`armor\bosmerarmormaty743\`) | 18 | `.tri` morphs built from Immersive Armours SSE CBBE 3BA BodySlide (22382, in the collection) | **Leave (#2454)**: Patrick, 17 Oct: Immersive Armors is used as-is through the collection and nothing built from it is redistributed (`permission-held.txt`); the next release takes the morphs off installs |
| More Craftable Equipment's executioner built in BodySlide (`MCE\clothes\executioner\f\`) | 2 | Built from its CBBE BodySlide file (44666) | **Ours for now (#1259)**, as above |
| Capital Windhelm's and Crossed Daggers' outfits, refitted (`surarmorcustommeshes\`, `clothes\saviik\`) | 15 | A refit of Capital Windhelm Expansion (42990) and The City of Crossed Daggers (168629) outfits that is not on Nexus | Out now; their own meshes, from the collection, show instead |
| Vanilla outfits refitted by nobody traced (`clothes\farmclothes03\`, `monk\`, `sheogorath\`, `dlc02\clothes\`), women's tails | 12 | Not found on Nexus | Out now |
| Leftovers nothing loads: `MCE\Clothing\`, `0CCE\`, `armor\dragon priests\`, `pulcharmsolis\`, `Armor_Replacer\` (3 files), `surwhiterunmeshes\` | 59 | Mage Clothing Expansion (128173), Common Clothing Expansion (134088), Armory of the Dragon Cult (94244), Armors of the Velothi (62752), NordwarUA's compilation (61423), Capital Whiterun Expansion (37982): none of their plugins is on the server, so nothing uses these | Out now. Adding any of them would add a plugin and move the load order |
| Bethesda's own meshes, notes and a Creation Club script, loose | 23 | The same bytes as the game's own archives | Out now; everybody's game has them |
| Scripts of mods nobody has: `IED.pex`, `MCM.pex`, `MCM_ConfigBase.pex`, `dlc1vcmoondial*.pex`, `wbptlight*.pex` | 7 | Immersive Equipment Displays (62001) without its program, an old MCM Helper that overrides the collection's newer one (53000), the Unofficial Skyrim Special Edition Patch (266) without its plugin, interior mods' light switches | Out now |
| Another server's: its haybale mesh (in a `weapons` folder named with its prefix), `TrueHUD\RP_Bosses.ini` | 2 | Another SkyMP server's; the boss list's own first line says "Daedric Online boss health bars" (#1253, Patrick: it goes) | Out now |
| Retextures with no mod found: `riftencanalwood01.dds`, Windhelm wood (dev only) | 5 | Not found on Nexus | Out now |
| The Creation Kit's face tint export for FishingInSkyrim.esp | 2 | Made here by the Creation Kit; Thornswood Content already carries the `.dds` the game reads | Out now |
| Settings written on one machine: SkyUI's `config.shipped.txt` (the launcher's copy of SkyUI's own), the ImGui window files, Community Shaders' settings and ImGuiVRHelper's (neither mod is in the collection) | 6 | Written on the machine that built the pack | Out now |
<!-- loose:end -->

Check: the table still totals 424 files and its retained outfit rows match
scripts\release\built-until-1259.txt. Changes to the order or ownership
rules require corresponding tests in the same PR.
