# The installer

## What it is

What a new person runs before they have a launcher. Since issue #4824
(decided 27 October: "the installer is compiled code plus Velopack") it is two
parts, and neither is a script:

- **Velopack's Setup.exe** puts the launcher and Thornswood's own game files
  on the PC, under the person's own profile (`%LocalAppData%\Thornswood`),
  with no administrator prompt, and makes the desktop and Start menu
  shortcuts. `.github\workflows\merge-release.yml` packs it with `vpk`; issue
  #4825 says the rest of what Velopack carries.
- **The launcher's first start** is the install itself. With no install folder
  recorded yet, the launcher opens on its install window instead of its own
  (`launcher\app\InstallWindow.cs`), which asks what the old setup window
  asked, and then runs every step the old install script took, in compiled
  code (`launcher\app\InstallSteps.cs`), with the bar on the bytes copied and
  every line in the window and in `Profile\setup-log.txt`.

Until #4824, `setup\Bootstrap.cs` built `Thornswood-Setup.exe`, which
downloaded the payload from the site and ran the install script,
Setup-Thornswood, hidden in its window, and `Setup.bat` and `Install.bat` ran
the same script in a console. A hidden
script is what antivirus reads hardest, and the install was written in two
languages for one job, so the script, both batch files and the setup program
are gone, and nothing falls back to them.

This folder keeps `licences\`, the GPL and AGPL texts and the licence texts
of every library built into the launcher or shipped with it, handed over with
the files (#421, #4823; `licences\README.txt` says where each comes from).
It no longer keeps a read me: `READ ME FIRST.txt` told people which of
`Setup.bat` and `Install.bat` to run, and Velopack's Setup.exe carries no
loose page, it opens the launcher, whose install window says each step. What
a person reads before installing is the join guide on the site
(`https://thornswood.net/join`, `site\data\site\join.md`), which that file
already called the one that is right.

## On your machine

The install runs inside the launcher, so it builds with the launcher
(`.\scripts\release\Build-Launcher.ps1`); this folder holds nothing to
compile. Nothing here is run from the checkout. To try a change, install from
a Velopack release on a machine that is not your own install, or start a built
launcher whose folder has no `install-root.txt` above it, which opens on the
install window. `tests\test-4824-install.py` builds the install steps with the
.NET SDK, runs them against stand-in folders, and holds the window to the
rules below.

## Where it runs

On the machine of anybody installing Thornswood for the first time, once:
Velopack's Setup.exe from the release, then the launcher's first start on that
machine. A launcher that finds its install folder recorded never shows the
install window again; a stopped install records nothing, so the next start
asks again.

## Why the install is in the launcher

One program and one install path. Velopack's Setup.exe has nothing to run but
the launcher it just put down, and the launcher already holds what the install
needs: how Steam and Skyrim are found (`Steam.cs`), what a Vortex folder must
hold (`OwnGame.PointAt`), and the agreement record (`Acceptance.cs`). A second
small program would have been one more exe to sign, update and keep in step
with all of that.

## Where it puts things

Velopack's folder holds the launcher. The install folder, Root, holds
`Profile`, `config.json` and, once the launcher makes it, `Game`, and it is
still the person's choice in the install window. The launcher records it in
`install-root.txt` beside Velopack's folder (`launcher\app\InstallPlace.cs`)
once the install has finished, so a stopped install is asked again on the next
start.

## Which drive it offers

The drive it starts on is the one Steam's copy of Skyrim Special Edition is on,
found the way the launcher finds it (`launcher\app\Steam.cs`: Steam's folder
from the registry, then every path in `config\libraryfolders.vdf`, then the
first library holding `steamapps\common\Skyrim Special Edition\SkyrimSE.exe`).
`C:\Thornswood` is only the fallback when there is no Steam copy to find.

That is not a preference. With the own folder box ticked (below), Thornswood
runs from a game folder the launcher builds out of the Steam copy mostly as
hard links, and a hard link cannot cross a drive, so an install on another
drive is one the launcher refuses to play from (`OwnGame.WhyNot`).
Unticked, the launcher asks to build that folder before Play
(`OwnGameRequired`), and the same rule holds. The drive Skyrim is on is marked
on its button, the line under the buttons says what a different drive costs,
and pressing Install on a different drive asks once more before anything is
written. It asks and does not refuse: whether the launcher may fall back to
copies instead is the team's call (issue #473).

## Thornswood's own Skyrim folder

Issue #906, 28 September: "let's offer the own folder during install as
well". Under the drive card is a card with the words of the launcher's
Settings, Maintenance panel, a tick box, "Give Thornswood a Skyrim folder of
its own", and Choose Vortex's folder.

