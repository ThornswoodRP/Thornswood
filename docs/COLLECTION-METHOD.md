# The collection method

Decided 15 September 2026. Thornswood stops keeping its own copy of Skyrim.
The mods come from a Nexus collection, installed by Vortex into the person's
own Skyrim, and Thornswood is a Vortex profile they switch to.

**The game folder half of this was reversed on 17 and 18 September:
Thornswood runs from its own folder. "Read this first", below, says what is
true now.**

This is what another server does. Their collection is public in Vortex right
now: 46 mods, 4.1 GB, described as the collection used by their server.

## Why, in one paragraph

The installer was 14 GB because it carried other people's mods. That is slow,
it is a redistribution question nobody wants to answer, and every mod update
meant rebuilding and re-hosting the lot. A collection is a list of mod and file
ids. Vortex downloads each one from Nexus once, stores it in its staging folder,
and hardlinks it into the game folder. Updating a mod is editing a line.

## What was checked, not assumed

Read off the machine on 15 September:

    deploymentMethod   hardlink_activator
    stagingPath        C:\Users\<you>\AppData\Roaming\Vortex\skyrimse\mods
    targetPath         C:\Program Files (x86)\Steam\steamapps\common\
                       Skyrim Special Edition\Data

So Vortex already hardlinks, and the mods already exist on disk exactly once.
Nothing about this change makes anybody download a mod twice.

## The one conflict to fix first

`Swap.cs` points Windows' Skyrim settings and saves folders at
`C:\Thornswood\Profile` for the length of a play session and puts them back
afterwards. A Vortex profile with local saves and local game settings turned on
redirects those same two folders.

Both doing it at once is two things fighting over one junction, and the failure
mode is somebody's saves ending up somewhere neither of them looks. Under the
collection method Vortex owns that redirection and Swap has to stop. The
uninstall path already refuses to run while a junction is live, which is the
behaviour to keep.

## Read this first: half of the plan below was reversed

The plan below is from 15 September. The collection half of it happened: the
mods come from the Nexus collection deployed by Vortex, and the installer
carries the launcher and Thornswood's own content, not the mods. The game
folder half did not. On 17 and 18 September Patrick and Djinn decided the
opposite ([Settled design](guide/settled-design.md)): Thornswood runs from its own
folder, `<Root>\Game`, which the launcher builds from the Steam copy and what
Vortex deployed into it, the big files as hard links. So `Paths.Game` is
`<Root>\Game`, not the Steam copy; the game folder is built, by the launcher
rather than the installer; and `Swap.cs` still junctions the Windows Skyrim
folders every session. The rows of the table and the steps below that say
otherwise are the plan as it stood, kept for the reasoning, not what is true
now. [One Skyrim of its own](guide/the-system.md#one-skyrim-of-its-own) is what is true now.

## What changes (the 15 September plan)

| Thing | Now | Becomes |
|---|---|---|
| `Paths.Game` | `C:\Thornswood\Game` | the Steam copy, found by `Steam.Path_()`, which already exists |
| The game folder | built by the installer from their Steam files plus mods | not built at all |
| Mods | shipped in the installer | the collection, deployed by Vortex |
| `Swap.cs` | junctions the Windows Skyrim folders per session | off; Vortex profiles do it |
| Installer | 14 GB | launcher, his own content, configs |
| `Package-Thornswood.ps1` | packages `C:\Thornswood` | packages the launcher only |
| Uninstall | deletes the game folder | removes the launcher; the mods are Vortex's to purge |
| `Check-Build.ps1` default | `C:\Thornswood\Game\Data` | the Steam Data folder |
| `Deploy-Gamemode.ps1` | reads `C:\Thornswood\Profile\Default\plugins.txt` | reads the Vortex profile's plugin list |
| Launcher mod list | reads the build's `plugins.txt` | same file, different place |

## What does not change

The server, the gamemode, the door, the website, Discord sign in, the voice
server, the update mechanism, the optional pack system, and the whole roles
whitelist. None of them care where the game folder is.

`Thornswood-Content.esp` still ships from us rather than from Nexus, because it
is our own file. It goes in the collection as a bundled mod, which is allowed
for content you made.

## What gets harder, honestly

Their real Skyrim is modded while the Thornswood profile is selected. That is
the trade for one click switching, and it is how every Skyrim modding setup on
Nexus already works, but it is a real change from "we never touch your game".

Purge Mods in Vortex is what puts their Skyrim back to vanilla. That should be
named in the launcher and on the site, because "how do I undo this" is the first
question anybody careful will ask.

A Steam update to Skyrim can break a mod list. That was true before and the
separate copy protected against it. It no longer does.

## The order to do it in

1. Finish the collection. Three mods left, then publish it and take the address.
2. Turn Swap off and let Vortex own the folder redirection. Nothing else works
   correctly until those two stop fighting.
3. Point `Paths.Game` at the Steam copy.
4. Rework the uninstall: launcher only, and say plainly that the mods belong to
   Vortex and Purge is how they go.
5. Strip the game folder out of `Package-Thornswood.ps1`. The `-VortexManifest`
   exclusion built on 15 September becomes unnecessary once there is no game
   folder to exclude from, so it comes out with it.
6. Repoint `Check-Build.ps1` and `Deploy-Gamemode.ps1` at the Vortex profile.
7. Ship, then rebuild the installer, then publish it.

Steps 2 to 4 are the ones that can strand somebody mid-install, so they go out
in one release or not at all.

## Still open

Whether the launcher should refuse to start when the Thornswood profile is not
the active one in Vortex. It can tell: the profile's plugin list is readable and
`Check-Build` already compares it against the server by checksum. Refusing is
kinder than letting somebody load into plain Skyrim and get turned away, but it
is also the launcher telling people what to do with their own mod manager.
