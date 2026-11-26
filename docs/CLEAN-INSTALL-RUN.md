# Clean install run

A checklist for installing Thornswood on a machine that has never seen it, the
way a stranger would, with the time and every word on screen written down.

**Last run: never.**

Until somebody has walked it once on a clean virtual machine and filled in
every row, this is a plan and not a record, and the right assumption is that
something in it is wrong. The run is how to find out which part. It is held to
the same standard as `RESTORING.md` in the ops repo.

## Contents

- [Why](#why)
- [The shape being tested](#the-shape-being-tested)
- [Who does what](#who-does-what)
- [Before the run](#before-the-run)
- [How to fill in a row](#how-to-fill-in-a-row)
- [The run](#the-run)
- [Questions asked](#questions-asked)
- [Commands](#commands)
- [What the build should show, by row](#what-the-build-should-show-by-row)
- [What the code predicts](#what-the-code-predicts)
- [After the run](#after-the-run)
- [Shrinking the list next time](#shrinking-the-list-next-time)

## Why

Nobody has installed Thornswood on a clean machine and written down what
happened. Everybody who builds it already has Steam, Skyrim, Vortex, the
collection and an old install on their disk, so every step that only a stranger
meets goes untested. The install (`launcher\app\InstallWindow.cs` and
`launcher\app\InstallSteps.cs`, the launcher's first start since #4824) is over
1,000 lines, and the first person to run it on a machine without all of that is
a new tester. One run finds most of what that
person would, before they do.

## The shape being tested

The one that ships today. It has three parts, and a run that reaches a lit PLAY
button has been through all three.

1. The installer on the Downloads page, `Thornswood-Setup.exe`, is Velopack's
   setup program from a GitHub Release (#4824), signed on GitHub's runner like
   the launcher it carries (`docs\SIGNED-RELEASES.md`). It puts down the
   launcher with Thornswood's own files beside it, downloads nothing, and
   starts the launcher. The launcher's first start is the Thornswood Setup
   window: where to install, Thornswood's own Skyrim folder (ticked as it
   starts), and an age box and three agreement boxes that lock Install. Install
   runs in that window, every line of it also going to
   `C:\Thornswood\Profile\setup-log.txt` (`launcher\app\InstallWindow.cs`,
   `launcher\app\InstallSteps.cs`). With the own folder ticked, nothing is
   written into the Steam copy of Skyrim. Nothing the collection provides is in
   the installer, so the install reads the Steam copy rather than make a Skyrim
   of its own.
2. Vortex deploys the Nexus collection into that same Steam copy.
3. The launcher makes Thornswood's own game folder, `C:\Thornswood\Game`, out
   of what Vortex deployed: the big files as hard links, so the collection is
   not on the disk twice, and copies of everything that gets rewritten in
   place. Then it runs Scan and Fix in that folder, takes a newer launcher if
   there is one, and restarts once, into that folder (`launcher\app\OwnGame.cs`,
   `launcher\app\ShellOwnGame.cs`, `FirstSetupRestart` in
   `launcher\app\ShellScanFix.cs`, #5937). This is the settled design in the
   Developer Guide (`docs\guide\settled-design.md`), and the launcher will not
   start the game out of the shared Steam copy at all.

The To Do entry that asked for this list named the Steam copy with Vortex as the
shape to test, on the grounds that the own folder had not reached main. It has:
the settled design was corrected on 18 Sep, and the own folder is where a new
install ends up.

Row 20 reads the Steam copy the way the install sees it. The setup window says
`Thornswood installs into this copy.` under the heading The base game, and
says what to do when the build is not 1.6.1170.

## Who does what

- **The tester** walks the rows and fills them in: Djinn, or anybody who has
  never installed Thornswood. Read this file through once before starting.
  Every question asked about it goes under Questions asked, because each one is
  a line this file is missing.
- **Patrick** accepts the Discord application at row 14, and runs the two checks
  at rows 48 and 49 on his own machine. One of them reads the server over SSH
  with his key, and that key never goes into a test machine.
- **Nobody fixes anything during the run.** Do only what the site, the installer
  or the launcher tells a person to do. When none of them says what to do next,
  that is the finding: write it down and stop the run there. The Address Library
  is the most likely to be missing. Record it, and do not add it by hand.

## Before the run

**The machine.**

- Hyper-V on the machine that hosts the run. Windows 11 Pro has it; Microsoft's
  page on switching it on is
  https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/Install-Hyper-V
- A generation 2 virtual machine with its virtual TPM switched on, since
  Windows 11 will not install without one, 8 GB of memory or more, and a single
  virtual disk of 200 GB, dynamically expanding. One disk on purpose: the own
  folder is made of hard links, and those only work inside one drive
  (`WhyNot` in `launcher\app\OwnGame.cs`). The size is generous so that running
  out of room is not what the run finds by accident. Row 46 measures what was
  really used.
- Room on the host for that disk. Measured on 24 Sep, C: on Patrick's machine
  had 2.6 GB free and D: and E: reported none, so the virtual machine cannot
  live there until room is made. If it goes on another machine instead, carry
  the `C:\ts-clean-run` folder M7 makes across to Patrick's machine for rows 48
  and 49.
- Windows 11 from Microsoft's own ISO, not a developer image, which comes with
  tools a stranger's machine does not have. Run Windows Update until it has
  nothing left, shut down, and take a checkpoint named `clean`. Every run
  starts from that checkpoint.
- Connect with an enhanced session and the host's C: drive shared in (Show
  Options, Local Resources, More, Drives). Row 47 copies the results out
  that way.
- No graphics card is needed. The run stops at the launcher's Play page, before
  the game starts.

**The outside.** The day of the run, Patrick runs `.\scripts\dev\Check-Outside.ps1`
from the repo folder on his own machine. It only reads, sends no token, and
walks what a first install fetches from outside the project: the update feed,
every pack, the launcher, the client runtime, Steam's public build and the
collection page. Keep what it prints with the run's screenshots. A red line
there is a row the run should expect to fail.

**The accounts.** Name each one in the rows. Never write down a password, a code
from an email or an authenticator, or anything a site or the launcher shows as
a key.

- A Steam account made for this run that owns Skyrim Special Edition. Owning it
  is a purchase.
- A Nexus Mods account made for this run, free, without Premium, because that
  is what a stranger has. On a free account Vortex can ask for a click on the
  Nexus site for every mod in the collection, and row 31 counts them.
- A Discord account that has never been in the Thornswood server, so the
  application is walked too. Staff remove it afterwards.

**The record.** Fill in this file itself, on a branch, as the run goes. A second
screen or a printout works, with the rows copied in afterwards. Screenshots go
in one folder named after the date, and a Seen cell can name one ("shot 07")
when the text is too long to type.

## How to fill in a row

- **Clock**: the time of day when the step starts, 24 hour, to the minute, as
  in `14:05`. How long a step took is the gap to the next row. A row the run
  never reached says `not reached`.
- **Seen, word for word**: every prompt, warning, error and button the step put
  on screen, copied exactly, window title included, and the numbers: sizes,
  speeds, counts. A row where nothing appeared says `nothing`.
- **A stranger would instead**: what somebody holding only the join page would
  have done at this point, where that is different from the step. Blank when it
  is the same.

The commands the measuring rows name (M1 to M8, C1 and C2) are under Commands,
further down. On the virtual machine they go into Windows PowerShell, from the
Start menu.

## The run

### The machine

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 1 | Start the virtual machine from the `clean` checkpoint and sign in to Windows. Write down the version `winver` shows. | | | |
| 2 | Measure the free space on C: before anything is installed (M1). | | | |
| 3 | Open https://thornswood.net/join in Edge and read it once, through. Under Seen, write the steps the tester now believes they have to take, in their order, before taking any. The page says the Steam copy can stay on any build: the launcher's Downgrade button asks Steam for 1.6.1170's files and puts them in Thornswood's own folder, and leaves the Skyrim you already have alone. | | | |

### Steam and Skyrim

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 4 | Download Steam from https://store.steampowered.com and install it. | | | |
| 5 | Sign in to Steam with the account made for this run. Name the account; never the password or a Steam Guard code. | | | |
| 6 | Put Skyrim Special Edition on that account. | | | |
| 7 | Install Skyrim Special Edition into Steam's own library on C:. Write down the size Steam shows and when it finished. | | | |
| 8 | Measure which build Steam installed (M2). | | | |
| 9 | Do not start Skyrim: the join page never says to. Write down here, and at the row where it happens, anything later that asks for it to have been started once. | | | |

### Nexus and Vortex

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 10 | Make a Nexus Mods account for this run, free, without Premium. Name the account; never the password. | | | |
| 11 | Download Vortex from Nexus Mods and install it. | | | |
| 12 | Sign Vortex in to Nexus Mods and let it find and manage Skyrim Special Edition. | | | |

### Apply

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 13 | Join the Thornswood Discord from the site and apply in a ticket, the way the join page says. | | | |
| 14 | Patrick accepts the application. Write down how long after the ticket that came. | | | |

### The installer

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 15 | Open https://thornswood.net/downloads and download the installer. Write down the file name, its size, the SHA-256 the page prints under it, and every warning the browser shows. Then measure the downloaded file's SHA-256 (M8) and write down whether the two match. | | | |
| 16 | Run it. Write down every Windows prompt word for word, what had to be pressed to get past each one, and the publisher Windows names: the setup program is signed, so it should not read Unknown publisher. Then write down what Velopack's setup showed while it put the launcher down, and when the Thornswood Setup window opened. | | | |
| 17 | Read the Thornswood Setup window before pressing anything. Write down the folder it offers under Install to, the drive buttons with their free space, and the lines under them about Skyrim's drive and the room. Also copy what it says about the Steam copy with the box for Thornswood's own Skyrim folder left ticked, as it starts: it does not install into the Skyrim you already have on Steam, and that copy is left as it is. | | | |
| 18 | Leave the folder at `C:\Thornswood` and the own folder box ticked. Tick the age box and the three boxes for the Terms and Conditions, the Privacy Policy and the Rules, and write down what each Read link opened and whether Install stayed off until all four were ticked. Then press Install. | | | |
| 19 | Write down when the install's lines started under the window and how long the bar ran, with the count of files and MB it says it is copying. | | | |
| 20 | Write down the window's first lines, up to the heading The base game, including whether it says Thornswood installs into this copy. If it says this Skyrim is not build 1.6.1170, write down what it says to do: open the launcher and press Downgrade, so Steam downloads 1.6.1170's files and Thornswood makes its own game folder from them, while the Steam copy stays on the build it is on. Do not change anything in Steam. | | | |
| 21 | Once the window prints Checking, copy every line marked ok, next or MISS, from the window or from `C:\Thornswood\Profile\setup-log.txt`. | | | |
| 22 | Write down how the install ended: whether the launcher's own window opened by itself, or the setup window stopped with a reason and a Close button, and its last lines. | | | |

### The launcher's first look

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 23 | If the launcher did not open by itself, open Thornswood from the desktop. Write down the words on the Play button and every card above it. | | | |
| 24 | Write down every Windows prompt the launcher raised on its first start: firewall, microphone, administrator. | | | |
| 25 | Measure that no installer scratch folder is on the disk (M3). The setup program unpacks nothing outside its own folders, so it should print False and no line from the log. | | | |

### The build

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 26 | Press Downgrade on the card. Copy the question it asks before anything starts, word for word, and what the tester chose. The question says the Steam copy of Skyrim is not changed and can stay on any build, and that the files go into Thornswood's own game folder. Then write down every window that opened, the log line that says it is getting Skyrim 1.6.1170, and whether the tester had to touch Steam at all. | | | |
| 27 | When the launcher says it is done, measure the build again (M2) and write down the build the Play page shows. | | | |
| 28 | The launcher does not ask about Steam's Updates after Downgrade, because the downgrade never changes the Steam copy. The question is asked on the way in, and only when Skyrim is already on 1.6.1170, Thornswood has no folder of its own yet, and Steam is open. If it appeared, copy it word for word and write down what the tester did with it. If a downgrade was needed first, write that the question did not appear. With Steam running, write down what Skyrim's Properties, Updates page shows under Automatic Updates, and whether Steam's Downloads page has Skyrim queued for an update again. | | | |

### The collection

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 29 | Open the collection from the launcher's card or from the Downloads page. Write down the card's words first, which, and the revision the Nexus page shows. | | | |
| 30 | Add it to Vortex and start the install. Write down every dialog, including the switch for skipping plugin rules, and leave that switch as it comes. | | | |
| 31 | Write down how many mods asked for a click on the Nexus site, and when the last one finished downloading. | | | |
| 32 | Write down the name of the Vortex profile the collection made, and whether Vortex switched to it by itself. | | | |
| 33 | Write down every dialog at deployment: external changes, file conflicts, sorting, missing masters. | | | |
| 34 | Measure whether the Address Library arrived in the Steam copy, and whether Start On Save did too (M4). Do not add or remove either by hand. | | | |

### Discord in the launcher

The launcher puts this after the collection, and so does the join page. Since
#428 the collection opens without it, because anyone can download in the alpha.
Row 36 records which order the tester really took.

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 35 | Press Connect Discord where the launcher offers it. Write down the words around the button first, then every page the browser showed, and whether it closed itself. | | | |
| 36 | Write down which the tester reached for first, the collection or Connect Discord, and why. | | | |

### Thornswood's own folder

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 37 | Go back to the launcher. Write down the words on the Play button and any question it asks, and press the button if it asks nothing. | | | |
| 38 | With the setup window's box for a Skyrim folder of its own left ticked, as it starts, the launcher makes the folder without a question. Copy the log line that starts "Making Thornswood's own Skyrim folder" word for word, then the percentages the log shows, and how long it took. If a question comes up instead, copy it word for word and answer yes. | | | |
| 39 | Write down any Windows prompt while the folder is made. There should be none: the launcher no longer asks for administrator for a firewall rule. | | | |
| 40 | Write down the restart, and copy the log line that starts "Thornswood's own Skyrim folder is ready at" (M5). There should be one restart, after Fix has run (#5937). | | | |
| 41 | Measure whether the Address Library is in the own folder and Start On Save is not (M4 again). | | | |
| 42 | Write down the Client row on the Play page, and any log lines about putting the client runtime back (M5). | | | |

### The Play page

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 43 | Write down any update the launcher offered, how many, and how long it took. | | | |
| 44 | Write down the line under the title (plugins, game build, launcher version), every check row, green or red, the bar above Play if there is one, and the First time card. | | | |
| 45 | The run ends when the Play button reads PLAY and can be pressed. Write down the time. Do not press it. | | | |
| 46 | Measure the free space on C: again (M1), and the size of `C:\Thornswood` (M6). | | | |

### The two read-only checks

| # | Step | Clock | Seen, word for word | A stranger would instead |
| --- | --- | --- | --- | --- |
| 47 | Copy the plugins, the load order and the launcher log out of the virtual machine (M7). | | | |
| 48 | On Patrick's machine, run Check-Build.ps1 against that copy (C1). Copy its In short line. | | | |
| 49 | On Patrick's machine, run Check-Manifest.ps1 against that copy (C2). Copy its POSITION BY POSITION line. | | | |

## Questions asked

Every question the tester asks, before or during the run, in their own words,
with the row it came up at.

| Row | The question |
| --- | --- |

## Commands

M1 to M8 run on the virtual machine. C1 and C2 run on Patrick's machine. All of
them only read, except M7, which copies files out of the virtual machine into
`C:\ts-clean-run` on Patrick's machine.

**M1, free space on C:.** Prints two numbers, used and free, in GB. The first
and last readings are the whole install's real cost on the disk.

```powershell
Get-PSDrive C | Select-Object @{ n = 'UsedGB'; e = { [math]::Round($_.Used / 1GB, 1) } }, @{ n = 'FreeGB'; e = { [math]::Round($_.Free / 1GB, 1) } }
```

**M2, which build of Skyrim.** Prints the size of SkyrimSE.exe in bytes.
37157144 is 1.6.1170, the build the server runs (`records\skyrim-files.json`).
37910440 is 1.7.104 (`launcher\app\Downgrade.cs`). Write any other number down as
it is.

```powershell
(Get-Item 'C:\Program Files (x86)\Steam\steamapps\common\Skyrim Special Edition\SkyrimSE.exe').Length
```

**M3, no installer scratch folder.** The installer from before Velopack unpacked
into `C:\Thornswood-setup`, and the launcher still clears one it finds. Today's
setup program makes none, so the first line should print False, and the second,
the launcher's own line from clearing one, should print nothing.

```powershell
Test-Path C:\Thornswood-setup
Select-String -Path C:\Thornswood\Profile\launcher.log -Pattern 'the installer left behind' | ForEach-Object { $_.Line }
```

**M4, the Address Library and Start On Save.** Four lines, True or False: the
Steam copy first, then the own folder. Until row 38 the own folder does not
exist, so its two lines read False. Once it does, its Address Library line
should read True and its Start On Save line False: Start On Save left
Thornswood in issue #394 and the launcher keeps it out of the own folder, even
while a collection revision older than the one that dropped it still deploys it
into the Steam copy.

```powershell
foreach ($d in 'C:\Program Files (x86)\Steam\steamapps\common\Skyrim Special Edition\Data\SKSE\Plugins', 'C:\Thornswood\Game\Data\SKSE\Plugins') {
  foreach ($f in 'versionlib-1-6-1170-0.bin', 'po3_StartOnSave.dll') {
    '{0,-5}  {1}' -f (Test-Path -LiteralPath (Join-Path $d $f)), (Join-Path $d $f)
  }
}
```

**M5, the launcher's own account of the folder and the client.** Prints the
matching lines from the launcher's log, each with its time.

```powershell
Select-String -Path C:\Thornswood\Profile\launcher.log -Pattern 'own Skyrim folder|first setup|Restarting the launcher|client runtime' | ForEach-Object { $_.Line }
```

**M6, the size of C:\Thornswood.** A hard linked file counts at its full size
here although it takes no extra room, so this reads larger than the folder
really costs. M1 is the real cost.

```powershell
'{0:n1} GB' -f ((Get-ChildItem C:\Thornswood -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1GB)
```

**M7, copy the results out.** Puts the plugins at the top of the own folder's
Data, its Skyrim.ccc, the load order the game reads and the launcher's log into
`C:\ts-clean-run` on Patrick's machine, through the drive the enhanced session
shares in. Only the plugins, because the two checks read nothing else: on 24 Sep
Patrick's own game folder had 100 of them at the top of Data, 377 MB. robocopy
ends with a summary table, and any number under Failed means a file did not come
across.

```powershell
$out = '\\tsclient\C\ts-clean-run'
New-Item -ItemType Directory -Force -Path "$out\Game\Data", "$out\Profile\LocalAppData" | Out-Null
robocopy C:\Thornswood\Game\Data "$out\Game\Data" *.esm *.esp *.esl /LEV:1 /NFL /NDL /NJH
if (Test-Path C:\Thornswood\Game\Skyrim.ccc) { Copy-Item C:\Thornswood\Game\Skyrim.ccc "$out\Game\" }
Copy-Item C:\Thornswood\Profile\LocalAppData\plugins.txt "$out\Profile\LocalAppData\"
Copy-Item C:\Thornswood\Profile\launcher.log "$out\"
```

**M8, the installer's checksum.** Prints the SHA-256 of the newest installer in
the Downloads folder, in lower case the way the Downloads page prints it, then
the file it read. An installer published before the page printed a checksum has
none there, and then row 15 says so. A checksum is not a key: the page prints it
for anybody, so both go into row 15 whole, and
`launcher\tests\test-clean-install-run.js` lets a SHA-256 through on a line that says
SHA-256.

```powershell
Get-ChildItem "$env:USERPROFILE\Downloads\Thornswood-Setup*.exe" | Sort-Object LastWriteTime | Select-Object -Last 1 | Get-FileHash -Algorithm SHA256 | ForEach-Object { $_.Hash.ToLower() + '  ' + $_.Path }
```

**C1 and C2, the two read-only checks, on Patrick's machine.** The first line
goes to the repo folder.

```powershell
cd C:\Thornswood-Repo
.\scripts\release\Check-Build.ps1 -Data C:\ts-clean-run\Game\Data -NoPause
.\scripts\mods\Check-Manifest.ps1 -Client C:\ts-clean-run -NoPause
```

C1 reads the live server's manifest over HTTP and compares every plugin it
names, by size and checksum, with the copy. When it worked it prints
`This build is byte for byte what the server expects.` above a line reading
0 missing and 0 the wrong file, and it exits 2 when anything is missing or
wrong.

C2 reads the live server's load order over SSH and compares it, position by
position, with the copy's plugins.txt. When it worked it prints
`you have every plugin the server wants` and
`POSITION BY POSITION: identical.`

Both check the live server, because the installer on the Downloads page is the
main build. Both need their `-Data` and `-Client`: without them they read
Patrick's own `C:\Thornswood` and pass for the wrong reason.

## What the build should show, by row

For whoever reads the filled-in rows afterwards, not for the tester during the
run: a tester who knows what is coming is not a stranger any more. Each line is
text the build puts on screen at that row, copied from the file named beside it.
`launcher\tests\test-clean-install-run.js` checks that every one of them is still in that
file, so a label that changes shows up as a stale line here rather than as a
tester confused by a list that no longer matches.

| Row | Text | In |
| --- | --- | --- |
| 3 | `Anniversary Edition is not required` | `site\data\site\join.md` |
| 3 | `Thornswood writes nothing of its own into the Skyrim you already have on Steam, so that copy stays yours to play and mod however you like` | `site\data\site\join.md` |
| 17 | `This puts Thornswood's own content on your PC.` | `launcher\app\InstallWindow.cs` |
| 17 | `that copy is left as it is, for you to play and mod however you like.` | `launcher\app\InstallWindow.cs` |
| 17 | `C:\Thornswood` | `launcher\app\InstallPlace.cs` |
| 17 | `Give Thornswood a Skyrim folder of its own` | `launcher\app\InstallWindow.cs` |
| 18 | `I am 18 or over. Thornswood is an adult server.` | `launcher\app\InstallAgreements.cs` |
| 18 | `I have read and accept the Terms and Conditions` | `launcher\app\InstallAgreements.cs` |
| 18 | `I have read and accept the Privacy Policy` | `launcher\app\InstallAgreements.cs` |
| 18 | `I have read and agree to the Rules` | `launcher\app\InstallAgreements.cs` |
| 19 | `Installing. What it is doing shows below, and Thornswood opens by itself when it is done.` | `launcher\app\InstallWindow.cs` |
| 20 | `Thornswood installs into this copy.` | `launcher\app\InstallSteps.cs` |
| 20 | `This Skyrim is not build 1.6.1170, which is the one the server runs.` | `launcher\app\InstallSteps.cs` |
| 20 | `Thornswood installs anyway. Open the launcher and press Downgrade:` | `launcher\app\InstallSteps.cs` |
| 20 | `Your Steam copy stays on the build it is on.` | `launcher\app\InstallSteps.cs` |
| 21 | `the collection installs this` | `launcher\app\InstallSteps.cs` |
| 22 | `failed. Send staff a screenshot of this window in the Discord.` | `launcher\app\InstallSteps.cs` |
| 22 | `Opening Thornswood now.` | `launcher\app\InstallSteps.cs` |
| 22 | `Next, in the launcher:` | `launcher\app\InstallSteps.cs` |
| 22 | `. Press Downgrade on the front page. Skyrim is not build 1.6.1170, and Steam downloads that build under your account.` | `launcher\app\InstallSteps.cs` |
| 22 | `. Install the collection in Vortex from the card the launcher shows, and switch to the profile it makes. The script extender and the address library come with it.` | `launcher\app\InstallSteps.cs` |
| 23 | `DOWNGRADE FIRST` | `launcher\app\Shell.cs` |
| 23 | `Skyrim is on the wrong build` | `launcher\app\Shell.cs` |
| 23 | `Thornswood is sharing one Skyrim with every other server on this machine` | `launcher\app\ShellOwnGame.cs` |
| 26 | `Downgrade Skyrim to 1.6.1170?` | `launcher\app\Shell.cs` |
| 26 | `Do not type or click while Steam's window is in front, or the keys go to the wrong place.` | `launcher\app\Shell.cs` |
| 26 | `Getting Skyrim 1.6.1170.` | `launcher\app\Downgrade.cs` |
| 28 | `Steam can update its copy of Skyrim by itself.` | `launcher\app\SteamUpdates.cs` |
| 28 | `Yes closes Steam, makes the change and starts Steam again.` | `launcher\app\SteamUpdates.cs` |
| 28 | `Wait until I launch the game` | `launcher\app\SteamUpdates.cs` |
| 29 | `Your mods are not installed yet` | `launcher\app\Shell.cs` |
| 29 | `Open the collection` | `launcher\app\Shell.cs` |
| 29 | `INSTALL THE MODS FIRST` | `launcher\app\Shell.cs` |
| 29 | `https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf` | `launcher\app\Config.cs` |
| 37 | `MAKE THORNSWOOD'S OWN FOLDER` | `launcher\app\Shell.cs` |
| 38 | `Making Thornswood's own Skyrim folder, which every install has unless its box was unticked.` | `launcher\app\ShellOwnGame.cs` |
| 38 | `Making Thornswood's own Skyrim folder:` | `launcher\app\OwnGame.cs` |
| 39 | `Making Thornswood's own Skyrim folder from what Vortex has deployed. Play comes back when it is done.` | `launcher\app\ShellOwnGame.cs` |
| 40 | `Thornswood's own Skyrim folder is ready at` | `launcher\app\OwnGame.cs` |
| 40 | `The first setup is done. Checking for a newer launcher before the one restart.` | `launcher\app\ShellScanFix.cs` |
| 40 | `Restarting the launcher once, so it runs from the new folder.` | `launcher\app\ShellScanFix.cs` |
| 42 | `files are` | `launcher\app\Checks.cs` |
| 42 | `The client runtime is back to the recorded build.` | `launcher\app\ClientRuntime.cs` |
| 43 | `UPDATE FIRST` | `launcher\app\Shell.cs` |
| 44 | `Give your character a name that belongs in Skyrim` | `launcher\app\MainWindow.axaml` |
| 45 | `PLAY` | `launcher\app\Shell.cs` |
| 48 | `This build is byte for byte what the server expects.` | `scripts\release\Check-Build.ps1` |
| 49 | `you have every plugin the server wants` | `scripts\mods\Check-Manifest.ps1` |
| 49 | `POSITION BY POSITION: identical.` | `scripts\mods\Check-Manifest.ps1` |

## What the code predicts

Read out of the code before anybody has run it, so the run can prove each one
right or wrong. To Do entries are named by title, because their numbers move.

- **The setup window may call a good install broken (rows 21 and 22).** In
  this shape `launcher\app\InstallSteps.cs` finishes with six checks and excuses
  three of them: the script extender and the Address Library, which the
  collection brings next, and a Steam copy on another build, which the
  launcher's Downgrade button answers. The other three count. Load order looks
  for a plugins.txt under `%LOCALAPPDATA%\Skyrim Special Edition`, which
  nothing may have written yet on a machine where Skyrim has never started and
  the collection is not in. If it fails, the window says the checks failed,
  tells the person to send staff a screenshot, and stops with a Close button
  instead of opening the launcher. No To Do entry covers this yet.
- **One way to fix the build (rows 20 and 26).** The setup window and the
  launcher both send the person to the Downgrade button, which asks Steam for
  the old build through Steam's console. Since 24 Sep the button asks first,
  naming the three lines it will type into Steam's console, so row 26 starts
  with a Yes or No. The keystrokes themselves are still owned by "Downgrade
  drives Valve's own window by synthesised keystrokes at a measured pixel
  offset, with no consent screen".
- **Steam taking Skyrim back to the newer build (row 28).** Once a downgrade
  has worked, the launcher asks whether to set Skyrim's Automatic Updates in
  Steam to "Wait until I launch the game", and asks for Steam to be exited
  first, because Steam writes its own setting back when it closes. No leaves
  it as it is. Either way Steam still updates the game when it is started from
  Steam. Owned by "Nothing stops Steam putting Skyrim back on the wrong build".
- **"It does not make a second copy of the game" (rows 3 and 17).** Fixed on
  25 September, and again in November: the join, help and Downloads pages
  and the installer's read me now name the install window's box, "Give
  Thornswood a Skyrim folder of its own", say it starts ticked (since
  12 November; it started unticked before), and say that ticked the launcher
  builds `Game` in the install folder, most of it as hard links, while
  unticked Thornswood's own files go into the Steam copy until the launcher
  builds it.
- **Other servers, on a machine that has none (rows 23 and 38).** A log line on
  the first start and the own folder question both say Thornswood is sharing one Skyrim
  with other servers. On a clean machine there are none, and a stranger reads
  that as something they did wrong. No entry.
- **Three different orders (rows 22, 23, 29 and 30).** The launcher opens on
  Downgrade when the build is wrong and keeps the collection card hidden until
  the build is right; Connect Discord comes after the collection. The console
  gives that order since #4496. The join and Downloads pages and #start-here
  still say installer, collection, then Discord, with Downgrade only in what
  you need (#4496).
- **The console's last words (rows 22 and 44).** Since #4496 they list the
  launcher's own steps in its order: Downgrade first when the build is wrong,
  then the collection, Connect Discord and Play. They no longer ask for a
  character named after yourself or a save. Row 22 records whether the
  window's last lines match the launcher's front page.
- **The Address Library and Start On Save (rows 34 and 41).** The Address
  Library is expected missing unless the collection delivers it, owned by "The
  launcher never checks the Address Library, so a whole class of failure reads
  as green". Start On Save in the own folder is a finding against issue #394,
  which took it out.
- **SmartScreen (row 16).** The setup program and the launcher are signed
  through Azure Artifact Signing on GitHub's runner (`docs\SIGNED-RELEASES.md`),
  so Windows should name the publisher and never Unknown publisher. A new
  signed publisher has little reputation yet, so a soft SmartScreen ask can
  still come up, and the help page tells people to press More info, then Run
  anyway. Row 16 records which one this run met.
- **Updates on the first open (row 43).** An installer older than the last
  release offers what came after it. One built with no record of the packs it
  already holds offers every pack ever published, and `scripts\dev\Check-Outside.ps1`
  found on 24 Sep that 164 of the feed's 227 packs point at a repository a
  stranger cannot download from. Owned by "The installer is a snapshot of your
  game folder with your home folder path baked into the script, and it is
  stale by design".
- **Play held for an update (rows 43 to 45).** The launcher asks GitHub for
  its channel's release and holds Play only while that answer is not in or
  an update it found is waiting (CHECKING..., UPDATE FIRST); GitHub not
  answering leaves Play open, and the site's join pass turns away a launcher
  its channel is not on (#5608). If row 45 never reaches PLAY, copy the
  button and the bar above it word for word and stop there.
- **The client runtime is left out of the own folder on purpose (row 42).** The
  own folder never takes the six client files from the Steam copy (`Skip` in
  `launcher\app\OwnGame.cs`), so right after the restart the Client row should read
  missing, and the launcher should put them back by itself
  (`HealClientBackground` in `launcher\app\Shell.cs`). Row 42 records whether it
  did and how long it took.
- **The load order matches the server (row 49).** The Nexus collection, 7essxf,
  carries the plugin order in its "load after" rules
  (`scripts\mods\Check-CollectionRules.ps1` reads them), and this row is the
  proof that a clean install lands in the server's order.
- **No scratch folder (row 25).** The installer from before Velopack unpacked
  into `C:\Thornswood-setup` with a read me that described the old multiplayer
  mod's installer. Today's setup program unpacks nothing there, and the
  launcher only clears such a folder when an old install left one
  (`launcher\app\Shell.cs`). A clean machine should have none.

## After the run

1. Change the Last run line at the top to the date, who walked it, and which
   checkpoint it started from.
2. Every row whose Seen differs from What the build should show, and every
   question asked, goes on the To Do List: into the entry named above where one
   fits, as a new entry where none does.
3. Correct this file wherever a row could not be followed as it was written.
4. Run `node launcher\tests\test-clean-install-run.js`. Once the Last run line carries a
   date it fails on any row left without a time and an observation.
5. Open a pull request with the filled-in file.

## Shrinking the list next time

- Take a second checkpoint after row 12, named `steam-and-vortex`. Steam,
  Skyrim and Vortex are not ours, and once they have been timed from nothing a
  run that only tests what is ours can start there and say so on its Last run
  line.
- M1 to M6 and M8 can become one script that writes its answers to a file, so
  the measuring rows are pasted rather than typed. `scripts\dev\Check-Outside.ps1`
  already scripts the outside half: what the feed, GitHub, Steam and Nexus
  answer a stranger.
- The setup window writes every line it shows to
  `C:\Thornswood\Profile\setup-log.txt`, so rows 20 to 22 can be pasted from
  that file rather than typed off the screen. M7 could copy it out with the
  launcher's log.
- The rest stays by hand. Every prompt, warning and wait in it is what a
  stranger meets, and timing that is the reason for the run.
