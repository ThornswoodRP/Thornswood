# Set up a machine

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

Do this once on a new Windows PC. Stay in order. On every PC is the steps. Setting up a machine and Shipping from another machine are for a PC that will publish a release. You can read those two after the clone works.

Use your own GitHub account. Patrick adds that account as a collaborator on the private repository before a clone will work. Say so in Discord and wait for that. Before your first change, read `LICENSE` at the root of the repository and say in #staff-updates that you agree to its contributor terms. You agree once, and it covers anything you contributed before. Use your own clone. The shared clone on the shipping machine is for the lanes that build from it. Your clone can live at `C:\Dev\Thornswood`, or any empty folder you own.

## On every PC

### Install the tools

Open PowerShell. Paste this and let each install finish. If Windows asks for an administrator, allow it.

```powershell
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
winget install --id Microsoft.PowerShell -e --accept-package-agreements --accept-source-agreements
winget install --id Microsoft.DotNet.SDK.10 -e --accept-package-agreements --accept-source-agreements
winget install --id Microsoft.VisualStudioCode -e --accept-package-agreements --accept-source-agreements
```

#### What each install is

| Program | What you use it for |
| --- | --- |
| Git | History of the folder on this PC. [B. Git](tools.md#b-git) |
| GitHub CLI (`gh`) | Pull requests from the terminal. [A. GitHub](tools.md#a-github) |
| Node | The website, voice, and the test command. [J. Node](tools.md#j-node) |
| PowerShell 7 | The terminal the scripts run in. [C. PowerShell](tools.md#c-powershell) |
| .NET 10 SDK (`dotnet`) | Builds and runs the tools written in C#, under `tools`: the release note check `Check-Change.ps1 -Body` runs, and the deploy agent. |
| Visual Studio Code | The window you edit in. [D. Visual Studio Code](tools.md#d-visual-studio-code) |

### Check that the tools open

Close that window and open **PowerShell 7** from the Start menu. A new window is required because Windows only sees newly installed programs in a window opened afterwards.

```powershell
git --version
gh --version
node --version
dotnet --version
ssh -V
code --version
```

Each line should print a version. `code --version` prints a few lines, and the first is the version. If one says the program is not recognized, you are still in the old window.

```powershell
$PSVersionTable.PSVersion
```

The major number is 7 or higher when you are in PowerShell 7. If it prints 5, type `pwsh` and press Enter.

### Install the OpenSSH client

The VPS scripts need `ssh`. If `ssh -V` already printed a version, this step is done.

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

#### When the class is not registered

Run the same install through DISM from an elevated PowerShell:

```powershell
dism /Online /Add-Capability /CapabilityName:OpenSSH.Client~~~~0.0.1.0
```

When DISM still fails, start Windows Update and run the DISM line again:

```powershell
Start-Service wuauserv
dism /Online /Add-Capability /CapabilityName:OpenSSH.Client~~~~0.0.1.0
```

`The operation completed successfully` means the client is installed. Check it:

```powershell
ssh -V
```

### Sign the GitHub CLI into your account

```powershell
gh auth login
gh auth status
```

Choose GitHub.com, then HTTPS, then login with a browser, as the GitHub user that has access to the repository. `gh auth status` should name your account and say the token can see private repositories. More on the website is in [A. GitHub](tools.md#a-github).

### Clone the repository

```powershell
New-Item -ItemType Directory -Force -Path C:\Dev | Out-Null
cd C:\Dev
git clone https://github.com/ThornswoodRP/Thornswood.git
cd C:\Dev\Thornswood
git status
```

`git status` should say you are on `main` and the working tree is clean. If the clone asks for a login and then fails, you are not a collaborator yet. Stop and say so in Discord.

Then turn on the checks that run before every push:

```powershell
git config core.hooksPath .githooks
```

It prints nothing. From then on `git push` first checks that every script parses and that the writing rules hold in what you are pushing, in about twenty seconds (#5291). When one fails, the push stops and names the file and line; fix it, commit, and push again. A cloud session turns this on by itself.

From here on, the commands assume PowerShell is inside your clone. If you used another folder, `cd` there first.

### Open the folder in Visual Studio Code

```powershell
cd C:\Dev\Thornswood
code .
```

`code .` opens the folder you are in. The window title shows Thornswood. If `code` is not recognized, close PowerShell, open PowerShell 7 again, `cd C:\Dev\Thornswood`, and run `code .` again.

The branch name is in the status bar at the bottom left. Open the terminal from the View menu, Terminal. It starts in the clone. The parts of the window are in [D. Visual Studio Code](tools.md#d-visual-studio-code). The folders, and the files a first change usually touches, are in [N. The repository map](tools.md#n-the-repository-map).

### Reach the VPS

You do not get the server password. Your PC creates a key and gets a token of its own, and reaches the server through the bridge, so your home address never matters. You send the public line. Patrick adds it and sends you the token.

```powershell
.\scripts\vps\Setup-SshKey.ps1
```

The script prints one line that starts with `ssh-ed25519`. Copy that whole line into Discord, and press Enter when it asks for the token. Leave the private key file where the script put it. Once the token comes, run it again and paste it. The whole guide is `docs\BOX-ACCESS.md` in the private ops repo; the reads, the test, and what the VPS is are in [E. VPS](tools.md#e-vps).

## Setting up a machine

Needs: Windows 10 or 11, Skyrim Special Edition on Steam (any Steam library,
any drive; the scripts find it through Steam) with the Thornswood collection
deployed through Vortex, the Thornswood launcher installed on any drive and
signed in, git, the GitHub CLI (`gh`) signed in to an account that is a
collaborator on the source repo, PowerShell 7, node, Python 3.11 or newer (the
bot runs on 3.12) with `discord.py` and `Pillow` for the bot scripts, and an
SSH key the VPS knows. There is no releases clone any more: the feed and its
baseline are on the VPS (#907).

```
cd C:\Users\<you>\Downloads
git clone https://github.com/ThornswoodRP/Thornswood.git Thornswood-Repo
gh auth login
gh auth status
```

The bot's libraries go into the Python that `py` starts by default, because
that is the one the bot harnesses run on: `bot\tests\test-*.py`, and
`tests\test-staff-commands.js`, which imports bot.py. On the shipping machine
the default was 3.12 with no discord.py, so every bot harness stopped on its
first import with nothing to do with the change being tested (#1008). From
`Thornswood-Repo`:

```
py -m pip install -r bot\requirements.txt
py -c "import discord, PIL; print('discord.py ' + discord.__version__)"
```

The second line prints the discord.py version `bot\requirements.txt` pins when
the first worked. The nightly does the same into a venv of its own on the VPS,
because the live bot runs on that box's Python.

Every change goes to the dev channel first, and the dev channel needs the dev
build on this machine too: in the main launcher, on the Play page, the Server
dropdown, Dev. It checks your Discord roles first, then puts it
at `<drive>:\Thornswood-DevBuild`, beside the main install. Then open it once and let it make its own game folder,
`<Root>-DevBuild\Game`: it offers at startup, and its own Settings, Maintenance
has "Make it". Ship refuses `-Channel dev` without the dev build, and with the
dev build but without that folder it builds the dev release out of the Steam
copy instead. That refusal is for `<drive>:\Thornswood-DevBuild` only, the folder
Ship finds for itself: a folder you name with `-Root`, or record once with
`.\scripts\release\Setup-ShipMachine.ps1 -Channel dev -Root <folder>`, is a release
folder `Update-ShipRoot.ps1` makes with no `Launcher` folder, and the Ship's own
launcher step makes one there (#2662). `.\scripts\release\Check-ShipReady.ps1 -Channel dev` says whether both are
in place, without shipping anything.

Then in `Thornswood-Repo`:

```
.\scripts\vps\Setup-SshKey.ps1
```

which makes a key for the VPS, points ssh at it through the bridge, and
prints the public line. That is for a machine that already holds a key: since
31 Oct 2026 no key is made for a new person or machine (Patrick's answer A
on q-retire-box-keys, #2862), and the keys there are changed only by Patrick (the workflows' two with the deploy gate's Renew-BoxKey verb). Box work from a new machine goes
through the gate instead, with `gh` signed in as somebody who may run workflows in the private ops repository, and no key:
`pwsh scripts/vps/Box-Run.ps1 -Line '<verb>'` ([E. VPS](tools.md#e-vps)). Ships go
the same way (`Ship-Dev`, `Ship-Main`), so a machine without a key can still
release; the scripts that ssh to the VPS themselves (`Ship`, `Deploy-*`,
`Request-Restart`, `Install-Bot`) do not
run from it, and Ship stops before it builds anything there: the feed and its
baseline are received from the VPS (#907).

Every Ship, dev included, checks the SkyMP client against the record, so
this machine builds the engine once (Visual Studio 2022 Build Tools with
"Desktop development with C++", node and yarn; the script says what is
missing):

```
.\scripts\release\Build-Engine.ps1
```

`engine\README.md` has the rest. A machine that only Ships does not need
to build it: `.\scripts\release\Setup-ShipMachine.ps1` fetches the recorded
client from the site instead (Shipping from another machine, below). The
release webhooks are on the VPS (`scripts\ops\Discord-Hook.ps1`) and every
Ship reads them from there, so there is nothing to hand over.

The launcher is Avalonia on .NET 10, compiled to native code (#4823,
decided by Patrick on 27 Oct; `launcher\app\ARCHITECTURE.md`).
`Build-Launcher.ps1` runs `dotnet publish` with Native AOT, so every machine
that builds it needs the .NET 10 SDK and, for the native step, the Visual
Studio 2022 C++ build tools ("Desktop development with C++"), which Native
AOT links with. It builds on Windows only. NuGet restores the libraries
`launcher\app\Thornswood.csproj` names on the first build. A machine with
neither yet, in PowerShell 7 (Windows asks for an administrator for the
second):

```
winget install --id Microsoft.DotNet.SDK.10 -e --accept-package-agreements --accept-source-agreements
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

A machine that already has the C++ build tools, for the engine above, needs
only the first line. Visual Studio 2022 or newer itself, any edition, with
the "Desktop development with C++" workload, is just as good. Then, from
`Thornswood-Repo`:

```
dotnet --list-sdks
.\scripts\release\Build-Launcher.ps1 -Root $env:TEMP\launcher-try -NoPause
```

The first lists a 10.x SDK. The second publishes `Thornswood.exe` and the
native libraries beside it into a scratch folder and ends with Done. With no
10.x SDK it stops and says so; with no C++ build tools `dotnet publish` stops
with "Platform linker not found".

The pack baseline lives on the VPS beside the feed, and every Ship receives it
first, so there is nothing to pull. If the VPS has none for a channel, Ship
stops with "No baseline yet". To rebuild a baseline by hand:

```
.\scripts\release\Publish-Update.ps1 -Baseline
```

which records what the game folder holds right now without shipping anything. Do it
straight after the launcher has brought the game up to date, so the baseline is the
current release and the first real Ship carries only what you changed.

`Publish-Discord.ps1` reads the #news webhook and the dev updates one from
the VPS through `Discord-Hook.ps1`, and a copy in `bot\news-webhook.txt` or
`bot\dev-webhook.txt` only when the VPS cannot be asked; without either, Ship
says so and carries on.

## Shipping from another machine

Issue #458: if One (Patrick's machine) dies, the release process has to
survive it. Since 31 Oct 2026 it does without any machine of ours: a Ship
runs on the box through the deploy gate (`Box-Run.ps1 -Line 'Ship-Dev ...'`,
`Ship-Main`), signs on GitHub's runner, and the box installs, backups, reads
and deletion requests are gate verbs too (#2862). The table below is for a
Ship run from a machine of one's own instead. Measured on One on 29 September, it is everything a dev Ship
reads that is not in a fresh clone, where it was on One, and where a second
machine gets it or how it is rebuilt. Nothing in this list is copied from One
by hand, and no secret is written into the repository.

| What a Ship needs | On One | A second machine |
| --- | --- | --- |
| The source | the shared clone | `git clone https://github.com/ThornswoodRP/Thornswood.git` and `gh auth login` as a collaborator |
| The feed, its baseline, the launcher list and history | the VPS store, with a working copy in `%LOCALAPPDATA%\Thornswood\feed\<channel>` | Nothing to copy: every Ship receives them from the VPS first (`scripts\release\Feed-Store.ps1`, #907). The working copy is made on the first Ship |
| The release webhooks, dev and #news | the VPS, `C:\Thornswood-Bot\webhooks`; One has no local copy | Nothing to copy: Ship reads them over ssh (`scripts\ops\Discord-Hook.ps1`) |
| VPS access | One's own key, `.ssh\thornswood_ed25519`, and its own bridge token, `.ssh\thornswood-box-token` | None: no new key is made (Patrick's A on q-retire-box-keys, 31 Oct 2026), and a Ship from the gate needs none. Box work goes through `scripts\vps\Box-Run.ps1`, with `gh` signed in as somebody who may run workflows in the private ops repository. With the gate down too, the BisectHosting panel is the way in (`docs\IT-IS-DOWN.md` in the private ops repo) |
| Signing: `records\signing\signing.json` | written from the template like any other machine's since 5 Oct, when `C:\tools` (an older copy of `metadata.json`) was removed. Never copy one machine's to another | `.\scripts\release\Setup-ShipMachine.ps1` writes one from `records\signing\signing.template.json` (paths and "enabled": true, no key or password) |
| Signing: Microsoft's signing client | `records\signing\client`, ignored by git | The same script fetches `Microsoft.ArtifactSigning.Client` 1.0.128 from nuget.org and refuses it unless its sha256 is the pinned one, which is the package One has |
| Signing: the Azure sign in | `az login` on One, as Patrick | `az login` on the new machine, as the person who ships from it, with an account of their own in the signing tenant that holds the Certificate Profile Signer role on the ThornswoodSigning account's profile ThornswoodRelease (Patrick, 4 Oct; #1740). Patrick makes the account and gives the role once: [Your own signing sign in](#your-own-signing-sign-in). The script asks the signing service with that sign in and checks the profile answers with the identity the launcher pins |
| The client runtime `records\client-build.json` names | only in the dev game folder, `C:\Thornswood-DevBuild\Game`. The build copies in `Downloads\Thornswood-ClientBuild-<commit>` are older builds, and the shared clone's `engine\skymp\build` does not match the record | Setup-ShipMachine records CI's build of the pin as the machine's engine build (`-EngineBuild ci`, which it does by itself on a machine with no engine build), and `Get-EngineArtifact.ps1` fetches the public fork's build of the pin, `thornswood-engine-<fork commit>` from ThornswoodRP/skymp (#3540), and holds every file to both records. A build made on the machine is not the recorded bytes (engine\README.md, "A Ship machine takes CI's build") |
| The game folder the Ship packs, `<root>-DevBuild\Game` | built by the dev launcher from what Vortex deployed | Skyrim Special Edition on Steam, Vortex with a profile named Thornswood and the Thornswood collection installed and deployed, the launcher from thornswood.net, then the dev build and its own game folder (Setting up a machine, above). A person does this; it needs a Nexus account, not Patrick's |
| The collection itself | Nexus collection `7essxf`, curated from Patrick's Nexus account in his Vortex | Any machine installs it. Only publishing a new revision needs his account (`docs\OWNERSHIP.md` in the private ops repo) |
| Backups | the originals on the VPS, `C:\Thornswood-Backup`; the copy off the box goes to the Oracle VM and on to Google Drive (`Send-Backups.ps1`, #2862), not to One; the passphrase on the VPS and in Patrick's keeping | Not needed to Ship. `pwsh scripts/vps/Box-Run.ps1 -Line 'Send-Backups -Status'` says what went off the box |

### Your own signing sign in

Until 4 Oct only Patrick's Azure account could sign (29 Sep, #1121), so a
second machine signed only while he sat at it and signed in. Since 4 Oct each
person who ships signs in as themselves, with an account of their own in the
signing tenant, Default Directory (`5a096034-ce55-40d2-b313-10ee86efe26a`), that
holds the Artifact Signing Certificate
Profile Signer role on the ThornswoodRelease profile (Patrick, 4 Oct; #1740).
The role is on that profile only, so the account can sign and can do nothing
else in the subscription. What it signs carries the same publisher name as
what Patrick signs, because the certificate comes from his identity
validation. Accounts that can sign, 4 Oct: Patrick's own, and
Djinn's.

#### Patrick, once for each person

On a machine where `az` is signed in as Patrick, in PowerShell 7:

```powershell
az account show --query "{user:user.name, tenant:tenantId}" -o table
```

It names Patrick's own sign-in and the tenant above. Then:

```powershell
$scope = (az resource list --name ThornswoodSigning --resource-type Microsoft.CodeSigning/codeSigningAccounts --query "[0].id" -o tsv) + "/certificateProfiles/ThornswoodRelease"; $scope
$domain = (az ad signed-in-user show --query userPrincipalName -o tsv).Split('@')[1]; $domain
$who = Read-Host 'Their name, one lower case word'
$pw = 'Tw7' + (-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 17 | ForEach-Object { [char]$_ })); $id = az ad user create --display-name $who --user-principal-name "$who@$domain" --password $pw --force-change-password-next-sign-in true --query id -o tsv; $id
$role = az role definition list --query "[?ends_with(roleName, 'Certificate Profile Signer')].roleName" -o tsv | Select-Object -First 1; $role
az role assignment create --assignee-object-id $id --assignee-principal-type User --role $role --scope $scope
"$who@$domain   $pw"
```

The first line prints a path that starts with `/subscriptions/` and ends with
`/certificateProfiles/ThornswoodRelease`. The second prints the domain above.
The account line prints the new account's id, the role line prints Artifact
Signing Certificate Profile Signer, and the assignment prints the role and
that path. The last line is the account and a first password: send both to
the person in a direct message, never a channel. They have to change it the
first time they sign in, so it stops working after that.

#### The person, on their own machine

In PowerShell 7, in the repository folder:

```powershell
az config set core.enable_broker_on_windows=false
az login --tenant 5a096034-ce55-40d2-b313-10ee86efe26a --allow-no-subscriptions
.\scripts\release\Setup-ShipMachine.ps1 -Check
```

The first line makes `az` sign in through your web browser. On Windows it
opens a sign in window of its own by default, and on 4 Oct that window sent
a work account to the page for personal Microsoft accounts, which answered
"That Microsoft account doesn't exist". The second opens the tenant's own
sign in page: sign in with the account Patrick sent, set a new password, and
set up Microsoft Authenticator when it asks. It ends by printing the tenant
above and your account. The account has no subscription of its own to list,
which is what `--allow-no-subscriptions` is for. `Setup-ShipMachine.ps1 -Check`
then says, under 4, that profile ThornswoodRelease answers this sign in with
the identity the launcher pins. A role given a few minutes ago can take a
little longer to reach the signing service.

#### Never a device code

`az login --use-device-code` does not work here, for anybody. The tenant has
Microsoft's security defaults on, and they refuse every device code sign in:
AADSTS530035, "Access has been blocked by security defaults", measured on
4 Oct when Patrick entered a code for Djinn's machine. Do not turn security
defaults off to get past it. They are what puts MFA on every account that
can sign.

#### When somebody stops shipping

Patrick, with `$scope` and `$domain` set as above:

```powershell
$who = Read-Host 'Their name, as it is before the @'
az role assignment delete --assignee "$who@$domain" --scope $scope
az ad user delete --id "$who@$domain"
```

The first takes the role away and the second removes the account. Neither
prints anything when it worked.

### Check the machine and Ship

The whole of it, on the second machine, from the repository folder:

```
.\scripts\release\Setup-ShipMachine.ps1 -Check
```

says what the machine has and what it would fetch or write, and changes
nothing.

```
.\scripts\release\Setup-ShipMachine.ps1
```

checks the tools a Ship calls (git, gh, PowerShell 7, node, ssh, the .NET
Framework compiler, signtool, az, the .NET 8 runtime), fetches the signing
client, writes `records\signing\signing.json`, checks the Azure sign in, fetches the
recorded client, and then runs `.\scripts\release\Check-ShipReady.ps1 -Channel dev`
for everything else Ship asks: the dev build, its game folder, the Vortex
profile, the VPS and the feed store. Each gap prints the command that closes
it and says when it is Patrick's. It never turns signing off, never edits a
`records\signing\signing.json` that is there, and never ships. The sign in is
the one step that needs Patrick, once for each person (Your own signing sign
in, above). When both say READY:

```
.\scripts\release\Ship.ps1 -Channel dev "what changed, in plain words
- one line for each thing a person will notice"
```

A main Ship runs only on Patrick's word, by whoever he names, from a machine that can sign (How work moves). The same script with
`-Channel main` checks a machine for it.

Ship builds a channel's release from one folder on each machine: the main
install for main and `<Root>-DevBuild` for dev, unless the machine has
recorded another (issue #1692). Vortex deploys into the Steam copy; the
launcher refuses a Thornswood game folder as Vortex's folder since #2210
(docs/COLLECTION-REVISION-2.md step 8). A machine that keeps its release
folder apart from its installs records it once. On One it is `local\release-devbuild` in the
repository folder since 5 Oct, because Thornswood work on One lives only in
the repository and the vault (Patrick); give
the whole path, since every clone and worktree reads what is recorded:

```
.\scripts\release\Setup-ShipMachine.ps1 -Channel dev -Root C:\Thornswood-Repo\local\release-devbuild
```

It writes the file `.\scripts\release\Where.ps1 ShipRoots` names, in this
machine's own data, so every clone and worktree reads it, and Ship,
Check-ShipReady and Build-Generated then take that folder without `-Root`.
Ship and Check-ShipReady refuse a folder Vortex deploys into, before
anything is built.

Moving a release folder needs nothing built afterwards: no release carries
the animation and body files since #3715, and every launcher builds its own
before Play.

`tests\test-ship-machine.ps1` walks this section: every script it names is
in the repository with the parameters it is given, the template holds paths
only, and the fetch refuses a signing client or a client runtime that is not
the pinned or recorded bytes.
