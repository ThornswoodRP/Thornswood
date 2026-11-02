<#
.SYNOPSIS
  Takes the records an engine.yml run made out of its log and writes them
  into this checkout's records\, for the pin pull request.

.DESCRIPTION
  Issue #3399. engine.yml records the fork's own build of a commit
  (records\server-build.json, records\client-build.json,
  records\client-licences.json and records\client-licences\), and since this
  repository's artifact storage was used up on 25 Oct it hands them back in
  its job's log instead of keeping them as an artifact (EngineRecords.ps1
  says what is carried, LogHandBack.ps1 how). This reads that log through
  gh, holds the records to what they must be, and writes them here.

  What is held first: the run is engine.yml's, in this repository, and ended
  green; exactly one of its Engine build jobs succeeded, and its log holds the records
  whole (their length and sha256); the records are the four things and no
  other; both build records name one fork commit; and that commit is the one
  this checkout's index pins engine\skymp to. So move the pin first, then run
  this. records\client-licences\ is then replaced whole.

  It reads GitHub through gh (any machine with gh, a cloud thread's too),
  writes nothing but the records, and sends nothing.

  Exit 0: the records are written. 1: they are not, and the last line says
  why.

.PARAMETER Run
  The engine.yml run's id.

.PARAMETER Gh
  The gh to run, for a harness. gh on the path otherwise.

.PARAMETER NoPause
  Exits without waiting for Enter.

.EXAMPLE
  git update-index --cacheinfo 160000,<fork commit>,engine/skymp
  .\scripts\release\Get-EngineRecords.ps1 -Run <the engine.yml run's id>
  The pin moved in the index, then the records of that run written beside it.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][long]$Run,
  [string]$Gh = 'gh',
  [switch]$NoPause
)
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'EngineRecords.ps1')
$RepoDir = Split-Path -Parent (Split-Path -Parent $Here)
$GitHubRepo = 'ThornswoodRP/Thornswood'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Stop-Here($m) {
  Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}

if (-not (Get-Command $Gh -ErrorAction SilentlyContinue)) { Stop-Here 'gh is not here. winget install --id GitHub.cli -e, then gh auth login.' }
# gh api through the gh this was given; its error stops the run with what it said.
function Get-Gh([string]$path, [string[]]$flags = @()) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = @(& $Gh api $path @flags 2>&1 | ForEach-Object { [string]$_ }); $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  if ($code -ne 0) { Stop-Here ("GitHub answered GET $path with: " + ((($out | Select-Object -Last 2) -join ' ') -replace "`e", '')) }
  return , $out
}

$r = (Get-Gh "repos/$GitHubRepo/actions/runs/$Run") -join "`n" | ConvertFrom-Json
if ([string]$r.path -ne '.github/workflows/engine.yml') { Stop-Here ("run $Run is not an engine.yml run (it is " + $r.path + ').') }
if ([string]$r.status -ne 'completed' -or [string]$r.conclusion -ne 'success') { Stop-Here ("run $Run is $($r.status) $($r.conclusion), not green, so it handed back no records to take: " + $r.html_url) }
Say ("engine.yml run {0} ({1}), green" -f $Run, $r.html_url) 'Cyan'

# The job that ran the build's steps and succeeded: "Engine build", or in an
# older run its "(VPS fallback)" when that one ran instead (engine.yml, WHERE
# IT RUNS). Picked by name: since #5220 the run also has the job "Wake the
# engine pin", which succeeds beside it and hands back no records, and a
# pick of "the one job that succeeded" stopped every pin from 1 Nov (#5219).
$jobs = @((((Get-Gh "repos/$GitHubRepo/actions/runs/$Run/jobs") -join "`n") | ConvertFrom-Json).jobs |
  Where-Object { [string]$_.conclusion -eq 'success' -and [string]$_.name -like 'Engine build*' })
if ($jobs.Count -ne 1) { Stop-Here ("run $Run has $($jobs.Count) Engine build jobs that succeeded, and engine.yml's records come from the one: " + $r.html_url) }
# The log keeps the runner's colours, which a newer gh hands over only when
# told (Get-GhLogFlags, #5202).
$log = Get-Gh "repos/$GitHubRepo/actions/jobs/$($jobs[0].id)/logs" (Get-GhLogFlags $Gh)
try { $bytes = Read-LogHandBack $log $EngineRecordsMark } catch { Stop-Here ("run $Run's log does not hold the records whole: " + $_.Exception.Message + '. A run from before #3399 kept them as an artifact instead.') }
try {
  $files = Read-EngineRecordsBundle $bytes
  $commit = Get-EngineRecordsCommit $files
} catch { Stop-Here ("run $Run's records are not what engine.yml hands back: " + $_.Exception.Message) }

# The pin in the index, which is what the pull request commits.
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$pinLine = "$(& git -C $RepoDir ls-files -s engine/skymp 2>$null)".Trim()
$ErrorActionPreference = $old
$pin = ''
if ($pinLine -match '^160000 ([0-9a-f]{40}) ') { $pin = $Matches[1] }
if ($pin -ne $commit) {
  Stop-Here ("run $Run recorded fork commit $commit, and this checkout pins engine/skymp to " + $(if ($pin) { $pin } else { 'nothing' }) + ". Move the pin first (git update-index --cacheinfo 160000,$commit,engine/skymp), then run this again, so the records never go in under another commit.")
}

Save-EngineRecords $files $RepoDir
$texts = @($files.Keys | Where-Object { $_ -like 'records/client-licences/*' }).Count
Say ("  the records of fork commit {0} are written: server-build.json, client-build.json, client-licences.json and {1} licence texts" -f $commit.Substring(0, 12), $texts) 'Green'
Say '  next: .\scripts\release\Check-Records.ps1, then the THIRD-PARTY.md and credits.md lines (engine\README.md, One engine, step 4)' 'DarkGray'
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
