<#
  test-4161-package-notices.ps1

      pwsh -NoProfile -File .\tests\test-4161-package-notices.ps1

  Issue #4161, Patrick's A on the NuGet card (9 Nov 2026): Dependabot opens
  a weekly grouped pull request for the launcher's and the deploy agent's C#
  packages, and the pull request gate holds each one until THIRD-PARTY.md,
  site\data\site\credits.md and installer\licences name the new versions.
  This harness is that hold: it runs scripts\dev\Check-PackageNotices.ps1.

    1. The tree: every package Dependabot moves is named at its own version.
    2. A planted copy where SharpSRTP is bumped in the launcher's project
       alone, as Dependabot's commit is: red, naming each place that still
       says the old version. The same copy with those places brought to the
       new version: green.
    3. A planted copy where Avalonia moves in the launcher and not in the
       window harness: red, one version for all.
    4. The nuget entry of .github\dependabot.yml: weekly, one group, no
       rebasing, area: Launcher, each directory holds a project, and every
       project that names one of the launcher's or the agent's packages is
       in it.
  Reads only; the planted copies are in a temp folder, removed after.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

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

$check = Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Check-PackageNotices.ps1'
Yes 'scripts\dev\Check-PackageNotices.ps1 is there' (Test-Path -LiteralPath $check)
if (-not (Test-Path -LiteralPath $check)) { Done }
. $check

# ---- 1. the tree ---------------------------------------------------------------
$faults = @(Find-PackageNoticeFaults $repo)
Yes ('every package Dependabot moves is named at its own version' + $(if ($faults.Count) { ': ' + ($faults -join ' | ') } else { '' })) ($faults.Count -eq 0)
$dirs = @(Get-NuGetDirectories $repo)
$ignored = @(Get-NuGetIgnored $repo)
$refs = @(Get-PackageReferences $repo $dirs $ignored)
Yes ('  it read the nuget entry''s projects ({0} references in {1} directories)' -f $refs.Count, $dirs.Count) ($refs.Count -ge 10 -and $dirs.Count -ge 2)

# A copy of what the check reads, for planting.
function New-Copy {
    $t = Join-Path ([IO.Path]::GetTempPath()) ('ts-4161-' + [Guid]::NewGuid().ToString('N'))
    foreach ($rel in @('.github/dependabot.yml', 'THIRD-PARTY.md', 'site/data/site/credits.md')) {
        $to = Join-Path $t $rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo $rel) -Destination $to
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $t 'installer') | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'installer/licences') -Destination (Join-Path $t 'installer/licences') -Recurse
    foreach ($d in $dirs) {
        $to = Join-Path $t ($d.TrimStart('/'))
        New-Item -ItemType Directory -Force -Path $to | Out-Null
        foreach ($p in @(Get-ChildItem -LiteralPath (Join-Path $repo ($d.TrimStart('/'))) -Filter '*.csproj' -File)) { Copy-Item -LiteralPath $p.FullName -Destination $to }
    }
    return $t
}
function Edit-Copy([string]$t, [string]$rel, [string]$from, [string]$to) {
    $p = Join-Path $t $rel
    $text = [IO.File]::ReadAllText($p)
    if (-not $text.Contains($from)) { throw "the planted edit found no '$from' in $rel" }
    [IO.File]::WriteAllText($p, $text.Replace($from, $to))
}

