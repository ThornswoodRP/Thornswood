<#
  test-ship-check-words.ps1

      powershell -NoProfile -File .\tests\test-ship-check-words.ps1

  Ship checks the release notes (Note-Rules.ps1) and, since issue #1081, the
  files people read (scripts\dev\Check-Words.ps1) before it builds. A dev Ship
  may be run from any branch, including one whose pull request build never ran
  or went red, so a hit has to stop a dry run too.

  HOW. A temp tree gets the real Ship.ps1, the scripts it loads before the
  check, and the real Check-Words.ps1. A README there carries one planted hit.
  Ship -DryRun -NoPause must exit non-zero and name that hit (file, line, rule)
  before it builds. The temp tree is removed, so the hit is not left in this
  repository.

  Nothing here publishes, opens Vortex, or runs a real Ship.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$shipReal = Join-Path $Repo 'scripts\release\Ship.ps1'
$wordsReal = Join-Path $Repo 'scripts\dev\Check-Words.ps1'
$shipText = [IO.File]::ReadAllText($shipReal)
$callAt = $shipText.IndexOf('scripts\dev\Check-Words.ps1')
$gitAt = $shipText.IndexOf("Head 'Git'")
# Ship builds no launcher since #4825; the first thing it builds is the ship root.
$buildAt = $shipText.IndexOf("Head 'The ship root'")
Yes 'Ship.ps1 runs Check-Words.ps1' ($callAt -ge 0)
Yes 'and before the git gate and before anything is built' ($callAt -ge 0 -and $gitAt -gt $callAt -and $buildAt -gt $gitAt)
Yes 'a non-zero result names the hits and stops' ($shipText.Contains('The writing rules do not hold. Nothing was built.'))

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-ship-words-' + [Guid]::NewGuid().ToString('N'))
$tree = Join-Path $T 'repo'
$play = Join-Path $T 'Play'
$dist = Join-Path $T 'dist'
$plant = 'HARNESS1081 the player must not ship'
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $tree 'scripts\release'), (Join-Path $tree 'scripts\dev'), (Join-Path $tree 'records'), $play, $dist | Out-Null
    foreach ($n in 'Ship.ps1', 'Ship-Rules.ps1', 'ShippedBytes.ps1', 'Assert-PublishSigned.ps1', 'Feed-Store.ps1', 'Feed-Json.ps1', 'Release-Name.ps1', 'Note-Rules.ps1', 'Where.ps1', 'Read-JsonFile.ps1', 'RecordShape.ps1', 'RepoPlugins.ps1', 'CollectionRevision.ps1', 'Note-Repeats.ps1', 'Feed-News.ps1', 'Release-Baseline.ps1', 'Feed-Rules.ps1', 'LauncherVersion.ps1') {
        Copy-Item -LiteralPath (Join-Path $Repo ('scripts\release\' + $n)) -Destination (Join-Path $tree ('scripts\release\' + $n)) -Force
    }
    Copy-Item -LiteralPath $wordsReal -Destination (Join-Path $tree 'scripts\dev\Check-Words.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $Repo 'layout.json') -Destination (Join-Path $tree 'layout.json') -Force
    Copy-Item -LiteralPath (Join-Path $Repo 'records\ui-gone.json') -Destination (Join-Path $tree 'records\ui-gone.json') -Force
    [IO.File]::WriteAllText((Join-Path $tree 'README.md'), ($plant + "`r`n"))

    $ps = (Get-Process -Id $PID).Path
    $notes = "The map marker points at the right door`n- The marker over a house now sits on the door you walk through"
    # What the channel has been told (#3320) is read from an empty stand-in
    # for the site and the VPS store, so nothing connects anywhere.
    $oldSite = $env:THORNSWOOD_TEST_SITE_DIR
    $env:THORNSWOOD_TEST_SITE_DIR = Join-Path $T 'site'
    New-Item -ItemType Directory -Force -Path (Join-Path $T 'site\feed'), (Join-Path $T 'site\feed-dev') | Out-Null
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $tree 'scripts\release\Ship.ps1') -DryRun -NoPause -Root $play -DistRoot $dist $notes 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $old; $env:THORNSWOOD_TEST_SITE_DIR = $oldSite }

    Yes ("a planted hit stops a dry-run Ship (exit {0})" -f $code) ($code -ne 0 -and $out -notmatch 'Dry run finished' -and $out -notmatch 'Building the launcher')
    Yes 'and the hit names the file, the line and the rule' ($out -match '::error file=README\.md,line=1::\[banned-word\]' -and $out -match 'Nothing was built')
    if ($code -eq 0 -or $out -notmatch 'banned-word') {
        Write-Host '---- ship output (last 50 lines) ----'
        @($out -split "`r?`n") | Select-Object -Last 50 | ForEach-Object { Write-Host $_ }
    }
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Yes 'the temp tree is gone' (-not (Test-Path -LiteralPath $T))
$readme = Join-Path $Repo 'README.md'
$left = $false
if (Test-Path -LiteralPath $readme) {
    $left = [IO.File]::ReadAllText($readme).Contains('HARNESS1081')
}
Yes 'the planted hit is not in the repository README' (-not $left)
$porcelain = @(& git -C $Repo status --porcelain -- 'README.md' 'launcher/app/MainWindow.axaml')
Yes 'the planted hit did not touch the files people read' ($porcelain.Count -eq 0)

Done