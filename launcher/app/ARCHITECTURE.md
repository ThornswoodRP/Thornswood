# How the launcher is put together

This page is for somebody opening `launcher\app` for the first time. It says how
the launcher starts, which class owns which files, and exactly what happens
between pressing Play and the game window appearing, with the file and line of
every step. It replaces a finished note about wiring Discord.cs in, which both
long-form documents used to point at as if it were this page.

## Which install this describes

Thornswood's own game folder, the settled design since 18 Sep. The game runs
from `<Root>\Game` (`C:\Thornswood\Game` on the main build,
`C:\Thornswood-DevBuild\Game` on the dev build), which OwnGame made from what
Vortex deployed into the Steam copy: big files as hard links, anything another
program rewrites in place as copies. It takes three kinds of file and nothing
else (#1232): Skyrim's own, by the pinned build's list, Vortex's, by Vortex's
record, and Thornswood's own, by its records; a mod the person put into the
Steam copy by hand stays there. In this shape `Paths.Collection` is false
and `Paths.Game` is `<Root>\Game`.

The older shared shape, where there is no `<Root>\Game` and the game would run
out of the Steam copy (`Paths.Collection` true), is still in the code for one
reason: so the launcher can recognise it and refuse to Play from it (step 3
below). Where a step behaves differently in that shape, the page says so in
one line. Nothing here describes it as something to run, and the two shapes
must never be mixed in one release.

Until the folder is made there are two ways in (#1226), chosen in the install
window (the launcher's first start, #4824). With Thornswood's own folder
ticked, the install (InstallSteps.cs) puts Thornswood's game files in
`Profile\Payload` and writes nothing into the Steam copy;
`Paths.OwnFirst` is true and `Paths.Game` is `Profile\Payload`, so every writer
below lands there, and Make takes it into `<Root>\Game` and removes it. Not
ticked, they go into the Steam copy with `Profile\installed-into-game.txt`
and `Paths.Game` is the Steam copy, as it always was; once the folder is made,
the next start takes Thornswood's files back out of the Steam copy, once
(`OwnGameClean.cs CleanSteamCopy()`).

`<Root>` is the install folder and `Profile` means `<Root>\Profile`. Every file
named below is in `launcher\app` unless the path says otherwise.

## Reading the references, and keeping them true

A reference looks like `ShellPlay.cs:143 Play()`: the file, the line, and the
name found on that line. A name ending in `()` is where that method is
declared. A name without them is the line that calls it, sets it, or wires it.

Lines move every time somebody edits a file above them. The name is the
anchor: if the line has moved, search the file for the name. Run
`node launcher\tests\test-architecture.js` and it prints where every moved reference is
now. It fails when this page names something that is no longer in its file,
or lists the steps of one method in an order the code no longer runs them in.
A line that has only moved is a NOTE, never a failure, however far it moved:
where a name is on more than one line, such as a method's declaration and a
call to it, the harness follows the one that moved with the references around
it, not the nearest.

Whoever changes a step on this page changes the page in the same pull
request. The Play sequence changes more than anything else here, so that is
the part to check first.

## 1. Starting up

### What the exe is

`scripts\release\Build-Launcher.ps1` runs `dotnet publish` on
`launcher\app\Thornswood.csproj` for win-x64 with Native AOT (#4823): every
`launcher\app\*.cs` and the compiled window are turned into native code, with
the .NET runtime and every library the project names linked in, so
`Thornswood.exe` needs nothing installed on the PC, no .NET and no WebView2.
Beside it go the native libraries Avalonia draws with (`libSkiaSharp.dll`,
`libHarfBuzzSharp.dll` and `av_libglesv2.dll`), which are DLLs of their own
and not linked in. It embeds, as resources: the emblems, the header art
(`launcher-header.jpg`) and its moving strip (`launcher-header.webp`), the
icons, the `Thornswood.ini` template from `launcher`, and
`records\client-build.json`, `skyrim-files.json`, `ui-gone.json` and
`generated.json`. The project file lists them, by the name the code asks for.
There is no ui.xaml, no voice page and no WebView2 or NLayer DLL to embed any
more: the window is compiled, voice is the launcher's own code, and NLayer is
a NuGet package compiled in like the rest.

A merge release packs that folder with Velopack (#4825,
`.github\workflows\merge-release.yml`): one package with the launcher and
Thornswood's game files, which Velopack's Setup.exe installs and the launcher
updates from (Velo, section 2). A launcher published by hand into a test root
is not a Velopack install and never updates itself.

### The compiled window

The window is `launcher\app\MainWindow.axaml`, compiled with the launcher
into the `MainWindow` class (`MainWindow.axaml.cs`), and `App.axaml` is the
application, which loads Avalonia's Fluent theme and nothing else
(`App.axaml.cs`). Every `x:Name` in the markup is a field of `MainWindow`, so
a control renamed there and not in the C# is a build error. The window has no
logic of its own and no event handlers in its markup. Its code file adds only
the two moments Shell waits for that Avalonia's `Window` does not name the way
WPF's did: `ContentRendered`, once, when the first frame with everything on it
has been drawn, and `StateChanged`. So:

- `Shell.cs:743 Bind()` takes each named control from the window's generated
  fields (`win.BtnPlay` and the rest) and keeps it in a static field.
- `Shell.cs:2186 Wire()` attaches every handler in code.
- `Shell` is therefore a static class, not a `Window` subclass, and it is
  split across every file that declares `partial class Shell`: Shell.cs,
  Pages.cs (the read-only pages), ShellOwnGame.cs (the game folder card and
  offer), ShellSteamUpdates.cs (the question about Steam's Updates setting at
  the start), ShellUninstall.cs (the launcher as Windows' Uninstall button
  opens it), ShellProgress.cs (the Play button as a progress bar),
  ShellScanFix.cs (Scan and Fix on Diagnostics), ShellUpdate.cs,
  ShellChars.cs, ShellPlay.cs, ShellNews.cs, ShellPacks.cs,
  ShellVortexWatch.cs, Waiting.cs and Stall.cs.

Message boxes are Windows' own, through Ask.cs (MessageBoxW): Avalonia has
none, and every caller waits for the answer on its next line. They work
before Avalonia has started, which the second copy check in Main and its
"could not start" box need, and once the window has drawn they take it as
their owner (`Ask.Owner`, row 24 below).

### The startup order

In the order Main and Run take it. Everything happens on the window's thread
unless it says a pool thread.

| # | Where | What it does and what it leaves behind |
|---|---|---|
| 1 | `Shell.cs:203 Main()` | First `Shell.cs:207 Velo.Start`: when Velopack runs the exe to tell it about an install, an update or an uninstall, Velopack answers and the process ends there (`Velo.cs:52 Start()`). Then a mutex named for this install folder (`Shell.cs:281 MutexName()`), so the main and dev builds can both be open. A second copy of the same build says so and exits. Anything thrown out of Run is appended to `Profile\launcher.log` as COULD NOT START and shown in a box. After Run returns, `Shell.cs:270 Velo.ExitApply` is the last line: an update downloaded and checked while the launcher ran goes in now (Velo, section 2). |
| 2 | `Shell.cs:334 Run()` | Reads `-root` and `-uninstall` off the command line, then `Shell.cs:346 AppBuilder.Configure` sets Avalonia up without starting it, since no window can be made before that; Run keeps the message loop to itself (row 27). |
| 2a | `Shell.cs:361 Velo.InstallRoot` | The folder the install recorded beside Velopack's own (InstallPlace.cs), else `-root`, else the folder above the exe's. On the first start after Velopack's Setup.exe there is none, so `Shell.cs:367 installing.Show` opens the install window (InstallWindow.cs, #4824) and `Shell.cs:368 Pump` keeps it answering until it has installed or been closed. Closed without installing, Run returns and the launcher ends. Installed, it stays up until the launcher's own window is on screen (row 27). Not on a start to uninstall. |
| 3 | `Shell.cs:373 Paths.Init` | `Paths.cs:71 Init()` works out Root, Game and every Profile path, once. Nothing recomputes them, which is why making the game folder restarts the launcher. Then `Shell.cs:377 LocalKeep.Tidy` cuts `Profile\launcher.log` to its last 30 days and deletes support zips in `Profile\Reports` older than that (`LocalKeep.cs:44 Tidy()`, #3679), before anything else writes the log. Then `Shell.cs:383 Acceptance.Ensure` asks for the terms when there is no record of them (below the table). |
| 4 | `Shell.cs:384 Config.Load` | Reads `<Root>\config.json` (`Config.cs:356 Load()`). Then `Stats.Load` reads `Profile\stats.txt`. |
| 5 | `Shell.cs:391 MainWindow` | Makes the compiled window. |
| 6 | `Shell.cs:393 Bind` | Takes the controls, and sets `Discord.Folder` to Profile. |
| 7 | `Shell.cs:394 Themes.Apply` | Colours from config.json's theme. |
| 8 | `Shell.cs:395 Wire` | Attaches every handler, including the Play button, calls `WirePages` and `WireOwnGame`, and starts the two second timer (`Shell.cs:2513 DispatcherTimer`). |
| 9 | `Shell.cs:396 BuildThemeRow` | Then `Shell.cs:397 BuildThemeEditor`, `Shell.cs:398 BuildDisplay`, `Shell.cs:399 BuildStatRow`, `Shell.cs:400 BuildPathRows`: the theme buttons and the colour editor, the display rows on Settings, the strip of figures from `Profile\stats.txt` (time played, sessions, last played, last update), and the install and game folder rows. They draw controls and write nothing. |
| 10 | `Shell.cs:406 OpenForUninstall` | Only when Windows sent `-uninstall`, which is what Uninstall under Installed apps runs. `ShellUninstall.cs:51 OpenForUninstall()` stops the two second timer before it has ticked, stands down the game folder check, opens on Settings with the Uninstall button in view, and runs the message loop itself. Run returns from here, so no row below this one happens: no update check, no server scan, no client repair, no voice, and the Installed apps entry is not written again. |
| 11 | `Shell.cs:408 RefreshDiscord` | The Discord card, then `Shell.cs:411 PullDiscordAvatarIfNeeded` and `Shell.cs:412 ShowPage`, which opens on Play. |
| 12 | `Shell.cs:417 Register.Ensure` | Writes this install's entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` (`Register.cs:78 Ensure()`). |
| 13 | `Shell.cs:430 Discord.SendPendingLogs` | Pool thread. A session that ended without sending its logs (`Profile\logs-pending.txt` still there) sends them now, before a new game start truncates them. |
| 14 | `Shell.cs:436 AutoJoin.Ensure` | Makes `Game\Data\Platform\Plugins\skymp5-client-settings.txt` when there is none (`AutoJoin.cs:52 Ensure()`). |
| 15 | `Shell.cs:445 Checks.GameRunning` | A game still running from before the launcher was restarted is taken over: `Shell.cs:455 Hold.Take` holds our files again and nothing is pulled apart under it. Otherwise `Shell.cs:460 Swap.Restore` takes off any redirect a crash left and `Shell.cs:461 Keep.TakeNote` deletes a stale session note. |
| 16 | `Shell.cs:463 Leaks.Clean` | Deletes the one sign in file a 16 Sep installer shipped, matched by hash, and, in Thornswood's own folder only, each mod menu setting, window layout and note of the machine that ships that the dev records of 28 and 29 Sep handed out, while it is still the bytes they handed out (#1252). A pool thread runs `OwnGame.CleanSteamCopy`, which once the folder is made takes Thornswood's files out of the Steam copy, once, and removes a leftover `Profile\Payload`. Then `Shell.cs:472 ThornIni.Ensure` writes `Game\Data\SKSE\Plugins\Thornswood.ini` from the template if it is missing. Before the folder exists and when no downgrade is needed (`SteamUpdates.LooksAtStart`), `Shell.cs:474 HoldSteamUpdatesOnStart` logs Steam's Updates setting for the Steam copy of Skyrim and sets it when it does not hold the version (see SteamUpdates below). |
| 17 | `Shell.cs:476 Keep.Unpark` | Puts back plugins a crashed session left parked. Then `Shell.cs:480 Keep.Seed` fills `Profile\Keep` from pack records for files it has no copy of yet. |
| 18 | `Shell.cs:489 Display.MatchScreen` | Unless Lock resolution is ticked: the game's resolution follows the screen. |
| 19 | `Shell.cs:502 Icons.Ensure` | Pool thread. The shortcut icon follows the exe. `Shell.cs:519 ClearLeftovers` (pool) ends a windowless Skyrim over three minutes old. `Shell.cs:533 Uninstall.DropScratch` (pool) deletes the installer's leftover `Thornswood-setup` folder. |
| 20 | `Shell.cs:550 RunScan` | `Verify.Run` against the server's manifest and Upkeep's quick checks (#2627), then the Scan and Fix card. Then DrawStatus fills the checklist (on Diagnostics since #607), the Play summary and the button (see "The gate" below). |
| 21 | `Shell.cs:557 HealClientBackground` | Pool thread, only when the six client runtime files are not the recorded build: `ClientRuntime.cs:223 Heal()` fetches them. Then `Shell.cs:558 AutoDisplayOnce` marks `config.json` so it never runs again and, on an install that has never played, matches the game's resolution to the screen; `Shell.cs:559 StartPing` asks whether the server is up, and `Shell.cs:560 StartGallery` fills Play's spotlight. |
| 22 | `Shell.cs:563 CheckUpdatesBackground` | Pool thread: the update check (see Updater in section 2). Always: config.json cannot switch it off, and Play stays shut until it answers (#937). Then `Shell.cs:564 StartFeedWatch`. |
| 23 | `Shell.cs:569 Voice.Start` | Voice comes up with the launcher, in its own code on threads of its own, with no window and nothing to prepare (see Voice in section 2). Then `Shell.cs:574 StartMenuMusic` is queued until the window is idle on screen. |
| 24 | `Shell.cs:582 win.ContentRendered` | Once the window has drawn its first frame (MainWindow.axaml.cs), `Shell.cs:584 LogStartTime` writes one line to `Profile\launcher.log`, `Launcher start: the window was on screen <s> s after the launcher started, <s> s of it the mod check, on launcher <version>.`, timed from the process's own start and the Stopwatch around RunScan (#3534); the weekly review totals them with `scripts\vps\Read-LauncherStarts.ps1`. When `Shell.cs:585 Velo.Restarted` says Velopack started this launcher straight after putting an update to it in, a pool thread brings the shortcut icons up to date (`Shell.cs:589 Icons.Ensure`) and then, in Thornswood's own folder, Fix runs as it does after any update (`Shell.cs:595 RunFix`, #3201), so the update that restarted the launcher ends the way Install now does. Every other start skips that. Last, `Shell.cs:599 Ask.Owner` gives message boxes the window. |
| 25 | `Shell.cs:603 WindowFit.Keep` | The window inside the screen's work area at any display scale (#463), then `Shell.cs:604 CentreOnMainScreen`. |
| 26 | `Shell.cs:623 win.Closed` | Ends the message loop when this window closes, whatever else is open. `Shell.cs:630 Dispatcher.UIThread.UnhandledException` logs a fault, with each frame's offset into the native exe, and keeps the launcher up. `Shell.cs:663 StartStallWatch` logs when the window stops answering. When the terms were already on record, `Shell.cs:677 Acceptance.Recheck` asks again from a pool thread about any page that changed (below the table). |
| 27 | `Shell.cs:692 win.Show` | The window goes on screen, then `Shell.cs:693 installing.Close` closes the install window if this start installed, and `Shell.cs:694 Dispatcher.UIThread.MainLoop` is the message loop. Run does not go past it until the window closes; then voice, presence and the hold are let go (`Shell.cs:696 Voice.Stop`), and Main ends with the update waiting, if any (row 1). |
| 28 | `ShellOwnGame.cs:49 OnceOnScreen` | Once the window is on screen: `ShellOwnGame.cs:102 OwnGameAtStart()` refreshes the game folder by itself when Vortex has deployed since it was made (`OwnGame.cs:1197 NeedsRefresh()`), or offers to make it in the shared shape. When Vortex deploys into a Thornswood game folder it logs why nothing is refreshed and what to do (`OwnGame.RefusedSource`). Play also asks that same test now, through `OwnGameRefreshIfDue`. |

An install made before the terms lock has no Profile\accepted.json. Run asks
before it reads config, unless it was started to uninstall, and returns
without opening when the three boxes are not ticked. A record already on disk
is checked again from a pool thread once the window can show the same boxes
(row 26), and declining that change closes the launcher.

### Threads

There is one window thread, Avalonia's UI thread. Anything that waits on the
network or a large file runs on a pool thread and comes back with
`Dispatcher.UIThread.Post`. `Log` (`Shell.cs:1075 Log()`) writes a control as
well as `Profile\launcher.log`, so it throws off the window's thread; code on
a pool thread logs through `PresenceLog`, `SafeLog` or `LogOnly`. A caught
exception that nothing acts on goes to `Swallow.cs:26 Note()`, one line in
`launcher.log` from any thread and never a throw. `Waiting.cs:39 Waiting()`
runs one piece of work on a pool thread while the window keeps drawing (in a
dispatcher frame of its own), with the controls off, and carries on from the
next line when it is done. Most of the slow steps in Play go through it.
`Waiting.cs:94 Pump` does the same for something Avalonia only offers as a
task, such as Windows' own folder picker, and `Waiting.cs:114 OnceOnScreen()`
runs work once the window is first on screen and laid out. Voice runs on
threads of its own (VoiceSession.cs, VoiceAudio.cs) and never on the window's.
The HTTP requests of the launcher's own go through one shared client
(Http.cs), each with the two waits the old requests had.

### The two second timer

`Shell.cs:2515 timer.Tick` runs every two seconds for the life of the window,
except in a window opened to uninstall, which stops it before it ticks.
Every fifteenth tick it pings the server. While a game is running it reads the
character choice every tick and checks for updates every fifteenth. The tick
that finds the game gone runs the whole close sequence (section 3, "When the
game closes").

## 2. What each part owns

One paragraph per class, naming the files it writes. Profile is
`<Root>\Profile`; Game is `<Root>\Game`.

**Shell** (Shell.cs, Pages.cs, ShellOwnGame.cs, ShellSteamUpdates.cs,
ShellUninstall.cs, ShellProgress.cs, ShellNews.cs, ShellPacks.cs, ShellScanFix.cs, ShellVortexWatch.cs, Waiting.cs, Stall.cs). The window and every flag that
decides the Play button: `playing`, `updatePending`, `updateAnswered`, `checkFailed`,
`collectionBarUp`, `ownGameBusy`, `doorCheckOut`, `feedNotice` (the last
answer FeedNotice gave), and `chosenId`, the character picked at the game's
menu this session. Writes `Profile\launcher.log` through Log and
`Profile\played.flag` at each Play.
While the collection card or the not-confirmed note is up, the two second
tick lists Vortex's state.v2 files and the plugin list (ShellVortexWatch.cs,
#5136); when they change it reads the revision again off the UI thread,
draws the card again, and asks the feed again once the card comes down, so
an update finished in Vortex is picked up with nothing pressed.

**Paths** (Paths.cs). Every path the launcher uses, worked out once in
`Paths.cs:71 Init()` from where the exe is. `Collection` says which shape the
install is; `OwnFirst` that its own folder was chosen at install and is not
made yet, when `Game` is `Profile\Payload` (#1226); `SteamCopy` is the Steam
copy, read for the game's build before the folder exists. `Skyrim` is the
folder the facts about the game are read from (its exe, the script extender,
their plugins with `SksePluginDirs`): the Steam copy while `OwnFirst`, `Game`
otherwise, and never a path anything writes to (#1235). Owns no files.

**Acceptance** (Acceptance.cs). `Profile\accepted.json`, the same file the
install window writes when the terms, the privacy policy and the rules are
ticked. `Acceptance.cs:113 Ensure()` asks when that file has no complete
record, which is an install made before the lock, and writes that file only
after all three are ticked. After that `Recheck()` asks again only when a
page's text has changed since it was accepted, shows only the changed pages,
and writes their new hash beside the others' stored ones (#2616, Patrick,
16 Oct 2026). Nothing changed asks nothing.

**Config** (Config.cs). `<Root>\config.json`, read by `Config.cs:356 Load()`
and written by Save, which encrypts the update token with Windows' DPAPI and
locks the file to this Windows account. The server address, port, collection
link, voice port and update repository in it are facts about the server, not
settings: `ShellUpdate.cs:262 OnVersionDoc()` overwrites them from version.json on
every update check. So is the Skyrim build pin (the exe size the checks look
for and the depots the Downgrade button asks Steam for), taken through
`Downgrade.AdoptPin()` when the feed carries it; the numbers compiled into
Downgrade.cs are the fallback until it does.

**Updater** (Updater.cs, Sync.cs, UpdateStages.cs, VeloUpdate.cs). The update
feed, the packs, and asking for the launcher's own replacement.
`Updater.cs:281 Check()` reads version.json from the site feed
on thornswood.net, asking with the ETag of the copy it keeps in
`Profile\feed-cache.txt` so an unchanged feed answers 304, and falls back to
the releases repository on GitHub. `Updater.cs:844 ApplyPack()` downloads a pack and
`Updater.cs:863 Install()` unpacks it: `game\...` entries into Game (hard link
names dropped first), `profile\...` entries into `Profile\Default`, the list of
what it wrote into `Profile\Packs\<pack id>.files`, the id into
`Profile\applied.txt`, and every Data\Platform file it wrote into Keep.
Since #1050, when the feed names a release record whose files are on the site
(`:record:files`), `Pending()` offers that release as one update instead of
its packs, and `ApplyPack()` hands it to `SyncRecord()` in Sync.cs: the record
is read, every file of ours is compared with it by size and sha256, only the
ones that differ are fetched from beside the record (resumed with a Range
request, each checked against its sha256) into `Profile\Sync`, then put in
place, the plugin list settled, what the record says is gone taken out, and
the release written into `Profile\release.txt` (docs\FEED.md, "Syncing to the
release record"). Once every launcher the feed lets in syncs, the feed's
`packs` is empty (docs\FEED.md, "When the packs can go"), and the update card
shows the note the record's pointer carries (`baseline.notes`, read by
`RecordRef.FromFeed` in Config.cs) rather than the last pack's.
ReleaseNews.cs is the News tab's half (#5187): the notes come from GitHub
Releases, not the feed. On the update check's own thread
(`ShellUpdate.cs CheckUpdatesBackground`), `FillNews()` asks GitHub's API,
without a token, for the newest successful Deployment to this channel's
environment (Dev or Main) that names a build Release (`payload.release`), and
for the newest hundred Releases. Each published `Release build-<day>.<n>` at or
before that one is a note: the first line of its body the title, each `- `
line one line of what changed, the time it was published the date. On a dev
launcher a note main's Deployment has not reached is marked DEV. The answer is
kept for fifteen minutes (`NewsEvery`), because GitHub allows sixty anonymous
requests an hour; a read that fails keeps the notes before and says why in
launcher.log. A feed's `news` and `newsFile` are a Ship's and are not read.
FeedSettings.cs reads the feed when the site answers it in two (#1050,
docs\FEED.md "version.json in two"): `Updater.ReadFeed`, called by
`Conditional` and `ReadCache`, reads version.json with every asset at the
feed's own `assets/` folder plus its sha256 (`AssetsOf`,
`VersionDoc.ParseFeed`), and when it names `settings`, the rest of the feed,
fetches that once by its sha256, checks it, keeps it in
`Profile\feed-settings.json`, and joins the two (`VersionDoc.Join`).
On a dev build the News tab's header says what main is on from main's own
feed (#2434): each time the tab is shown, `ShellNews.cs ReadMainVersion`
asks `MainVersion.cs MainLauncherVersion()` for main's `launcherVersion` on a
pool thread, through `CheckUrl` and the shared client, and puts the answer
into the header line. Only while main's feed has not answered, or could not
be read, does the header name the dev feed's `mainVersion` from the last
update check, worded as such. The DEV marks on the notes come from main's
Deployment (ReleaseNews.cs, above).
The launcher itself is not in the feed any more: it updates through Velopack
(Velo, below), and VeloUpdate.cs is the same Updater class's half for it.
`VeloUpdate.cs:68 CheckLauncher()` asks this install's channel on GitHub for a
newer launcher, `VeloUpdate.cs:103 FetchLauncher()` downloads the package into
Velopack's own folder and checks it, and `VeloUpdate.cs:167 ApplyLauncher()`
leaves it to go in once the launcher has closed. `Version` at the top of
Updater.cs is the launcher's version, read from the exe: the build passes it
as `-p:Version` (`scripts\release\LauncherVersion.ps1` works it out, #5179),
in a merge release it is the Velopack package's version, and a bare build is
`0.0.0`. In the launcher,
`ShellUpdate.cs:139 CheckUpdatesBackground()` asks, `OnVersionDoc` decides,
`ShellUpdate.cs:675 RunUpdate()` installs, in two halves (UpdateStages.cs,
#2210): `FetchUpdate` downloads the release's files into `Profile\Sync`, the
packs and the new launcher's package and writes nothing into Game or the
records a refresh reads, so it runs while the game folder is being prepared;
`WriteUpdate` then puts them in under `OwnGame.Alone`, after any refresh
under way, and checks again any file a refresh changed in between; the new
launcher goes in last, when the window has closed (`ApplyLauncher`, then
`Velo.ExitApply` at the end of Main). Install now, on the card above Play and in
Settings, and the automatic update, go
through `ShellUpdate.cs UpdateNow` (#3201): the update, then Fix's whole
path on the folder the update left (`ShellScanFix.cs FixAfterUpdate`), which
scans everything again, puts right what the scan finds and never takes the
update it just tried a second time. A new launcher's first start runs the
same Fix (row 24 of the startup order). The automatic update is
`ShellUpdate.cs UpdateBySelf` (#3202), run after every update check's
answer when `Config.AutoUpdate` is on (the default; only an explicit false
in `config.json` turns it off): the start's check, the feed watch, Check
now, the retry after a failed check and the check after the game closed
for an update. It leaves the update to the in-play clock while a game the
launcher started runs, to the card while a Skyrim it did not start is open,
and never takes the update `RunUpdate` tried last a second time by itself.
`RunUpdate` runs one update at a time (`updating`). `ShellUpdate.cs:213 CheckFailed()` keeps
Play shut and asks again every thirty seconds when the source does not answer.
Every document that was read also goes to `ShellUpdate.cs:242 ShowNotice()`, which
asks FeedNotice what the bar above Play says and whether Play is held.

**PlayProgress and PlayBar** (Progress.cs, painted by ShellProgress.cs).
The Play button as a progress bar (#1145). RunUpdate, the client repair and
StartOwnGame open it with `PlayProgress.Begin` and close it with `End`; in
between, `Updater.Download` reports the bytes of each download, Sync the files
it checks and the bytes it fetches, OwnGame.Make and Refresh the files they
bring over, and Verify.Bytes the plugins it checks. A report with nothing open
is dropped, so the same code run by Fix or a Scan leaves the button alone.
While the game folder is prepared (`FolderFirst`) the button is its own, and
an update downloading beside it (a thread marked `Second`) shows itself again
with its next report once the folder is done (#2210).
`PlayBar` turns the reports into the words and the fill, never backwards
within a phase, and a band that slides while the total is unknown;
ShellProgress.cs redraws it at most every `PlayBar.DrawEveryMs`. It writes
nothing. `launcher\tests\test-play-progress.ps1` compiles Progress.cs and drives it.

**Velo** (Velo.cs, VeloUpdate.cs, VeloRecord.cs, VeloPackage.cs, #4825).
Velopack installs the launcher and replaces it, which the launcher's own self
update and its swap script did until #4825 (SelfSwap.cs went with them).
Velopack keeps the app in a folder of its own under the person's profile
(`%LocalAppData%\Thornswood`: its `Update.exe`, a small starter, `current\`
with the package's files and `packages\` with the package it came from), and
Root is apart from it on Skyrim's drive, recorded by the install window
(InstallPlace.cs) and read back by `Velo.InstallRoot`. `Velo.cs:52 Start()` is
the first line of Main, with auto apply off, so a package downloaded and not
yet put in is checked like any other before it goes in. Before an update is
put in, Velopack checks the package against the sha256 its channel's feed
names, and the launcher checks that sha256 against the Release's signed record
(`VeloRecord.Vouches`, the manifest a catalog signed with ThornswoodRelease
vouches for), every file in the package against the signed game and setup
lists or, for a program, by `Signature.Refusal` (VeloPackage.cs), and the
`Update.exe` that will apply it by `Signature.Refusal` too. A refusal deletes
the package and leaves the running launcher alone. A checked package goes in
at `Velo.cs:148 ExitApply()`, the last line of Main, after the close has put
everything back: Velopack's Update.exe waits for the process to end, puts the
new launcher in and starts it, and `Velo.Restarted` tells that launcher so
(startup row 24). The way back to the version before is Velopack's, from its
packages folder.

**Signature** (Signature.cs). Whether a program is really Thornswood's, asked
of every program in a launcher update (VeloPackage.cs) and of Velopack's
`Update.exe` (VeloUpdate.cs), and of the signed release catalogs (issue
#912). `Signature.cs:102 Refusal()` has Windows verify the signature and its
chain (WinVerifyTrust, the call behind Get-AuthenticodeSignature's Valid),
takes the chain Windows built from `Signature.cs:300 Trust()`, and then pins
Microsoft's Artifact Signing: the root, an "ID Verified CS" issuer, a
timestamp, and Thornswood's durable identity value in the certificate, which
stays the same when the three day certificate renews. Only then does it look
for `ExpectedSigner` in the Subject. `scripts\release\Assert-PublishSigned.ps1`
runs the same class before a Ship publishes, and
`tests\test-signer-check.ps1` compiles it on its own and points it at signed,
unsigned, self-signed and changed files.

**ReleaseManifest** (ReleaseManifest.cs, FeedManifest.cs). Whether the
release's signed manifest vouches for every asset the feed names (#2163,
phase C of docs\SIGNED-RELEASES.md). The feed's "signedManifest" is read
apart (`ManifestRef.FromFeed` in Config.cs). On an update check that brings
a different manifest or different assets, `Updater.ManifestLine` fetches
release.json and its catalog like any asset (a listed host, stored under
their sha256, bytes that hash to it). `ReleaseManifest.Refusal` then checks
the catalog with Signature.Refusal, finds release.json's sha256 among the
catalog's digests (wintrust's CryptCATEnumerateMember), and checks that
release.json lists every asset. The launcher, the client runtime, each pack
and the release record are those assets. Phase C only writes the answer to
launcher.log, from CheckUpdatesBackground in ShellUpdate.cs; nothing is
refused on it yet. `launcher\tests\test-2163-manifest-check.ps1` compiles the two
files on their own and checks them against a catalog ThornswoodRelease
signed.

**FeedNotice** (FeedNotice.cs). What the feed says to everybody. Three
optional fields in version.json, set by hand in the releases repository:
`message` (a bar above Play, never a hold on its own), `maintenance` (holds
Play) and `minLauncher` (holds Play in a launcher older than it; since #937
Publish-Update writes it on every publish as the launcher the feed offers, and
the site refuses a join pass below it).
`FeedNotice.cs:45 From()` turns a document into the bar's words and, when
Play is held, the reason and the button's words. It owns no files and holds
nothing on a check that did not answer; a value it cannot read leaves Play
open.

**Keep** (Keep.cs). Thornswood's own files under `Game\Data\Platform`, kept
pristine in `Profile\Keep` and put back before every Play by
`Keep.cs:323 Restore()`. Which files are ours is learned from the packs that
wrote them (`Keep.cs:175 Remember()`), plus the fixed `Core` list and any
plugin named `thornswood-*.js`. Any other script in
`Game\Data\Platform\Plugins` is parked in `Profile\Parked`, listed in
`Profile\Parked\parked.txt`, until `Keep.cs:472 Unpark()` puts it back. Also
writes and deletes the session note `Game\Data\Platform\thornswood-session.txt`
(`Keep.cs:540 LeaveNote()`), which the plugins read to know the session is
ours. `Changed()` and `PutBack()` are Restore's first half for Scan and Fix
(#2627): which kept files differ, and putting them back without parking
anything. `Profile\developer.flag` makes a newer game copy win over the kept one;
nothing writes it since 25 September, when `Go.ps1` started refreshing the kept
copies of what it installs, so the machine that ships repairs the way a
tester's does.

**Hold** (Hold.cs). Owns open file handles, not files. `Hold.cs:63 Take()`
opens every kept file and `skymp5-client-settings.txt` read only with read
sharing, so the game can read them and nothing can write, replace or delete
them. Where a parked plugin was, it stands an empty file and holds that too. A
watcher on Plugins and UI logs anything else that tries. The launcher's own
writes to a held file go through `Hold.cs:146 Around()`.
`Hold.cs:112 Release()` lets everything go.

**Swap** (Swap.cs). Where Skyrim keeps its settings and saves.
`Swap.cs:180 Apply()` moves `Documents\My Games\Skyrim Special Edition` and
`%LOCALAPPDATA%\Skyrim Special Edition` aside with `.st-backup` on the end and
puts junctions in their place pointing at `Profile\MyGames` and
`Profile\LocalAppData`, then writes `Profile\swap.json`.
`Swap.cs:41 Restore()` undoes it and is safe to call at any time, including
after a crash. `LeftRedirected()` says, reading only, whether a crash left
the folders pointed at Profile, which Scan asks while Skyrim is not running
(#2627); `MissingConfigs()` and `PutBackMissingConfigs()` are the shipped
settings files that are missing, found and put back.
In the shared shape Apply does nothing, because Vortex owns those folders
there.

**Verify and LoadOrder** (Verify.cs, LoadOrder.cs). Whether this install's
plugin list is the server's. `Verify.cs:144 Run()` reads, and writes nothing:
the shipped reference `Profile\Default\plugins.txt`, the live list
`Profile\LocalAppData\plugins.txt`, the server's manifest over HTTP on its
resources port (3000 for the main server, 7788 for dev), and the size and
CRC of each plugin. Only the Fix button writes: the reference list into the
live one, Thornswood's own plugins put in from the release the update feed
names when their bytes differ from the server's or they are missing, over
https and by the sha256 the release record gives them, and only when that
copy is the one the server's manifest describes (`Updater.ReleaseCopy`,
#3386; the old one kept in `Profile\Replaced`; no other author's plugin,
#1180),
one of ours the server's order names switched on in its place
(`PutInServerOrder`), and other servers' files moved into
`Profile\Isolated`. With no folder of its own yet (`Paths.Collection`) Run
says only that, and Fix makes the folder and writes nothing into the Steam
copy (#2403). Each issue carries its kind, the problem alone, whether Fix can
do anything about it, and what will put it right when Fix cannot.
`Verify.cs:1435 DeployPersonal()` copies `<Root>\Your Mods` into `Game\Data`.

**Upkeep** (Upkeep.cs, with ShellScanFix.cs for Scan and Fix on
Diagnostics, #2627). Everything Scan finds wrong that is not the plugin list:
an update waiting on the feed, the feed holding Play, Thornswood's own folder
behind Vortex or refused, files the folder lost (`OwnGameLost.cs`), this
build's own files changed or missing (Keep's kept files, `Thornswood.ini`,
the shipped settings files), Windows' Skyrim folders left pointed at
Profile, the shortcut icon, the client runtime, Steam not running, the
Skyrim build, and the three files made from the game (below). `Look()` reads and writes nothing in the game folder.
`FixOnDisk()` is Fix's steps that write files, with the folder to itself
(`OwnGame.Alone`); the shell's Fix brings the folder up to date from Vortex
first, then runs those steps, scans again and says only what is still wrong
and what will put it right, and then makes the own folder, takes the update
or starts the Downgrade, each of which asks first or restarts the launcher.

**MadeFromGame and FromGame** (MadeFromGame.cs, FromGame.cs,
FromGameArchive.cs, FromGameDeflate.cs, FromGameMath.cs, and the recipes
FromGameMenu.cs, FromGameBoard.cs and FromGameModMenus.cs, #2827, #3113, #3127). The main menu with no Bethesda
logo (`Data\Interface\startmenu.swf`) and the notice board and drop box
meshes (`Data\meshes\thornswood\noticeboard01.nif`, `dropbox01.nif`) are
Bethesda's files edited or put together, so Thornswood ships none of them:
FromGame reads the game's own `.bsa` archives under `Paths.Skyrim` and makes
each one, byte for byte the file that used to ship, from a recipe that
`scripts\mods\Build-StartMenu.py` and `Build-NoticeBoard.py` write on a
machine with the game. Each recipe names the sha256 of every game file it
reads, so a game on another build makes nothing and the reason names the
file that differs. MadeFromGame writes only the ones missing or changed in
`Game\Data`, before every Play and from Fix, taking the old name off first
(`OwnGame.DropName`) so a link into the Steam copy or Vortex's staging is
never written through. The own folder's refresh counts them as Thornswood's
(`OwnGameKinds.cs MadeInGame`), and `Ship-Rules.ps1 $ShipMadeFromGame` keeps
them out of every pack. `scripts\release\Go.ps1` compiles the same files to
make them for a hand-run install, and `scripts\mods\Check-FromGame.ps1`
says whether a game makes all of them.

The collection's menus are made the same way (#3113): an item on Thornswood
has no gold price, and SkyUI's item lists and item card
(`Data\Interface\skyui\config.txt`, `itemcard.swf`), SkyHUD's line under an
item somebody looks at (`Data\Interface\hudmenu.swf`) and moreHUD's value to
weight (`Data\Interface\AHZHudInfo.swf` and its copy under `exported`) draw
one. Those are their authors' files, so FromGame makes them from the mods'
own archives (`SkyUI_SE.bsa`, `SkyHUD.bsa`, `AHZmoreHUD.bsa`) with the edits
`scripts\mods\Build-ModMenus.py` wrote into FromGameModMenus.cs, each pinned
to the sha256 of the collection's version. `Ship-Rules.ps1
$ShipMadeFromMods` keeps them out of every pack. QuickLoot IE's columns are
set by its own settings file instead, which ships from `game\ours`. SkyUI's
journal (`Data\Interface\quest_journal.swf`, from `SkyUI_SE.bsa`) is made the
same way with Quick Save, Save, Load, Help and the Creation Club entries taken
off its System page (#3127), since a character lives on the server and the
help panel replaced Skyrim's help. The game still writes "disabled" into each
of those entries every time the journal opens (SetSaveDisabled), so the edit
hands it an empty object of its own in each one's place; handing it the
missing entry crashed the game on Escape (31 Oct 2026).

**GeneratedHere and GeneratedBuild** (GeneratedHere.cs, GeneratedBuild.cs,
Generated.cs, CoveredBodies.cs, #1247, #3715). The behavior files Pandora
Behaviour Engine+ makes and the bodies BodySlide builds are the game's graphs
with Precision's and True Directional Movement's patches merged in, and CBBE
3BA's, CBBE's and HIMBO's bodies: other people's work, so no release carries
them (Patrick, 27 Oct 2026, option A on #3715). The launcher builds them on
each computer, in the own folder, with the collection's own Pandora and
BodySlide, from `records\generated.json`, which is compiled into it
(`generated.json`). Generated reads `Profile\OwnGame\generated.txt`, the
record of the last build, and says whether the files are current: the mod
list, the files each tool reads (by files.txt), the build list and every
built file's sha256. GeneratedHere builds them before every Play (step 18a)
and from Fix (the Generated card, Upkeep) only when they are not, inside
`OwnGame.Alone`. GeneratedBuild is the build: Pandora from a copy in
`Profile\OwnGame\build-generated` with its own Settings.json naming this
folder's Data, BodySlide into folders of its own at each set's slider
defaults under the body rules (#1004, #405), each file put in place as a new
file of the folder's own so nothing is written through a link into Vortex's
staging or the Steam copy, and CoveredBodies reading every body in the folder
for its underwear before the record is written. A build that stops, or a nude
body, stops Play. `scripts\mods\Build-Generated.ps1` and
`Check-CoveredBodies.ps1` compile the same files (`Generated.ps1`) to run
them by hand, and Ship runs a dry run to ask whether the collection installed
there can build them. `Ship-Rules.ps1 Test-ShipGenerated` keeps them out of
every pack and off every list of removed files.

**LastPlugin** (LastPlugin.cs, #2791). `Data\Thornswood-Last.esp` copies
other authors' records out of the load order, so a release carries only its
recipe, `Data\Thornswood-Last.recipe` (written by
`scripts\mods\last_recipe.py`), and MadeFromGame makes the plugin from the
plugins and string tables in `Paths.Game`'s Data, pinned by the sha256 of each
and of the plugin, whenever a recipe is there and the plugin is missing or
other bytes. Verify never fetches that plugin from the server, and counts it
as ours when it puts the order right. A game folder with no recipe is left to
the release. `tests\test-2791-last-plugin.ps1` holds it to `last_recipe.py`.

**Vortex profile state** (VortexProfileState.cs). Checks and the PowerShell
load-order scripts share this reader for the named Skyrim profile and the
collection revision installed (#1582). The newest revision Vortex knows of
and the mod ids that name the collection's staging folder are read only by
the scripts, `Get-CollectionNewest` and `Get-CollectionModIds` in
`scripts\mods\LoadOrder.ps1` (#1902); the launcher's copies had no caller
and were removed (#1957). It reads
the current LevelDB manifest, compressed tables and sequenced log records
without opening or writing the database. Deleted, ambiguous, corrupt or
incomplete profile metadata is refused. Finish deployment and close Vortex
before a bake or Ship so its exclusively held database can be read.

**Checks** (Checks.cs). The rows on the Play page (`Checks.cs:844 All()`):
game build, script extender, Address Library, multiplayer, client, mods, mod
list, other servers, auto load, Steam. A failed row shuts Play unless it is
advisory, which is drawn amber and leaves Play alone. Address Library
(`Checks.cs:58 AddressLibraryRow()`) is advisory, because a new row that
blocks and is wrong on somebody's machine locks them out with nothing they
can press. Finding and closing the game's processes
(`Checks.cs:1082 GameRunning()`, `Checks.cs:1271 CloseGame()`). Writes nothing
except when Fix moves a file aside.

**Door and Discord** (Door.cs, Discord.cs). Who is allowed in. The Discord
ticket lives in `Profile\discord.txt`, DPAPI encrypted and locked to this
account, with `discord-name.txt` and `dev-allowed.txt` beside it.
`Door.cs:106 Check()` asks thornswood.net at `/api/play/join` through
`Discord.cs:467 Join()`, holds a yes for five minutes, and writes the site's
last answer to `Profile\door.txt`; when the site cannot be reached, or
answers that it could not ask Discord, a yes in that file less than 72 hours
old still lets the person in. Discord.cs also
sends both ends of every session and its logs (`/api/play/start`, `/end`,
`/logs`), remembering an unsent set in `Profile\logs-pending.txt`.

**Chars, AutoJoin and Roster** (Chars.cs, AutoJoin.cs, Roster.cs). Characters.
There is no class called Creation: the person picks or makes a character at
the game's own main menu, and these three prepare that menu and read its
answer. `Chars.cs:895 Prepare()` owns `Profile\Characters\profiles.txt` (one
row per profile id, plus a spare on slot 0 for New character),
`retired.txt`, the saves folder `Profile\Characters\saves`, the menu's list
`Game\Data\Platform\thornswood-characters.json` and
`Game\Data\Platform\UI\thornswood-characters.js`, and the two files the menu
writes back, `thornswood-choice.txt` and `thornswood-forget.txt` in
`Game\Data\Platform`. AutoJoin owns what the launcher writes into
`skymp5-client-settings.txt`: the server address and port, the manifest
location, `gameData.profileId`, and `gameData.chooseAtMenu`. Roster asks the
site for this account's character names and keeps them in memory.

**Voice** (Voice.cs, VoiceSession.cs, VoiceAudio.cs, VoiceCom.cs,
VoiceIce.cs, VoiceStun.cs, VoicePeer.cs, VoiceMix.cs, VoiceHrtf.cs). Proximity voice runs
in the launcher, not in the game, and since #4823 in the launcher's own code,
with no browser: until then it was `voice-host.html` in a hidden WebView2.
`Voice.cs:134 Start()` makes the session at startup (row 23). VoiceSession.cs
is that page in C#, on one thread of its own the way the page ran on a
browser's event loop, talking to the voice service over a WebSocket with the
same protocol. The microphone and speakers are WASAPI in shared mode
(VoiceAudio.cs, through the generated COM interfaces in VoiceCom.cs), the
connections are ICE with STUN and TURN (VoiceIce.cs, VoiceStun.cs) and
DTLS-SRTP through SharpSRTP on BouncyCastle (VoicePeer.cs), the codec is Opus
through Concentus (THIRD-PARTY.md), the page's gain is a mixer of our own
with the page's numbers (VoiceMix.cs), and its HRTF panner is Chromium's,
ported to C# with Chromium's impulse responses (VoiceHrtf.cs and
`launcher\hrtf-composite.wav`, embedded; #963 point 4), whose filters are
built once on the thread pool. Nothing is written beside
the exe and there is no browser data folder. Voice.cs is the launcher's side,
as it always was. It talks to the game through small files in both
`Game\Data\Platform` and Profile (`voice-status.txt`, and `voice-muted.txt`
written by the game, passed on to the session by `Voice.cs:720 PassMuted()`),
and hears push to talk from the game plugin on a loopback port.
`Voice.cs:525 Reconfigure()` tells it which character is being played. A join
token opens one connection and is good for two minutes (#1322), so nothing
keeps one: the session asks for a token before every try (`PageToken()`), and
the game's chat asks by writing `voice-token-ask.txt`, which `PassTokenAsk()`
answers by writing a token for that character to `voice-token.txt`. Both
files are emptied when the file channel starts. The join token is only asked
for over https, because the request carries the Discord ticket; with a voice
address that is not https there is no token. `Voice.Stop` closes every
connection and lets the microphone and speakers go when the window closes
(row 27).

**OwnGame** (OwnGame.cs, OwnGameShare.cs, OwnGameKinds.cs, OwnGameClean.cs and OwnGameLost.cs, with
ShellOwnGame.cs for its card and offer). `<Root>\Game` itself. `OwnGame.cs:1254 Make()` builds it in
`<Root>\Game.new` and moves it into place; `OwnGame.cs:1425 Refresh()` brings it
up to date with Vortex. A refresh looks only at what can have changed and
carries the rest of the record forward without opening it (#2210): when the
rules moved, the paths the new rules are about (RulesScope and RuleTouches in
OwnGame.cs, which every new rule number joins); when Vortex has deployed
since, the files whose entry in Vortex's record (its mod and time) is not the
one the folder last took in, which `Profile\OwnGame\vortex.txt` keeps
(VortexMoved). A folder with no vortex.txt for that Vortex folder, files
still to sort into the three kinds, or a rule with no line, is walked whole.
The separations of rules 5, 6 and 11 are made once, by the refresh of a
folder whose record is older than the rule, and never at every refresh. Its
log line says which it did and how long it took. Vortex deploying into a
Thornswood game folder, this install's or another's, is refused
(`ThornswoodSource`, `RefusedSource`, said at every start), because Vortex
links what it deploys and the two folders would undo each other. One writer
at a time: Make, Refresh and the update's write all go through the folder's
lock, and `OwnGameKinds.cs Alone()` is how the update and the add-on packs
wait for it. Once made, the folder needs nothing from the Steam copy
(#1218): a refresh takes only the files Vortex's record lists, the game's own
files are the folder's own copies, and nothing writes into the Steam copy, so
it can be on any build and modded freely. Skyrim's archives are shared with the
Steam copy only while the bytes are the same (`OwnGameShare.cs:245 Share()`),
and checked before every Play (`OwnGameShare.cs:355 CheckShared()`).
Only three kinds of file go in (#1232, OwnGameKinds.cs): Skyrim's own, which
is a file on the pinned build's list (`records\skyrim-files.json`, read out of
the depot manifests the Downgrade asks Steam for and compiled into the
launcher), Vortex's by its record, and Thornswood's own by its records (packs,
Keep, the installer's list, Payload, the files it writes by name, and the game
files of the release the install synced to, `Profile\release-files.txt`, which
Sync.cs keeps). Make leaves anything else in the Steam copy out, and a refresh
takes it out of a folder made before this, logged, without touching the Steam
copy; on an install an older launcher synced, nothing is taken out until the
check against its release has kept that list (`made.txt` kinds=1 once sorted).
The records are in `Profile\OwnGame`: `files.txt` (every file, linked
or copied, and which kind it is, V Vortex's, O Skyrim's own, T Thornswood's;
Publish-Update reads the V lines), `installed-kept.txt` (the installer's list,
kept by the clean up before it empties it), `generated.txt` (what
GeneratedBuild made in the folder, the behavior files Pandora makes and the
BodySlide bodies, #1247, #3715: Thornswood's own, kept as made by a refresh even where Vortex deploys a file of the same
name (`Owned`), and forgotten when the folder is made anew),
`shared.txt`, `differs.txt` and `changed.txt` (the archives, OwnGameShare.cs),
`made.txt`, `left-out.txt`, `declined.txt`, and Vortex's `plugins.txt` and
`loadorder.txt`. `OwnGame.cs:677 WhyNot()` names the one thing stopping the
folder being made. Every writer into Game calls `OwnGame.cs:2145 Unshare()` or
Detach first, so a write never lands in Vortex's copy through a hard link.
Make takes `Profile\Payload` in too, Thornswood's own files when the folder was
chosen at install, and removes it (#1226). `OwnGameClean.cs CleanSteamCopy()`
runs at every start and, the first time it finds the folder made, takes
Thornswood's files out of the Steam copy: the installer's list and what packs
added to it, Thornswood.ini and the thornswood- files under Data\Platform, and
at paths other SkyMP servers write too (the client runtime, the client's page)
only a file whose bytes are Thornswood's. Nothing Vortex deployed, nothing of
Skyrim's own, the person's own mods and the client's shared settings file
stay. It notes what it did in `Profile\OwnGame\steam-copy-cleaned.txt` and
never runs again; a file it could not delete keeps it running at each start.

**ClientRuntime** (ClientRuntime.cs). The six files that are the SkyMP client,
checked by SHA-256 against `records\client-build.json`, which is compiled into
the exe (`ClientRuntime.cs:196 Good()`), and put back from a pack when they
are not (`ClientRuntime.cs:223 Heal()`).

**Downgrade** (Downgrade.cs). Gets Skyrim 1.6.1170's own files through
Steam's own console, after asking, since it takes over Steam's window and the
keyboard; the question shows the three console lines
(`Downgrade.cs:221 Commands()`). They go into Thornswood's own folder
(`OwnGameShare.cs:451 TakePinned()`), or, before it has one, the folder is
made from them. The Steam copy is never written (#1218). The ship root tool
(`scripts\release\ShipRoot`) has a third way for a new root's folder, which
the launcher does not offer: a folder that already holds those files, each
checked against the list and then copied (`OwnGameKinds.cs SkyrimFrom()`,
#2603).

**SteamUpdates** (SteamUpdates.cs, with ShellSteamUpdates.cs for its
question). Steam's Updates setting for Skyrim, `AutoUpdateBehavior` in
`steamapps\appmanifest_489830.acf` in the library that holds it.
At every start `ShellSteamUpdates.cs:27 HoldSteamUpdatesOnStart()` logs it
(`SteamUpdates.cs:270 Report()`) and, when it is not "Wait until I launch the
game" or the file is marked read only, sets it (#493): `SteamUpdates.cs:344
OnStart()` says write it at once when Steam is closed, or put
`ShellSteamUpdates.cs:63 AskToHoldSteamUpdates()`, whose Yes closes Steam,
waits for it to go, writes and starts Steam again, and starts Steam again
whatever happens once it was asked to exit. No means not now (#3600): nothing
is remembered, so a later start with Steam closed writes it and one with Steam
open asks again, and the question says so. `SteamUpdates.cs:465 Hold()` changes that one value,
takes off a read-only mark and never writes while Steam runs. The mark is not
what holds the version: Thornswood runs its own folder, whose exe is its own
copy, and Steam puts an update in by moving new files into its own copy. Since
#1218 a made folder does not read the Steam copy's game at all, so an update
costs it nothing; the setting only saves a download before the folder is
made, so it is only looked at until then (`SteamUpdates.LooksAtStart`, #1226):
once the folder exists the Steam copy is the person's to update as they like.
The question no longer follows a downgrade, which never writes the Steam
copy now.
Play is never held on it.

**The settings Play writes every time.** Enforce.cs (`SkyrimSoulsRE.ini` and
`OpenAnimationReplacer.ini`, which those mods rewrite on exit; `SkyrimPlatform.ini`'s
log level and text window; the actor draw distance in `SkyrimPrefs.ini`), ThornIni.cs
(`Thornswood.ini` from the template when missing), Mics.cs (the microphone
name and voice address in `Thornswood.ini`), Display.cs
(`SSEDisplayTweaks.ini`, `SkyrimPrefs.ini`, SkyUI's `config.txt`). Key binds,
the field of view, the chat fade and the needs bars are written in the game,
by Settings in thornswood-front.js (#3126), not by the launcher. All in Game except `SkyrimPrefs.ini`,
which is in `Profile\MyGames`. CrashDump.cs (#2626, replacing #1191's rule) writes Crash Logger's
own `Crash Log Write Minidump` in `CrashLogger.ini` to match Settings, Crash
snapshots (`Config.CrashSnapshots`): off for everybody until they tick it.
The snapshot it turns on is the game's whole memory, which measured 9.2 GB
on 17 October; after a crash it is moved to the folder the person chose
(`Config.CrashSnapshotFolder`, blank leaves it beside the crash log in
`Profile\MyGames\SKSE`) and the launcher asks whether to keep it. Each is
kept until staff mark its crash looked at on the sessions page, two at most
(#2319): the session logs remember which session each one crashed in
(`Profile\crash-snapshots.txt`), the check in asks the site which of those
are marked (`snapshots` in, `lookedAt` out), and `CrashDump.Tidy` deletes
those and any past two. Turning it off deletes none, and nothing ever sends
one anywhere.

**SkyMp** (SkyMp.cs). Whether the server answers (`SkyMp.cs:74 Up()`, a TCP
connect to the resources port), and on a machine whose address is this
machine, starting the server (`Profile\server.pid`, `Profile\server.log`).

**Presence** (Presence.cs). "Playing Thornswood" on the person's Discord
profile, over the Discord app's local pipe. No files.

**Register** (Register.cs). This install's entry in Windows' Installed apps,
under `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`, one key per
install folder, rewritten at every start.

**Uninstall** (Uninstall.cs). Removing the install. Swap.Restore always runs
first, because deleting Profile with the junctions live would follow them
into the person's real Skyrim folders. It only ever deletes under Root, and
the last part runs from a script in the temp folder after the launcher exits.
Uninstall under Windows' Installed apps runs the exe with `-uninstall`, and
the launcher opens on Settings without starting up to play (startup step 10,
ShellUninstall.cs).

**The install** (InstallWindow.cs, InstallSteps.cs, InstallPlace.cs,
InstallAgreements.cs, InstallSkyrim.cs, InstallShortcut.cs, #4824). Velopack's
Setup.exe puts the launcher and Thornswood's own game files on the PC and
starts the launcher; that first start finds no install recorded and shows the
install window before anything else (startup row 2a). It asks what the old
setup program asked, in its words: the drive, starting on Skyrim's, because
Root\Game is made with hard links that cannot cross a drive (InstallPlace.cs);
Thornswood's own folder; and the boxes that lock Install, with the record
Acceptance reads (InstallAgreements.cs). InstallSteps runs the steps on a
thread of its own, every line in the window and in `Profile\setup-log.txt`:
no Skyrim left running (InstallSkyrim.cs, which asks before it ends one),
then Thornswood's game files from the package into `Profile\Payload` or the
Steam copy (#1226), Profile with the licence texts beside `SOURCE CODE.txt`,
`config.json`, a shortcut in Root (InstallShortcut.cs, through the shell's
own ShellLink object) and the checks at the end. InstallPlace records Root
beside Velopack's folder, which Velopack keeps across updates and removes on
an uninstall. The
installer script, its batch files and the setup program it ran in went with
#4824.

**LocalKeep** (LocalKeep.cs). How long the launcher keeps its own records on
the PC: `Profile\launcher.log` lines and the support zips for `Days` (30)
days, cut at every start, which is what the privacy page promises. NotSaves
lists what is in Profile that is not a save or a setting (the log, the
reports, the Discord sign-in, name and picture from `Discord.AccountFiles`,
and `Profile\MusicBrowser`, the folder the menu music's old browser left);
Uninstall removes those even when it keeps the saves and settings, and its
farewell names any it could not.

**DevBuild** (DevBuild.cs). The second launcher in `<Root>-DevBuild`, made
from the main one's files with the channel set to dev and the dev ports (game
7787, voice 7789). Its program is copied from the folder the running exe is
in (Velopack's `current\`), the `.exe` and `.dll` files only, into
`<Root>-DevBuild\Launcher`. It is installed and opened from the Server card on the main
build's Play page (`Shell.cs DrawServerPick()`, `SwitchToDev()`), which checks
the person's Discord roles before it offers the install (#605); `MainRoot` and
`MainExe` are the way back the dev build's own Server card opens the main
launcher. It has its own Profile, and makes its own `Game` folder the same way
from its own Settings, under Maintenance.

**Smaller pieces.** Stats.cs (`Profile\stats.txt`), Leaks.cs (the shipped sign
in file, and what the 28 and 29 Sep dev records handed out), Icons.cs (the shortcut icon), Stall.cs and Waiting.cs
(section 1), Ask.cs (Windows' own message boxes, section 1), Http.cs (the one
HttpClient the launcher's own requests go through, with the wait for an
answer to start and the wait for each read that HttpWebRequest and WebClient
had before .NET 10), LooseString.cs (a number or true where the feed's JSON
has a string reads as its text, as .NET Framework's serializer read it,
instead of refusing the whole document), Keys.cs (the few Thornswood keys the
Play page and the voice line name, read out of `Thornswood.ini`), Diag.cs (`Profile\Reports`), Files.cs (the logs and the newest crash
for the support report), Secrets.cs (DPAPI and locking a file to this account), Junction.cs
(making and reading junctions without cmd), Steam.cs (finding Steam and its
Skyrim), Online.cs (the headcount the server publishes), Slots.cs (the one
rule for moving a character's slot), Art.cs (the art inside the exe, and the
moving strip behind the title, `launcher-header.webp`, an animated WebP that
`HeaderFrames` decodes a frame at a time with SkiaSharp),
Themes.cs (every colour; the install window is drawn in its Forge too, #2851), Gallery.cs (the pictures the site shows from the world, read
from `/api/public` for Play's rotating spotlight and the Gallery page; the
Gallery page uploads via `/api/gallery/submit` and then sends the picture's
800 and 1600 pixel JPEG copies to `/api/gallery/copy` (#3218), reports via
`/api/gallery/report`, and for staff Approves (naming the copies the card
showed beside the picture), Rejects and takes an approved shot down over the
same Discord ticket, with a clear message when an older
site still answers those doors 403 without why), MediaStrip.cs (what a
picture or recording says about where and when it was made, Exif and GPS
among it, taken out before the Gallery page sends it, by the site's rules,
#3648), Swallow.cs
(a caught exception written to `launcher.log` instead of dropped, section 1).

A new class gets a line on this page in the pull request that adds it.

**ChannelWait** (ChannelWait.cs). Waits for the game to write one of the named voice files, instead of opening those files ten times a second for the whole life of the launcher. When no watcher can be made it sleeps the old 100 ms, so push to talk is never slower than the poll it replaced.

**MenuMusic** (MenuMusic.cs). Plays the launcher menu theme from the launcher's own process: NLayer (the NuGet package, compiled into the exe, THIRD-PARTY.md) decodes the MP3 and waveOut plays it on a thread of its own, so the Windows Volume Mixer lists the sound as this build, by the name and icon MenuMusic gives its audio session ("Thornswood" or "Thornswood Dev", #3207). It used to play in a hidden WebView2, whose sound Windows put under Microsoft Edge WebView2; the WPF MediaPlayer before that needed a Windows Media component the ship PC does not have. The sound output is opened the first time the music is wanted and closed while the game runs.

**Watched** (Watched.cs). Remembers the processes the last full look found and asks only those, by the handle each already has, whether they are still running. A full look happens again only when all of them have gone, and that look is the same one Checks.GameRunning makes.

**PathFence** (PathFence.cs). The one rule for whether a resolved path is inside a folder: it compares against the folder plus its separator, so `C:\Thornswood2` is not inside `C:\Thornswood`. Every pack write and delete in Updater and Sync is fenced with it (#3561). The setup program compiled it too until #4824 retired that program.

**WindowFit** (WindowFit.cs). Keeps a window inside the work area of the monitor it is on, at any display scale. The size and the minimum are clamped to that work area at startup and again when the window lands on a monitor with another scale (#463). The setup program compiled it too until #4824 retired that program; the install window is the launcher's own now.
## 3. The Play sequence

From the button to the game starting, in the order it runs, with what each
step leaves behind. The list of files at the end of it is the answer to
"what is written or locked between pressing Play and the game window
appearing".

### The gate

`Shell.cs:2743 DrawStatus()` runs on every page change, scan and recheck. It
draws a row for each check in `Checks.cs:844 All()`, and a failed row counts
against Play unless it is advisory (`Shell.cs:2762 c.Blocks`); an advisory row
that fails is drawn amber instead. The rows live in `StatusList` on the
Diagnostics page now (#607); the Play page shows a one line summary of them
(`DrawStatus.UpdateReadySummary`), and both are updated in place rather than
torn down and rebuilt, so an unchanged pass does not flash or re-say itself.
A failing summary names the problem in a few words, the first blocking row's
`Check.Problem` and how many more ("Steam not running", "Wrong Skyrim build and
2 more"), with every one listed on hover (#3203); each row that can block sets
its `Problem` where `Checks.cs` makes it. While the Steam row blocks, the card
shows Open Steam (`Shell.OpenSteam`, steam://open/main), and the window's two
second tick redraws the rows when Steam starts or closes
(`Checks.SteamStillRunning`, a watch on steam.exe's handle like
`GameStillRunning`), so the card cannot go on saying "running" about a closed
Steam or "Steam not running" after it has started (#3204).
`DrawStatus.StatusRow` builds a row once and `DrawStatus.FillStatusRow` fills
it. Then it sets
`Shell.cs:2899 btnPlay.IsEnabled`, which turns the button on only when no row
counts against Play, none of
`playing`, `updatePending`, `collectionBarUp` or `ownGameBusy` is set, no work
is showing on the button (`playBar.Active`, see PlayProgress in section 2), and the
feed does not hold Play (`feedNotice.Hold`, see FeedNotice in section 2). The
button's words say which one is holding it: while work shows, what it is doing
and how far it has got (UPDATING 41%, 310 OF 740 MB), otherwise PREPARING THE GAME FOLDER,
INSTALL THE MODS FIRST, UPDATE THE MODS FIRST, WAITING FOR THE SERVER (this
copy's collection revision is ahead of the server's, so nothing needs
installing, #4115), CHECKING..., UPDATE FIRST, NO ANSWER FROM THE UPDATE
SOURCE, CLOSED FOR MAINTENANCE or UPDATE THE LAUNCHER (the feed's hold, with
the bar above Play saying why), DOWNGRADE FIRST, or in the shared shape MAKE
THORNSWOOD'S OWN FOLDER. `updatePending` starts true and only an answer from
the update source clears it, except in a launcher with no update source
configured at all, which is a developer's own build and never a tester's.

### Pressing it

| # | Where | What happens | Left behind |
|---|---|---|---|
| 1 | `Shell.cs:2305 btnPlay.Click` | Wired in Wire. A game this launcher already started goes to Play; otherwise StartPlay. | |
| 2 | `ShellChars.cs:38 StartPlay()` | | |
| 3 | `ShellChars.cs:43 OwnGameRequired` | `ShellOwnGame.cs:304 OwnGameRequired()` returns straight away in this shape. In the shared shape it offers to make the folder, or says what is in the way, and Play stops. | nothing |
| 3b | `ShellChars.cs:46 OwnGameRefreshIfDue` | `ShellOwnGame.cs:210 OwnGameRefreshIfDue()` asks `OwnGame.NeedsRefresh` under Waiting, then reads `ownGameBusy` again, since a bring-up-to-date queued at startup can begin inside that wait. When Vortex has deployed since the folder was made, it runs the same bring-up-to-date as Diagnostics, Bring it up to date from Vortex, and Play stops for it. When that succeeds, StartPlay runs again from step 1, so one press ends in the game; when it fails, nothing more runs and the reason is shown. A folder that still does not match straight after is said and not refreshed again. When NeedsRefresh cannot be answered, a log line says so and Play goes on. | the game folder, through OwnGame.Refresh, only when due |
| 4 | `ShellChars.cs:53 Door.RecentlyCleared` | A yes from the site in the last five minutes skips the next step. | |
| 5 | `ShellChars.cs:58 Door.Check` | `Door.cs:106 Check()` on a pool thread: `Discord.cs:467 Join()` posts the ticket and the profile id currently in `skymp5-client-settings.txt` to thornswood.net `/api/play/join`. A yes comes back through `ShellChars.cs:72 StartPlay`, which runs StartPlay again from the top and passes this step. A no shows why (`Door.cs:204 Explain()`) and nothing more runs. | `Profile\door.txt` (the answer and when); `discord-name.txt` and `dev-allowed.txt` when they changed |
| 6 | `ShellChars.cs:90 Checks.GameRunning` | A Skyrim started by hand goes straight to Play with nothing under Data touched, because a write to the client settings reloads every plugin in a running game. | |
| 7 | `ShellChars.cs:101 Chars.Prepare` | Under Waiting. `Chars.cs:895 Prepare()`, below in its own table. It throws when the client settings or the character list cannot be written, and Play stops. | see below |
| 8 | `ShellChars.cs:114 Chars.KnownIds` | Every profile id this install could pick, then `ShellChars.cs:120 CheckIn` for each on a pool thread, posting each one to `/api/play/join` so the server's allowed list has it before the person picks. A failure is a log line; the game still starts. | |
| 9 | `ShellChars.cs:127 Play` | Into `ShellPlay.cs:143 Play()`. Its first lines check `updatePending`, `collectionBarUp`, `ownGameBusy`, `OwnGameRefreshIfDue` and the feed's hold again, because the button is not the only way in. | |
| 9b | `ShellPlay.cs:158 OwnGameRefreshIfDue` | Same as step 3b, for the ways in that are not the button. | |
| 10 | `ShellPlay.cs:161 Paths.Loader` | `Game\skse64_loader.exe` has to exist, and `ShellPlay.cs:162 Paths.MpClient` (`Game\Data\SKSE\Plugins\MpClientPlugin.dll`). | |
| 11 | `ShellPlay.cs:167 ClearStuckGame` | A Skyrim with no window is closed; one on screen is asked about. Then, under Waiting, `ShellPlay.cs:179 OwnGame.CheckShared`: every archive the folder shares with the Steam copy still has the bytes on record (the change time is read, and the bytes only when it moved). One that changed stops Play and brings up the Downgrade card. | `Profile\OwnGame\shared.txt` and `changed.txt`, when anything moved |
| 12 | `ShellPlay.cs:193 Verify.Run` | Under Waiting. Reads the plugin list, the server's manifest and the plugins' bytes. Any problem that would get the person refused: the Diagnostics page (Scan and Fix) opens with a message saying what to do, and Play stops. | nothing |
| 13 | `ShellPlay.cs:252 Verify.DeployPersonal` | `<Root>\Your Mods` copied into `Game\Data`, never a plugin. | those files in `Game\Data` |
| 14 | `ShellPlay.cs:266 Display.MatchScreen` | Skipped when Lock resolution is ticked. The game's window size and Display Tweaks' resolution follow the screen. | `Game\Data\SKSE\Plugins\SSEDisplayTweaks.ini`, `Profile\MyGames\SkyrimPrefs.ini`, each only when it changes |
| 15 | `ShellPlay.cs:270 Enforce.Apply` | Settings two mods rewrite on the way out, put back; SkyrimPlatform at its normal log level with no text window; one actor draw distance for everybody (#963). Then `ShellPlay.cs:274 CrashDump.Apply`: the full crash snapshot on only when the person ticked it in Settings (#2626), and with it on, those whose crash staff marked looked at deleted, and any past the newest two (#2319). | `Game\Data\SKSE\Plugins\SkyrimSoulsRE.ini`, `OpenAnimationReplacer.ini`, `SkyrimPlatform.ini`, `CrashLogger.ini`, `Profile\MyGames\SkyrimPrefs.ini`; old `crash-*.dmp` in `Profile\MyGames\SKSE` deleted |
| 16 | `ShellPlay.cs:281 AutoJoin.Apply` | `AutoJoin.cs:124 Apply()`: the server address and port, and where the client fetches the server's load order, through Hold.Around. SkyMP has no join screen; this file is the whole of joining. | `skymp5-client-settings.txt` when it changes |
| 17 | `ShellPlay.cs:290 ThornIni.Ensure` | The template, if the file is missing. | `Game\Data\SKSE\Plugins\Thornswood.ini` |
| 18 | `ShellPlay.cs:293 Mics.Apply` | This machine's microphone name, the voice port and the voice address. | `Thornswood.ini` |
| 18a | `ShellPlay.cs:308 GeneratedHere.Ensure` | Under Waiting. The behavior files and the covered bodies (#3715), built with the collection's own Pandora and BodySlide only when `generated.txt` is missing or stale: the mod list, the files the tools read, the build list compiled into the launcher, or a built file changed. A build that stops, or any body in the folder that is nude, stops Play with a message box saying why (#405). | when it builds: `Game\Data\meshes\actors\*\behaviors`, `characters`, `animationdatasinglefile.txt` and `animationsetdatasinglefile.txt`, the six bodies in `character assets`, BodySlide's own copies of its settings, presets and groups, and `Profile\OwnGame\generated.txt`; `Profile\OwnGame\build-generated` while it runs |
| 18b | `ShellPlay.cs:331 MadeFromGame.Ensure` | The main menu, the notice board's two meshes and the collection's menus with no gold values (#3113) made from this machine's game and mod archives, only those missing or changed. A game that cannot make them still plays, and the log line says which file differs. | `Game\Data\Interface\startmenu.swf`, `Game\Data\meshes\thornswood\noticeboard01.nif` and `dropbox01.nif`; `Game\Data\Interface\skyui\config.txt` and `itemcard.swf`, `Game\Data\Interface\hudmenu.swf`, `AHZHudInfo.swf` and `exported\AHZHudInfo.swf`; `Game\Data\Interface\quest_journal.swf` (#3127); `Game\Data\Thornswood-Last.esp` from the release's recipe and the person's own plugins (#2791) |
| 19 | `ShellPlay.cs:338 EnsureServer` | `ShellPlay.cs:106 EnsureServer()`: `SkyMp.Up` connects to the resources port. A server elsewhere that does not answer is asked about; one on this machine is started. | `Profile\server.pid` and `server.log`, local server only |
| 20 | `ShellPlay.cs:345 Keep.Restore` | Last thing before the game that can still say no, so nothing is left parked by a refusal. Our Data\Platform files back from `Profile\Keep`; other servers' plugins parked. | changed files in `Game\Data\Platform`; `Profile\Parked\*` and `parked.txt` |
| 21 | `ShellPlay.cs:347 Keep.LeaveNote` | The note that says this session is ours. The plugins idle without it. | `Game\Data\Platform\thornswood-session.txt` |
| 22 | `ShellPlay.cs:353 Hold.Take` | Read only handles on every kept file and the client settings, and an empty held stand-in where each parked plugin was. | locks, and the stand-ins |
| 23 | `ShellPlay.cs:357 Swap.Apply` | Windows' two Skyrim folders pointed at Profile. Throws, with the folder named, when Windows will not let one go. On the next line `playing` goes true, the theme music and the video behind the title stop, the button reads RUNNING and Quit game appears. | two junctions, two `.st-backup` folders, `Profile\swap.json` |
| 24 | `ShellPlay.cs:376 ProcessStartInfo` | For `Game\skse64_loader.exe`, with Game as the working directory and no arguments, started at `ShellPlay.cs:399 Process.Start`. The loader starts `SkyrimSE.exe` beside it. Then one log line names the launcher version, the newest pack applied and the display mode. | |
| 25 | `ShellPlay.cs:426 Discord.NewSession` | An id for this session, then `ShellPlay.cs:430 Discord.SessionStart` on a pool thread posts it to `/api/play/start`. | `Profile\logs-pending.txt` |
| 26 | `ShellPlay.cs:437 Presence.Start` | The Discord card, on its own thread. | |
| 27 | `ShellPlay.cs:439 PlayedFile` | Then `ShellPlay.cs:441 Stats.StartedPlaying`, a pause of 1.2 seconds, and the window minimises unless Keep launcher open is ticked. | `Profile\played.flag`, `Profile\stats.txt` |

If anything in Play throws, the catch at the end of it undoes the work in
this order: `ShellPlay.cs:455 Swap.Restore`, `ShellPlay.cs:456 Hold.Release`,
`ShellPlay.cs:457 Keep.Unpark`, `ShellPlay.cs:458 Presence.Stop`,
`ShellPlay.cs:459 Keep.TakeNote`. A reason longer than one line is shown in a
box.

### Inside Chars.Prepare (step 7)

| Where | What happens | Left behind |
|---|---|---|
| `Chars.cs:895 Prepare()` | The saves folder Skyrim will see, `Profile\MyGames\Saves`, becomes a junction to `Profile\Characters\saves`. A real folder there with files in it is moved aside whole, never deleted. SkyrimPlatform's scaffolding saves are deleted. | `Profile\Characters\saves`, the junction, maybe `Saves-before-Thornswood-<time>` |
| `Chars.cs:984 EnsureSpare` | Mints the spare id for New character when there is none. | `Profile\Characters\profiles.txt` |
| `Chars.cs:1001 AutoJoin.SetChooseAtMenu` | `AutoJoin.cs:295 SetChooseAtMenu()`: the id played last and `chooseAtMenu` inside `gameData`, read back, and a throw if the file does not say what was written. | `skymp5-client-settings.txt` |
| `Chars.cs:1003 WriteBrowserBackend` | Which in-game browser SkyrimPlatform uses (its log level and text window are Enforce's, step 15). Edited, never rewritten, and only when a value changes. | `Game\Data\SKSE\Plugins\SkyrimPlatform.ini` |
| `Chars.cs:1010 Voice.Reconfigure` | Voice fetches a token for that id for its session, when the voice address is https. The game's chat asks for its own (`voice-token-ask.txt`). | |
| `Chars.cs:1032 TidySlots` | Only on the site's own answer about how many slots this account has. | `profiles.txt` when a slot moves |
| `Chars.cs:1034 WriteCharacters` | Names from the site's roster, then the list the menu draws. Throws when it cannot be written. | `Game\Data\Platform\thornswood-characters.json`, `Game\Data\Platform\UI\thornswood-characters.js` |
| `Chars.cs:1038 ChoiceFile` | Last session's choice and forget files deleted, so neither is read as this session's. | |

### What is on disk when the game window appears

Written or rewritten, when anything needed changing:

- `Profile`: `door.txt`, `Characters\profiles.txt`, `Characters\saves`,
  `MyGames\Saves` (a junction), `MyGames\SkyrimPrefs.ini`, `Parked\` and
  `parked.txt`, `swap.json`, `logs-pending.txt`, `played.flag`, `stats.txt`,
  `launcher.log`, and with a local server `server.pid` and
  `server.log`.
- `Game\Data\Platform`: `Plugins\skymp5-client-settings.txt`, any kept file
  put back, `thornswood-session.txt`, `thornswood-characters.json`,
  `UI\thornswood-characters.js`.
- `Game\Data\SKSE\Plugins`: `SkyrimPlatform.ini`,
  `SSEDisplayTweaks.ini`, `SkyrimSoulsRE.ini`, `OpenAnimationReplacer.ini`,
  `Thornswood.ini`.
- The files made from the game and the collection's mods (MadeFromGame),
  the behavior files and bodies built with the collection's Pandora and
  BodySlide (GeneratedHere), and anything from `<Root>\Your Mods`.
- Windows' `Documents\My Games\Skyrim Special Edition` and
  `%LOCALAPPDATA%\Skyrim Special Edition` are junctions into Profile, with the
  real folders beside them as `.st-backup`.

Deleted: `Game\Data\Platform\thornswood-choice.txt` and `thornswood-forget.txt`.

Locked read only until the game closes: every file in `Game\Data\Platform`
that has a kept copy in `Profile\Keep`, `skymp5-client-settings.txt`, and the
empty stand-ins where parked plugins were.

### While the game runs

`Shell.cs:2515 timer.Tick` keeps going. `Shell.cs:2541 PollChoice` reads
`Game\Data\Platform\thornswood-choice.txt`, which the menu plugin writes when
the person picks (`Chars.cs:598 ReadChoice()`); a new id is written into
`profiles.txt` (`Chars.cs:623 Chose()`), handed to voice and checked in with
the site. The same tick keeps a join pass for the character picked
(`JoinPass.cs:82 Tick()`, #937): fetched from the site when they pick and
every minute after (a pass proves one session, #1320), and left in `Game\Data\Platform\thornswood-pass.txt`
for the front plugin to hand the game server, which ends a session without
one. The pass's own key goes beside it in `thornswood-pass-key.txt`, named by
the pass's mac, for the client to prove the pass on its own connection when
the game server challenges the login (#1320). Nothing in this loop writes the client settings: a write to that
file reloads every plugin in the running game.
`Shell.cs:2546 CheckUpdatesInPlay` looks for a release every thirty seconds
and, four and a half minutes after first seeing one, closes the game so it can
be installed, landing on the server's own five minute warning.

### When the game closes

The first tick that finds no game runs, in order:
`Shell.cs:2562 Presence.Stop`, `Shell.cs:2563 Hold.Release`,
`Shell.cs:2564 Keep.TakeNote` (the session note goes),
`Shell.cs:2565 Swap.Restore` (Windows' folders back, `swap.json` gone),
`Shell.cs:2567 Keep.Unpark` (parked plugins home, or into `Profile\Isolated`
when their launcher has already written a new copy),
`Shell.cs:2570 Stats.StoppedPlaying`, then on a pool thread
`Shell.cs:2581 Discord.SessionEnd` and `Shell.cs:2588 Discord.SessionLogs`
(the session's logs up to the site before the next start truncates them),
`Shell.cs:2597 Chars.AddPlaytime`, `Shell.cs:2618 CrashDump.AfterSession`
(when a crash log was written this session, a line naming it and the
snapshot beside it), `Shell.cs:2635 Checks.LastRunFrom` (a
warning if that session ran some other Skyrim), and `Shell.cs:2648 Verify.Run`
on a pool thread. A game closed for an update then fetches and installs it
(`Shell.cs:2684 CheckUpdatesBackground`).

### Closing the launcher

`Shell.cs:2493 win.Closing` asks first when a game is still running, then
runs Swap.Restore, Hold.Release and, when no game is running, Keep.Unpark.

## 4. The six shared files

docs/guide/how-work-moves.md asks for a line in #staff-updates before any of these is edited, because both
machines work in them.

| File | What it is | Why both machines are in it |
|---|---|---|
| `launcher\app\Shell.cs` | The window, startup and the whole Play sequence. | Nearly every change that adds a button or a step touches it. |
| `launcher\app\Checks.cs` | The rows that gate Play, and finding and closing the game. | A new requirement for Play is a new row here. |
| `launcher\app\Keep.cs` | Our Data\Platform files put back and other plugins parked. | Anything new the plugins ship under Data\Platform, and how the main and dev builds share a game. |
| `launcher\app\Hold.cs` | The read-only hold while the game runs. | It holds exactly what Keep keeps, so they change together. |
| `launcher\app\Updater.cs` | The feed, the packs and `Version`; the launcher's own update through Velopack is the same class, in VeloUpdate.cs. | Nothing in the source carries the launcher's number: `Version` is read from the exe, which the build numbers (`-p:Version`, #5179). |
| `scripts\release\Publish-Update.ps1` | Diffs the build, packs what belongs by Ship-Rules.ps1, uploads, writes version.json. | Ship runs it on whichever machine ships: main from Patrick's, dev from either. |
