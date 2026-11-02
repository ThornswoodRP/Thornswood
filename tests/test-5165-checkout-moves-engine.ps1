<#
  test-5165-checkout-moves-engine.ps1

      pwsh -NoProfile -File .\tests\test-5165-checkout-moves-engine.ps1

  Issue #5165. The gate broker moved its checkout to main with git checkout
  and never moved engine\skymp, because a checkout moves a submodule only
  when told to. After #5162 moved the pin, every gate verb refused: "engine/
  skymp is at b21c4eb9, not the befb8364 this commit pins". Since #5148 the
  pin moves by itself whenever the fork merges, so a script that moves a
  long-lived checkout and leaves its submodules behind breaks at every pin.

  This checks every script and workflow that runs git (scripts, bot, site,
  voice, .github\workflows; not tests, which plant their own). A file that
  moves a checkout (git checkout, switch or reset with --detach, --hard or
  origin/main, in a command line or as an argument list) must also bring its
  submodules along (git submodule update), unless:
    - it is a workflow whose actions/checkout says submodules: false, so the
      runner's fresh checkout has no submodule fetched to be left behind; or
    - it is one of the files named in $Exempt below, each with its reason.
  scripts\release\Update-Checkout.ps1 is the one way a person or a lane moves
  a shared clone (#2981). It brings the submodules itself and passes as
  written.

  It also checks the rule over planted files: a broker like the one before
  #5166 is named, the same with submodule update passes, and a workflow
  passes with submodules: false and is named without it.
  Read only, apart from the planted folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# Files that move a checkout and need not move its submodules, with why.
$Exempt = [ordered]@{
    'scripts/dev/Trace-HarnessReads.js' = 'checks out a clone it made itself a moment before, whose submodules it never fetches'
    'scripts/oneoff/Reset-History.ps1'  = 'only tells people what to run after the history rewrite, which keeps every pin as it was'
    'scripts/release/Ship-OnBox.ps1'    = 'puts the gate''s checkout on the branch main at the commit GateBroker.ps1 has just moved it to, submodules and all'
    'scripts/release/Update-EnginePin.ps1' = 'names git switch only in its example, and then moves engine\skymp to the new pin itself'
}

$move = [regex]'(?im)\bgit\b[^\r\n]*\b(checkout|switch|reset)\b[^\r\n]*(--detach|--hard|origin/main)|[''"](checkout|switch|reset)[''"][^\r\n]*[''"](--detach|--hard)[''"]'
$sub = [regex]'(?i)submodule[''"\s,]+update'
$noSub = [regex]'(?im)^\s*submodules:\s*[''"]?false[''"]?\s*$'

# What is wrong with one file, or '' when nothing is.
function Get-Fault([string]$rel, [string]$text) {
    if (-not $move.IsMatch($text)) { return '' }
    if ($sub.IsMatch($text)) { return '' }
    if ($rel -match '\.ya?ml$' -and $noSub.IsMatch($text)) { return '' }
    if ($Exempt.Contains($rel)) { return '' }
    $line = ($text.Substring(0, $move.Match($text).Index) -split "`n").Count
    return ('{0}:{1} moves a checkout and leaves its submodules where they were (add git submodule update --checkout, or move it with Update-Checkout.ps1)' -f $rel, $line)
}

# ---- 1. the rule, over planted files --------------------------------------
$before = @'
foreach ($step in @(
    @('-C', $Repo, 'fetch', '--quiet', '--depth', '1', 'origin', '+refs/heads/main:refs/remotes/origin/main'),
    @('-C', $Repo, 'checkout', '--quiet', '--force', '--detach', 'refs/remotes/origin/main'),
    @('-C', $Repo, 'clean', '-ffdxq'))) { }
'@
$after = $before.Replace("'clean', '-ffdxq'))", "'clean', '-ffdxq'),`n    @('-C', `$Repo, 'submodule', 'update', '--checkout', '--force', '--depth', '1'))")
$flowNo = "steps:`n  - uses: actions/checkout@x`n    with:`n      submodules: false`n  - run: git checkout --force --detach origin/main`n"
$flowYes = $flowNo.Replace('submodules: false', 'submodules: true')
Yes '1. the gate broker as it was before #5166 is named' ((Get-Fault 'scripts/vps/gate/GateBroker.ps1' $before) -match 'GateBroker\.ps1:3 moves a checkout')
Yes '1. the same broker with git submodule update passes' ((Get-Fault 'scripts/vps/gate/GateBroker.ps1' $after) -eq '')
Yes '1. a git command line that resets to origin/main is named' ((Get-Fault 'scripts/x.ps1' "git -C `$r reset --hard origin/main`n") -ne '')
Yes '1. a workflow whose checkout fetches no submodule passes' ((Get-Fault '.github/workflows/x.yml' $flowNo) -eq '')
Yes '1. the same workflow with submodules: true is named' ((Get-Fault '.github/workflows/x.yml' $flowYes) -ne '')
Yes '1. a file that never moves a checkout passes' ((Get-Fault 'scripts/x.ps1' "git -C `$r fetch origin main`n") -eq '')

# ---- 2. the repository ------------------------------------------------------
$roots = @('scripts', 'bot', 'site', 'voice', '.github/workflows')
$exts = @('.ps1', '.psm1', '.js', '.py', '.sh', '.yml', '.yaml')
$faults = New-Object System.Collections.Generic.List[string]
$moving = New-Object System.Collections.Generic.List[string]
foreach ($r in $roots) {
    $dir = Join-Path $Repo $r
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Recurse -File | Where-Object { $exts -contains $_.Extension.ToLowerInvariant() -and $_.FullName -notmatch '[\\/]node_modules[\\/]' })) {
        $rel = $f.FullName.Substring($Repo.Length + 1).Replace('\', '/')
        $text = [IO.File]::ReadAllText($f.FullName)
        if ($move.IsMatch($text)) { $moving.Add($rel) }
        $fault = Get-Fault $rel $text
        if ($fault) { $faults.Add($fault) }
    }
}
Yes ('2. the gate broker and Update-Checkout.ps1 are among the files that move a checkout (' + $moving.Count + ' in all)') (
    $moving.Contains('scripts/vps/gate/GateBroker.ps1') -and $moving.Contains('scripts/release/Update-Checkout.ps1'))
foreach ($f in $faults) { Write-Host "      $f" }
Yes '2. every script and workflow that moves a checkout brings its submodules along' ($faults.Count -eq 0)
foreach ($k in $Exempt.Keys) {
    Yes ("2. $k, exempt because it " + $Exempt[$k] + ', is still there and still moves one') (
        (Test-Path -LiteralPath (Join-Path $Repo $k)) -and $moving.Contains($k))
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
