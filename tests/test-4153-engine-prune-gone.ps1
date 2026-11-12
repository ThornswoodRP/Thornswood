<#
  test-4153-engine-prune-gone.ps1

      pwsh -NoProfile -File .\tests\test-4153-engine-prune-gone.ps1

  Issue #4153. The engine build prune (#3410) deleted the engine-<commit>
  artifacts engine.yml kept, so the artifact storage could not fill again.
  Since #3399 (26 Oct) engine.yml keeps no artifact: it hands its records
  back in its log. The prune's last run, on 31 Oct (run 41248764267), found
  no engine build to keep or drop, and the runs engine-pin.yml starts never
  start it at all (engine.yml's header, run 41253887577). So the workflow
  had nothing left to do and is gone, with what named it.

  This holds that: the workflow file is not there, and no file in the
  repository names it, apart from engine.yml's dated measurement of 31 Oct,
  which says what happened then and is that file's header to keep or edit
  (a change to engine.yml is its own card). Reads the files only.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
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

$name = 'engine-' + 'prune'
$workflows = Join-Path $Repo '.github/workflows'
Yes '.github/workflows is there' (Test-Path -LiteralPath $workflows)
Yes ("{0}.yml is gone from .github/workflows" -f $name) (-not (Test-Path -LiteralPath (Join-Path $workflows ($name + '.yml'))))

# engine.yml's header measured on 31 Oct that a run engine-pin.yml started
# never started the prune. That line is history, not a pointer to the file.
$history = "# $name.yml, which waits on this workflow's workflow_run, never ran"

$skipDirs = @('.git', 'node_modules', 'engine', 'out', 'local')
$text = @('.ps1', '.psm1', '.psd1', '.js', '.mjs', '.cjs', '.ts', '.cs', '.py', '.md', '.yml', '.yaml', '.json', '.txt', '.csv', '.html', '.css', '.toml', '.xml')
$self = [IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
$found = New-Object System.Collections.Generic.List[string]
$read = 0
$stack = New-Object System.Collections.Generic.Stack[string]
$stack.Push($Repo)
while ($stack.Count) {
    $dir = $stack.Pop()
    foreach ($d in [IO.Directory]::GetDirectories($dir)) {
        if ($dir -eq $Repo -and $skipDirs -contains [IO.Path]::GetFileName($d)) { continue }
        if ([IO.Path]::GetFileName($d) -eq 'node_modules') { continue }
        $stack.Push($d)
    }
    foreach ($f in [IO.Directory]::GetFiles($dir)) {
        if ($text -notcontains [IO.Path]::GetExtension($f).ToLowerInvariant()) { continue }
        if ([IO.Path]::GetFullPath($f) -eq $self) { continue }
        $read++
        $rel = [IO.Path]::GetRelativePath($Repo, $f) -replace '\\', '/'
        $n = 0
        foreach ($line in [IO.File]::ReadLines($f)) {
            $n++
            if ($line.IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
            if ($rel -eq '.github/workflows/engine.yml' -and $line.Trim() -eq $history) { continue }
            $found.Add(("{0}:{1}: {2}" -f $rel, $n, $line.Trim()))
        }
    }
}
Yes ("it read the repository's text files ({0})" -f $read) ($read -gt 500)
Yes ("no file names the prune workflow ({0} found)" -f $found.Count) ($found.Count -eq 0)
foreach ($l in $found) { Write-Host "      $l" }

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
