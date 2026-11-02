<#
  test-nightly-stray.ps1

      pwsh -NoProfile -File .\tests\test-nightly-stray.ps1

  The nightly's stray check reads every page of branches and of open pull
  requests. Issue #1201: the step read branches?per_page=100 and
  pulls?state=open&per_page=100 once each, so a branch past the first hundred
  was never checked, and a branch whose open pull request was past the first
  hundred pulls was called stray when it was not.

  HOW. scripts\dev\Nightly-Stray.ps1 is dot-sourced without -Run, so it only
  defines its functions, and Invoke-RestMethod is a stand-in here that keeps
  branches and pull requests in memory and answers the way GitHub does: pages
  of 100 by per_page and page, and a JSON array handed down the pipe as ONE
  object. Then:
    1. 150 branches and 130 open pull requests. Branch 140 is on the second
       page with no pull request: it is named. Branch 120's pull request is
       on the second page of pulls: it is not named. main never is.
    2. A pull request three days old is named; one a day old is not; one
       labelled held is listed as held and not named (#1273).
    3. A run that names nothing exits 0 and one that names something exits 1,
       with the lines the step used to print.
    4. nightly.yml runs the script and the inline step is gone.
  Never connects to anything.
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

$script:Branches = @()
$script:Pulls = @()
$script:Asked = New-Object System.Collections.ArrayList
$now = [DateTime]::UtcNow

# GitHub, as far as this script uses it: one page of a list, by per_page and
# page, as one object down the pipe (a single array), the way Invoke-RestMethod
# hands a JSON array on.
function Invoke-RestMethod {
    param([string]$Method = 'GET', $Headers, [string]$Uri, $Body, [string]$ContentType)
    [void]$script:Asked.Add($Uri)
    $m = [regex]::Match($Uri, '/repos/[^/]+/[^/]+/(branches|pulls)(\?.*)?$')
    if (-not $m.Success) { throw ('the stand-in does not answer ' + $Uri) }
    $q = @{}
    foreach ($kv in ($m.Groups[2].Value.TrimStart('?') -split '&')) {
        if (-not $kv) { continue }
        $p = $kv -split '=', 2
        $q[$p[0]] = $p[1]
    }
    $per = if ($q.ContainsKey('per_page')) { [int]$q['per_page'] } else { 30 }
    $page = if ($q.ContainsKey('page')) { [int]$q['page'] } else { 1 }
    $list = if ($m.Groups[1].Value -eq 'branches') { $script:Branches } else { $script:Pulls }
    $from = ($page - 1) * $per
    $slice = @()
    if ($from -lt $list.Count) { $slice = @($list[$from..([Math]::Min($list.Count, $from + $per) - 1)]) }
    Write-Output -NoEnumerate $slice
}

$env:REPO = 'ThornswoodRP/Thornswood'
$env:GH_TOKEN = 'not-a-real-token'
$scriptPath = Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Nightly-Stray.ps1'
. $scriptPath

function Branch([string]$n) { [pscustomobject]@{ name = $n } }
function Pull([int]$n, [string]$ref, [int]$daysOld) {
    [pscustomobject]@{ number = $n; title = ('work on ' + $ref); created_at = $now.AddDays(-$daysOld).ToString('o'); head = [pscustomobject]@{ ref = $ref } }
}

# ---- 1. pages ------------------------------------------------------------------
$script:Branches = @(Branch 'main') + @(1..149 | ForEach-Object { Branch ('claude/b' + $_) })
# Every branch has an open pull request except 140, and the pull request for
# 120 is the 130th, on the second page of pulls.
$pulls = @()
$k = 1
foreach ($i in 1..149) {
    if ($i -eq 140 -or $i -eq 120) { continue }
    $pulls += Pull $k ('claude/b' + $i) 0
    $k++
}
$pulls = @($pulls[0..128]) + @(Pull 999 'claude/b120' 0)
# Branches the pulls left out past the 129th are stray too; name them so the
# expected set is exact.
$script:Pulls = $pulls
$open = @($script:Pulls | ForEach-Object { $_.head.ref })
$expected = @($script:Branches | ForEach-Object { $_.name } | Where-Object { $_ -ne 'main' -and $open -notcontains $_ })

$found = Find-Stray -Now $now
Yes ('every branch was read, past the first page ({0} of 149)' -f $found.Branches) ($found.Branches -eq 149)
Yes ('every open pull request was read, past the first page ({0} of 130)' -f $found.Pulls) ($found.Pulls -eq 130)
Yes 'the second page of each was asked for' (
    @($script:Asked | Where-Object { $_ -match '/branches\?per_page=100&page=2$' }).Count -eq 1 -and
    @($script:Asked | Where-Object { $_ -match '/pulls\?state=open&per_page=100&page=2$' }).Count -eq 1)
Yes 'a branch on the second page with no pull request is named' ($found.Stray -contains 'claude/b140')
Yes 'a branch whose pull request is on the second page of pulls is not' ($found.Stray -notcontains 'claude/b120')
Yes 'main never is' ($found.Stray -notcontains 'main')
Yes ('and nothing else is named but the branches with no pull request ({0})' -f $expected.Count) (
    (@($found.Stray | Sort-Object) -join ',') -eq (@($expected | Sort-Object) -join ','))

# ---- 2. old pull requests ----------------------------------------------------
$script:Branches = @(Branch 'main'), (Branch 'a'), (Branch 'b')
$script:Pulls = @((Pull 7 'a' 3), (Pull 8 'b' 1))
$found = Find-Stray -Now $now
Yes 'a pull request open three days is named' (@($found.OldPulls | ForEach-Object { $_.number }) -contains 7)
Yes 'one open a day is not' (@($found.OldPulls | ForEach-Object { $_.number }) -notcontains 8)
Yes 'and neither branch is stray, each has its pull request' ($found.Stray.Count -eq 0)

# A pull request held back on purpose carries the held label (#1273): listed,
# not counted. Any other label, or held only in its title, is not held.
$h = Pull 9 'c' 5; $h | Add-Member labels @([pscustomobject]@{ name = 'area: Gamemode' }, [pscustomobject]@{ name = 'held' })
$t = Pull 10 'd' 5; $t.title = 'HELD 1.2.4: work on d'; $t | Add-Member labels @([pscustomobject]@{ name = 'area: Gamemode' })
$script:Branches = @(Branch 'main'), (Branch 'c'), (Branch 'd')
$script:Pulls = @($h, $t)
$found = Find-Stray -Now $now
Yes 'a pull request labelled held is listed as held' (@($found.HeldPulls | ForEach-Object { $_.number }) -contains 9)
Yes '  and is not an old one' (@($found.OldPulls | ForEach-Object { $_.number }) -notcontains 9)
Yes 'one held only in its title is still old' (@($found.OldPulls | ForEach-Object { $_.number }) -contains 10 -and
    @($found.HeldPulls | ForEach-Object { $_.number }) -notcontains 10)

# ---- 3. the run ----------------------------------------------------------------
# The script run as the nightly runs it, in a process of its own, over a
# stand-in that answers one page of the branches named here and no pulls.
$probe = @'
param([string]$ScriptPath, [string]$Names)
$ErrorActionPreference = 'Stop'
# Global, not script: the stand-in is called from inside Nightly-Stray.ps1,
# whose own script scope is the one $script: would read there.
$global:StrayBranches = @($Names -split ',' | ForEach-Object { [pscustomobject]@{ name = $_ } })
function Invoke-RestMethod {
    param([string]$Method = 'GET', $Headers, [string]$Uri)
    $list = @()
    if ($Uri -match '/branches' -and $Uri -match 'page=1$') { $list = $global:StrayBranches }
    Write-Output -NoEnumerate @($list)
}
$env:REPO = 'x/y'; $env:GH_TOKEN = 'not-a-real-token'
& $ScriptPath -Run
exit $LASTEXITCODE
'@
$probeFile = Join-Path ([IO.Path]::GetTempPath()) ('ts-stray-probe-' + [Guid]::NewGuid().ToString('N') + '.ps1')
[IO.File]::WriteAllText($probeFile, $probe)
try {
    $ps = (Get-Process -Id $PID).Path
    $out = & $ps -NoProfile -File $probeFile -ScriptPath $scriptPath -Names 'main' 2>&1 | Out-String
    $code0 = $LASTEXITCODE
    Yes ('a run that names nothing exits 0 and says so (exit {0})' -f $code0) ($code0 -eq 0 -and $out -match 'no stray pull requests or branches')
    $out = & $ps -NoProfile -File $probeFile -ScriptPath $scriptPath -Names 'main,old/thing' 2>&1 | Out-String
    $code1 = $LASTEXITCODE
    Yes ('a run that names a branch exits 1 (exit {0})' -f $code1) ($code1 -eq 1)
    Yes '  with the lines the step always printed' ($out -match '::error::branch old/thing has no open pull request' -and $out -match '0 old pull request\(s\), 1 stray branch\(es\)')
} finally {
    Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
}

# ---- 4. the nightly runs it ------------------------------------------------------
$yml = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $repo '.github') 'workflows') 'nightly.yml'))
$a = $yml.IndexOf('- name: Stray pull requests and branches')
$b = if ($a -ge 0) { $yml.IndexOf('- name:', $a + 10) } else { -1 }
$step = if ($a -ge 0 -and $b -gt $a) { $yml.Substring($a, $b - $a) } else { '' }
Yes 'nightly.yml has its stray step' ($step.Length -gt 0)
Yes 'it runs Nightly-Stray.ps1 -Run with the token and the repository' (
    $step.Contains('.\scripts\dev\Nightly-Stray.ps1 -Run') -and $step.Contains('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}') -and
    $step.Contains('REPO: ${{ github.repository }}'))
Yes 'and the one-page inline reads are gone from it' (-not $step.Contains('per_page=100') -and -not $step.Contains('Invoke-RestMethod'))

Done
