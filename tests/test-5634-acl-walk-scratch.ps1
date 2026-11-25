<#
  test-5634-acl-walk-scratch.ps1

  Issue #5634. test-2862-send-backups-acl.ps1 failed the Windows merge queue
  gate at random (run 43742148910): it walked the whole working tree with
  Get-ChildItem -Recurse and dropped temp, worktrees, node_modules, .git and
  engine only afterwards, so it went down into temp\ while
  test-crash-snapshot.ps1, in the same share, removed its scratch there,
  and the folder that went between being listed and being read threw under
  ErrorAction Stop.

  The race cannot be timed here, so this holds what makes it impossible:
    - test-2862 does not walk the working tree: no Get-ChildItem in it is
      given the repository's root with -Recurse;
    - it reads the scripts git tracks, so no harness's scratch, nothing
      untracked and no submodule is ever on its path;
    - and that is every tracked .ps1 and .psm1 outside a tests folder, the
      same set it is meant to check, counted against git here.
  Under two seconds.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$path = Join-Path $PSScriptRoot 'test-2862-send-backups-acl.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
$walks = @($ast.FindAll({ param($n)
    $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Get-ChildItem' -and
    ($n.CommandElements | Where-Object { $_ -is [Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -eq 'Recurse' }) -and
    ($n.CommandElements | Where-Object { $_.Extent.Text -eq '$Repo' })
}, $true))
Yes ('test-2862 does not walk the whole working tree (Get-ChildItem of $Repo with -Recurse)' +
     $(if ($walks.Count) { ': line ' + (($walks | ForEach-Object { $_.Extent.StartLineNumber }) -join ', ') })) ($walks.Count -eq 0)
$text = [IO.File]::ReadAllText($path)
Yes 'it reads the scripts git tracks (git ls-files)' ($text -match "git[^\r\n]*ls-files")

# The set it is meant to read, from git: every tracked .ps1 and .psm1, less
# tests\ and a product's own tests folder.
$want = @(& git -C $Repo ls-files -- '*.ps1' '*.psm1' | Where-Object { $_ -notmatch '^([^/]+/)?tests/' })
$out = @(& (Get-Process -Id $PID).Path -NoProfile -File $path 2>&1 | ForEach-Object { "$_" })
$said = @($out | ForEach-Object { if ($_ -match '^PASS  there are scripts to read \((\d+)\)') { [int]$Matches[1] } })
Yes ('it reads exactly those ' + $want.Count + ' scripts' + $(if ($said.Count) { ' (it read ' + $said[0] + ')' } else { ' (it said no count)' })) (
    $said.Count -eq 1 -and $said[0] -eq $want.Count)

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
