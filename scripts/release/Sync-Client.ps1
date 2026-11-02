<#
.SYNOPSIS
  Puts the client runtime built from the fork into the game folder, and
  refuses any file that is not the recorded build.

.DESCRIPTION
  The six files in records\client-build.json are the SkyMP client Thornswood
  ships: the bundle, MpClientPlugin.dll, both SkyrimPlatform DLLs, the CEF host
  and TESModPlatform.pex. New-ClientBuildRecord.ps1 writes that record after a
  rebuild; this copies the files it names from the fork's build output into
  the game folder, from where the next Ship packs them.

  Every file is hashed before it is copied and compared against the record.
  A mismatch stops the whole run with both hashes printed, because a runtime
  that is not the recorded one is either stale, or somebody else's, and until
  20 September it was the second: another server's launcher had written its
  own client into the Steam copy and the folder build copied it across.

  When the game folder already holds all six as recorded, nothing is copied
  and the build is not read, so a checkout with no engine\skymp build still
  answers 0 for a game folder that is right (issue #946).

  CI'S BUILD, issue #3047. A rebuild is never the same bytes, so only the
  build a record was made from matches it, and since #459 that is CI's. On a
  machine that takes CI's build (Setup-ShipMachine.ps1 -EngineBuild ci) the
  default -Dist is Where.ps1 EngineArtifact's client folder, named for the
  pin. When the game folder needs the client and that folder is not there
  yet, Get-EngineArtifact.ps1 fetches the fork's build of the pin into it first,
  held to the records, so a Ship or Go after a pin move needs no engine build.
  -Check fetches nothing.

  Nothing here talks to the VPS, starts anything, or touches the Steam copy.

.PARAMETER Check
  Compare and report only. Nothing is copied.

.PARAMETER Game
  The game folder. Defaults to Thornswood's own.

.EXAMPLE
  .\scripts\release\Sync-Client.ps1 -Check
  Says which of the six are already in place, which differ, and whether the
  build matches the record.

.EXAMPLE
  .\scripts\release\Sync-Client.ps1
  Copies the recorded build in. Go.ps1 runs this.
#>
[CmdletBinding()]
param(
  [string]$Dist = (& (Join-Path $PSScriptRoot 'Where.ps1') ClientDist),
  # Under the launcher install, which Where.ps1 Install finds (C:\Thornswood
  # on most machines, another drive's when the launcher is there, #3003), so
  # Sync-Client copies into the install this machine's launcher actually uses.
  # -Game still wins.
  [string]$Game = ((& (Join-Path $PSScriptRoot 'Where.ps1') Install) + '\Game'),
  [string]$Record,
  [switch]$Check,
  [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
if (-not $Record) { $Record = Join-Path $PSScriptRoot '..\..\records\client-build.json' }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

function Stop-Here($m) {
  Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}
function Sha256([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }

if (-not (Test-Path -LiteralPath $Record)) { Stop-Here "no record at $Record. Run .\scripts\release\New-ClientBuildRecord.ps1 after building the client." }
if (-not (Test-Path -LiteralPath $Game))   { Stop-Here "game folder not found: $Game" }

# Named when empty or not JSON, rather than a parse error or a null record.
$recText = "$(Get-Content -LiteralPath $Record -Raw)"
if (-not $recText.Trim([char]0xFEFF, ' ', [char]9, [char]13, [char]10)) { Stop-Here "$Record is empty. Run .\scripts\release\New-ClientBuildRecord.ps1 after building the client." }
try { $rec = $recText | ConvertFrom-Json } catch { Stop-Here ("$Record is not valid JSON: " + $_.Exception.Message) }
# RecordShape.ps1 (#2180): a version this checkout does not know, or a missing
# field, stops here before a file is copied.
. (Join-Path $PSScriptRoot 'RecordShape.ps1')
$recBad = @(Get-ThornswoodRecordProblems -Doc $rec -Kind client-build)
if ($recBad.Count) { Stop-Here ("$Record is not a client-build record this checkout can trust: " + ($recBad -join '; ')) }
$files = @($rec.files.PSObject.Properties.Name)
if (-not $files.Count) { Stop-Here 'the record names no files' }

Say ("client build {0} on {1}, recorded {2}" -f $rec.forkCommit, $rec.forkBranch, $rec.recordedUtc) 'Cyan'

# The game folder first. When it already holds every recorded file, byte for
# byte, there is nothing to copy and the build is not needed at all: what a
# Ship packs is the game folder, and it is the recorded client. Until 28 Sep
# this stopped on "client build not found" before looking, so a fresh Ship
# worktree with no engine\skymp could not Ship although the folder it packs was
# right (issue #946).
$already = 0
foreach ($rel in $files) {
  $dst = Join-Path $Game $rel
  if ((Test-Path -LiteralPath $dst) -and ((Sha256 $dst) -eq $rec.files.$rel.sha256)) { $already++ }
}
if ($already -eq $files.Count) {
  foreach ($rel in $files) { Say ("  {0,-9} {1,10:N0} b  {2}" -f 'in place', (Get-Item -LiteralPath (Join-Path $Game $rel)).Length, $rel) 'Green' }
  if (-not (Test-Path -LiteralPath $Dist)) { Say "  no client build at $Dist, and none is needed" 'DarkGray' }
  Say 'every recorded file is already in the game folder' 'Green'
  exit 0
}
# CI's build of the pin, fetched when it is the build asked for and is not
# here yet (CI'S BUILD above). Only that folder: any other -Dist is somebody's
# own and is never filled from here.
$ciDist = ''
try { $ciDist = Join-Path ([string](& (Join-Path $PSScriptRoot 'Where.ps1') EngineArtifact)) 'build\dist\client' } catch { $ciDist = '' }
$isCi = $ciDist -and ([IO.Path]::GetFullPath($Dist).TrimEnd('\', '/') -eq [IO.Path]::GetFullPath($ciDist).TrimEnd('\', '/'))
if ($isCi -and -not $Check -and -not (Test-Path -LiteralPath $Dist)) {
  Say "  CI's engine build of the pin is not here yet; fetching it" 'Cyan'
  $global:LASTEXITCODE = 0
  & (Join-Path $PSScriptRoot 'Get-EngineArtifact.ps1') -NoPause
  if ($LASTEXITCODE -ne 0) { Stop-Here "CI's engine build of the pin could not be fetched, and the game folder does not hold the recorded client. Get-EngineArtifact.ps1 says why above." }
}
if (-not (Test-Path -LiteralPath $Dist)) {
  Stop-Here (("client build not found: $Dist, and the game folder does not hold the recorded client ({0} of {1} in place). " -f $already, $files.Count) +
             $(if ($isCi) { 'It is CI''s build of the pin, which .\scripts\release\Get-EngineArtifact.ps1 fetches (and Sync-Client without -Check runs it).' }
               else { 'Put a build that matches records\client-build.json there, or pass -Dist with one. CI''s build of the pin is the one the record names: .\scripts\release\Setup-ShipMachine.ps1 -EngineBuild ci makes it this machine''s (engine\README.md, A Ship machine takes CI''s build).' }))
}

# First pass: every file in the build must be the recorded one. Nothing is
# copied until all six pass, so a half synced folder is not a state this can
# leave behind.
$plan = @()
foreach ($rel in $files) {
  $want = $rec.files.$rel.sha256
  $src = Join-Path $Dist $rel
  if (-not (Test-Path -LiteralPath $src)) { Stop-Here "the build is missing $rel" }
  $have = Sha256 $src
  if ($have -ne $want) {
    Say "  $rel" 'Yellow'
    Say "    build    $have" 'Yellow'
    Say "    recorded $want" 'Yellow'
    # Not "rebuild": a rebuild is never the same bytes, so it can match only a
    # record made from it, and a new record for an engine nobody changed is
    # the mix engine\README.md forbids (#3047).
    Stop-Here ("the build is not the recorded one ($Dist). Only the build the record was made from matches it, and that is CI's: " +
               '.\scripts\release\Setup-ShipMachine.ps1 -EngineBuild ci makes it this machine''s engine build (engine\README.md, A Ship machine takes CI''s build). ' +
               'A new record is only for an engine change, in its pin pull request.')
  }
  $dst = Join-Path $Game $rel
  $state = if (-not (Test-Path -LiteralPath $dst)) { 'absent' }
           elseif ((Sha256 $dst) -eq $want) { 'in place' }
           else { 'differs' }
  $plan += [pscustomobject]@{ Rel = $rel; Src = $src; Dst = $dst; State = $state; Bytes = (Get-Item -LiteralPath $src).Length }
}

$todo = @($plan | Where-Object { $_.State -ne 'in place' })
foreach ($p in $plan) {
  $c = if ($p.State -eq 'in place') { 'Green' } else { 'Yellow' }
  Say ("  {0,-9} {1,10:N0} b  {2}" -f $p.State, $p.Bytes, $p.Rel) $c
}

if (-not $todo.Count) {
  Say 'every recorded file is already in the game folder' 'Green'
  exit 0
}
if ($Check) {
  Say ("{0} of {1} would be copied. Run without -Check to do it." -f $todo.Count, $plan.Count) 'Yellow'
  exit 2
}

foreach ($p in $todo) {
  $dir = Split-Path $p.Dst -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  # The old file's name comes off first (#2019). A game folder OwnGame made is
  # mostly hard links, and a copy over a file with a second name writes the
  # new bytes through every name it has (OwnGame.cs, Unshare). Removing a
  # name takes only this folder's, so the copy is the folder's own.
  if (Test-Path -LiteralPath $p.Dst) { Remove-Item -LiteralPath $p.Dst -Force }
  Copy-Item -LiteralPath $p.Src -Destination $p.Dst -Force
  if ((Sha256 $p.Dst) -ne $rec.files.($p.Rel).sha256) { Stop-Here "copy of $($p.Rel) does not hash as the record; the folder may be in use" }
  Say "  copied $($p.Rel)" 'Green'
}
Say ("{0} file(s) in place. The next Ship packs them." -f $todo.Count) 'Green'
