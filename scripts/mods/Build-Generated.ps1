<#
.SYNOPSIS
  Builds Thornswood's animation and body files (the behavior files, with
  Pandora Behaviour Engine+, and BodySlide's body meshes) in a Thornswood game
  folder, by hand, with the launcher's own code. Never writes into the Steam
  copy.

.DESCRIPTION
  Issue #1247, and since 27 Oct 2026 #3715. The launcher builds these files on
  each computer, in Thornswood's own folder, before Play and from Fix
  (launcher\app\GeneratedHere.cs), from the collection's own Pandora,
  BodySlide and mods, and no release carries them (Patrick, option A: "The
  launcher makes all 45 files on each computer"). This runs the same build,
  launcher\app\GeneratedBuild.cs, compiled by Generated.ps1, for a folder by
  hand: to see what a collection change does before a Ship, or what stops a
  build on a machine. Ship runs it with -DryRun to ask whether the collection
  installed here can build them at all.

  GeneratedBuild.cs says each step: the folder checks, the build list and the
  body rules (#1004, #405), this folder's own copies of what BodySlide writes
  in place, Pandora from a copy in the work folder, BodySlide into folders of
  its own, the write-through and stray-file checks, the files the last build
  made, every body in the folder read for underwear, and the record,
  Profile\OwnGame\generated.txt.

  WHY PANDORA AND NOT NEMESIS is in GeneratedBuild.cs too: no Nemesis release
  can generate from a command line, and Pandora reads the same patches.

  What has the folder open is asked here, as before: anything run from the
  install, its Skyrim, script extender, launcher, or the tools themselves.
  The launcher does not ask, because it builds only with the game closed and
  the folder to itself.

  Exit 0 when built and recorded (or a dry run found nothing in the way),
  1 when it stopped, 3 when the folder is in use.

.PARAMETER Channel
  main or dev: which install's folder to build in, the one Ship.ps1 builds
  that channel's release from: Where.ps1 ShipRoot or ShipRootDev (#1692),
  the folder Setup-ShipMachine.ps1 -Root recorded, or else the launcher
  install, and for dev that with -DevBuild on the end. Required unless -Root
  is given, so the folder is always chosen.

.PARAMETER Root
  The Thornswood install to build in (the folder with Game, Launcher and
  Profile in it), in place of the one -Channel finds.

.PARAMETER BuildList
  What to build. records\generated.json in this repository by default; the
  launcher has the same file compiled into it.

.PARAMETER DryRun
  Checks everything and says what it would run, and writes nothing: no copy,
  no setting, no tool started, no record.

.PARAMETER Minutes
  How long each tool may run before it is stopped and the build refused.
  30 by default.

.PARAMETER StallSeconds
  How long a tool may sit using almost no processor time (under a second of
  it) while no file changes in the game folder or the work folder, before it
  is taken as waiting on something nobody can answer, stopped, and the build
  refused. 180 by default.

.PARAMETER NoPause
  Exits without waiting for Enter.

.EXAMPLE
  .\scripts\mods\Build-Generated.ps1 -Channel dev
  Builds them in C:\Thornswood-DevBuild\Game.

.EXAMPLE
  .\scripts\mods\Build-Generated.ps1 -Channel main -DryRun
  Says what it would do in C:\Thornswood\Game, and changes nothing.
#>
[CmdletBinding()]
param(
    [ValidateSet('main', 'dev')][string]$Channel,
    [string]$Root,
    [string]$BuildList,
    [switch]$DryRun,
    [int]$Minutes = 30,
    [int]$StallSeconds = 180,
    [switch]$NoPause
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoDir = Split-Path -Parent (Split-Path -Parent $Here)
. (Join-Path $Here 'Generated.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Leave([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit $code }
function Die([string]$m, [int]$code = 1) {
    Write-Host ''
    Write-Output "STOP. $m"
    Leave $code
}

# ------------------------------------------------------------ which folder
# The one Ship builds the channel's release from, which Where.ps1 answers for
# Ship, Check-ShipReady, Setup-ShipMachine and this alike (#1692).
if (-not $Root) {
    if (-not $Channel) { Die 'Say which folder: -Channel dev or -Channel main (the folder Ship builds that channel from), or -Root.' }
    try { $Root = [string](& (Join-Path $RepoDir 'scripts\release\Where.ps1') $(if ($Channel -eq 'dev') { 'ShipRootDev' } else { 'ShipRoot' })) }
    catch { Die $_.Exception.Message }
}
$Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
if (-not $BuildList) { $BuildList = Join-Path $RepoDir 'records\generated.json' }
$Game = Join-Path $Root 'Game'

Write-Host ''
Write-Host '  BUILD THORNSWOOD''S ANIMATION AND BODY FILES' -ForegroundColor White
Say ("  in " + $Game + $(if ($DryRun) { '  (dry run: nothing is written)' } else { '' })) 'DarkGray'

# ------------------------------------------------------------ in use
# Anything run from the install: its Skyrim, script extender, launcher, or
# the tools themselves.
#
# A game or launcher whose path cannot be read is another account's process.
# Until 11 Oct every one of those counted as in use, because which folder it
# had open could not be told. On the VPS four build runners are four accounts,
# and the harness starts a stand-in SkyrimSE.exe, so one runner's stand-in
# stopped another runner's build of a folder it never touched (#2233). Which
# folder it has open can be told, from the folder's side: a running program's
# file cannot be opened for writing (Windows answers with a sharing
# violation), whoever runs it. So such a process counts only when one of this
# install's own programs is running.
function Test-ImageRunning([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
    try {
        $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite)
        $fs.Dispose()
        return $false
    } catch {
        $e = $_.Exception
        while ($e -and $e -isnot [IO.IOException] -and $e.InnerException) { $e = $e.InnerException }
        # ERROR_SHARING_VIOLATION (32): the image is mapped by a running process.
        return ($e -is [IO.IOException] -and ($e.HResult -band 0xFFFF) -eq 32)
    }
}
function Get-RunningInstallImages([string]$root) {
    $running = @()
    foreach ($dir in @((Join-Path $root 'Game'), (Join-Path $root 'Launcher'))) {
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
        foreach ($f in @(Get-ChildItem -LiteralPath $dir -Filter '*.exe' -File -ErrorAction SilentlyContinue)) {
            if (Test-ImageRunning $f.FullName) { $running += $f.FullName }
        }
    }
    return , $running
}
function Get-FolderUsers([string]$root) {
    $prefix = $root.TrimEnd('\') + '\'
    $users = @()
    $unreadable = @()
    foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
        $exe = [string]$p.ExecutablePath
        if ($exe) {
            if ($exe.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $users += ($p.Name + ' (' + $p.ProcessId + ', ' + $exe + ')') }
        } elseif ($p.Name -match '^(SkyrimSE|skse64_loader|Thornswood|Thornswood Dev)\.exe$') {
            $unreadable += $p
        }
    }
    if ($unreadable.Count) {
        $images = Get-RunningInstallImages $root
        if ($images.Count) {
            foreach ($p in $unreadable) {
                $users += ($p.Name + ' (' + $p.ProcessId + ', another account''s, while ' + (($images | ForEach-Object { Split-Path -Leaf $_ }) -join ', ') + ' from this folder is running)')
            }
        }
    }
    return , $users
}
# ------------------------------------------------------------ the build
# The launcher's own (GeneratedBuild.cs): each line it says is shown here,
# and a refusal is its sentence and its exit code.
try { $list = Get-GeneratedBuildList $BuildList } catch { Die $_.Exception.Message }
$build = New-Object Thornswood.GeneratedBuild
$build.Root = $Root
$build.List = $list
$build.DryRun = [bool]$DryRun
$build.Minutes = $Minutes
$build.StallSeconds = $StallSeconds
$build.Say = [Action[string, string]] { param($m, $c) if ($c -eq 'Head') { Head $m } else { Say $m $c } }
# Get-FolderUsers hands its list back whole (return , $users), so it is
# taken as one value here and not wrapped again: @() around it made an empty
# list one empty name, and every run stopped as in use by nobody.
$build.InUse = [Func[string[]]] { $users = Get-FolderUsers $Root; return [string[]]@($users | Where-Object { $_ }) }
try { $made = $build.Run() }
catch {
    $e = $_.Exception
    while ($e -and -not ($e -is [Thornswood.GeneratedStop]) -and $e.InnerException) { $e = $e.InnerException }
    if ($e -is [Thornswood.GeneratedStop]) { Die $e.Message $e.Code }
    Die ("The build stopped on something it did not expect: " + $e.Message)
}

Write-Host ''
if ($DryRun) { Say '  Done. Nothing was written.' 'Green' }
else { Say ("  Done. {0} file(s) built and recorded as this folder's own; the launcher keeps them, and nothing ships them." -f $made) 'Green' }
Leave 0
