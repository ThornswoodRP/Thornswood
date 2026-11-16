# test-2235-dev-ship-guard.ps1
#
# #2235: Ship -Channel dev checked the checkout with -AnyBranch, then, after
# building, signing and installing the launcher, called Publish-Update, which
# checked without it and refused the same branch as "diverged from
# origin/main". Both now ask Test-FreshAnyBranch (scripts\deploy\
# Fresh-Checkout.ps1) with their -Channel, and Ship hands Publish-Update its
# -AllowStaleCheckout.
#
# A. The rule, against scratch git repos: a bare "origin" in a temp folder and
#    clones of it, so git never leaves this machine. Each case asks the two
#    questions exactly as Ship and Publish-Update now ask them, and they must
#    agree: the reported case (a pushed dev branch behind main), a branch for
#    a main release, a hotfix/ branch, a branch never pushed, a dirty one.
#    The old Publish-Update question is asked too, to show the case it broke.
# B. The scripts: both call Test-FreshAnyBranch with $Channel, Ship asks
#    before it builds anything, and Ship passes -AllowStaleCheckout on.
# Ship and Publish-Update are never run. Runs under Stop, as 5.1 would.
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$env:THORNSWOOD_HARNESS = ''
. (Join-Path $Repo 'scripts\deploy\Fresh-Checkout.ps1')
Yes 'Test-FreshAnyBranch is in Fresh-Checkout.ps1' ([bool](Get-Command Test-FreshAnyBranch -ErrorAction SilentlyContinue))

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-2235-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
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
# The question as each script now asks it, and as Publish-Update used to.
function Ask([string]$dir, [string]$channel, [string]$who) {
    $env:THORNSWOOD_FRESH_CHECKED = ''
    try { Assert-FreshCheckout -RepoDir $dir -What $who -AnyBranch:(Test-FreshAnyBranch -RepoDir $dir -Channel $channel) *> $null; return '' }
    catch { return $_.Exception.Message }
}
function AskOldPublish([string]$dir) {
    $env:THORNSWOOD_FRESH_CHECKED = ''
    try { Assert-FreshCheckout -RepoDir $dir -What 'Publish-Update' *> $null; return '' } catch { return $_.Exception.Message }
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

    # The reported case: a pushed branch with one commit of its own while
    # main moved on by three.
    G $me checkout -q -b claude/generated-source
    Commit $me 'mine.txt'
    G $me push -q -u origin claude/generated-source
    Commit $seed 'b.txt'; Commit $seed 'c.txt'; Commit $seed 'd.txt'; G $seed push -q origin main
    G $me fetch -q origin

    $old = AskOldPublish $me
    Yes "A1 the old Publish-Update question refused the reported case: $old" ($old -match 'diverged from origin/main: 1 commit\(s\) only here and 3 only there')
    $s = Ask $me 'dev' 'Ship'; $p = Ask $me 'dev' 'Publish-Update'
    Yes 'A2 dev from a pushed branch behind main: Ship lets it through' ($s -eq '')
    Yes 'A3 and Publish-Update now agrees' ($p -eq '')
    Yes 'A4 Test-FreshAnyBranch says yes for dev' ((Test-FreshAnyBranch -RepoDir $me -Channel 'dev') -eq $true)

    $s = Ask $me 'main' 'Ship'; $p = Ask $me 'main' 'Publish-Update'
    Yes "A5 a main release from that branch: Ship refuses before building: $s" ($s -match '^Ship refused' -and $s -match 'origin/main')
    Yes 'A6 and Publish-Update would refuse it the same way' ($p -match '^Publish-Update refused' -and $p -match 'origin/main')

    # A hotfix/ branch for a live release.
    G $me checkout -q -b hotfix/door origin/main
    Commit $me 'fix.txt'
    G $me push -q -u origin hotfix/door
    Yes 'A7 Test-FreshAnyBranch says yes for a hotfix/ branch on main' ((Test-FreshAnyBranch -RepoDir $me -Channel 'main') -eq $true)
    $s = Ask $me 'main' 'Ship'; $p = Ask $me 'main' 'Publish-Update'
    Yes 'A8 a live release from a pushed hotfix/ branch: both let it through' ($s -eq '' -and $p -eq '')
    $old = AskOldPublish $me
    Yes "A9 (the old Publish-Update question refused this too: $old)" ($old -match 'ahead of main')

    # main itself.
    G $me checkout -q main
    G $me pull -q origin main
    Yes 'A10 Test-FreshAnyBranch says no for main on main' ((Test-FreshAnyBranch -RepoDir $me -Channel 'main') -eq $false)
    Yes 'A11 a main release from current main: both let it through' ((Ask $me 'main' 'Ship') -eq '' -and (Ask $me 'main' 'Publish-Update') -eq '')
    Yes 'A12 a dev release from current main: both let it through' ((Ask $me 'dev' 'Ship') -eq '' -and (Ask $me 'dev' 'Publish-Update') -eq '')

    # A branch never pushed, and a dirty one: refused at Ship, before anything.
    G $me checkout -q -b dev/never-pushed
    Commit $me 'local.txt'
    $s = Ask $me 'dev' 'Ship'
    Yes "A13 dev from a branch never pushed: Ship refuses first: $s" ($s -match 'origin/dev/never-pushed does not exist')
    Yes 'A14 and Publish-Update would say the same' ((Ask $me 'dev' 'Publish-Update') -match 'does not exist')
    G $me push -q -u origin dev/never-pushed
    Set-Content -LiteralPath (Join-Path $me 'local.txt') -Value 'changed'
    $s = Ask $me 'dev' 'Ship'
    Yes "A15 dev from a dirty pushed branch: Ship refuses first: $s" ($s -match 'uncommitted change')
    Yes 'A16 and Publish-Update agrees' ((Ask $me 'dev' 'Publish-Update') -match 'uncommitted change')
    G $me checkout -q -- local.txt

    # One process, Ship then Publish-Update: the second check is the same
    # question, so it is the cached pass, not a second opinion.
    $env:THORNSWOOD_FRESH_CHECKED = ''
    Assert-FreshCheckout -RepoDir $me -What 'Ship' -AnyBranch:(Test-FreshAnyBranch -RepoDir $me -Channel 'dev') *> $null
    $second = ''; try { Assert-FreshCheckout -RepoDir $me -What 'Publish-Update' -AnyBranch:(Test-FreshAnyBranch -RepoDir $me -Channel 'dev') *> $null } catch { $second = $_.Exception.Message }
    Yes 'A17 Ship then Publish-Update in one run: the second passes on the first one''s answer' ($second -eq '')
} finally {
    $env:THORNSWOOD_FRESH_CHECKED = ''
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# B. The scripts.
$ship = (Get-Content -Raw (Join-Path $Repo 'scripts\release\Ship.ps1')) -replace "`r", ''
$pub = (Get-Content -Raw (Join-Path $Repo 'scripts\release\Publish-Update.ps1')) -replace "`r", ''
$q = "Assert-FreshCheckout -RepoDir `$freshRepo -What '{0}' -AnyBranch:(Test-FreshAnyBranch -RepoDir `$freshRepo -Channel `$Channel) -AllowStale:`$AllowStaleCheckout"
Yes 'B1 Ship asks Test-FreshAnyBranch with its -Channel' ($ship.Contains(($q -f 'Ship')))
Yes 'B2 Publish-Update asks the same, with its -Channel' ($pub.Contains(($q -f 'Publish-Update')))
Yes 'B3 neither asks with a bare -AnyBranch any more' (-not ($ship -match "Assert-FreshCheckout[^\n]*-AnyBranch(\s|$)") -and -not ($pub -match "Assert-FreshCheckout[^\n]*-AnyBranch(\s|$)"))
$askAt = $ship.IndexOf(($q -f 'Ship'))
$buildAt = $ship.IndexOf("& (Join-Path `$Here 'Publish-Update.ps1') @pubArgs")
Yes 'B4 Ship asks before it calls Publish-Update (and so before it builds)' ($askAt -gt 0 -and $buildAt -gt $askAt)
Yes 'B5 Ship passes -AllowStaleCheckout on to Publish-Update' ($ship.Contains("if (`$AllowStaleCheckout) { `$pubArgs['AllowStaleCheckout'] = `$true }"))
Yes 'B6 and hands it -Channel dev for a dev release' ($ship.Contains("if (`$Dev) { `$pubArgs['Channel'] = 'dev'"))

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
