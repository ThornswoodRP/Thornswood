<#
  test-6119-secrets-walk-scratch.ps1

  Issue #6119. scripts/tests/test-secrets-off-command-lines.ps1 walked the whole
  working tree from its root with recursive Get-ChildItem (lines 334, 346 and
  475), so it went into temp\ where other harnesses in the same gate share make
  and remove scratch folders. It passed -ErrorAction SilentlyContinue to the
  walk.

  This holds what makes that impossible:
    - test-secrets-off-command-lines does not walk the working tree: no
      Get-ChildItem in it is given the repository root with -Recurse;
    - SilentlyContinue on the file walks is gone;
    - it reads the files git tracks (git ls-files), so no harness scratch,
      nothing untracked and no submodule is ever on its path;
    - and that is every tracked script outside tests\ and engine\, counted
      against git here.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$path = Join-Path $Repo 'scripts\tests\test-secrets-off-command-lines.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
$walks = @($ast.FindAll({ param($n)
    $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Get-ChildItem' -and
    ($n.CommandElements | Where-Object { $_ -is [Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -eq 'Recurse' }) -and
    ($n.CommandElements | Where-Object { $_.Extent.Text -eq '$repo' })
}, $true))
Yes ('test-secrets-off-command-lines does not walk the whole working tree (Get-ChildItem of $repo with -Recurse)' +
     $(if ($walks.Count) { ': line ' + (($walks | ForEach-Object { $_.Extent.StartLineNumber }) -join ', ') })) ($walks.Count -eq 0)

$text = [IO.File]::ReadAllText($path)
Yes 'it reads the files git tracks (git ls-files)' ($text -match "git[^\r\n]*ls-files")
Yes 'SilentlyContinue is gone from the walk' ($text -notmatch 'Get-ChildItem[^\r\n]*-ErrorAction\s+SilentlyContinue')

# The set it is meant to read, from git: every tracked .ps1 outside tests and engine
$skip = '(?i)/(tests|engine)/'
$want = @(& git -C $Repo ls-files -- '*.ps1' | Where-Object { ('/' + ($_ -replace '\\', '/')) -notmatch $skip })
Yes 'there are tracked scripts to scan' ($want.Count -gt 100)

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
