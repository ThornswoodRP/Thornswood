<#
  test-4373-prev-kept.ps1

      pwsh -NoProfile -File .\scripts\tests\test-4373-prev-kept.ps1

  Issue #4373. Install-Bridge.ps1 and Install-AdminService.ps1 move the files
  they replace into a new <root>\.prev-<stamp> on every install, and nothing
  cleared those folders: only -Remove did, by deleting the whole install.
  Swap.ps1 and Install-ThornswoodServer.ps1 keep the newest two of theirs.

  This holds:
    1. Remove-ThornswoodOldCopies, in StopAndMove.ps1 (the text both
       installers put in front of what runs on the box), throws no error
       away and says a copy it could not remove;
    2. run on a scratch install folder it keeps the newest two .prev
       folders by their stamp, removes the rest, and touches nothing else
       (the stage, an .undone folder, the service's own files and folders);
    3. a copy it cannot remove is said, PRUNE FAILED with the folder and
       what Windows answered, and the others still go;
    4. both installers call it on the way out of an install that answers,
       for .prev-* and two, with StopAndMove.ps1's text in front of that box
       block; and a rolled-back install takes away the .prev folder its
       put-back emptied, so an empty one is never one of the two kept, without
       a failure there stopping the old task's start.

  The function is lifted out of StopAndMove.ps1 by its AST and run against a
  scratch folder, with Remove-Item stood in for so that one copy refuses the
  way a held file does. Needs nothing of Windows. Under a second.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done { Write-Host ''; Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); exit ([int]($script:fail -gt 0)) }

$FnAst = [System.Management.Automation.Language.FunctionDefinitionAst]
$stopAndMove = [IO.Path]::Combine($Repo, 'scripts', 'deploy', 'StopAndMove.ps1')
$errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($stopAndMove, [ref]$null, [ref]$errs)
Yes 'StopAndMove.ps1 parses' (-not $errs -or $errs.Count -eq 0)
$fn = $ast.Find({ param($a) $a -is $FnAst -and $a.Name -eq 'Remove-ThornswoodOldCopies' }, $true)
Yes 'StopAndMove.ps1 has Remove-ThornswoodOldCopies' ($null -ne $fn)
if ($script:fail) { Done }
$text = $fn.Extent.Text

# ---- 1. nothing thrown away -------------------------------------------------
Yes '1 it throws away no error (no SilentlyContinue, no Ignore)' ($text -notmatch '(?i)SilentlyContinue|ErrorAction\s+Ignore|-EA\s+(0|Ignore)')
Yes '1 and says a copy it could not remove' ($text -match 'PRUNE FAILED' -and $text -match 'catch')
Yes '1 StopAndMove.ps1 stays ASCII, as Windows PowerShell 5.1 on the box reads it' (
    -not @([IO.File]::ReadAllBytes($stopAndMove) | Where-Object { $_ -gt 127 }).Count)

