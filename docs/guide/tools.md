# The tools, A to O

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

Each letter stands on its own: what the thing is, then the commands. The pages from Set up a machine to Release to main are the path. These letters are what you open when you already know the name.

## A. GitHub

GitHub is the website copy of the repository, at https://github.com/ThornswoodRP/Thornswood. Your PC and GitHub each hold the history. `origin` is the name Git uses for the GitHub copy.

### Sign in and look

Sign in on the website as the account that was added to the repository. The Code tab shows the files on the branch named in the dropdown. After a clone, that dropdown is `main`.

```powershell
gh auth status
```

It should print your login.

### Where your commits are

After `git push -u origin HEAD`, refresh the Code tab and choose your branch in the dropdown. The files there are your branch. The `main` entry is still the shared line. Those commits join `main` when the pull request is merged.

The Pull requests tab lists open pull requests. `gh pr create` adds yours. The steps are in [Open the pull request](make-a-change.md#open-the-pull-request).

### Learn more about GitHub

- [Hello World on GitHub](https://docs.github.com/en/get-started/quickstart/hello-world), the first-time walkthrough
- [About pull requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests)
- [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow), the short version of branch, pull request, merge
- This repository: https://github.com/ThornswoodRP/Thornswood
- The board: https://github.com/orgs/ThornswoodRP/projects/1

## B. Git

Git is the history of this folder on your PC. A commit is one saved step. A branch is a named line of commits. The folder shows one branch at a time.

### See the branch and the edits

```powershell
git status
git branch
git diff
git log -5 --oneline
```

`git status` names the branch and lists files that differ from the last commit. `git branch` lists the branches on this PC. The star is the one in the folder.

### The commands the rest of the guide uses

| You want | Command |
| --- | --- |
| Move onto a branch | `git switch yourname/short-name` |
| Create a branch and move onto it | `git switch -c yourname/short-name` |
| Update `main` | `git switch main` then `git pull` |
| Upload the branch you are on | `git push -u origin HEAD` |
| The same move, the older spelling | `git checkout yourname/short-name` |

The safe way to hold two jobs at once is [Switch between branches](make-a-change.md#switch-between-branches).

### Learn more about Git

- [Git tutorial](https://git-scm.com/docs/gittutorial), the first commands, from the Git project
- [What is Git, in pictures and video](https://git-scm.com/videos)
- [The Git book](https://git-scm.com/book/en/v2)
- [git-guides](https://github.com/git-guides), short pages from GitHub
- The program itself: https://github.com/git/git

## C. PowerShell

PowerShell is the terminal. You type one line, press Enter, and Windows runs it. The prompt looks like `PS C:\Dev\Thornswood>`. The folder in the prompt is the folder the next command runs in.

### Where you are

```powershell
Get-Location
Get-ChildItem
Set-Location launcher
Set-Location ..
```

`Get-Location` prints the folder. `Get-ChildItem` lists names. `cd launcher` and `cd ..` are the short forms this guide uses. Press Tab while you type a folder name and PowerShell finishes it.

### Run a script from the repository folder

The `.\` means the file is in this folder:

```powershell
.\scripts\dev\Check-Words.ps1
```

The up arrow brings the previous command back. `Ctrl+C` stops a command that is still running. `Clear-Host` clears the text off the window.

```powershell
$PSVersionTable.PSVersion
```

Scripts in this repository run in PowerShell 7. If the major number is 5, type `pwsh`.

### Run a harness by hand

Every nightly and build run starts a PowerShell harness with `pwsh -NoProfile -File`, from the repository folder. Do the same by hand:

```powershell
pwsh -NoProfile -File .\tests\test-install-server.ps1
```

From Git Bash too (the shell Claude Code's Bash tool uses on One), the same line with forward slashes. Nothing here runs in Windows PowerShell 5.1 any more, the box included (#5356): every script, task and harness starts `pwsh`.

### Learn more about PowerShell

- [PowerShell 101](https://learn.microsoft.com/en-us/powershell/scripting/learn/ps101/00-introduction), Microsoft's first course
- [Install PowerShell on Windows](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows)
- The source: https://github.com/PowerShell/PowerShell

## D. Visual Studio Code

Visual Studio Code is the window you work in. The folders sit on the left. The file you are reading sits in the middle. A terminal sits along the bottom.

### Open this repository

```powershell
cd C:\Dev\Thornswood
code .
code .\Developer-Guide.md
code .\game\gamemode.js
```

### The parts of the window

Hover the icons on the far left and read the name.

**Explorer** lists the folders and files. Click a triangle to open a folder. Click a file to open it. A dot on the file's tab means the editor still has unsaved changes. `Ctrl+S` saves. Git sees the saved file.

`Ctrl+P` opens a file by name. Type `gamemode.js` and press Enter.

`Ctrl+Shift+F` searches the words inside files. Click a result to open that line.

**Source Control** lists the same changed files `git status` lists. This guide does the commit from PowerShell, so the message and the branch stay visible in one place.

The branch name is in the status bar at the bottom left. Click it for a list of branches. Commit or stash first, as [Switch between branches](make-a-change.md#switch-between-branches) says, so each job's files stay with its branch.

**Terminal.** Open it from the View menu, Terminal. A new terminal starts in the clone. If the dropdown beside the plus sign says a PowerShell whose version is 5, type `pwsh`.

### Where to click

Stay in `C:\Dev\Thornswood`. Each big folder has its own `README.md`. Open that file when you go into the folder. The long map is [The pieces](the-system.md#the-pieces).

| In Explorer | What it is | In PowerShell |
| --- | --- | --- |
| `README.md` | The short map of the repository | `code .\README.md` |
| `Developer-Guide.md` | This guide's index; its pages are in `docs\guide` | `code .\Developer-Guide.md` |
| `launcher\app` | The launcher program | `Get-ChildItem launcher\app\*.cs` |
| `launcher\app\MainWindow.axaml` | The launcher window layout | `code .\launcher\app\MainWindow.axaml` |
| `game\gamemode.js` | The server rules | `code .\game\gamemode.js` |
| `game\plugins` | Scripts that run in Skyrim | `Get-ChildItem game\plugins` |
| `site\data\site` | The public website pages | `Get-ChildItem site\data\site` |
| `bot` | The Discord bot | `Get-ChildItem bot` |
| `voice` | Proximity voice | `code .\voice\voice-server.js` |
| `scripts\release` | Build and ship | `Get-ChildItem scripts\release` |
| `scripts\deploy` | Put a build on the server | `Get-ChildItem scripts\deploy` |
| `scripts\vps` | The server key and log reads | `Get-ChildItem scripts\vps` |
| `tests` | The test files | `Get-ChildItem tests` |
| `docs` | The system notes | `code .\docs\README.md` |

`engine` is the SkyMP source. Leave it until a task tells you to build the server. `out` and `local` appear after a build. Git keeps them off GitHub.

An edit to Shell.cs, Checks.cs, Keep.cs, Hold.cs, Updater.cs or Publish-Update.ps1 that blocks others' work gets a line in #dev-coordination first, from a Dev. Those files sit in `launcher\app` and `scripts\release`.

Search one file from PowerShell:

```powershell
Select-String -Path .\game\gamemode.js -Pattern "door"
```

For the whole repository, `Ctrl+Shift+F` is the search to use.

### Learn more about Visual Studio Code

- [Introductory videos](https://code.visualstudio.com/docs/getstarted/introvideos), from the Visual Studio Code team
- [The user interface](https://code.visualstudio.com/docs/getstarted/userinterface), each part of the window
- [Source Control](https://code.visualstudio.com/docs/sourcecontrol/overview)
- The editor's repository: https://github.com/microsoft/vscode
- The folders in this clone: [N. The repository map](#n-the-repository-map)

## E. VPS

The VPS is the remote Windows machine. The site, the bot, voice, and both game servers run there. You do not get the server password, and since 31 Oct 2026 you do not get a key to it either (Patrick's answer A on q-retire-box-keys, #2862): every job on the box is a verb of the deploy gate, which runs main's script there and hands what it printed back to you alone. `scripts\vps\gate\verbs.json` is the whole list, with what each verb takes.

### Run a verb

From the repository folder, with `gh` signed in as somebody who may run workflows in the private ops repository:

```powershell
pwsh scripts/vps/Box-Run.ps1 -Line 'ping'
```

A good answer says `ENDED 0`. It starts `box-run.yml` in the private ops repository, which asks the gate on the box over its own ssh, and nothing reaches the box from your machine.

### Two reads

```powershell
pwsh scripts/vps/Box-Run.ps1 -Line 'Check-Site'
pwsh scripts/vps/Box-Run.ps1 -Line 'Get-Logs -Lines 300'
```

`Check-Site` says whether the website answers. `Get-Logs` brings the tail of the site, bot, game server, and voice logs back to your machine and prints the folder. `-Lines 40000` pulls more.

The machines that hold a key from before 31 Oct keep it; `docs\BOX-ACCESS.md` in the private ops repo has those, and the secrets table below says how one is changed.

### Learn more about VPS

- [OpenSSH on Windows](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse), Microsoft's install page
- When the server is down: `docs\IT-IS-DOWN.md` in the private ops repo
- Moving the box: `docs\MOVING-THE-SERVER.md` in the private ops repo

## F. Website

The website is the `site` folder. Public pages are `site\data\site`. On the VPS it runs under Node at `C:\Thornswood-Docs`, and https://thornswood.net answers it.

### Deploy

Nothing to run: the merge's Release carries the app and the public pages, and the box deploy agent puts them in within minutes ([docs\DEPLOY-AGENT.md](../DEPLOY-AGENT.md)). An older copy goes back by its tag:

```powershell
pwsh scripts/vps/Box-Run.ps1 -Line 'Deploy-Release -Environment site -Tag <tag>'
```

`Deploy-Docs.ps1` is for the documents, the boards and the password, and for a new box before the agent has the site. News for a main release is [Release to main](release-to-main.md).

### Learn more about Website

- The site: https://thornswood.net
- Staff pages: https://thornswood.net/hub
- Join page: https://thornswood.net/join
- How a feed is served: [docs/FEED.md](../FEED.md)
- Node, which runs the site: [J. Node](#j-node)

## G. Main Build

The main build is the live launcher. People who join use this install. A main Ship publishes the live feed that this launcher reads. The steps to publish are [Release to main](release-to-main.md).

The install folder is `<drive>:\Thornswood` on most machines. The launcher exe sits under that tree. Profile, config, and packs sit beside it. The map of ports and folders is [The pieces](the-system.md#the-pieces). The Play page, with Main and Dev in the server list, is pictured in [H. Dev Build](#h-dev-build).

### Learn more about Main Build

- The live feed: https://thornswood.net/feed/version.json
- The feed, in detail: [docs/FEED.md](../FEED.md)

## H. Dev Build

The dev build is a second launcher beside the main install, at `<drive>:\Thornswood-DevBuild`. Its config says the channel is dev. The game port is 7787 and voice is 7789. Staff roles use it. Every change is tried here before a main release.

### Install it from the main launcher

In the main launcher, on the Play page, open the Server dropdown and choose Dev. It checks your Discord roles, then puts the dev build beside the main install. Open it once and let it make its own game folder. Settings, Maintenance has "Make it".

```powershell
.\scripts\release\Check-ShipReady.ps1 -Channel dev
```

That says whether the dev build and its game folder are in place, and ships nothing. Ship refuses `-Channel dev` without the dev build, unless the folder was named with `-Root` or recorded with Setup-ShipMachine.ps1 (#2662). The publish steps are [section 3](release-to-dev.md).

### The Play page

On the Play page, the server list is at the lower right, under the Play button. Main is the live server. Dev is the row under it. Choose Dev.

![The Play page. The server list at the lower right shows Main and Dev, and Dev is circled.](../launcher-play-dev.png)

### Learn more about Dev Build

- The dev feed: https://thornswood.net/feed-dev/version.json
- The same feed notes: [docs/FEED.md](../FEED.md)

## I. Bot

The bot is the `bot` folder, Python, on the VPS at `C:\Thornswood-Bot`. It posts tickets, join cards, and staff tools. The Windows service is `ThornswoodBot`.

### Deploy the code

When a merged pull request changed the bot's code or the join card art:

```powershell
.\scripts\deploy\Install-Bot.ps1 -CodeOnly
```

The bot's avatar is uploaded by hand in the Discord developer portal. No script sends that file. The token and the door key are in [P. Secrets, by name and place, never by value](secrets.md).

### Learn more about Bot

- discord.py, the library the bot uses: https://discordpy.readthedocs.io/en/stable/
- The library's repository: https://github.com/Rapptz/discord.py
- Discord's developer docs: https://discord.com/developers/docs/intro
- The developer portal, where the bot token and the avatar are set: https://discord.com/developers/applications

## J. Node

Node runs the website, the voice service, and the JavaScript tests. The install in [Install the tools](set-up-a-machine.md#install-the-tools) is the one this repository uses.

### See the version and run a test

```powershell
node --version
node tests\test-site-local.js
```

A passing run ends without an error. Use the file in `tests\` whose name matches the area you touched. Voice is `voice\voice-server.js`, also Node. The site program is `site\server.js` over its modules in `site\lib`.

### Learn more about Node

- [Introduction to Node](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs)
- Downloads: https://nodejs.org/en/download
- The runtime's repository: https://github.com/nodejs/node

## K. Vortex

Vortex is the mod manager. Thornswood's collection is deployed through a Vortex profile named Thornswood. The collection id is `7essxf`. Any machine can install it. Publishing a new revision of the collection uses Patrick's Nexus account.

The launcher builds `<Root>\Game` from the Steam copy of Skyrim Special Edition and from what that profile deployed. Play does not start the game out of the Steam copy. The full rules are [One Skyrim of its own](the-system.md#one-skyrim-of-its-own).

Leave Vortex's own files alone. A Ship packs Thornswood's files. It leaves Vortex's deployed files for Vortex to deploy.

### Install the collection

1. Install Vortex from the Nexus page below, and sign Vortex into a Nexus account.
2. Point Vortex at Skyrim Special Edition.
3. Add the Thornswood collection. Its address is https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf
4. Use a profile named Thornswood. Deploy that profile so the mods land on the Steam copy.
5. Open the Thornswood launcher. On the Play page, the server list at the lower right has Dev. The picture is in [H. Dev Build](#h-dev-build). Choose Dev, then let that install make its game folder. Settings, Maintenance has "Make it".

Publishing a new revision of the collection is done from Patrick's Nexus account. Installing a revision that is already published is any developer's Nexus account. The history of this choice is [docs/COLLECTION-METHOD.md](../COLLECTION-METHOD.md).

### Learn more about Vortex

- Vortex: https://www.nexusmods.com/site/mods/1
- Vortex getting started: https://wiki.nexusmods.com/index.php/Vortex
- The collection: https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf
- How this project uses it: [docs/COLLECTION-METHOD.md](../COLLECTION-METHOD.md)

## L. Pandora

Pandora Behaviour Engine+ builds the behavior files. The collection carries Pandora from revision 2. Nemesis cannot generate those files from a command line, which is why the launcher uses Pandora.

Every launcher builds them on its own computer before Play, and no release carries them (#3715). To build or check a folder by hand, with the game and the launcher closed:

```powershell
.\scripts\mods\Build-Generated.ps1 -Root <a Thornswood install> -NoPause
```

Ship runs it with `-DryRun` and stops when the collection installed in the ship root could not build them. What it builds is listed in `records\generated.json`. The behavior files are made in Thornswood's own folder, never in the Steam copy. The same rule is in [Settled design, not up for a quiet rewrite](settled-design.md).

### Learn more about Pandora

- Pandora Behaviour Engine+ on the Nexus, the file the collection carries: https://www.nexusmods.com/skyrimspecialedition/mods/133232
- Which revision added it, and the other mods beside it: [docs/COLLECTION-REVISION-2.md](../COLLECTION-REVISION-2.md)
- The code that runs it: [launcher/app/GeneratedBuild.cs](../../launcher/app/GeneratedBuild.cs), and by hand [scripts/mods/Build-Generated.ps1](../../scripts/mods/Build-Generated.ps1)

## M. Creation Kit

The Creation Kit is Bethesda's tool for records inside a plugin. Steam installs it into the Steam copy of Skyrim. A Creation Kit sitting there belongs to the person whose Steam copy it is.

A Thornswood release does not ship the Creation Kit, its script sources, or a copy of the game's own programs. Ship leaves those files out of the pack. Thornswood's own game folder drops them when it refreshes, and logs that it did. A plugin record that has to change is changed in the kit, then the plugin is rebuilt and that plugin is what the release carries.

### Change a record

1. Install the Creation Kit from Steam into the Steam copy of Skyrim Special Edition. Steam lists it with that game's tools.
2. Open the kit on that Steam copy. Load the plugin you are changing.
3. Change the record and save the plugin.
4. The saved plugin is the file the collection or `game\content` carries. The kit, `CreationKit.exe`, and its script sources stay on the Steam copy. A Ship does not pack them.

### Learn more about Creation Kit

- The Creation Kit wiki: https://ck.uesp.net/wiki/Main_Page
- Getting started there: https://ck.uesp.net/wiki/Category:Getting_Started
- Bethesda's older kit pages: https://www.creationkit.com/

## N. The repository map

One repository holds the launcher, the game, the website, the bot, voice, and the scripts that publish them. A release is those pieces together, so they live in one clone instead of six. You edit in the folder for the piece you are changing. You publish with a script from `scripts`. The long table of machines and ports is [The pieces](the-system.md#the-pieces). This section is the map of the clone on your PC.

### Why it is split this way

The game server, the launcher, and the site are different programs. Putting each in its own folder means a pull request that touches `game` is a game change, and a pull request that touches `scripts\release` is a change to how a release is built. `records` holds the build records a Ship checks against, kept apart from the code so a record and a code change are easy to tell apart. `engine\skymp` is a submodule because the SkyMP fork is its own repository and it is large. `out` and `local` are created on your PC when you build. Git leaves them off GitHub because they are output, not source.

### How to move around

Open the clone with `code .`, as in [Open the folder in Visual Studio Code](set-up-a-machine.md#open-the-folder-in-visual-studio-code). In Explorer, click a triangle to open a folder. `Ctrl+P`, then the file name, opens a file without walking the tree. `Ctrl+Shift+F` searches the words inside files.

From PowerShell, inside `C:\Dev\Thornswood`:

```powershell
Get-ChildItem
Get-ChildItem scripts
Set-Location game
Set-Location ..
code .\game\gamemode.js
```

`Get-ChildItem` lists the folder you are in. `Set-Location` moves you. `cd` is the short form. Each big folder has a `README.md`. Open that file when you enter the folder. It says what the folder is and how to change it.

### What each folder is

```text
Thornswood
  launcher     the window and the C# program
  game         the server rules, the plugins, the overlays
  site         the website
  bot          the Discord bot
  voice        proximity voice
  scripts      build, ship, deploy, and checks
  tests        the harnesses
  docs         the system notes
  records      build records and signing setup
  installer    the setup program a new person runs
  engine       the SkyMP fork, as a submodule
  lore         the world writing
  .github      pull request template and the build check
```

| Folder | What it is for | Open this first |
| --- | --- | --- |
| `launcher` | The launcher window and the C# that runs it | [launcher/app/MainWindow.axaml](../../launcher/app/MainWindow.axaml), then [launcher/app/ARCHITECTURE.md](../../launcher/app/ARCHITECTURE.md) |
| `game` | What the server and the Skyrim client run for Thornswood | [game/gamemode.js](../../game/gamemode.js) |
| `site` | The website program and the public pages | [site/server.js](../../site/server.js) and the modules in `site\lib`, then `site\data\site` |
| `bot` | The Discord bot | [bot/README.md](../../bot/README.md) |
| `voice` | The proximity voice service | [voice/voice-server.js](../../voice/voice-server.js) |
| `scripts` | Commands you run from the repository folder | [scripts/README.md](../../scripts/README.md) |
| `tests` | One file per check. `node tests\the-name.js` runs it | the `tests` folder |
| `docs` | How the feed, the gamemode, and the game's systems fit | [docs/README.md](../README.md) |
| `records` | What a Ship compares the build to, and signing | [records/README.md](../../records/README.md) |
| `installer` | What the install hands over; the install itself is the launcher's first start | [installer/README.md](../../installer/README.md) |
| `engine` | SkyMP source. Leave it until you are building the server | [engine/README.md](../../engine/README.md) |
| `lore` | The world. It is writing, not the server rules | the `lore` folder |

Inside `scripts`, the folders you will use are `release` (build and Ship), `deploy` (put a built thing on the server), `vps` (the key and the log reads), `dev` (checks on your PC), `ops` (news and the door), and `mods` (the generated behavior files).

Inside `game`, `gamemode.js` is the server. `plugins` is what runs inside Skyrim. `ui` is the overlays. `data` is the tables the gamemode reads. `content` is authored content. `menu` is the in-game menu pieces.

### Files you will open often

Click a name to open the file. The line under it says what the file is for.

| File | What it is for |
| --- | --- |
| [Developer-Guide.md](../../Developer-Guide.md) | This guide's index; the pages are in [docs/guide](../../Developer-Guide.md#the-pages) |
| [README.md](../../README.md) | The short map of the repository |
| [game/gamemode.js](../../game/gamemode.js) | The server's rules. Most game changes start here or in `game\data` |
| [game/plugins/README.md](../../game/plugins/README.md) | The scripts that run inside Skyrim. The plugin files sit beside that README |
| [launcher/app/MainWindow.axaml](../../launcher/app/MainWindow.axaml) | The launcher window: buttons, pages, and labels |
| [launcher/app/ARCHITECTURE.md](../../launcher/app/ARCHITECTURE.md) | How the launcher starts, which class owns which job, and the path from Play to the game |
| [site/server.js](../../site/server.js) | The website program: it starts the site, and `site\lib` holds one module per area |
| [site/data/site](../../site/data/site) | The public pages, one markdown file each |
| [bot/README.md](../../bot/README.md) | How the Discord bot is laid out and how to change it |
| [voice/voice-server.js](../../voice/voice-server.js) | The proximity voice service |
| [scripts/release/Ship.ps1](../../scripts/release/Ship.ps1) | Publishes a dev release or a main release |
| [scripts/release/LauncherVersion.ps1](../../scripts/release/LauncherVersion.ps1) | Works out the launcher's number from git, so it is never committed |
| [scripts/deploy/Deploy-DevGamemode.ps1](../../scripts/deploy/Deploy-DevGamemode.ps1) | Puts the gamemode on the dev server |
| [scripts/deploy/Deploy-Gamemode.ps1](../../scripts/deploy/Deploy-Gamemode.ps1) | Puts the gamemode on the live server. The server deploy is the next script in that folder |
| [docs/GLOSSARY.md](../GLOSSARY.md) | The long list of Thornswood words |

Six files are shared by every machine. A Dev posts a line in #dev-coordination before an edit that blocks others' work. #dev-coordination is the Dev space's channel, which only the Dev ranks and the council see. The Lead Dev does not have to post these lines, and neither does a Claude working for the Lead Dev (Patrick, 22 Oct). They are for coordinating the work, so they never go in #staff-updates:

| File | Where |
| --- | --- |
| [launcher/app/Shell.cs](../../launcher/app/Shell.cs) | The launcher's main flow |
| [launcher/app/Checks.cs](../../launcher/app/Checks.cs) | Checks the launcher runs |
| [launcher/app/Keep.cs](../../launcher/app/Keep.cs) | Thornswood's own files in the game folder |
| [launcher/app/Hold.cs](../../launcher/app/Hold.cs) | Keeps those files from changing while the game is open |
| [launcher/app/Updater.cs](../../launcher/app/Updater.cs) | The feed, the version, and applying a pack |
| [scripts/release/Publish-Update.ps1](../../scripts/release/Publish-Update.ps1) | Builds the pack a Ship publishes |

An edit to one of them that blocks others' work gets a line in #dev-coordination first, from a Dev; any other edit gets none.

### Learn more about the repository

- The repository on GitHub: https://github.com/ThornswoodRP/Thornswood
- The launcher folder: https://github.com/ThornswoodRP/Thornswood/tree/main/launcher
- The game folder: https://github.com/ThornswoodRP/Thornswood/tree/main/game
- The scripts folder: https://github.com/ThornswoodRP/Thornswood/tree/main/scripts
- How the launcher is built: [launcher/app/ARCHITECTURE.md](../../launcher/app/ARCHITECTURE.md)

## O. Others

These are part of a normal week and do not each need a letter of their own. Python runs the bot. The launcher is C# on the .NET Framework. SkyMP is the multiplayer engine. HTML, CSS, and JavaScript are the website and the page drawn over the game. How the pieces fit is [5. The system](the-system.md).

### Python

The bot scripts need Python 3.11 or newer (the bot runs on 3.12; Pillow 13 needs 3.11) with `discord.py` and `Pillow`. [Setting up a machine](set-up-a-machine.md#setting-up-a-machine) names that install. The bot deploy is [I. Bot](#i-bot).

### The .NET Framework

Launcher code is C# on .NET 10 with Avalonia, published with Native AOT from `launcher\app\Thornswood.csproj` (#4823, Patrick's decision of 26 Oct), so it stays AOT safe (the rules are in [Settled design](settled-design.md)), and C# that Windows PowerShell 5.1 compiles with Add-Type stays C# 5. The window is `launcher\app\MainWindow.axaml`. How the launcher starts is `launcher\app\ARCHITECTURE.md`. The six shared files in `launcher\app` are named in [D. Visual Studio Code](#d-visual-studio-code).

### SkyMP

The game server is SkyMP. The fork's source is on GitHub at github.com/ThornswoodRP/skymp, branch `thornswood/engine-changes`, and it is the `engine\skymp` submodule of this repository. `git submodule update --init engine/skymp` fetches it. It is large. A machine that only copies server binaries can leave it unfetched. Building it needs Visual Studio, and [Setting up a machine](set-up-a-machine.md#setting-up-a-machine) gives that command.

### HTML

HTML is the structure of a page. A tag wraps one part of it. The words on the browser tab, the text, and the links to the look and the scripts all live in that file.

Open these in Visual Studio Code. `Ctrl+P`, then the file name.

| File | What it is |
| --- | --- |
| [site/public/home.html](../../site/public/home.html) | The public page at https://thornswood.net |
| [site/public/index.html](../../site/public/index.html) | The staff hub at https://thornswood.net/hub |
| [game/ui/index.html](../../game/ui/index.html) | The page Skyrim Platform opens over the game |

In `home.html`, the `<title>` is the tab name. Two `<link>` tags pull in the stylesheets, `fonts.css` and `home.css`. The page loads nothing from another site. Keep it that way: a test fails if a `src`, a `url()`, or a stylesheet link points anywhere else.

The public page and the hub go out with the site deploy in [F. Website](#f-website). The in-game page is different. With the game closed, from the repository folder:

```powershell
.\scripts\release\Go.ps1 -SkipServer
```

That copies `index.html` and the overlay scripts from `game\ui` into the game folder. `-SkipServer` matters: without it, the same script also copies the voice service onto the live one and restarts it. The notes for that folder are [game/ui/README.md](../../game/ui/README.md).

### CSS

CSS is the look of a page: colour, type, and spacing. A rule names a part of the page, then lists what changes.

| File | What it styles |
| --- | --- |
| [site/public/home.css](../../site/public/home.css) | The public page |
| [site/public/hub.css](../../site/public/hub.css) | The staff hub |
| [site/public/door.css](../../site/public/door.css) | The door page. `site\lib\passes.js` is what links it |
| [site/public/fonts.css](../../site/public/fonts.css) | Spectral and Cinzel. The font files sit beside it |

Open `home.css`. The `:root` block at the top names the colours and the fonts the rest of the file uses. `--night` is the ground. `--gold` is the warm colour. A change here shows on https://thornswood.net after the deploy in [F. Website](#f-website).

The page over the game has its look in the JavaScript overlays under `game\ui`. There is no stylesheet in that folder.

### JavaScript

JavaScript is the language of the site scripts, the checks in `tests`, the game server, and the overlays on the in-game page. Node is the program that runs it for the site, the voice service, and the tests. That install is [J. Node](#j-node). The in-game page runs in the browser Skyrim Platform opens, so those files do not go through Node.

| File | What it does |
| --- | --- |
| [site/public/home.js](../../site/public/home.js) | The public page's script |
| [site/public/hub.js](../../site/public/hub.js) | The staff hub's script |
| [game/gamemode.js](../../game/gamemode.js) | The server. It is one long file. Read an overlay before you read this |
| [game/ui/thornswood-chat.js](../../game/ui/thornswood-chat.js) | One overlay, the chat, and the one socket to the voice service |

A file is a list of statements the program runs from the top. Open `home.js` beside `home.html` and you are looking at the page and the code that runs in it.

Run one check from the repository folder:

```powershell
node tests\test-site-local.js
```

A passing run ends without an error. Use the file in `tests\` whose name matches the area you touched.

An overlay change uses the same `Go.ps1 -SkipServer` as the HTML section, with the game closed. A new overlay is named `thornswood-*.js` and listed in the `OVERLAYS` list at the top of `game\plugins\thornswood-front.js`. That list is what loads it. There is no build step for these files.

### Learn more about the other tools

- HTML, from MDN: https://developer.mozilla.org/en-US/docs/Learn/HTML
- CSS, from MDN: https://developer.mozilla.org/en-US/docs/Learn/CSS
- JavaScript, from the first page, on MDN: https://developer.mozilla.org/en-US/docs/Learn/JavaScript
- The three together, a first website: https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web
- HTML, the web.dev course: https://web.dev/learn/html
- CSS, the web.dev course: https://web.dev/learn/css
- JavaScript, the web.dev course: https://web.dev/learn/javascript
- JavaScript, the long written guide: https://javascript.info/
- The public pages in this repository: https://github.com/ThornswoodRP/Thornswood/tree/main/site/public
- The in-game page in this repository: https://github.com/ThornswoodRP/Thornswood/tree/main/game/ui
- Python's tutorial: https://docs.python.org/3/tutorial/
- Python downloads: https://www.python.org/downloads/
- C# on Microsoft Learn: https://learn.microsoft.com/en-us/dotnet/csharp/
- The .NET Framework: https://learn.microsoft.com/en-us/dotnet/framework/
- The SkyMP fork this server builds from: https://github.com/ThornswoodRP/skymp
