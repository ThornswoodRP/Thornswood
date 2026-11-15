<#
  test-reset-history.ps1

  scripts\oneoff\Reset-History.ps1 run for real against a scratch repository:
  a bare "origin" with main, the hotfix branch and two old branches, and a
  clone of it standing for Patrick's checkout. gh is a stand-in that answers
  what GitHub would and writes down every call.

  WHY THIS EXISTS. The reset cannot be undone on GitHub (issue #567), so it is
  proved here first: the new main has main's files and no parent, the hotfix
  keeps its files, the other branches go, force pushes are turned on only for
  the one push and read back off, the rest of branch protection is written
  back as it was, the bundle holds the old history, and every refusal
  (a dry run, an open pull request, an uncommitted change) changes nothing.

  NEVER CONNECTS. git talks only to the scratch origin on disk, and gh is a
  PowerShell function here, so nothing reaches GitHub.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$script = Join-Path $Here '..\..\scripts\oneoff\Reset-History.ps1'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')   # $OnWindows (#2957)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function G { $o = & git @args 2>&1; if ($LASTEXITCODE -ne 0) { throw ('git ' + ($args -join ' ') + ': ' + ($o | Out-String)) }; ($o | Out-String).Trim() }

# The stand-in for gh. $global:TsGh holds what it answers and what it was asked.
function global:gh {
    $a = @($args)
    $line = $a -join ' '
    $global:TsGh.Calls += $line
    $global:LASTEXITCODE = 0
    if ($line -like 'auth status*') { return }
    if ($line -like 'pr list*') { return [string]$global:TsGh.Open }
    if ($line -like 'api -X PUT *') {
        $body = (@($input) -join '') | ConvertFrom-Json
        $global:TsGh.Puts += ,$body
        $global:TsGh.Force = [bool]$body.allow_force_pushes
        return '{}'
    }
    if ($line -like 'api -X PATCH *') { $global:TsGh.Patch += $line; return '{}' }
    if ($line -like 'api repos/*/branches/main/protection --jq*') { return ([string]$global:TsGh.Force).ToLower() }
    if ($line -like 'api repos/*/branches/main/protection') {
        return '{"required_pull_request_reviews":{"dismiss_stale_reviews":false,"require_code_owner_reviews":false,"require_last_push_approval":false,"required_approving_review_count":0},"enforce_admins":{"enabled":false},"required_linear_history":{"enabled":false},"allow_force_pushes":{"enabled":false},"allow_deletions":{"enabled":false},"block_creations":{"enabled":false},"required_conversation_resolution":{"enabled":false},"lock_branch":{"enabled":false},"allow_fork_syncing":{"enabled":false}}'
    }
    $global:LASTEXITCODE = 9
    return "UNEXPECTED gh $line"
}

function New-World {
    $w = Join-Path ([IO.Path]::GetTempPath()) ('ts-reset-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $w | Out-Null
    $origin = Join-Path $w 'origin.git'
    $seed = Join-Path $w 'seed'
    G init -q --bare -b main $origin | Out-Null
    G init -q -b main $seed | Out-Null
    Push-Location $seed
    try {
        G config user.email t@t | Out-Null; G config user.name t | Out-Null
        New-Item -ItemType Directory -Path (Join-Path 'scripts' 'oneoff') -Force | Out-Null
        Copy-Item -LiteralPath $script -Destination (Join-Path (Join-Path 'scripts' 'oneoff') 'Reset-History.ps1')
        Set-Content -Path 'a.txt' -Value 'one'
        G add -A | Out-Null; G commit -q -m 'first' | Out-Null
        Set-Content -Path 'a.txt' -Value 'two'
        G commit -q -am 'second, with a secret that must go' | Out-Null
        G checkout -q -b hotfix/1.1.94-downgrade | Out-Null
        Set-Content -Path 'hot.txt' -Value 'the live build'
        G add -A | Out-Null; G commit -q -m 'hotfix' | Out-Null
        G checkout -q main | Out-Null
        G checkout -q -b claude/old | Out-Null; Set-Content -Path 'b.txt' -Value 'b'; G add -A | Out-Null; G commit -q -m 'old' | Out-Null
        G checkout -q -b patrick/older main | Out-Null; Set-Content -Path 'c.txt' -Value 'c'; G add -A | Out-Null; G commit -q -m 'older' | Out-Null
        G checkout -q main | Out-Null
        G remote add origin $origin | Out-Null
        G push -q origin main hotfix/1.1.94-downgrade claude/old patrick/older | Out-Null
    } finally { Pop-Location }
    $clone = Join-Path $w 'patrick'
    G clone -q $origin $clone | Out-Null
    Push-Location $clone; G config user.email t@t | Out-Null; G config user.name t | Out-Null; Pop-Location
    $bundles = Join-Path $w 'home'
    New-Item -ItemType Directory -Path $bundles | Out-Null
    $global:TsGh = @{ Calls = @(); Puts = @(); Patch = @(); Open = 0; Force = $false }
    return @{ Dir = $w; Origin = $origin; Clone = $clone; Home = $bundles }
}
function Heads($origin) { @(G --git-dir $origin for-each-ref --format '%(refname:short)=%(objectname)' refs/heads) -split "`n" | Sort-Object }
function Run($w, [hashtable]$extra) {
    Push-Location $w.Clone
    try { $out = & (Join-Path (Join-Path (Join-Path $w.Clone 'scripts') 'oneoff') 'Reset-History.ps1') -BundleDir $w.Home @extra *>&1 | Out-String; $code = $LASTEXITCODE }
    finally { Pop-Location }
    return @{ Out = $out; Code = $code }
}

$worlds = @()
try {
    # ---- a dry run changes nothing ---------------------------------------
    $w = New-World; $worlds += $w
    $before = Heads $w.Origin
    $r = Run $w @{ DryRun = $true }
    Yes 'a dry run finishes' ($r.Code -eq 0 -and $r.Out -match 'Dry run finished')
    Yes '  and names the branches it would delete' ($r.Out -match 'claude/old' -and $r.Out -match 'patrick/older')
    Yes '  and leaves every branch on the origin as it was' ((Heads $w.Origin) -join ',' -eq ($before -join ','))
    Yes '  writes no bundle' (@(Get-ChildItem $w.Home).Count -eq 0)
    Yes '  and never touches branch protection' ($global:TsGh.Puts.Count -eq 0)

    # ---- an open pull request stops it -----------------------------------
    $w = New-World; $worlds += $w
    $global:TsGh.Open = 1
    $before = Heads $w.Origin
    $r = Run $w @{ Yes = $true }
    Yes 'an open pull request stops it' ($r.Code -eq 1 -and $r.Out -match 'pull request\(s\) are open')
    Yes '  with the origin untouched and no bundle' ((Heads $w.Origin) -join ',' -eq ($before -join ',') -and @(Get-ChildItem $w.Home).Count -eq 0)

    # ---- an uncommitted change stops it ----------------------------------
    $w = New-World; $worlds += $w
    Set-Content -Path (Join-Path $w.Clone 'a.txt') -Value 'edited'
    $before = Heads $w.Origin
    $r = Run $w @{ Yes = $true }
    Yes 'an uncommitted change to a tracked file stops it' ($r.Code -eq 1 -and $r.Out -match 'not committed')
    Yes '  with the origin untouched' ((Heads $w.Origin) -join ',' -eq ($before -join ','))

    # ---- a refused push still turns force pushes off --------------------
    $w = New-World; $worlds += $w
    $hook = Join-Path (Join-Path $w.Origin 'hooks') 'pre-receive'
    Set-Content -LiteralPath $hook -Value "#!/bin/sh`necho refused by the test >&2`nexit 1" -NoNewline
    if (-not $OnWindows) { & chmod +x $hook }
    $before = Heads $w.Origin
    $r = Run $w @{ Yes = $true }
    Yes 'a push GitHub refuses stops it' ($r.Code -ne 0)
    Yes '  and force pushes were still turned off again' ($global:TsGh.Puts.Count -eq 2 -and $global:TsGh.Puts[1].allow_force_pushes -eq $false)
    Yes '  and no branch was deleted' ((Heads $w.Origin) -join ',' -eq ($before -join ','))

    # ---- the real run ----------------------------------------------------
    $w = New-World; $worlds += $w
    $oldMain = G --git-dir $w.Origin rev-parse main
    $oldMainTree = G --git-dir $w.Origin rev-parse 'main^{tree}'
    $oldHotTree = G --git-dir $w.Origin rev-parse 'hotfix/1.1.94-downgrade^{tree}'
    $r = Run $w @{ Yes = $true }
    Yes 'the real run finishes' ($r.Code -eq 0 -and $r.Out -match 'Done\.')
    $newMain = G --git-dir $w.Origin rev-parse main
    Yes 'main on the origin is a new commit' ($newMain -ne $oldMain)
    Yes '  with no parent' ((G --git-dir $w.Origin rev-list --count main) -eq '1')
    Yes '  and exactly the old tree' ((G --git-dir $w.Origin rev-parse 'main^{tree}') -eq $oldMainTree)
    Yes 'the hotfix branch is one commit with its own tree' ((G --git-dir $w.Origin rev-list --count hotfix/1.1.94-downgrade) -eq '1' -and (G --git-dir $w.Origin rev-parse 'hotfix/1.1.94-downgrade^{tree}') -eq $oldHotTree)
    $names = (Heads $w.Origin | ForEach-Object { ($_ -split '=')[0] }) -join ','
    Yes "only main and the hotfix are left on the origin ($names)" ($names -eq 'hotfix/1.1.94-downgrade,main')
    Yes 'force pushes were turned on, then off, and nothing else' ($global:TsGh.Puts.Count -eq 2 -and $global:TsGh.Puts[0].allow_force_pushes -eq $true -and $global:TsGh.Puts[1].allow_force_pushes -eq $false)
    $p = $global:TsGh.Puts[1]
    Yes '  the rest of branch protection is written back as it was read' ($p.enforce_admins -eq $false -and $p.required_pull_request_reviews.required_approving_review_count -eq 0 -and $p.required_pull_request_reviews.require_code_owner_reviews -eq $false -and $null -eq $p.required_status_checks -and $p.allow_deletions -eq $false)
    Yes '"Automatically delete head branches" is turned on' (@($global:TsGh.Patch | Where-Object { $_ -match 'delete_branch_on_merge=true' }).Count -eq 1)
    $bundle = @(Get-ChildItem $w.Home -Filter '*.bundle')
    Yes 'a bundle of the old history was written' ($bundle.Count -eq 1)
    if ($bundle.Count -eq 1) {
        $refs = G bundle list-heads $bundle[0].FullName
        Yes '  and it holds the old main and the old branches' ($refs -match $oldMain -and $refs -match 'claude/old' -and $refs -match 'patrick/older')
    }
    Yes 'the checkout is on the new main' ((G -C $w.Clone rev-parse HEAD) -eq $newMain)
    Yes '  with the same files' ((Get-Content (Join-Path $w.Clone 'a.txt')) -eq 'two')
}
finally {
    Remove-Item -Path function:global:gh -ErrorAction SilentlyContinue
    Remove-Variable -Name TsGh -Scope Global -ErrorAction SilentlyContinue
    foreach ($w in $worlds) { Remove-Item -LiteralPath $w.Dir -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
