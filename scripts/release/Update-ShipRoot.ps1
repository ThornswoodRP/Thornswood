<#
.SYNOPSIS
  Brings a ship root's game folder up to date with Vortex's deployment and puts the recorded client in it, or says why it cannot; Ship runs it before anything is packed.

.DESCRIPTION
  A ship root is the folder a release is built from (Where.ps1 ShipRoot and
  ShipRootDev, #1692). It is a whole launcher install, and until #2019 its
  Game folder was made and refreshed only by that install's own launcher
  (OwnGame.Make and OwnGame.Refresh). Patrick, 15 Oct: the launchers he
  plays from stay apart from the build folders, so a ship root's launcher is
  never started, and nothing kept the folder up to date. Measured on One that
  night: the dev root was made on 3 Oct at OwnGame's rules 14 (the code is on
  16), from C:\Thornswood-DevBuild\Game rather than Vortex's deployment, with
  a 3,288 byte 3BBB.esp where the collection's is 20,257 and the 12 Oct
  client, and the dev Ship refused twice. With no main entry in ship-roots.json
  a main Ship packed C:\Thornswood, Patrick's own install.

  So every Ship runs this first, and it does three things, refusing with one
  sentence at the first that fails:

    1. Builds Thornswood-ShipRoot.exe from scripts\release\ShipRoot, which
       compiles the launcher's own OwnGame and everything it calls (the
       project file says why it is the launcher's sources and not a script),
       so it is always this checkout's rules.
    2. Runs it on the root: OwnGame.Make for a root with no game folder
       (Thornswood's own files of the channel's release synced into it first,
       as an install that chose its own folder gets them, and with
       -SkyrimFrom the game's own files copied from that folder), otherwise
       OwnGame.Refresh, then the check that the folder is on record as made
       from the folder Vortex deploys into now, from that deployment, to the
       current rules. A root made at older rules or from another folder is
       brought up to date by the refresh; one OwnGame did not make is
       refused.
    3. Puts the six recorded client files into the root's game folder from
       the configured engine build (Sync-Client.ps1, Where.ps1 ClientDist,
       which is the build Setup-ShipMachine.ps1 -EngineBuild recorded; for
       -EngineBuild ci, CI's build of the pin, which Sync-Client fetches when
       it is not here yet, #3047), and checks they are there.

  It changes nothing outside the root: OwnGame never writes into the Steam
  copy or into Vortex's files, and Sync-Client takes a file's name off before
  it copies, so nothing is written through a hard link. It never starts the
  launcher or the game, and refuses while either runs from the root.

.PARAMETER Channel
  main or dev: which root, Where.ps1 ShipRoot or ShipRootDev, and which
  channel's release a new root starts from.

.PARAMETER Root
  The ship root, when not the one Where.ps1 names for the channel.

.PARAMETER Check
  Changes nothing: builds the tool and asks it whether the root is current,
  and Sync-Client -Check whether the client is in it.

.PARAMETER SkyrimFrom
  For a root with no game folder yet: a folder that holds Skyrim 1.6.1170's
  own files, such as the other channel's root's Game, to copy them from
  instead of the Steam copy (#2603). The tool checks every one it takes
  against records\skyrim-files.json before anything is placed and refuses,
  naming the first that is not the build's. Needed where the Steam copy is
  not on 1.6.1170 and the launcher's Downgrade, a Steam download under the
  person's account, is not something a script can run. A root that is made
  already never takes the game's own files again, so it is not used there.

.PARAMETER Tool
  A Thornswood-ShipRoot.exe already built, instead of building one. For a
  harness, which runs a stand-in.

.PARAMETER NoPause
  Exits without waiting for Enter.

.EXAMPLE
  .\scripts\release\Update-ShipRoot.ps1 -Channel dev
  Brings the dev root up to date and puts the recorded client in it.

.EXAMPLE
  .\scripts\release\Update-ShipRoot.ps1 -Channel main -SkyrimFrom C:\Thornswood-Repo\local\release-devbuild\Game
  Makes main's root with the game's own files copied from the dev root's
  Game, on a machine whose Steam copy is not on 1.6.1170.
#>
[CmdletBinding()]
param(
    [ValidateSet('main', 'dev')][string]$Channel = 'dev',
    [string]$Root,
    [switch]$Check,
    [string]$SkyrimFrom,
    [string]$Tool,
    [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

if (-not $Root) {
    try { $Root = [string](& (Join-Path $Here 'Where.ps1') $(if ($Channel -eq 'dev') { 'ShipRootDev' } else { 'ShipRoot' })) }
    catch { Die ($_.Exception.Message + ' The ship root was not touched.') }
}
$Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
$game = Join-Path $Root 'Game'

# ---- 1. the tool, from this checkout's OwnGame -------------------------------
Head ('The ship root, ' + $Root)
if (-not $Tool) {
    # The .NET 10 SDK builds it, as it builds the launcher (#4823,
    # Build-Launcher.ps1): the tool is the launcher's own OwnGame and what it
    # calls, at the launcher's framework.
    $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    if (-not $dotnet) { Die 'dotnet was not found on this machine. The ship root tool builds with the .NET 10 SDK, as the launcher does; docs/guide/set-up-a-machine.md "Setting up a machine" has the install line. The ship root was not touched.' }
    $sdks = @(& $dotnet.Source --list-sdks 2>$null | Where-Object { $_ -match '^10\.' })
    if ($sdks.Count -eq 0) { Die 'This machine has dotnet but no .NET 10 SDK (dotnet --list-sdks lists none starting 10.). The ship root tool targets .NET 10, as the launcher does; install the SDK and run this again. The ship root was not touched.' }
    $proj = Join-Path $Here 'ShipRoot\ShipRoot.csproj'
    if (-not (Test-Path -LiteralPath $proj)) { Die "$proj is not there. It is in the repository, so the path is wrong. The ship root was not touched." }
    $out = & (Join-Path $Here 'Get-ScratchDir.ps1') ('Thornswood-shiproot-' + (Split-Path -Leaf $Root))
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $built = & $dotnet.Source build (Resolve-Path -LiteralPath $proj).Path -c Release -o $out --nologo -v quiet --disable-build-servers 2>&1 | Out-String
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    $Tool = Join-Path $out 'Thornswood-ShipRoot.exe'
    if ($rc -ne 0 -or -not (Test-Path -LiteralPath $Tool)) {
        Write-Host $built.TrimEnd()
        Die ("The ship root tool did not build (dotnet build exit $rc); the errors are above. The ship root was not touched.")
    }
    Say ('  Thornswood-ShipRoot.exe built from this checkout''s launcher\app') 'DarkGray'
}
if (-not (Test-Path -LiteralPath $Tool)) { Die "There is no ship root tool at $Tool. The ship root was not touched." }

# ---- 2. the game folder, as OwnGame makes it -------------------------------
$global:LASTEXITCODE = 0
# Line by line as the tool says them: a refresh walks some thirty thousand
# files and takes minutes, and the archives it checks are named as it goes.
# The arguments are written out rather than splatted from an array, which a
# PowerShell stand-in would take as positions rather than names.
$said = New-Object System.Collections.Generic.List[string]
$show = { $l = [string]$_; $said.Add($l); Say $l $(if ($l -like 'STOP.*') { 'Red' } else { 'Gray' }) }
if ($Check) { & $Tool -Root $Root -Channel $Channel -Check 2>&1 | ForEach-Object $show }
elseif ($SkyrimFrom) { & $Tool -Root $Root -Channel $Channel -SkyrimFrom ([IO.Path]::GetFullPath($SkyrimFrom).TrimEnd('\')) 2>&1 | ForEach-Object $show }
else { & $Tool -Root $Root -Channel $Channel 2>&1 | ForEach-Object $show }
$toolCode = $LASTEXITCODE
if ($toolCode -ne 0) {
    $why = @($said | Where-Object { $_ -like 'STOP.*' } | ForEach-Object { $_.Substring(5).Trim() }) -join ' '
    if (-not $why) { $why = 'Thornswood-ShipRoot.exe exited ' + $toolCode + ' and said nothing.' }
    Die ("The ship root's game folder is not current with Vortex's deployment, so nothing is packed from it: " + $why)
}

# ---- 3. the recorded client, from the configured engine build --------------
Head 'The client the record names'
$global:LASTEXITCODE = 0
if (-not $Check) {
    & (Join-Path $Here 'Sync-Client.ps1') -Game $game -NoPause
    if ($LASTEXITCODE -ne 0) {
        Die ('The recorded client could not be put into ' + $game + ' from the engine build (Where.ps1 ClientDist); Sync-Client says why above. ' +
             'The build that matches the record is CI''s: .\scripts\release\Setup-ShipMachine.ps1 -EngineBuild ci makes it this machine''s engine build, and Sync-Client then fetches it (engine\README.md, A Ship machine takes CI''s build).')
    }
}
$global:LASTEXITCODE = 0
& (Join-Path $Here 'Sync-Client.ps1') -Check -Game $game -NoPause
if ($LASTEXITCODE -ne 0) {
    Die ('The game folder ' + $game + ' does not hold the client records\client-build.json names (Sync-Client -Check exit ' + $LASTEXITCODE + ').')
}
Say ('  ' + $Root + ' is current, with the recorded client in it') 'Green'
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
