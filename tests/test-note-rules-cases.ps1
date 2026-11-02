<#
  test-note-rules-cases.ps1

      pwsh -NoProfile -File .\tests\test-note-rules-cases.ps1

  The release note rules are written twice while both are in use (#5179,
  plan rev 64): in C# in tools\ReleaseNotes, which the "Release note" check
  runs on every pull request, and in PowerShell in
  scripts\release\Note-Rules.ps1, which Ship.ps1, Rollback-Feed.ps1,
  Deploy-DevGamemode.ps1 and Collect-ReleaseNotes.ps1 still read on the box,
  where there is no .NET SDK. tests\fixtures\note-rules-cases.json holds the
  answer for every case; tools\ReleaseNotes.Tests holds the C# copy to it,
  and this holds the PowerShell copy, so a rule changed in one copy and not
  the other fails both. When the fixture's answers have to change, change
  both copies, then the fixture.

  Each case is one PASS or FAIL line. When the .NET SDK is on this machine it
  also runs dotnet test on tools\ReleaseNotes.Tests from the locked packages;
  without it that check is a SKIP (the "Release note rules" workflow runs it).

  Read only.
#>
[CmdletBinding()]
param()
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
function Same($a, $b) { (@($a) -join "`n") -ceq (@($b) -join "`n") -and @($a).Count -eq @($b).Count }
function Short([string]$t) { $one = ($t -replace "`r?`n", ' / ').Trim(); if ($one.Length -gt 50) { $one.Substring(0, 47) + '...' } else { $one } }

. (Join-Path $Repo 'scripts/release/Note-Rules.ps1')
$cases = Get-Content -Raw -LiteralPath (Join-Path $Repo 'tests/fixtures/note-rules-cases.json') | ConvertFrom-Json

Yes 'the fixture holds enough cases' (@($cases.notes).Count -ge 50 -and @($cases.bodies).Count -ge 10 -and @($cases.joins).Count -ge 3)

$i = 0
foreach ($c in @($cases.notes)) {
    $i++
    $note = [string]$c.note
    Yes ("note {0} ({1}) gets the same problems" -f $i, (Short $note)) ((Same @(Get-NoteShapeProblems $note) @($c.shape)) -and (Same @(Get-NoteProblems $note) @($c.words)))
}

$i = 0
foreach ($c in @($cases.bodies)) {
    $i++
    $body = [string]$c.body
    $n = Get-PrReleaseNote $body
    $same = ($n.Found -eq $c.found) -and ($n.None -eq $c.none) -and ([string]$n.Headline -ceq [string]$c.headline) -and
        (Same @($n.Details) @($c.details)) -and ([string]$n.Text -ceq [string]$c.text) -and ($n.Count -eq $c.count) -and
        (Same @(Get-PrReleaseNoteProblems $body ([string]$c.author)) @($c.problems))
    Yes ("body {0} ({1}) reads the same" -f $i, (Short $body)) $same
}

$i = 0
foreach ($c in @($cases.joins)) {
    $i++
    $n = 0
    $items = @(@($c.bodies) | ForEach-Object { $n++; [pscustomobject]@{ Number = $n; Body = [string]$_ } })
    Yes ("join {0} of {1} bodies gives the same note" -f $i, $items.Count) ([string](Join-PrReleaseNotes $items) -ceq [string]$c.note)
}

$dotnet = Get-Command dotnet -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $dotnet) { Write-Host 'SKIP  dotnet test on tools/ReleaseNotes.Tests: the .NET SDK is not on this machine (the Release note rules workflow runs it)' }
else {
    $tests = Join-Path $Repo 'tools/ReleaseNotes.Tests'
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'
    $r = & $dotnet.Source restore $tests --locked-mode 2>&1
    if ($LASTEXITCODE -ne 0) { Yes 'dotnet restore on tools/ReleaseNotes.Tests from the locked packages' $false; $r | Select-Object -Last 10 | ForEach-Object { Write-Host "      $_" } }
    else {
        $t = & $dotnet.Source test $tests --no-restore 2>&1
        Yes 'dotnet test on tools/ReleaseNotes.Tests' ($LASTEXITCODE -eq 0)
        if ($LASTEXITCODE -ne 0) { $t | Select-Object -Last 20 | ForEach-Object { Write-Host "      $_" } }
    }
}

Write-Host ""
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
exit 0
