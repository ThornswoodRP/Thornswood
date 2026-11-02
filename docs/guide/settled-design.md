# Settled design, not up for a quiet rewrite

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

- Decided by Patrick and Djinn on 17 Sep, after the three launchers kept
  getting into each other's files: Thornswood runs from its own game folder
  (`Thornswood\Game`), built by the launcher from what Vortex has deployed
  into the Steam copy, the big files as hard links so the collection is not
  stored twice, and copies of everything another launcher rewrites in place
  (settings, scripts, programs, the client folders, the master files and
  whatever else rewrites a copied file in place). Decided by Patrick on
  20 Sep: nothing here supports another server's install any more. The SkyMP
  client runtime is built from the fork and recorded in
  `records\client-build.json`; `Sync-Client.ps1` puts it in the game folder and
  Ship refuses a release whose client is not the recorded build. Nothing is
  taken from the Steam copy's `Data\Platform` or its SkyMP DLLs, because until
  that day another launcher's builds of all of them were what shipped.
  This is what ships now, corrected 18 Sep. The bullet used to say the Steam
  copy shipped until `djinn/own-game-folder` reached main. That branch is on
  main, `C:\Thornswood\Game` is built, and the launcher restarts into it:
  Profile\launcher.log records "runs from the new folder". A session reading
  the old wording would have believed the wrong layout was live, which is the
  one thing this section exists to prevent.
  Decided by Patrick on 24 Sep, for a tester whose Vortex deploys into
  another server's copy of Skyrim (its own folder under `steamapps\common`), in
  his words "detcts and fixes this but doesnt have the servers bleed": when
  Vortex deploys anywhere but the Steam copy, `Thornswood\Game` is the Steam
  copy's game plus exactly the files Vortex's record in that folder lists,
  taken from Vortex's own mods folder, and nothing else of that folder is
  read. Scan names the folder, Fix and Settings point the launcher at it,
  and with no Steam copy on the machine it refuses (OwnGame.DeploysInto,
  Gather, launcher\tests\test-vortex-folder.ps1). Djinn to agree it in #staff-updates.
  Decided by Patrick on 29 Sep (#1218, #1226): the Steam copy is the
  person's, to play vanilla at any build with their own mods, and Thornswood
  runs entirely from its own folder. With the own folder chosen in the setup
  window, first setup never writes into the Steam copy: the installer's
  payload and everything the launcher writes before the folder exists go to
  `Profile\Payload` (Paths.OwnFirst), and Make takes them in. Not chosen, the
  install uses the Steam copy as it always did, and once the folder is turned
  on and made the next start takes Thornswood's files back out of the Steam
  copy, once (OwnGame.CleanSteamCopy); an existing own folder gets the same
  from its next update. Steam's "Wait until I launch the game" is set only
  until the folder exists (launcher\tests\test-own-folder-first.ps1).
  Decided by Patrick on 29 Sep (#1232): `Thornswood\Game` takes only
  Skyrim's own files (from the Steam copy when it is on the pinned build, or
  the Downgrade's download; for a ship root, also from a folder that holds
  that build's files byte for byte, checked file by file first, #2603),
  Vortex's deployed files by Vortex's own record,
  and Thornswood's own files. Skyrim's own is the pinned build's file list,
  `records\skyrim-files.json`, read out of the depot manifests the Downgrade
  uses, never a guess by folder. A mod put into the Steam copy by hand stays
  there, and a folder made before this loses such files at its next refresh,
  logged (OwnGameKinds.cs, launcher\tests\test-own-folder-alone.ps1).
  Decided by Patrick on 29 Sep (#1247) and changed on 27 Oct (#3715): the
  behavior files and the BodySlide bodies are made in Thornswood's own
  folder, never in the Steam copy, and since #3715 by every launcher on its
  own computer before Play, never on the shipping machine for a release. No
  release and no installer carries them, because they are other people's
  work (CBBE's page disallows distribution without permission). What is
  built is `records\generated.json`, compiled into the launcher
  (`launcher\app\GeneratedBuild.cs`, which `scripts\mods\Build-Generated.ps1`
  runs too). The behavior files come from Pandora Behaviour Engine+, which
  the collection carries from revision 2, because Nemesis cannot generate
  from a command line (tests\test-build-generated.ps1).
- Whichever folder the game runs from, the launcher looks after its own
  files: Keep puts its files back before Play and parks any plugin in
  `Data\Platform\Plugins` that is not ours; Hold keeps its files open read
  only while the game runs; the plugins idle unless the client points at our
  server and a fresh session note is there; Publish-Update packs what belongs
  and nothing else (Ship-Rules.ps1, by what is ours rather than by whose
  anything is). No wrapper scripts around the launcher, nothing moved by hand
  in Data\Platform, nothing touches Vortex's own files.
- The SkyMP client runtime is built from the fork, the `engine\skymp`
  submodule of this repository on `thornswood/engine-changes`, and recorded
  in `records\client-build.json` by `New-ClientBuildRecord.ps1`.
  `Sync-Client.ps1` puts the six recorded files in the game folder and
  refuses any that is not the recorded build; Ship refuses a release whose
  client is not. Every change Patch-Client.ps1 used to make by text is in the
  fork's source, and that script is gone.
  Decided by Patrick and Djinn on 25 Sep, so the second machine has
  everything and GitHub holds it: the fork, its build and the release output
  live in the repository folder, not in `C:\Thornswood-Dev`. The fork is the
  `engine\skymp` submodule, pinned to the commit the build records name; the
  output (packs, launcher, installer, server payload) is `out`, ignored by
  git; anything else that folder held and that never goes to GitHub is
  `local`, ignored too. Scripts ask `scripts\release\Where.ps1` where each of these is
  rather than naming a path. It no longer falls back to `C:\Thornswood-Dev`:
  no machine has that folder any more, and the fallback went on 28 Sep
  (issue #440), along with the forwarding copies in `tools\`. The files a
  machine kept in `tools\` moved on 29 Sep (signing.json to `records\signing`,
  the setup stub to `out`, the rest to `local`) and the folder is gone.
- The launcher is Avalonia on .NET 10, Windows only, self-contained and
  published with Native AOT, and Velopack installs and updates it. Decided
  by Patrick on 26 Oct 2026 (#3209, docs\studies\launcher-stack\README.md):
  the stack is Avalonia on .NET 10, the install moves into compiled code and
  Velopack, and the game files update through Velopack with the feed's
  checks rebuilt on top of it. It replaced the WPF launcher on the .NET
  Framework 4.8.1 that MSBuild built (#498) in one change (#4823, #4824,
  #4825), with nothing kept for the old one.
  `scripts\release\Build-Launcher.ps1` runs `dotnet publish` on
  `launcher\app\Thornswood.csproj` (win-x64, Native AOT, which publishes on
  Windows only) and has no other way. `LangVersion` is latest. Code stays
  AOT safe: System.Text.Json with a source-generated context, LibraryImport
  or DllImport, generated COM interfaces, no reflection serializers and no
  `Assembly.Location`; the project's AOT analyzers say when a change is not.
  The harnesses build launcher files with the same .NET SDK at the same
  settings, on any machine (`tests\Launcher-Csc.ps1`,
  `tests\launcher-csc.js`). C# inside a script that Windows PowerShell 5.1
  compiles with `Add-Type` (the Framework compiler, as in
  `scripts\dev\Check-Secrets.ps1`) stays C# 5, and so do the launcher files
  such a script compiles: `launcher\app\VortexProfileState.cs`
  (`scripts\mods\LoadOrder.ps1`) and the others `tests\Framework-Csc.ps1`
  names; `tests\test-vortex-profile-state.ps1`, `test-2791` and `test-2827`
  hold them to it.
- Every change goes out as one complete release: launcher, game files and
  server together, never a half.

Anything that changes one of these is a few lines in #staff-updates first: the
problem, the approach, what it touches. Agreed in #staff-updates by
the team before code; nobody settles it alone, and a Claude never does.
