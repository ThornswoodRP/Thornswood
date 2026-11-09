<#
  test-4322-pull-tables.ps1

      pwsh -NoProfile -File .\tests\test-4322-pull-tables.ps1

  #4322. scripts\mods\Rebuild-PullTables.ps1 rebuilds a pull request's
  content tables on the box through Box-Run.ps1 and commits them back to its
  branch. This runs it in a scratch repository with a bare origin, a stand-in
  gh that answers for the pull request and a stand-in Box-Run.ps1 that
  writes a run's output and files where the real one does, and checks:
    - the tables land on the branch as one commit on the pull request's head,
      and the gate line names the pull request and that head;
    - -Server main and -Stations reach the line;
    - -Run reads a run again instead of starting one;
    - it starts nothing when the checkout is not at the head, has
      uncommitted changes, or the pull request is from another repository
      or closed;
    - it commits nothing when the run ended non-zero, its output names
      another head, or it sent back a file the box may not;
    - a run that changed nothing commits nothing.
  Needs git on the path; prints SKIP without it. No network.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
if (-not (Get-Command git -CommandType Application -ErrorAction SilentlyContinue)) {
    Write-Host 'SKIP  Rebuild-PullTables.ps1 needs git on the path, and this machine has none'
    Write-Host ''
    Write-Host '0 passed, 0 failed'
    exit 0
}

$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$root, [string]$rel, [string]$text) {
    $f = Join-Path $root $rel
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $f))
    [IO.File]::WriteAllText($f, $text, $utf8)
}
function G([string]$dir, [string[]]$words) {
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& git -C $dir @words 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $was }
    return (($o -join "`n").Trim())
}
$shell = (Get-Process -Id $PID).Path

# A stand-in gh: pr view prints the pull request from pr.json beside it.
$fakeGh = @'
if ($args[0] -ne 'pr' -or $args[1] -ne 'view') { Write-Output "unexpected gh $args"; exit 2 }
Write-Output ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'pr.json')))
exit 0
'@
# A stand-in Box-Run.ps1: records how it was called, then writes the run's
# output.txt and files under the scratch root, as the real one does once a
# run's seal is opened, from box.json beside it.
$fakeBox = @'
param([string]$Line = '', [long]$Run = 0)
$cfg = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'box.json')) | ConvertFrom-Json
[IO.File]::AppendAllText((Join-Path $PSScriptRoot 'calls.log'), $(if ($Run) { "RUN $Run" } else { "LINE $Line" }) + "`n")
$id = if ($Run) { $Run } else { [long]$cfg.run }
$dir = Join-Path (Join-Path $env:THORNSWOOD_SCRATCH_ROOT 'box-run') "$id"
[void][IO.Directory]::CreateDirectory((Join-Path $dir 'files'))
[IO.File]::WriteAllText((Join-Path $dir 'output.txt'), [string]$cfg.output)
foreach ($p in $cfg.files.PSObject.Properties) {
    $f = Join-Path (Join-Path $dir 'files') $p.Name
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $f))
    [IO.File]::WriteAllText($f, [string]$p.Value)
}
if (-not $Run) { Write-Host "  run $id, https://example.invalid/runs/$id" }
Write-Host "  ENDED $($cfg.code) Rebuild-ContentTables"
exit ([int]$cfg.code)
'@
$chain = '{ "steps": [ { "tool": "scripts/dev/Build-RecipeTable.ps1", "writes": ["game/data/recipes.json", "tests/fixtures/merchant-retrieval-records.json"] } ] }'

