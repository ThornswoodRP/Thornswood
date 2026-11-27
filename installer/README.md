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
Packaging stages its three texts (`GPL-3.0.txt`, `AGPL-3.0.txt` and the launcher
library licences) beside `SOURCE CODE.txt` and stops without them. That licences
folder is different from the payload's own licences folder: the payload's
licences folder carries the client libraries' texts (the vcpkg libraries and
front packages recorded in `records\client-licences.json`), while this folder
holds the licences for the installer and launcher libraries.
It no longer keeps a read me: `READ ME FIRST.txt` told people which of
`Setup.bat` and `Install.bat` to run (#4752, #4824), and Velopack's Setup.exe
carries no loose page, it opens the launcher, whose install window says each
step. What a person reads before installing is the join guide on the site
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

## The installer's tests

Every test that reads, builds or runs the install's own files
(`launcher\app\Install*.cs`) or this read me, what it holds, and which
workflow runs it (#4186). A `.js` or `.ps1` is on the pull request gate
unless `tests\gate-excluded.txt` names it, and the nightly runs every one; on
a pull request the gate runs the ones its change can reach, and on main all of
them. A `.py` runs only where a workflow names it. `tests\test-4186-installer-tests.js`
reads those files and fails when this table leaves a test out, names one that
is gone, or says another workflow than they give.

| Test | What it holds | Runs on |
|---|---|---|
| `launcher/tests/test-2771-text-contrast.js` | The install window takes every colour from the Forge theme before it builds a control, and the lines InstallPlace.cs colours meet the contrast the launcher is held to | Pull request and nightly |
| `launcher/tests/test-4180-fresh-payload.ps1` | Runs setup against scratch Steam and package folders to verify a fresh payload drops stale files and leaves a linked folder's target alone | Pull request and nightly |
| `launcher/tests/test-4459-setup-keys.ps1` | The install window works from the keyboard: focus starts on its first control, Esc closes it as Not now does, Enter on a tick box starts the install, and focus follows what the install says, run on the real window on Avalonia's headless platform | Pull request and nightly |
| `launcher/tests/test-4496-install-closing-steps.js` | The setup log lists Downgrade, the collection, Connect Discord and Play in order, with Downgrade shown only when the game build check fails | Pull request and nightly |
| `launcher/tests/test-4538-install-sizes.ps1` | The install says the build's own sizes: the real InstallSteps, run against a pretend Steam copy and package, count the package's files and megabytes, and no install file names a size typed in by hand | Pull request and nightly |
| `launcher/tests/test-4680-collection-load-order.ps1` | A missing plugin list is no failed check while the launcher's own folder is not made, since Vortex writes it with the collection, and is still one once the folder is made: the real InstallSteps, run with no plugin list in AppData | Pull request and nightly |
| `launcher/tests/test-4409-setup-look.ps1` | Runs the real setup window on Avalonia's headless platform to verify Windows contrast colours, text scaling and layout at several window sizes | Pull request and nightly |
| `launcher/tests/test-4681-install-room.ps1` | What the install window says about room on each drive is what the install refuses: the window's line, its Install button and InstallSteps all read InstallPlace.Rooms and InstallPlace.Short, held over a spread of free space on both drives | Pull request and nightly |
| `launcher/tests/test-4693-setup-reader.ps1` | A screen reader can use the install window: each drive is a radio button named by its letter and free space and reads as chosen or not, the links name their pages, the progress bar and log have names, and the bar's value and each status line are told to Windows as they change, read through the real window's automation peers on Avalonia's headless platform | Pull request and nightly |
| `launcher/tests/test-4696-reinstall-config.ps1` | Exercises setup's saved configuration and its folder choice across reinstalls | Pull request and nightly |
| `launcher/tests/test-4697-setup-ownership.ps1` | Runs setup's copy stage and uninstall in scratch folders: a collision leaves the existing file alone, failed copies do not become owned, and the list keeps files from earlier setups and launcher updates | Pull request and nightly |
| `launcher/tests/test-4711-setup-failures-logged.ps1` | A setup failure says what happened and what to do, and what Windows said behind it is in the install's Profile\launcher.log: the real Swallow and Failure, with a planted full disk, and the install window pointing launcher.log there before any step that can fail, with the stop naming that file | Pull request and nightly |
| `launcher/tests/test-4702-whole-settings.ps1` | The setup's config.json, like the launcher's own settings, goes to a .new file first and is renamed over the old one in one step (InstallSteps.WriteJson), so a stopped install never leaves a short file | Pull request and nightly |
| `launcher/tests/test-downgrade-copy-order.js` | A Skyrim on the wrong build is not a failed install: InstallSteps counts it as next and sends the person to the launcher's Downgrade button | Nightly only |
| `launcher/tests/test-move.ps1` | The new launcher takes an older launcher's handover (InstallPlace.TakeHandover) only on its first start after Velopack's setup, before the install window would ask | Pull request and nightly |
| `launcher/tests/test-own-folder-first.ps1` | Runs the real InstallSteps on a pretend Steam copy and package: with the own folder chosen nothing is written into the Steam copy and the files wait in `Profile\Payload`; not chosen, they go into the Steam copy with their list | Pull request and nightly |
| `launcher/tests/test-prior-acceptance.ps1` | The terms, privacy policy and rules are asked again of an install made before they were recorded, with the pages and words InstallAgreements.cs and the install window use | Pull request and nightly |
| `launcher/tests/test-skyrim-pin.ps1` | The install reads the size of the server's SkyrimSE.exe from `records\skyrim-files.json`, the record the launcher's checks use, and keeps no copy | Pull request and nightly |
| `test-4186-installer-tests.js` | This table: every installer test is in it, and each row's workflow is the one the gate's list and the workflows give | Pull request and nightly |
| `test-4431-install-leaves.js` | The files and other changes setup and first start leave on the PC, where setup writes them, and what removes them | Pull request and nightly |
| `test-4395-own-folder-words.js` | The own folder card in the install window, InstallPlace.cs and this read me say the same about where Thornswood's files go, ticked and unticked | Pull request and nightly |
| `test-4687-setup-plugin-list.ps1` | Runs the real Build-SetupFiles.ps1 against a stand-in site: a release that recorded no plugin list stops it before the package is built and signed, and one with both lists goes on | Pull request and nightly |
| `test-4824-install.py` | Builds the install steps with the .NET SDK and runs them against stand-in folders in every shape, and holds the window and the agreements to their rules. Run it by hand for now: no workflow runs it (#5840) | No workflow |
| `test-component-readmes.js` | This read me matches what is here: only `licences\` and this file in `installer\`, the join guide named, and the folder InstallPlace.cs falls back to | Pull request and nightly |
| `test-repo-docs.js` | This read me says what a person reads before installing is the join guide on the site, and `READ ME FIRST.txt` stays gone | Nightly only |
| `test-shortcut-icons.ps1` | Builds Icons.cs with InstallShortcut.cs: the shortcuts' icon file is named after the exe's own art and kept, so the desktop and Start menu shortcuts keep their icons | Pull request and nightly |
| `test-source-notice.ps1` | The source notice the install hands over: `SOURCE CODE.txt`, and the GPL and AGPL texts byte for byte from `licences\`, as InstallSteps.cs copies them | Nightly only |
| `test-source-offer.ps1` | InstallSteps.cs copies `SOURCE CODE.txt` and the GPL, AGPL and voice library texts and replaces `licences\` whole, and Build-SetupFiles.ps1 packs the names InstallSteps.LicenceFiles lists | Nightly only |
| `test-third-party.js` | InstallSteps.LicenceFiles names every text in `licences\` and nothing else, Build-SetupFiles.ps1 packs them, and Uninstall.cs removes them | Pull request and nightly |
| `test-voice-hrtf.js` | The voice's two HRTF licence texts are in `licences\` and on InstallSteps.LicenceFiles | Pull request and nightly |

### Named here, not installer tests

These name an install file or this read me without testing the install.

- `test-3003-one-install-rule.ps1`: names InstallPlace.cs in its header, to say a new install's folder is the launcher's choice and no script's.
- `test-4115-collection-revision-link.ps1`: names this read me in a comment.
- `test-4415-clean-install-run.js`: names InstallWindow.cs and InstallAgreements.cs to say what the clean install list follows; it reads only that list.
- `test-5197-real-client.js`: reads InstallPlace.cs for the record that says where the launcher is installed, so the real game run finds it; it tests that run, not the install.
- `launcher/tests/test-4329-accessible-names.ps1`: names InstallWindow.cs to say the setup window's names are read by `test-4693-setup-reader.ps1`.
- `test-check-words.ps1`: writes a stand-in `installer/README.md` in its own scratch folder and never reads this one.
- `test-3682-github-front.js`: names InstallWindow.cs to say where the install's log is written; it checks only that the crash form names that log.
- `site/tests/test-4496-install-steps-order.js`: reads InstallSteps.cs's closing lines for the order of the steps after the installer, and checks that the join, Downloads and help pages give them in that order; it tests those pages, not the install.


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
`config.json` merged, updating only the package's channel and feed fields and
keeping the person's settings unless they change a choice on the setup card;
the file is kept to this Windows account; `Thornswood.lnk` in the install folder; and the checks at
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
| The launcher, Velopack's `Update.exe` and the package it came from | `%LocalAppData%\Thornswood` (`current\`, `packages\`) | Velopack's Setup.exe, and Velopack again at each update | Velopack's own uninstall. The launcher's Uninstall leaves this Velopack folder (#5820) |
| Which folder is the install folder | `%LocalAppData%\Thornswood\install-root.txt` | `InstallPlace.Record`, once Install has finished, or at the first start after an older launcher handed over (`InstallPlace.TakeHandover`) | Velopack's own uninstall, with its folder. Not the launcher's Uninstall (#5820) |
| An older launcher's handover | `%LocalAppData%\Thornswood-moved-from.txt` | The last update of an older launcher, from before Velopack (`launcher\move`) | The first start, which reads it and deletes it (`InstallPlace.TakeHandover`) |
| Desktop and Start menu shortcuts | `Thornswood.lnk` on the Desktop and in `Start Menu\Programs` | Velopack's Setup.exe makes its own. At every start `Icons.Ensure` points every shortcut that runs the launcher at the current icon, renames one with an old name (`Icons.Rename`) and makes one where the Desktop or the Start menu has none (`Icons.Make`) | The launcher's Uninstall (`Icons.Drop`): every shortcut on the Desktop, the shared Desktop, the Start menu, the pinned taskbar and in the install folder whose target is the running launcher. Velopack's own uninstall takes the ones it made |
| The shortcuts' icon | `icon-<hash>.ico` in the install folder's `Launcher` folder, only when there is one (an install from before Velopack), and `Profile\icons.stamp` | `Icons.IconFile` and `Icons.Remember`, at every start | The launcher's Uninstall, with `Launcher` and with Profile |
| Thornswood in Windows' Installed apps | `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\Thornswood-<hash of the install folder>` | `Register.Ensure`, at every start | The launcher's Uninstall (`Register.Forget`). Not Velopack's own uninstall (#5820) |
| The install folder and its `Profile` folder | The install folder | `InstallWindow.Work`, before anything is installed, and `InstallSteps.Run` | The launcher's Uninstall, last, and only once it is empty: anything still in it keeps it, and the farewell names each thing and why |
| The setup's log | `Profile\setup-log.txt` | `InstallWindow.Work` | The launcher's Uninstall, with Profile |
| What was accepted before Install | `Profile\accepted.json` | `InstallAgreements.Record` | The launcher's Uninstall, with Profile |
| Thornswood's own game files | Into the Steam copy of Skyrim when Thornswood's own folder is not ticked; into `Profile\Payload` when it is; into the install folder's `Game` when the launcher has already made that folder | `InstallSteps.CopyPayload` | In the Steam copy: the launcher's Uninstall when it is told to remove the mods, by the list below, leaving every file Vortex deploys; and making Thornswood's own folder later takes them out of the Steam copy too (`OwnGame.CleanSteamCopy`). `Profile\Payload` and `Game`: the launcher's Uninstall when it is told to remove the mods |
| The list of what went into the Steam copy | `Profile\installed-into-game.txt`, written through a sibling `installed-into-game.txt.<id>.tmp` | `InstallSteps.SaveOwnership` writes a complete replacement list. It keeps prior setup and update entries and records prepared copies before they move | Setup moves the temporary file into place or removes it when a write fails. The launcher's Uninstall removes the list with Profile after using it |
| Prepared copies of new files for the Steam install | A `.tw-setup-<id>` directory next to each destination, holding a file named `payload` | `InstallSteps.CopyPayload` stages the copy, and `InstallSteps.PublishPrepared` moves it to its destination after saving its ownership record | Setup clears staging when it finishes and can clear previously recorded staging on retry. An interruption before the record is saved may leave a staging directory |
| Skyrim's settings and the saves folder for Thornswood | `Profile\Default`, `Profile\MyGames` with `Saves` in it, and `Profile\LocalAppData`, filled from the package's `profile` folder when it has one | `InstallSteps.Settings` | The launcher's Uninstall, with Profile, unless it is told to keep saves and settings |
| The updates already in this build | `Profile\applied.txt` | `InstallSteps.Settings` | The launcher's Uninstall, with Profile, unless it is told to keep saves and settings |
| Where the SkyMP source is, and the licence texts | In the install folder: `SOURCE CODE.txt`, `GPL-3.0.txt`, `AGPL-3.0.txt`, `Concentus-LICENSE.txt`, `SharpSRTP-LICENSE.txt`, `SharpDTLS-LICENSE.txt`, `BouncyCastle-LICENSE.txt`, `dotnet-LICENSE.txt`, `dotnet-THIRD-PARTY-NOTICES.txt`, `Avalonia-LICENSE.txt`, `MicroCom-LICENSE.txt`, `Tmds.DBus-LICENSE.txt`, `SkiaSharp-LICENSE.txt`, `SkiaSharp-THIRD-PARTY-NOTICES.txt`, `ANGLE-LICENSE.txt`, `Velopack-LICENSE.txt`, `Velopack-Rust-crates.txt`, `NLayer-LICENSE.txt`, `Chromium-HRTF-LICENSE.txt`, `IRCAM-Listen-HRTF.txt`, and the `licences` folder | `InstallSteps.Settings` | The launcher's Uninstall, always (`Uninstall.Targets`) |
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

The launcher's uninstall leaves Velopack's files. Velopack's uninstall
leaves the files that the launcher manages (#5820).

`tests\test-4431-install-leaves.js` reads every write in the setup and first
start code (`InstallWindow.cs`, `InstallSteps.cs`, `InstallPlace.cs`,
`InstallAgreements.cs`, `InstallShortcut.cs`, `InstallSkyrim.cs`,
`Register.cs` and `Icons.cs`) and fails when this table does not name the
method that writes or a name its path is built from.