$t = New-Copy
try {
    # ---- 2. a bump with the notices left behind, then brought up ---------------
    Edit-Copy $t 'launcher/app/Thornswood.csproj' '<PackageReference Include="SharpSRTP" Version="0.5.8" />' '<PackageReference Include="SharpSRTP" Version="0.5.9" />'
    $bumped = @(Find-PackageNoticeFaults $t)
    Yes ('a SharpSRTP bump in the project alone is red ({0} fault(s))' -f $bumped.Count) ($bumped.Count -gt 0)
    Yes '  naming THIRD-PARTY.md''s old version' (@($bumped | Where-Object { $_ -match '^FAULT THIRD-PARTY\.md names SharpSRTP 0\.5\.8, but the project is at 0\.5\.9' }).Count -eq 1)
    Yes '  and that THIRD-PARTY.md does not name the new one' (@($bumped | Where-Object { $_ -match 'does not name SharpSRTP 0\.5\.9' }).Count -eq 1)
    Yes '  and the credits page''s' (@($bumped | Where-Object { $_ -match '^FAULT site/data/site/credits\.md names SharpSRTP 0\.5\.8' }).Count -eq 1)
    Yes '  and installer\licences''' (@($bumped | Where-Object { $_ -match '^FAULT installer/licences/README\.txt names SharpSRTP 0\.5\.8' }).Count -eq 1)
    Yes '  and nothing about any other package' (@($bumped | Where-Object { $_ -notmatch 'SharpSRTP' }).Count -eq 0)
    $p = Join-Path $t 'installer/licences/README.txt'
    [IO.File]::WriteAllText($p, [IO.File]::ReadAllText($p).Replace('SharpSRTP 0.5.8', 'SharpSRTP 0.5.9'))
    $p = Join-Path $t 'site/data/site/credits.md'
    [IO.File]::WriteAllText($p, [IO.File]::ReadAllText($p).Replace('SharpSRTP 0.5.8', 'SharpSRTP 0.5.9'))
    $part = @(Find-PackageNoticeFaults $t)
    Yes ('  with the credits and installer\licences brought up but not THIRD-PARTY.md, still red ({0})' -f $part.Count) ($part.Count -eq 2 -and @($part | Where-Object { $_ -notmatch '^FAULT THIRD-PARTY\.md' }).Count -eq 0)
    Edit-Copy $t 'THIRD-PARTY.md' '| SharpSRTP | 0.5.8 |' '| SharpSRTP | 0.5.9 |'
    $p = Join-Path $t 'THIRD-PARTY.md'
    [IO.File]::WriteAllText($p, [IO.File]::ReadAllText($p).Replace('SharpSRTP 0.5.8', 'SharpSRTP 0.5.9'))
    $up = @(Find-PackageNoticeFaults $t)
    Yes ('  and with all three brought up, green' + $(if ($up.Count) { ': ' + ($up -join ' | ') } else { '' })) ($up.Count -eq 0)

    # ---- 3. one version for the projects that move together --------------------
    Edit-Copy $t 'launcher/app/Thornswood.csproj' '<PackageReference Include="Avalonia" Version="12.1.4" />' '<PackageReference Include="Avalonia" Version="12.1.5" />'
    $split = @(Find-PackageNoticeFaults $t)
    Yes 'Avalonia moved in the launcher and not in the window harness is red, one version for all' (@($split | Where-Object { $_ -match '^FAULT Avalonia is at .*launcher/app/Thornswood\.csproj 12\.1\.5.*launcher/tests/window-starts/WindowStarts\.csproj 12\.1\.4' }).Count -eq 1)
} finally {
    Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 4. the nuget entry ----------------------------------------------------------
$yml = [IO.File]::ReadAllText((Join-Path $repo '.github/dependabot.yml')) -replace "`r`n", "`n"
$code = ($yml -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
$m = [regex]::Match($code, '(?ms)^  - package-ecosystem: nuget\n(.*?)(?=^  - package-ecosystem:|\z)')
$entry = $m.Groups[1].Value
Yes 'dependabot.yml has one nuget entry' ($m.Success -and ([regex]::Matches($code, '(?m)^  - package-ecosystem: nuget$')).Count -eq 1)
Yes '  weekly' ($entry -match '(?m)^    schedule:\n      interval: weekly$')
Yes '  as one group' ($entry -match '(?m)^    groups:\n      [a-z-]+:\n        patterns: \["\*"\]$')
Yes '  with no rebasing (#5327)' ($entry -match '(?m)^    rebase-strategy: disabled$')
Yes '  labelled area: Launcher and nothing else' ($entry -match '(?m)^    labels:\n      - "area: Launcher"\n(?!      -)')
$empty = @($dirs | Where-Object { @(Get-ChildItem -LiteralPath (Join-Path $repo ($_.TrimStart('/'))) -Filter '*.csproj' -File -ErrorAction SilentlyContinue).Count -eq 0 })
Yes ('  every directory holds a project' + $(if ($empty.Count) { ': not ' + ($empty -join ', ') } else { '' })) ($empty.Count -eq 0)
Yes ('  it ignores only DeployAgent.Tests'' own test libraries ({0})' -f ($ignored -join ', ')) ((@($ignored | Sort-Object) -join ',') -eq 'Microsoft.NET.Test.Sdk,xunit,xunit.runner.visualstudio')
# Every project that names one of the moved packages must move with them,
# or the next bump splits it from the launcher (a project naming its version
# through a property read from the launcher's, like tests\voice-launcher,
# moves by itself). The study prototypes never build with the launcher.
# The projects are the ones git tracks, the ones Dependabot reads: a walk of
# the folder also read the projects other harnesses build under out/, and
# passed or failed by which of them ran first in the share (#5720).
$moved = @($refs | ForEach-Object { $_.Name } | Select-Object -Unique)
$left = @()
$tracked = @(& git -C $repo ls-files -- '*.csproj')
if ($LASTEXITCODE -ne 0 -or -not $tracked.Count) { throw "git ls-files named no project in $repo (exit $LASTEXITCODE)" }
foreach ($p in @($tracked | Where-Object { $_ -notmatch '^(engine|docs/studies)/' } | ForEach-Object { Get-Item -LiteralPath (Join-Path $repo $_) })) {
    $rel = '/' + (Split-Path -Parent $p.FullName.Substring($repo.TrimEnd('\', '/').Length + 1)).Replace('\', '/')
    if ($dirs -contains $rel) { continue }
    $x = [xml][IO.File]::ReadAllText($p.FullName)
    $named = @($x.SelectNodes('//PackageReference') | Where-Object { $moved -contains $_.GetAttribute('Include') -and -not $_.GetAttribute('Version').Contains('$(') })
    if ($named.Count) { $left += $rel }
}
Yes ('  and every project that names one of its packages at a written version is in it' + $(if ($left.Count) { ': not ' + ($left -join ', ') } else { '' })) ($left.Count -eq 0)

Done
