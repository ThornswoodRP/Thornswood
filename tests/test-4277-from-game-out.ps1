<#
  test-4277-from-game-out.ps1

      pwsh -NoProfile -File .\tests\test-4277-from-game-out.ps1

  Check-FromGame.ps1 -Out (#4277). The files it makes are Bethesda's and
  the mods' authors', so -Out may not be in the repository. The check took
  the path as the process folder saw it, never through links, and refused
  only a path under the repository plus a separator. This holds that each of
  these is refused before anything is read or written:
    1. the repository folder itself;
    2. a relative -Out that the session's own location puts in the
       repository, while the process folder is somewhere else;
    3. a link outside the repository that points into it;
  and that a folder outside it is let through. -Data names a folder with no
  game in it, so nothing is made either way.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$script = Join-Path $repo 'scripts\mods\Check-FromGame.ps1'
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4277-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
New-Item -ItemType Directory -Force -Path $T | Out-Null
$noGame = Join-Path $T 'no-game'
New-Item -ItemType Directory -Force -Path $noGame | Out-Null
function Q([string]$s) { return "'" + $s.Replace("'", "''") + "'" }
# The script run from a session whose process folder is $T and whose own
# location is $at, as after Set-Location.
function Run([string]$at, [string]$out) {
    $cmd = '[Environment]::CurrentDirectory = ' + (Q $T) + '; Set-Location -LiteralPath ' + (Q $at) + '; [Environment]::CurrentDirectory = ' + (Q $T) +
        '; & ' + (Q $script) + ' -Data ' + (Q $noGame) + ' -Out ' + (Q $out) + '; exit $LASTEXITCODE'
    $o = & pwsh -NoProfile -Command $cmd 2>&1 | Out-String
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $o }
}
$stop = 'STOP\. -Out is inside the repository'
try {
    $r = Run $T $repo
    Yes 'the repository folder itself is refused' ($r.Code -eq 1 -and $r.Out -match $stop)
    $r = Run $T ($repo + [IO.Path]::DirectorySeparatorChar + 'scripts' + [IO.Path]::DirectorySeparatorChar + '..')
    Yes '  and so is a path that climbs back to it' ($r.Code -eq 1 -and $r.Out -match $stop)
    $r = Run (Join-Path $repo 'scripts') 'from-game-out'
    Yes 'a relative -Out the session''s location puts in the repository is refused, though the process folder is outside' ($r.Code -eq 1 -and $r.Out -match $stop -and -not (Test-Path -LiteralPath (Join-Path $T 'from-game-out')))
    $link = Join-Path $T 'into-repo'
    New-Item -ItemType SymbolicLink -Path $link -Target (Join-Path $repo 'local') -Force | Out-Null
    $r = Run $T (Join-Path $link 'from-game')
    Yes 'a link outside the repository that points into it is refused' ($r.Code -eq 1 -and $r.Out -match $stop)
    $r = Run $T (Join-Path $T 'look')
    Yes 'a folder outside the repository is let through to the build' ($r.Out -notmatch $stop)
}
finally {
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
