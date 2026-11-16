<#
  test-3183-prune-says.ps1

      pwsh -NoProfile -File .\scripts\tests\test-3183-prune-says.ps1

  Issue #3183. Install-ThornswoodServer.ps1 keeps the newest copies of a
  server root it replaced and removes the rest with Prune. Prune threw every
  error away (-ErrorAction SilentlyContinue on the listing and the removal),
  so on 21 Oct 2026 the box held eleven dev copies of about 0.4 GB each, kept
  for two, and nothing had said why. This fails on:
    1. Prune listing or removing with its errors thrown away;
    2. Prune not removing what is past the newest n, or touching the newest n,
       or touching another root's copies;
    3. a copy it cannot remove going unsaid: the line must start
       PRUNE FAILED and carry the folder and what Windows answered, and the
       rest must still be removed.
    4. either of Swap.ps1's two in-root prunes (the .prev and .undone sets
       a deploy keeps) throwing its errors away or not saying PRUNE FAILED.
    5. the root's name and folder that Prune reads ($leaf, $parent) being set
       anywhere in the installer's own scope but where they are made. The
       -FromStore plugin loop used $leaf for each plugin's file name, so a
       -FromStore install pruned against "<plugin>.prev-*", matched nothing
       and said nothing: on 21 Oct 2026, after the new Prune was on the box,
       the dev publish left all ten old dev copies with no PRUNE FAILED line.
  Prune is lifted out of the installer by its AST and run against a scratch
  folder, with Remove-Item stood in for so that one copy refuses the way a
  held file does. Needs nothing of Windows. Under a second.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done { Write-Host ''; Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); exit ([int]($script:fail -gt 0)) }

$installer = [IO.Path]::Combine($Repo, 'scripts', 'deploy', 'Install-ThornswoodServer.ps1')
$errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$null, [ref]$errs)
Yes 'Install-ThornswoodServer.ps1 parses' (-not $errs -or $errs.Count -eq 0)
$fn = $ast.Find({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Prune' }, $true)
Yes 'the installer has Prune' ($null -ne $fn)
if ($script:fail) { Done }
$text = $fn.Extent.Text

# ---- 1. nothing thrown away -------------------------------------------------
Yes 'Prune throws away no error (no SilentlyContinue, no Ignore)' ($text -notmatch '(?i)SilentlyContinue|ErrorAction\s+Ignore|-EA\s+(0|Ignore)')
Yes 'Prune says a copy it could not remove' ($text -match 'PRUNE FAILED' -and $text -match 'catch')

# ---- 2 and 3. run it ----------------------------------------------------------
$scratch = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'ts-3183-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $scratch
try {
    $root = [IO.Path]::Combine($scratch, 'Thornswood-Server-Dev')
    $null = New-Item -ItemType Directory -Path $root
    $stamps = @('20261012-103440', '20261015-224524', '20261016-122827', '20261019-020047', '20261021-061220')
    foreach ($s in $stamps) {
        $d = New-Item -ItemType Directory -Path ($root + '.prev-' + $s)
        Set-Content -LiteralPath ([IO.Path]::Combine($d.FullName, 'server.log')) -Value 'x'
    }
    # Another root beside it, whose copies are not this root's to prune.
    $other = New-Item -ItemType Directory -Path ([IO.Path]::Combine($scratch, 'Thornswood-Server.prev-20261003-131708'))

    $held = $root + '.prev-20261015-224524'
    $script:said = @()
    function Say([string]$m, [string]$c = 'Gray') { $script:said += $m }
    # A held file refuses the removal the way Windows does.
    function Remove-Item {
        param([string]$LiteralPath, [switch]$Recurse, [switch]$Force, $ErrorAction)
        if ($LiteralPath -eq $held) { throw "Cannot remove item $LiteralPath\server.log: The process cannot access the file because it is being used by another process." }
        Microsoft.PowerShell.Management\Remove-Item -LiteralPath $LiteralPath -Recurse:$Recurse -Force:$Force -ErrorAction Stop
    }
    $parent = $scratch
    $leaf = 'Thornswood-Server-Dev'
    . ([scriptblock]::Create($text))
    Prune '.prev-*' 2

    $left = @(Get-ChildItem -LiteralPath $scratch -Directory | ForEach-Object { $_.Name } | Sort-Object)
    Yes 'the newest two copies are kept' (($left -contains 'Thornswood-Server-Dev.prev-20261021-061220') -and ($left -contains 'Thornswood-Server-Dev.prev-20261019-020047'))
    Yes 'the older ones it could remove are gone' (-not ($left -contains 'Thornswood-Server-Dev.prev-20261012-103440') -and -not ($left -contains 'Thornswood-Server-Dev.prev-20261016-122827'))
    Yes 'the held one is still there, since it could not go' ($left -contains 'Thornswood-Server-Dev.prev-20261015-224524')
    Yes 'the root itself and the other root''s copy are untouched' (($left -contains 'Thornswood-Server-Dev') -and ($left -contains 'Thornswood-Server.prev-20261003-131708'))
    $line = @($script:said | Where-Object { $_ -like 'PRUNE FAILED*' })
    Yes 'exactly one PRUNE FAILED line' ($line.Count -eq 1)
    Yes 'it names the folder and what Windows answered' ($line.Count -eq 1 -and $line[0] -like "*$held*" -and $line[0] -like '*being used by another process*')
} finally {
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $scratch -Recurse -Force
}

# ---- 4. the swap's own prunes ---------------------------------------------------
$swap = [IO.File]::ReadAllText([IO.Path]::Combine($Repo, 'scripts', 'deploy', 'Swap.ps1'))
$prunes = @([regex]::Matches($swap, "foreach \(\`$kind in '\.prev-\*', '\.undone-\*'\) \{[\s\S]*?\n    \}"))
Yes 'Swap.ps1 has its two in-root prunes' ($prunes.Count -eq 2)
foreach ($m in $prunes) {
    Yes '  a swap prune throws away no error' ($m.Value -notmatch '(?i)SilentlyContinue|ErrorAction\s+Ignore|-EA\s+(0|Ignore)')
    Yes '  and says PRUNE FAILED for a copy it could not remove' ($m.Value -match 'catch \{ ''PRUNE FAILED: ')
}

# ---- 5. what Prune reads is set once ---------------------------------------------
# An assignment inside a function is that function's own; one anywhere else is
# the script's, the scope Prune reads $leaf and $parent from.
foreach ($name in 'leaf', 'parent') {
    $sets = @($ast.FindAll({ param($a)
        $a -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $a.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $a.Left.VariablePath.UserPath -eq $name }, $true) | Where-Object {
        $up = $_.Parent; $inFn = $false
        while ($up) { if ($up -is [System.Management.Automation.Language.FunctionDefinitionAst]) { $inFn = $true; break }; $up = $up.Parent }
        -not $inFn })
    $where = ($sets | ForEach-Object { $_.Extent.StartLineNumber }) -join ', '
    Yes ("`$$name, which Prune reads, is set once in the installer's scope (line(s) $where)") ($sets.Count -eq 1)
}
Done
