# test-fresh-checkout.ps1
#
# Deploy and ship scripts refuse a stale or dirty checkout (#2118).
# Builds scratch git repos in a temp folder (a bare "origin" and clones of it)
# and runs scripts\deploy\Fresh-Checkout.ps1 against each state: current,
# behind, ahead, diverged, dirty, not a repo, a branch with -AnyBranch, and
# the -AllowStale override. Then checks each deploy and ship script calls it.
# Runs under Stop on purpose, which is where Windows PowerShell 5.1 turns
# git's stderr into a halt. No network, nothing outside its temp folder.
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$lib = Join-Path $Repo 'scripts\deploy\Fresh-Checkout.ps1'
Yes 'scripts\deploy\Fresh-Checkout.ps1 exists' (Test-Path $lib)
if (-not (Test-Path $lib)) { Write-Host ''; Write-Host "$pass passed, $fail failed"; exit 1 }
. $lib

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('fresh-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $tmp | Out-Null
function G([string]$dir) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & git -C $dir @args 2>&1 | Out-Null
    $c = $LASTEXITCODE; $ErrorActionPreference = $old
    if ($c -ne 0) { throw "git $($args -join ' ') failed in $dir ($c)" }
}
function Commit([string]$dir, [string]$name) {
    Set-Content -LiteralPath (Join-Path $dir $name) -Value $name
    G $dir add -- $name
    G $dir -c user.name=t -c user.email=t@t commit -q -m $name
}
function Refusal([string]$dir, [hashtable]$more = @{}) {
    $env:THORNSWOOD_FRESH_CHECKED = ''
    try { Assert-FreshCheckout -RepoDir $dir -What 'Deploy-Test' @more *> $null; return '' } catch { return $_.Exception.Message }
}
try {
    $origin = Join-Path $tmp 'origin.git'
    G $tmp init -q --bare -b main $origin
    $seed = Join-Path $tmp 'seed'
    G $tmp clone -q $origin $seed
    G $seed checkout -q -b main
    Commit $seed 'a.txt'
    G $seed push -q origin main
    $me = Join-Path $tmp 'me'
    G $tmp clone -q $origin $me

    Yes 'a1: current and clean passes' ((Refusal $me) -eq '')
    $s = Get-FreshCheckoutState -RepoDir $me
    Yes 'a2: and the state says so' ($s.Ok -and $s.Behind -eq 0 -and $s.Ahead -eq 0 -and $s.Dirty -eq 0)

    Commit $seed 'b.txt'; Commit $seed 'c.txt'; G $seed push -q origin main
    $m = Refusal $me
    Yes "b1: two commits behind is refused with the words asked for: $m" ($m -match 'checkout is behind main by 2 commit\(s\), run git pull')
    Yes 'b2: and names who refused and that nothing went' ($m -match '^Deploy-Test refused' -and $m -match 'Nothing was sent')
    G $me pull -q origin main
    Yes 'b3: after git pull it passes' ((Refusal $me) -eq '')

    Commit $me 'mine.txt'
    $m = Refusal $me
    Yes "c1: a local commit not on GitHub is refused as ahead: $m" ($m -match 'ahead of main by 1 commit')

    Commit $seed 'd.txt'; G $seed push -q origin main
    $m = Refusal $me
    Yes "d1: both is refused as diverged: $m" ($m -match 'diverged from origin/main: 1 commit\(s\) only here and 1 only there')

    G $me reset -q --hard origin/main
    Add-Content -LiteralPath (Join-Path $me 'a.txt') -Value 'edit'
    $m = Refusal $me
    Yes "e1: a changed tracked file is refused as dirty: $m" ($m -match '1 uncommitted change')
    Set-Content -LiteralPath (Join-Path $me 'loose.txt') -Value 'x'
    G $me checkout -q -- a.txt
    Yes 'e2: an untracked file alone is not dirty' ((Refusal $me) -eq '')
    Remove-Item -LiteralPath (Join-Path $me 'loose.txt')

    $plain = Join-Path $tmp 'plain'; New-Item -ItemType Directory $plain | Out-Null
    $m = Refusal $plain
    Yes "f1: a folder that is not a git checkout is refused: $m" ($m -match 'is not a git checkout')

    G $me checkout -q -b dev/try
    Commit $me 'try.txt'
    $m = Refusal $me @{ AnyBranch = $true }
    Yes "g1: a branch never pushed is refused with -AnyBranch: $m" ($m -match 'origin/dev/try does not exist')
    G $me push -q origin dev/try
    Yes 'g2: once pushed, -AnyBranch passes on it' ((Refusal $me @{ AnyBranch = $true }) -eq '')
    $m = Refusal $me
    Yes "g3: without -AnyBranch the same branch is held to main: $m" ($m -match 'ahead of main')
    G $me checkout -q main

    Commit $seed 'e.txt'; G $seed push -q origin main
    $env:THORNSWOOD_FRESH_CHECKED = ''
    $said = & { Assert-FreshCheckout -RepoDir $me -What 'Deploy-Test' -AllowStale } *>&1 | Out-String
    Yes 'h1: -AllowStale goes ahead behind main, with the banner' ($said -match 'AllowStaleCheckout: GOING AHEAD' -and $said -match 'behind main by 1')

    G $me pull -q origin main
    $env:THORNSWOOD_FRESH_CHECKED = ''
    Assert-FreshCheckout -RepoDir $me -What 'x' *> $null
    $saved = $env:THORNSWOOD_FRESH_CHECKED
    Remove-Item -Recurse -Force $origin
    $again = ''
    try { Assert-FreshCheckout -RepoDir $me -What 'x' *> $null } catch { $again = $_.Exception.Message }
    Yes 'i1: a second call at the same commit in one run does not fetch again' ($saved -and $again -eq '')
    $env:THORNSWOOD_FRESH_CHECKED = ''
    $m = Refusal $me
    Yes "i2: a fetch that fails is a refusal, judged by exit code under Stop: $m" ($m -match 'could not fetch origin/main')
} finally {
    $env:THORNSWOOD_FRESH_CHECKED = ''
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# ------------------------------------------- the harness stand-in only ---
# Skipped only when THORNSWOOD_HARNESS is 1 AND the box is harness.invalid.
$keepH = $env:THORNSWOOD_HARNESS; $keepV = $env:THORNSWOOD_VPS
try {
    $env:THORNSWOOD_HARNESS = ''; $env:THORNSWOOD_VPS = ''
    Yes 'j1: the stand-in boxes are harness.invalid and loopback only' ((@($script:FreshHarnessHosts) -join ',') -eq 'harness.invalid,127.0.0.1,::1,localhost')
    Yes 'j2: harness.invalid without THORNSWOOD_HARNESS=1 is not the stand-in' (-not (Test-FreshHarnessStandIn 'harness.invalid'))
    $env:THORNSWOOD_HARNESS = '1'
    Yes 'j3: THORNSWOOD_HARNESS=1 with no box named is not the stand-in' (-not (Test-FreshHarnessStandIn ''))
    Yes 'j4: both together is the stand-in' (Test-FreshHarnessStandIn 'harness.invalid')
    $env:THORNSWOOD_VPS = 'harness.invalid'
    Yes 'j5: so is THORNSWOOD_VPS=harness.invalid for a script that takes no -Vps' (Test-FreshHarnessStandIn '')
    Yes 'j6: but an explicit real -Vps wins over it' (-not (Test-FreshHarnessStandIn ([string](Get-Content (Join-Path $PSScriptRoot '..\scripts\vps\vps.json') -Raw | ConvertFrom-Json).address)))
    $plainDir = Join-Path ([IO.Path]::GetTempPath()) ('fresh-plain-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
    New-Item -ItemType Directory $plainDir | Out-Null
    $m = ''; try { Assert-FreshCheckout -RepoDir $plainDir -What 'x' -Target 'harness.invalid' *> $null } catch { $m = $_.Exception.Message }
    Yes 'j7: the stand-in goes through even from a folder that is no checkout' ($m -eq '')
    Remove-Item -Recurse -Force $plainDir

    # The live and dev boxes can never be the stand-in: every host vps.json,
    # this machine's own file and the scripts name, with the flag on.
    $vj = Get-Content -Raw (Join-Path $Repo 'scripts\vps\vps.json') | ConvertFrom-Json
    $hosts = @([string]$vj.address)
    # Where Vps.ps1 keeps it; '' when this machine has no place for one.
    . (Join-Path $Repo 'scripts\vps\Vps.ps1')
    $local = Get-ThornswoodVpsLocalPath
    if ($local -and (Test-Path -LiteralPath $local)) { try { $hosts += [string](Get-Content -Raw $local | ConvertFrom-Json).address } catch { } }
    $scan = Get-ChildItem (Join-Path $Repo 'scripts') -Recurse -Include *.ps1, *.json | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }
    foreach ($s in $scan) {
        foreach ($mm in [regex]::Matches([string]$s, '\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:net|com|org|io|gg|invalid)\b')) { $hosts += $mm.Value }
    }
    $hosts = @($hosts | Where-Object { $_ } | Sort-Object -Unique)
    $env:THORNSWOOD_VPS = ''
    $hit = @($hosts | Where-Object { $script:FreshHarnessHosts -notcontains $_ -and (Test-FreshHarnessStandIn $_) })
    Yes "j8: none of the $($hosts.Count) hosts the scripts name, live and dev box included, is the stand-in" ($hit.Count -eq 0 -and $hosts -contains [string]$vj.address)
    Yes 'j9: vps.json, the live and dev box, is not a stand-in box' ($script:FreshHarnessHosts -notcontains ([string]$vj.address).ToLowerInvariant())
    Yes 'j10: and is not loopback or .invalid' (-not ([string]$vj.address).EndsWith('.invalid') -and -not ([string]$vj.address).StartsWith('127.'))
    $env:THORNSWOOD_VPS = ''
    Yes 'j11: a loopback box with the flag is the stand-in' (Test-FreshHarnessStandIn '127.0.0.1')
    $env:THORNSWOOD_HARNESS = ''
    Yes 'j12: and without the flag it is not' (-not (Test-FreshHarnessStandIn '127.0.0.1'))
} finally { $env:THORNSWOOD_HARNESS = $keepH; $env:THORNSWOOD_VPS = $keepV }
# Every script that sends to the VPS or ships calls it, near the top, and
# offers the loud override. The old installer's Package-Thornswood.ps1 and
# Publish-Installer.ps1 were on this list until they went in #4824.
$callers = @(
    @{ f = 'scripts\deploy\Deploy-Docs.ps1' }, @{ f = 'scripts\deploy\Deploy-DevGamemode.ps1' },
    @{ f = 'scripts\deploy\Deploy-Server.ps1' }, @{ f = 'scripts\release\Ship.ps1' },
    @{ f = 'scripts\release\Publish-Server.ps1' },
    @{ f = 'scripts\release\Publish-Update.ps1' }, @{ f = 'scripts\release\Publish-Pack.ps1' }
)
foreach ($c in $callers) {
    $p = Join-Path $Repo $c.f
    $src = Get-Content -Raw -LiteralPath $p
    $tok = $null; $err = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tok, [ref]$err)
    $hasParam = $ast.ParamBlock -and @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'AllowStaleCheckout' }).Count -eq 1
    Yes "$($c.f) takes -AllowStaleCheckout" $hasParam
    Yes "$($c.f) calls Assert-FreshCheckout with it" ($src -match 'Assert-FreshCheckout\b[^\r\n]*-AllowStale:\$AllowStaleCheckout')
}

Write-Host ''
Write-Host "$pass passed, $fail failed"
exit ([int]($fail -gt 0))