The install does not make the folder. The launcher builds it (`OwnGame.Make`),
out of what Vortex has deployed, and nothing is deployed while the install
window is up. The box starts ticked (decided 12 November: the own folder
is the default for everyone). So the tick answers the launcher's own question
in advance: it goes into `config.json` as `MakeOwnGame`, and the launcher then
makes the folder without asking once Vortex has deployed. The launcher reads a
`config.json` with no `MakeOwnGame` the same as ticked, so only an install
whose box was unticked is asked. Ticked, which is the default, Thornswood's own
files go into `Profile\Payload` and nothing is written into the Steam copy
(#1226); unticked, they go into the Steam copy with a list of what went there
(`Profile\installed-into-game.txt`), and the launcher asks before it makes the
folder. A chosen Vortex folder is checked the way `OwnGame.PointAt` checks it
(SkyrimSE.exe and `Data\vortex.deployment.json`) and saved as `VortexGame`, the
field the Settings button writes. A second install over a folder the launcher
already made writes Thornswood's files into it, separating any hard-linked name
first, and never parks it (#1233).

## What a person agrees to before Install

Issue #1009, asked for on 28 September: "check boxes that lock the install for
reading and accepting terms and conditions, privacy policy, and agreeing to
the rules", "and links to all 3". Beside Install are four boxes, all unticked:
the age box, then "I have read and accept the Terms and Conditions", "I have
read and accept the Privacy Policy" and "I have read and agree to the Rules".
Install stays greyed out until all four are ticked. Each of the three has a
link beside it that opens the page on the site in the browser
(`https://thornswood.net/terms`, `/privacy`, `/rules`), so what a person
reads is the current text, never a copy inside the launcher.

When Install is pressed, the install writes `Profile\accepted.json`: the time
in UTC, and for each page its address and the SHA-256 of its text as
`https://thornswood.net/api/page/<name>` serves it at that moment, which is the
version accepted. A page the site did not answer for is recorded with an empty
hash, and the install carries on: the boxes were ticked either way. Nothing
about the person or the machine goes in it. The steps then refuse to install
anything if that note is not there. The launcher reads the same file
(`launcher\app\Acceptance.cs`) on every start and asks again when it is missing
or a page changed.

## What the steps do

`InstallSteps.Run`, in order, each saying what it does in the window: Skyrim
still running is closed, asking before anything is ended
(`InstallSkyrim.cs`); the note of what was accepted; Skyrim found; which of
the three shapes this is (into the Steam copy, into `Profile\Payload`, or into
a folder the launcher already made), with an old `Game` folder parked as
`Game-old-<date>`; room on the drives (6 GB on the install folder's, 3 GB on
Skyrim's when the files go there); the files copied, stopping with both
folders named when one will not copy; the profile folders, the load order when
the package carries one, `applied.txt`, `SOURCE CODE.txt`, the licence texts;
`config.json` merged, never wiping a filled field with a blank one, and kept to
this Windows account; `Thornswood.lnk` in the install folder; and the checks at
the end, where the script extender and the address library are the
collection's to install next, and a wrong Skyrim build is the launcher's
Downgrade button's to fix.

The script's other shape, a copy of the whole base game for a payload built
with every mod in it, is not ported: no package carries that shape now, and
the launcher's own folder and its Downgrade card do that job.

## What an install leaves on the PC

Everything the setup and the launcher's first start write, where it goes,
which step writes it and what takes it away again (#4431). The install
folder is the one picked in the install window, `<Skyrim's drive>\Thornswood`
unless another was chosen. Uninstall here means the launcher's own, from
Settings or from its entry in Windows' Installed apps.

| What | Where | Which step writes it | What removes it |
|---|---|---|---|
| The launcher, Velopack's `Update.exe` and the package it came from | `%LocalAppData%\Thornswood` (`current\`, `packages\`) | Velopack's Setup.exe, and Velopack again at each update | Velopack's own uninstall. Not the launcher's Uninstall, which never deletes outside the install folder (#5820) |
| Which folder is the install folder | `%LocalAppData%\Thornswood\install-root.txt` | `InstallPlace.Record`, once Install has finished, or at the first start after an older launcher handed over (`InstallPlace.TakeHandover`) | Velopack's own uninstall, with its folder. Not the launcher's Uninstall (#5820) |
| An older launcher's handover | `%LocalAppData%\Thornswood-moved-from.txt` | The last update of an older launcher, from before Velopack (`launcher\move`) | The first start, which reads it and deletes it (`InstallPlace.TakeHandover`) |
| Desktop and Start menu shortcuts | `Thornswood.lnk` on the Desktop and in `Start Menu\Programs` | Velopack's Setup.exe makes its own. At every start `Icons.Ensure` points every shortcut that runs the launcher at the current icon, renames one with an old name (`Icons.Rename`) and makes one where the Desktop or the Start menu has none (`Icons.Make`) | The launcher's Uninstall (`Icons.Drop`): every shortcut on the Desktop, the shared Desktop, the Start menu, the pinned taskbar and in the install folder whose target is the running launcher. Velopack's own uninstall takes the ones it made |
| The shortcuts' icon | `icon-<hash>.ico` in the install folder's `Launcher` folder, only when there is one (an install from before Velopack), and `Profile\icons.stamp` | `Icons.IconFile` and `Icons.Remember`, at every start | The launcher's Uninstall, with `Launcher` and with Profile |
| Thornswood in Windows' Installed apps | `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\Thornswood-<hash of the install folder>` | `Register.Ensure`, at every start | The launcher's Uninstall (`Register.Forget`). Not Velopack's own uninstall (#5820) |
| The install folder and its `Profile` folder | The install folder | `InstallWindow.Work`, before anything is installed, and `InstallSteps.Run` | The launcher's Uninstall, last, and only once it is empty: anything still in it keeps it, and the farewell names each thing and why |
| The setup's log | `Profile\setup-log.txt` | `InstallWindow.Work` | The launcher's Uninstall, with Profile |
| What was accepted before Install | `Profile\accepted.json` | `InstallAgreements.Record` | The launcher's Uninstall, with Profile |
| Thornswood's own game files | Into the Steam copy of Skyrim when Thornswood's own folder is not ticked; into `Profile\Payload` when it is; into the install folder's `Game` when the launcher has already made that folder | `InstallSteps.CopyPayload` | In the Steam copy: the launcher's Uninstall when it is told to remove the mods, by the list below, leaving every file Vortex deploys; and making Thornswood's own folder later takes them out of the Steam copy too (`OwnGame.CleanSteamCopy`). `Profile\Payload` and `Game`: the launcher's Uninstall when it is told to remove the mods |
| The list of what went into the Steam copy | `Profile\installed-into-game.txt` | `InstallSteps.RecordIntoGame` | The launcher's Uninstall, with Profile, after it has used the list |
| Skyrim's settings and the saves folder for Thornswood | `Profile\Default`, `Profile\MyGames` with `Saves` in it, and `Profile\LocalAppData`, filled from the package's `profile` folder when it has one | `InstallSteps.Settings` | The launcher's Uninstall, with Profile, unless it is told to keep saves and settings |
| The updates already in this build | `Profile\applied.txt` | `InstallSteps.Settings` | The launcher's Uninstall, with Profile, unless it is told to keep saves and settings |
| Where the SkyMP source is, and the licence texts | In the install folder: `SOURCE CODE.txt`, `GPL-3.0.txt`, `AGPL-3.0.txt`, `Concentus-LICENSE.txt`, `SharpSRTP-LICENSE.txt`, `BouncyCastle-LICENSE.txt`, `dotnet-LICENSE.txt`, `dotnet-THIRD-PARTY-NOTICES.txt`, `Avalonia-LICENSE.txt`, `MicroCom-LICENSE.txt`, `Tmds.DBus-LICENSE.txt`, `SkiaSharp-LICENSE.txt`, `SkiaSharp-THIRD-PARTY-NOTICES.txt`, `ANGLE-LICENSE.txt`, `Velopack-LICENSE.txt`, `Velopack-Rust-crates.txt`, `NLayer-LICENSE.txt`, `Chromium-HRTF-LICENSE.txt`, `IRCAM-Listen-HRTF.txt`, and the `licences` folder | `InstallSteps.Settings` | The launcher's Uninstall, always (`Uninstall.Targets`) |
| Thornswood's settings | `config.json` in the install folder, kept to this Windows account | `InstallSteps.MergeConfig`, through `InstallSteps.WriteJson` | The launcher's Uninstall, unless it is told to keep saves and settings |
| A shortcut in the install folder | `Thornswood.lnk` in the install folder | `InstallSteps.Shortcut` | The launcher's Uninstall (`Icons.Drop`) |
| An old Game folder moved aside | `Game-old-<date>` in the install folder | `InstallSteps.Run`, when it finds a `Game` folder the launcher did not make | Nothing yet: the uninstall leaves it and its farewell calls it not Thornswood's (#5821). The setup's log says to delete it by hand |
| The old setup program's scratch folder | `Thornswood-setup` at the root of a drive, or in the temp folder | The setup program from before #4824, which is gone; no current setup makes it | The launcher, at every start and in its Uninstall (`Uninstall.DropScratch`) |

The install writes nothing into Windows' own Skyrim folders
(`Documents\My Games\Skyrim Special Edition` and
`%LocalAppData%\Skyrim Special Edition`): it only reads the plugin list
Vortex keeps there. What the launcher writes once it is in use, when it
plays, updates and fixes, is in `launcher\app\ARCHITECTURE.md`, its startup
and Play tables.

The two uninstalls do not know about each other today: the launcher's never
deletes outside the install folder, and Velopack's runs none of the
launcher's (#5820).

`tests\test-4431-install-leaves.js` reads every write in the setup and first
start code (`InstallWindow.cs`, `InstallSteps.cs`, `InstallPlace.cs`,
`InstallAgreements.cs`, `InstallShortcut.cs`, `InstallSkyrim.cs`,
`Register.cs` and `Icons.cs`) and fails when this table does not name the
method that writes or a name its path is built from.
