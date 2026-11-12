<#
  test-4740-mods-folder.ps1

      pwsh -NoProfile -File .\tests\test-4740-mods-folder.ps1

  Issue #4740. scripts\mods holds the scripts that work on the collection, the
  mod list or the plugins and can still be run. It also held four that work on
  this machine and the box instead, and nine retired ones that refuse to run.

  What it holds:
    1. no script in scripts\mods opens RETIRED. DO NOT RUN; each of the nine
       is in scripts\oneoff, still refuses at its first statement, and has a
       row in scripts\oneoff\README.md;
    2. the four machine tools are in scripts\dev and not in scripts\mods:
       Fix-Icons.ps1 (the Windows shortcut icon cache), Clean-Everything.ps1
       (installers, packs, temp files, backups and release assets on this
       machine, the box and GitHub), Audit-Leftovers.ps1 and
       Clean-Leftovers.ps1 (backup and temp files across this machine's
       folders);
    3. scripts\README.md lists the four under dev/ and none of the thirteen
       under mods/;
    4. no file in the checkout outside docs\archive names any of the thirteen
       at its old place in scripts\mods.

  Read only.
#>
[CmdletBinding()]
param()

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

$Utf8 = New-Object Text.UTF8Encoding($false)
$scripts = Join-Path $Repo 'scripts'
$mods = Join-Path $scripts 'mods'
$dev = Join-Path $scripts 'dev'
$oneoff = Join-Path $scripts 'oneoff'

$retired = @('Add-Accuracy.ps1', 'Add-Bodies.ps1', 'Add-CartTravel.ps1', 'Add-McmShortcut.ps1', 'Enable-MCM.ps1',
             'Fix-MaleBody.ps1', 'Fix-QuickLoot.ps1', 'Remove-Plugin.ps1', 'Set-UnboundMenu.ps1')
$machine = @('Audit-Leftovers.ps1', 'Clean-Everything.ps1', 'Clean-Leftovers.ps1', 'Fix-Icons.ps1')

# ---- 1. nothing retired in scripts\mods ----------------------------------------
$dead = @(Get-ChildItem -LiteralPath $mods -File | Where-Object {
    $text = [IO.File]::ReadAllText($_.FullName, $Utf8)
    $text.Substring(0, [Math]::Min(800, $text.Length)) -match 'RETIRED\. DO NOT RUN'
} | ForEach-Object { $_.Name })
Yes ('no script in scripts\mods is retired' + $(if ($dead.Count) { ': ' + ($dead -join ', ') } else { '' })) ($dead.Count -eq 0)

$oneoffIndex = [IO.File]::ReadAllText((Join-Path $oneoff 'README.md'), $Utf8)
foreach ($n in $retired) {
    $at = Join-Path $oneoff $n
    Yes "$n is in scripts\oneoff" (Test-Path -LiteralPath $at)
    if (Test-Path -LiteralPath $at) {
        $text = [IO.File]::ReadAllText($at, $Utf8)
        $tokens = $null; $errors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseInput($text, $at, [ref]$tokens, [ref]$errors)
        $first = $null
        if ($ast.EndBlock -and @($ast.EndBlock.Statements).Count) { $first = $ast.EndBlock.Statements[0] }
        Yes "  and still refuses at its first statement" ($first -is [System.Management.Automation.Language.ThrowStatementAst] -and $first.Extent.Text -match "\('STOP\.")
    }
    $row = @($oneoffIndex -split "\r?\n" | Where-Object { $_.StartsWith('| `' + $n + '`') })
    Yes "  and scripts\oneoff\README.md has one row for it that says it refuses to run" ($row.Count -eq 1 -and $row[0] -match 'refuses to run')
}

# ---- 2. the machine tools are in dev ---------------------------------------------
foreach ($n in $machine) {
    Yes "$n is not in scripts\mods" (-not (Test-Path -LiteralPath (Join-Path $mods $n)))
    Yes "  and is in scripts\dev" (Test-Path -LiteralPath (Join-Path $dev $n))
}

# ---- 3. the index ----------------------------------------------------------------
$index = [IO.File]::ReadAllText((Join-Path $scripts 'README.md'), $Utf8)
$lines = @($index -split "\r?\n")
foreach ($n in ($retired + $machine)) {
    $old = @($lines | Where-Object { $_.Contains('](mods/' + $n + ')') })
    Yes "scripts\README.md has no mods/ row for $n" ($old.Count -eq 0)
}
foreach ($n in $machine) {
    $new = @($lines | Where-Object { $_.StartsWith('| [dev/' + $n + '](dev/' + $n + ')') })
    Yes "  and lists dev/$n" ($new.Count -eq 1)
}

# ---- 4. nothing names the old places ---------------------------------------------
$me = 'tests/' + (Split-Path -Leaf $PSCommandPath)
$names = ($retired + $machine) | ForEach-Object { [regex]::Escape($_) }
$oldRx = [regex]('(?i)scripts[\\/]+mods[\\/]+(' + ($names -join '|') + ')|[("''\s]mods/(' + ($names -join '|') + ')|''mods'',\s*''(' + ($names -join '|') + ')''')
$all = @(Get-ChildItem -LiteralPath $Repo -Recurse -File -Force -ErrorAction SilentlyContinue |
         Where-Object { $_.FullName -notmatch '[\\/](\.git|node_modules|local|worktrees|temp)[\\/]' -and $_.Length -lt 2MB } |
         ForEach-Object { $_.FullName.Substring($Repo.Length + 1).Replace('\', '/') })
Yes ('the walk finds the checkout''s files (' + $all.Count + ')') ($all.Count -gt 500)
$hits = @()
foreach ($f in $all) {
    if ($f -eq $me -or $f -like 'docs/archive/*') { continue }
    if ($f -notmatch '\.(md|ps1|psm1|js|ts|cs|py|json|yml|yaml|txt|cmd|bat|html)$') { continue }
    $full = Join-Path $Repo $f
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $i = 0
    foreach ($line in [IO.File]::ReadAllLines($full)) {
        $i++
        if ($oldRx.IsMatch($line)) { $hits += ('{0}:{1}' -f $f, $i) }
    }
}
foreach ($h in $hits) { Write-Host "      names an old place: $h" }
Yes ('no file names one of the thirteen at scripts\mods (' + $hits.Count + ')') ($hits.Count -eq 0)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