# A repository on branch wisp/x with one commit, pushed to a bare origin,
# and the stand-ins in a folder of their own.
function New-Sandbox {
    $top = Join-Path ([IO.Path]::GetTempPath()) ('ts-4322-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $root = Join-Path $top 'work'
    $origin = Join-Path $top 'origin.git'
    $fakes = Join-Path $top 'fakes'
    Put $root 'scripts/mods/Rebuild-PullTables.ps1' ([IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/Rebuild-PullTables.ps1')))
    Put $root 'scripts/release/Get-ScratchDir.ps1' ([IO.File]::ReadAllText((Join-Path $Repo 'scripts/release/Get-ScratchDir.ps1')))
    Put $root 'scripts/mods/content-tables.json' $chain
    Put $root 'game/data/recipes.json' "{`"old`":true}`n"
    Put $root '.gitignore' "temp/`n"
    Put $fakes 'gh.ps1' $fakeGh
    Put $fakes 'Box-Run.ps1' $fakeBox
    [void](G $top @('init', '--quiet', '--bare', $origin))
    [void](G $root @('init', '--quiet'))
    [void](G $root @('config', 'user.name', 'Test'))
    [void](G $root @('config', 'user.email', 'test@example.invalid'))
    [void](G $root @('checkout', '--quiet', '-b', 'wisp/x'))
    [void](G $root @('add', '--all'))
    [void](G $root @('commit', '--quiet', '-m', 'start'))
    [void](G $root @('remote', 'add', 'origin', $origin))
    [void](G $root @('push', '--quiet', 'origin', 'HEAD:refs/heads/wisp/x'))
    $head = G $root @('rev-parse', 'HEAD')
    return [pscustomobject]@{ Top = $top; Root = $root; Origin = $origin; Fakes = $fakes; Head = $head }
}
function Set-Pr($s, [string]$head, [string]$state = 'OPEN', [bool]$cross = $false) {
    Put $s.Fakes 'pr.json' (@{ headRefOid = $head; headRefName = 'wisp/x'; state = $state; isCrossRepository = $cross } | ConvertTo-Json)
}
function Set-Box($s, [int]$code, [string]$output, [hashtable]$files, [long]$run = 4242) {
    Put $s.Fakes 'box.json' (@{ run = $run; code = $code; output = $output; files = $files } | ConvertTo-Json -Depth 4)
}
function Invoke-Pull($s, [string[]]$more = @()) {
    $env:THORNSWOOD_SCRATCH_ROOT = Join-Path $s.Root 'temp'
    $args2 = @('-NoProfile', '-File', (Join-Path $s.Root 'scripts/mods/Rebuild-PullTables.ps1'), '-Pull', '7',
               '-Gh', (Join-Path $s.Fakes 'gh.ps1'), '-BoxRun', (Join-Path $s.Fakes 'Box-Run.ps1')) + $more
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = @(& $shell @args2 2>&1 | ForEach-Object { "$_" }) -join "`n" } finally { $ErrorActionPreference = $was }
    $code = $LASTEXITCODE
    Remove-Item Env:\THORNSWOOD_SCRATCH_ROOT -ErrorAction SilentlyContinue
    $log = Join-Path $s.Fakes 'calls.log'
    $calls = if (Test-Path -LiteralPath $log) { @(Get-Content -LiteralPath $log) } else { @() }
    return [pscustomobject]@{ Code = $code; Out = $out; Calls = $calls }
}
function Said([string]$pull, [string]$head) { "main's builders read, from pull request $pull at $head`: game/content/Thornswood-Content.esp`n" }
$new = "{`"new`":true}`n"
$tops = @()

try {
    # A. The tables land on the branch, on its head, and the line names both.
    $s = New-Sandbox; $tops += $s.Top
    Set-Pr $s $s.Head
    Set-Box $s 0 (Said '7' $s.Head) @{ 'game/data/recipes.json' = $new; 'tests/fixtures/merchant-retrieval-records.json' = "[]`n" }
    $r = Invoke-Pull $s
    Yes 'A1 it ends 0 when the run ended 0' ($r.Code -eq 0)
    Yes 'A2 it asks the gate for Rebuild-ContentTables with the pull request and its head' ($r.Calls.Count -eq 1 -and $r.Calls[0] -ceq "LINE Rebuild-ContentTables -Pull 7 -Head $($s.Head)")
    $tip = G $s.Origin @('rev-parse', 'refs/heads/wisp/x')
    Yes 'A3 the branch on origin moved to a new commit' ($tip -ne $s.Head -and $tip -match '^[0-9a-f]{40}$')
    Yes 'A4 whose parent is the head the tables were built from' ((G $s.Origin @('rev-parse', "$tip^")) -eq $s.Head)
    $names = (G $s.Origin @('diff', '--name-only', $s.Head, $tip)) -split "`n" | Where-Object { $_ } | Sort-Object
    Yes 'A5 and which holds the tables that came back, and nothing else' (($names -join ',') -eq 'game/data/recipes.json,tests/fixtures/merchant-retrieval-records.json')
    Yes 'A6 with what the box built' ((G $s.Origin @('show', "$($tip):game/data/recipes.json")) -eq $new.Trim())
    Yes 'A7 the commit names the pull request and the run' ((G $s.Origin @('log', '-1', '--format=%B', $tip)) -match 'pull request #7' -and (G $s.Origin @('log', '-1', '--format=%B', $tip)) -match 'run 4242')
    Yes 'A8 the checkout is clean after' ((G $s.Root @('status', '--porcelain')) -eq '')

    # B. A run that changed nothing commits nothing.
    $before = G $s.Origin @('rev-parse', 'refs/heads/wisp/x')
    Set-Pr $s $before
    Set-Box $s 0 (Said '7' $before) @{ 'game/data/recipes.json' = $new } 4343
    $r = Invoke-Pull $s
    Yes 'B1 a run whose tables the branch already has ends 0' ($r.Code -eq 0 -and $r.Out -match 'Nothing to commit')
    Yes 'B2 and commits nothing' ((G $s.Origin @('rev-parse', 'refs/heads/wisp/x')) -eq $before)

    # C. -Server main and -Stations reach the line.
    $s = New-Sandbox; $tops += $s.Top
    Set-Pr $s $s.Head
    Set-Box $s 0 (Said '7' $s.Head) @{}
    $r = Invoke-Pull $s @('-Server', 'main', '-Stations')
    Yes 'C1 -Server main and -Stations go to the gate' ($r.Calls.Count -eq 1 -and $r.Calls[0] -ceq "LINE Rebuild-ContentTables -Server main -Stations -Pull 7 -Head $($s.Head)")

    # D. -Run reads a run again and starts none.
    $s = New-Sandbox; $tops += $s.Top
    Set-Pr $s $s.Head
    Set-Box $s 0 (Said '7' $s.Head) @{ 'game/data/recipes.json' = $new }
    $r = Invoke-Pull $s @('-Run', '999')
    Yes 'D1 -Run reads that run, starting none' ($r.Code -eq 0 -and $r.Calls.Count -eq 1 -and $r.Calls[0] -eq 'RUN 999')
    Yes 'D2 and puts its tables on the branch' ((G $s.Origin @('rev-parse', 'refs/heads/wisp/x')) -ne $s.Head)

    # E. Nothing starts when the checkout is not the head, or not clean.
    $s = New-Sandbox; $tops += $s.Top
    Set-Pr $s ('a' * 40)
    Set-Box $s 0 '' @{}
    $r = Invoke-Pull $s
    Yes 'E1 a checkout not at the pull request''s head stops before any run' ($r.Code -eq 1 -and $r.Calls.Count -eq 0 -and $r.Out -match 'STOP\. this checkout is at')
    Set-Pr $s $s.Head
    Put $s.Root 'game/data/recipes.json' "{`"edited`":true}`n"
    $r = Invoke-Pull $s
    Yes 'E2 a checkout with uncommitted changes stops before any run' ($r.Code -eq 1 -and $r.Calls.Count -eq 0 -and $r.Out -match 'not committed')

    # F. Nor for a pull request from another repository, or a closed one.
    $s = New-Sandbox; $tops += $s.Top
    Set-Box $s 0 '' @{}
    Set-Pr $s $s.Head 'OPEN' $true
    $r = Invoke-Pull $s
    Yes 'F1 a pull request from another repository stops before any run' ($r.Code -eq 1 -and $r.Calls.Count -eq 0 -and $r.Out -match 'another repository')
    Set-Pr $s $s.Head 'MERGED'
    $r = Invoke-Pull $s
    Yes 'F2 a pull request that is not open stops before any run' ($r.Code -eq 1 -and $r.Calls.Count -eq 0 -and $r.Out -match 'not open')

    # G. Nothing is committed when the run failed, built another head, or
    # sent back a file the box may not.
    $s = New-Sandbox; $tops += $s.Top
    Set-Pr $s $s.Head
    Set-Box $s 1 (Said '7' $s.Head) @{ 'game/data/recipes.json' = $new }
    $r = Invoke-Pull $s
    Yes 'G1 a run that ended 1 stops' ($r.Code -eq 1 -and $r.Out -match 'ended 1')
    Yes 'G2 and nothing is copied or committed' ((G $s.Root @('status', '--porcelain')) -eq '' -and (G $s.Origin @('rev-parse', 'refs/heads/wisp/x')) -eq $s.Head)
    Set-Box $s 0 (Said '7' ('b' * 40)) @{ 'game/data/recipes.json' = $new } 4444
    $r = Invoke-Pull $s
    Yes 'G3 a run whose output names another head stops' ($r.Code -eq 1 -and $r.Out -match 'may be another commit')
    Yes 'G4 and nothing is copied or committed' ((G $s.Root @('status', '--porcelain')) -eq '' -and (G $s.Origin @('rev-parse', 'refs/heads/wisp/x')) -eq $s.Head)
    Set-Box $s 0 (Said '7' $s.Head) @{ 'game/data/recipes.json' = $new; 'scripts/dev/Build-RecipeTable.ps1' = 'exit 0' } 4545
    $r = Invoke-Pull $s
    Yes 'G5 a run that sent back a file outside what the box may send stops' ($r.Code -eq 1 -and $r.Out -match 'sent back scripts/dev/Build-RecipeTable\.ps1')
    Yes 'G6 and copies nothing, the allowed tables included' ((G $s.Root @('status', '--porcelain')) -eq '' -and (G $s.Origin @('rev-parse', 'refs/heads/wisp/x')) -eq $s.Head)
}
finally {
    foreach ($t in $tops) { Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
