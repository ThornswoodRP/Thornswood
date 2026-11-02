# Rebuilding onto the 7essxf collection

The old Nexus collection `ombo2a` is replaced by the rebuilt Nexus Vortex
collection, slug `7essxf`, at
`https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf`, for
Steam Skyrim SE 1.6.1170. This page records what changed in the repository, what
was audited for removal and why, and the steps that can only run on the shipping
machine.

Patrick's split, and how this PR fits it:

- Pre-collection work promotes to main separately on the ship PC (a main Ship
  plus the deploys). This PR is not required for that promote and does not touch
  the live main feed.
- The new collection work stays dev-only: it is meant to go out with
  `Ship.ps1 -Channel dev` after this lands, then be promoted later.

## What this PR changes

- `launcher/app/Config.cs` `Config.Collection`, the launcher's shipped fallback
  address, now points at `7essxf`. The live `collectionUrl` in the feed still
  points at `ombo2a` until `Set-Collection.ps1` is run on the ship PC, which is
  the step that reaches every launcher.
- The slug and URL are swapped everywhere else they were hardcoded: the
  `LoadOrder.ps1` and `Check-CollectionRules.ps1` tooling, the collection-slug
  and revision tests, and the docs (`SERVER.md`, `FEED.md`, `CLEAN-INSTALL-RUN.md`,
  `OWNERSHIP.md`, `THIRD-PARTY.md`).
- `THIRD-PARTY.md` now records Thornswood Content 1.2 (was 1.1.0), with a note
  to re-measure its files on the ship PC once 7essxf is installed.

## Load-order and plugin fixtures: baked on the ship PC, not in this repo

There are no checked-in client or server plugin lists to update. The server's
list is written by `scripts/mods/Sync-LoadOrder.ps1` into the engine build tree
(`Where.ps1 ServerSettings`, `build\dist\server\server-settings.json`), and the
reference `plugins.txt` lives under the ship PC's `Profile`. Both are derived
from Vortex's deployment of the installed collection, which does not exist on a
cloud runner, and no live `Plugins.txt` was attached to this task. So the load
order for the new mod set has to be baked on the ship PC after 7essxf is
installed. The steps are under "On the ship PC" below.

## Why a fresh installer already carries no duplicate or conflicting mod patches

This was the main worry behind the cleanup, and the shipping path already
answers it by construction rather than by a hand-kept list:

- A pack leaves out every file Vortex deployed: `Publish-Update.ps1` reads
  Vortex's own deployment record (`Get-ShipOwnGameCollection` in
  `Ship-Rules.ps1`, backed by `Profile\OwnGame\files.txt` origin `V`). The
  installer's game files are Velopack's package since #4824, built by
  `scripts/release/Build-GameFiles.ps1` from dev's last release, whose files
  were held to those rules when it was published, with this checkout's own
  files over it, so no file of the collection goes in. Until #4824 the old
  installer's builder left them out the same way, by the same record.
- Because the exclusion is driven by what Vortex actually deployed, every mod
  the rebuilt 7essxf list adds (the JK's city expansions, Container
  Distribution Framework, SKSE Menu Framework, imGui Icons, and the rest) stops
  being carried the moment Vortex provides it, with no code change here.
- `scripts/release/Ship-Rules.ps1` already treats the script extender, NirnLab
  UI Platform, other people's frameworks and tools, and Bethesda's own files as
  never-shipped. The SKSE note there already reads "it is in the collection now,
  so shipping it again would be redistributing somebody's mod and doing it twice."
- `scripts/release/optional-packs.txt` is empty, so no optional patch pack ships.
- The only plugin checked into the repo is Thornswood's own
  `game/content/Thornswood-Content.esp`. There are no hand-made hotfix copies of
  collection plugins in the tree to remove.

So nothing was removed from the shipped installer or launcher, because there was
no hardcoded, collection-provided patch bundled in them to remove. The exclusion
is already collection-driven and self-correcting.

## What is deliberately kept

- `launcher/app/Enforce.cs` rewrites `SkyrimSoulsRE.ini` and
  `OpenAnimationReplacer.ini` on every Play. This is not made redundant by the
  collection carrying those files: both mods rewrite their own ini on exit, so a
  value shipped in the collection does not survive a session. The class exists
  for exactly that reason and stays.
- The `OwnGame` foreign and skip rules (`launcher/app/OwnGame.cs`) and
  `Firewall.cs` treatment of NirnLab UI Platform are unchanged. NirnLab is a
  standing question for the owners and this PR does not settle it.

## Ship-PC operator scripts to review against 7essxf (not changed here)

These live under `scripts/mods` and are run by hand on the shipping machine, not
carried in the installer, so they cannot put a duplicate patch into a fresh
installer. They were workarounds for MCM Helper's load-order and light-flag
state before the collection carried it with load-order rules, and they should be
checked against the live 7essxf collection before being run or retired. They are
left in place here because whether each is still needed depends on how 7essxf
bakes MCM Helper's flags and rules, which cannot be read from a cloud runner:

- `Fix-QuickLoot.ps1` inserts `MCMHelper.esp` into the server list after
  `SkyUI_SE.esp`, which is `MCMHelper.esp`'s own master and so the earliest
  place the entry is legal: the server's reader refuses a plugin whose masters
  are absent. The default anchor was `SunHelmDiseases.esp` until the SunHelm
  removal (issue #480) left that plugin in no load order, and the script would
  have stopped on it. It still stops when the master is not in the list, with
  a message naming what to run first. Its premise ("MCMHelper.esp is not ESL
  flagged, so it takes a real index") is the pre-light state; confirm against
  7essxf.
- `Enable-MCM.ps1` clears `SkyUI_SE.esp`'s light flag so `MCMHelper.esp` can take
  a normal index server side. Confirm whether 7essxf already carries MCM Helper
  in its load-order rules before running.
- `Add-McmShortcut.ps1` installs MCM Shortcut NG (Nexus 169548) by hand. This mod
  is not in the 7essxf checklist, so unlike the two above it is not obviously
  superseded; leave it until the owners decide whether MCM Shortcut belongs in
  the collection.

Run `scripts/mods/Check-CollectionRules.ps1` on the ship PC to see what the
7essxf collection's plugin rules actually hold before deciding on any of these.

## On the ship PC, after this lands

Run in order on the machine with the curated Vortex install, after installing or
updating the 7essxf collection in Vortex. None of this touches the live main
feed; the dev Ship is separate.

```
# 1. Point config.json and the feed at 7essxf, then push the feed. This also
#    updates the live feed's collectionUrl and sends it to the VPS (#907).
.\scripts\ops\Set-Collection.ps1 -Url "https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf"

# 2. Re-bake the server load order from the installed collection's plugin list.
.\scripts\mods\Sync-LoadOrder.ps1

# 3. Confirm the collection's plugin rules hold the reference list's order.
.\scripts\mods\Check-CollectionRules.ps1

# 4. Push the server load order to the VPS.
.\scripts\release\Publish-Server.ps1

# 5. Dev-channel ship of the launcher and pack changes (separate from a main ship).
.\scripts\release\Ship.ps1 -Channel dev "Point the launcher at the rebuilt 7essxf collection"

# 6. Re-measure Thornswood Content 1.2's files for THIRD-PARTY.md.
```