# ---- 2 and 3. run it ----------------------------------------------------------
. ([scriptblock]::Create($text))
$scratch = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'ts-4373-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $scratch
try {
    $root = [IO.Path]::Combine($scratch, 'Thornswood-Bridge')
    $null = New-Item -ItemType Directory -Path $root
    $stamps = @('20261012-103440', '20261015-224524', '20261016-122827', '20261019-020047', '20261021-061220')
    # Made out of order, so the order kept is the stamp's and not the disk's.
    foreach ($s in @($stamps[3], $stamps[0], $stamps[4], $stamps[1], $stamps[2])) {
        $d = New-Item -ItemType Directory -Path ([IO.Path]::Combine($root, '.prev-' + $s))
        Set-Content -LiteralPath ([IO.Path]::Combine($d.FullName, 'bridge.js')) -Value 'x'
    }
    foreach ($other in '.stage-20261021-061220', '.undone-20261001-000000', 'tokens') {
        $null = New-Item -ItemType Directory -Path ([IO.Path]::Combine($root, $other))
    }
    Set-Content -LiteralPath ([IO.Path]::Combine($root, 'bridge.js')) -Value 'live'

    $said = @(Remove-ThornswoodOldCopies -Root $root -Like '.prev-*' -Keep 2)
    $left = @(Get-ChildItem -LiteralPath $root -Directory -Force | ForEach-Object { $_.Name } | Sort-Object)
    $prevLeft = @($left | Where-Object { $_ -like '.prev-*' })
    Yes ('2 the newest two .prev folders are kept (' + ($prevLeft -join ', ') + ')') (
        ($prevLeft -join ',') -eq ('.prev-' + $stamps[3] + ',.prev-' + $stamps[4]))
    Yes '2 and the older three are removed' (-not @($stamps[0..2] | Where-Object { Test-Path -LiteralPath ([IO.Path]::Combine($root, '.prev-' + $_)) }).Count)
    Yes '2 the stage, the .undone folder and the service''s own folder are left' (
        $left -contains '.stage-20261021-061220' -and $left -contains '.undone-20261001-000000' -and $left -contains 'tokens')
    Yes '2 and so is the live file' ((Get-Content -LiteralPath ([IO.Path]::Combine($root, 'bridge.js')) -Raw).Trim() -eq 'live')
    Yes ('2 and it says nothing when all went (' + ($said -join ' | ') + ')') ($said.Count -eq 0)
    $again = @(Remove-ThornswoodOldCopies -Root $root -Like '.prev-*' -Keep 2)
    Yes '2 run again with two left, it removes nothing' ($again.Count -eq 0 -and @(Get-ChildItem -LiteralPath $root -Directory -Force | Where-Object { $_.Name -like '.prev-*' }).Count -eq 2)

    # One that will not go, the way a held file refuses on Windows.
    foreach ($s in '20261101-010101', '20261102-020202', '20261103-030303') {
        $null = New-Item -ItemType Directory -Path ([IO.Path]::Combine($root, '.prev-' + $s))
    }
    $held = [IO.Path]::Combine($root, '.prev-' + $stamps[3])
    function Remove-Item {
        param([string]$LiteralPath, [switch]$Recurse, [switch]$Force, $ErrorAction)
        if ($LiteralPath -eq $held) { throw "The process cannot access the file 'bridge.log' because it is being used by another process." }
        Microsoft.PowerShell.Management\Remove-Item -LiteralPath $LiteralPath -Recurse:$Recurse -Force:$Force -ErrorAction Stop
    }
    $said = @(Remove-ThornswoodOldCopies -Root $root -Like '.prev-*' -Keep 2)
    Remove-Item Function:\Remove-Item
    $line = @($said | Where-Object { $_ -match '^PRUNE FAILED: ' })
    Yes ('3 the copy that would not go is said (' + ($said -join ' | ') + ')') (
        $line.Count -eq 1 -and $line[0].Contains($held) -and $line[0] -match 'being used by another process' -and $line[0] -match 'newest 2')
    $prevLeft = @(Get-ChildItem -LiteralPath $root -Directory -Force | Where-Object { $_.Name -like '.prev-*' } | ForEach-Object { $_.Name } | Sort-Object)
    Yes ('3 and the rest still go: the newest two and the held one are left (' + ($prevLeft -join ', ') + ')') (
        ($prevLeft -join ',') -eq ('.prev-' + $stamps[3] + ',.prev-20261102-020202,.prev-20261103-030303'))
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 4. both installers use it ------------------------------------------------
foreach ($pair in @(@('Install-Bridge.ps1', 'BRIDGE'), @('Install-AdminService.ps1', 'ADMIN'))) {
    $name = $pair[0]; $word = $pair[1]
    $file = [IO.Path]::Combine($Repo, 'scripts', 'deploy', $name)
    $perr = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$null, [ref]$perr)
    Yes "4 $name parses" (-not $perr -or $perr.Count -eq 0)
    $src = [IO.File]::ReadAllText($file) -replace "`r`n", "`n"
    # The here-string that swaps the files in: the one that ends an install
    # that answers with BRIDGE OK or ADMIN OK.
    $k = $src.IndexOf("'" + $word + " OK'; exit 0")
    $i = if ($k -ge 0) { $src.LastIndexOf('@"' + "`n", $k) } else { -1 }
    $box = if ($i -ge 0) { $src.Substring($i, $src.IndexOf("`n" + '"@', $k) - $i) } else { '' }
    Yes "4 $name has its box block" ($box.Length -gt 0)
    Yes "4 $name puts StopAndMove.ps1's text in front of that block" (
        $src -match '\$stopIt = \[IO\.File\]::ReadAllText\(\(Join-Path \$Here ''StopAndMove\.ps1''\)\)' -and $box -match "(?m)^\`$stopIt\s*$")
    $ok = [regex]::Match($box, "(?s)if \(Answers @\('\`$Plain'\)\) \{(.*?)'$word OK'; exit 0")
    Yes "4 $name keeps the newest two .prev folders when the new one answers" (
        $ok.Success -and $ok.Groups[1].Value -match "(?m)^\s*Remove-ThornswoodOldCopies -Root '\`$Root' -Like '\.prev-\*' -Keep 2\s*$")
    $back = [regex]::Match($box, "(?s)foreach \(``\`$f in ``\`$back\).*?\n(.*?)\nif \(``\`$oldXml\)")
    Yes "4 $name takes away the .prev folder a put-back emptied, and only an empty one" (
        $back.Success -and $back.Groups[1].Value -match [regex]::Escape("if (-not @(Get-ChildItem -LiteralPath '`$Root\`$prev' -Force).Count) { Remove-Item -LiteralPath '`$Root\`$prev' -Force -ErrorAction Stop }"))
    Yes "4 $name says a failure there and goes on to start the old task" (
        $back.Success -and $back.Groups[1].Value -match '(?m)^try \{' -and $back.Groups[1].Value -match "(?m)^catch \{ 'could not remove the emptied ")
}
Done
