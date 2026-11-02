# test-docs-backup.ps1
#
# Deploy-Docs.ps1 -Docs, -Boards and -SeedDocs overwrite documents people type
# into on the site, and each one promises a .bak beside every document first.
# On 24 September a -Docs known,help run printed "backed up 0 document(s)":
# the backup's Get-ChildItem used -Include on a bare folder, which matches
# nothing, so no run had ever left a .bak.
#
# This lifts the real here-string Deploy-Docs sends to the VPS, fills in a
# scratch folder for $rootWin, and runs it under PowerShell 7, the shell the
# VPS runs it in. It touches nothing outside that scratch folder.
#
#   pwsh -File tests\test-docs-backup.ps1                 the repo's copy
#   pwsh -File tests\test-docs-backup.ps1 -Path <file>    any other copy
param([string]$Path)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
# What this runs, every machine runs in PowerShell 7 since #5356, the box
# included, and this harness runs in it too.
$boxPs = Get-BoxPowerShell
$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$here = Split-Path -Parent $here
if (-not $Path) { $Path = Join-Path $here 'scripts\deploy\Deploy-Docs.ps1' }

$pass = 0; $fail = 0
function yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host ('PASS  ' + $what) }
    else { $script:fail++; Write-Host ('FAIL  ' + $what) }
}

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
yes 'Deploy-Docs.ps1 parses' ($errors.Count -eq 0)

$block = $ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and
    $n.Extent.Text -match 'backed up'
}, $true) | Select-Object -First 1
yes 'the backup script it sends up is in the file' ($null -ne $block)

if ($block) {
    $scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('ts-docs-backup-' + [guid]::NewGuid().ToString('N'))
    $data = Join-Path $scratch 'data'
    New-Item -ItemType Directory -Force -Path (Join-Path $data 'site') | Out-Null
    Set-Content -LiteralPath (Join-Path $data 'help.md') -Value 'typed on the site' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $data 'board.json') -Value '{"typed":true}' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $data 'notes.txt') -Value 'not a document' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $data 'site\world.md') -Value 'public page' -Encoding UTF8
    try {
        # The here-string is expanded exactly as Deploy-Docs expands it, with
        # $rootWin pointing at the scratch folder, and the result is what the
        # VPS would be handed.
        $rootWin = $scratch
        $script = Invoke-Expression $block.Extent.Text
        yes 'it names the data folder it was given' ($script -like ('*' + $scratch + '\data*'))

        $said = & $boxPs -NoProfile -NonInteractive -Command $script 2>&1 | ForEach-Object { "$_" }
        $said = ($said -join ' ').Trim()
        Write-Host ('      it said: ' + $said)

        yes 'help.md gets a .bak' (Test-Path -LiteralPath (Join-Path $data 'help.md.bak'))
        yes 'board.json gets a .bak' (Test-Path -LiteralPath (Join-Path $data 'board.json.bak'))
        yes 'and the .bak holds what was typed' ((Test-Path -LiteralPath (Join-Path $data 'board.json.bak')) -and
            ((Get-Content -Raw -LiteralPath (Join-Path $data 'board.json.bak')) -match 'typed'))
        yes 'a file that is not a document is left alone' (-not (Test-Path -LiteralPath (Join-Path $data 'notes.txt.bak')))
        yes 'the public pages under site are not part of it' (-not (Test-Path -LiteralPath (Join-Path $data 'site\world.md.bak')))
        yes 'and the count it prints is the two documents, not 0' ($said -match 'backed up 2 document')
    } finally {
        Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
if ($fail) { exit 1 }
exit 0
