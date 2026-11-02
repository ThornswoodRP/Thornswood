<#
  test-git-stderr.ps1

      pwsh -NoProfile -File .\tests\test-git-stderr.ps1

  git writes "fatal" on stderr for a ref or folder it does not know. Under
  Windows PowerShell 5.1 with $ErrorActionPreference = 'Stop', that line is a
  terminating NativeCommandError even through 2>$null, so a script that meant
  to read git's exit code stopped instead. Two places did:
    1. Release-Name.ps1 Invoke-ReleaseGit, which Ship (its origin/main check),
       Dev-News and the tag step call and read .Code from;
    2. Build-Engine.ps1 -Check with no fork checked out yet: it said the run
       would fetch it, then ended on git rev-parse in the missing folder.
  Offline: scratch git repositories and a scratch Skyrim folder; -Check builds
  and changes nothing.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-gitstderr-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void][IO.Directory]::CreateDirectory($T)
try {
    # ---- 1. Invoke-ReleaseGit under Stop ----------------------------------------
    $g = Join-Path $T 'repo'
    & { $ErrorActionPreference = 'Continue'
        git init -q $g 2>&1 | Out-Null
        git -C $g -c user.email=t@t -c user.name=t commit -q --allow-empty -m one 2>&1 | Out-Null }
    . (Join-Path $Repo 'scripts\release\Release-Name.ps1')
    $ErrorActionPreference = 'Stop'
    $r = $null; $threw = ''
    try { $r = Invoke-ReleaseGit $g @('rev-parse', '--verify', 'refs/remotes/origin/main') } catch { $threw = $_.FullyQualifiedErrorId }
    Yes ("Invoke-ReleaseGit under Stop: an unknown ref is a nonzero Code, not a thrown error ({0})" -f $(if ($threw) { $threw } else { 'Code ' + $r.Code })) (-not $threw -and $r.Code -ne 0 -and $r.First -eq '')
    Yes '  and the caller''s Stop is as it was afterwards' ($ErrorActionPreference -eq 'Stop')
    $r = $null; $threw = ''
    try { $r = Invoke-ReleaseGit (Join-Path $T 'not-a-repo') @('rev-parse', 'HEAD') } catch { $threw = $_.FullyQualifiedErrorId }
    Yes '  a folder that is not there is a nonzero Code too' (-not $threw -and $r.Code -ne 0)
    $r = Invoke-ReleaseGit $g @('rev-parse', 'HEAD')
    Yes '  and a good call still answers 0 with the commit' ($r.Code -eq 0 -and $r.First -match '^[0-9a-f]{40}$')
    $threw = ''
    try { $s = Get-ReleaseSource $g } catch { $threw = $_.FullyQualifiedErrorId }
    Yes '  Get-ReleaseSource on a clone with no origin answers, under Stop' (-not $threw -and $s.Commit -match '^[0-9a-f]{40}$')

    # ---- 2. Build-Engine -Check, no fork yet ------------------------------------
    $sky = Join-Path $T 'Game'
    [void][IO.Directory]::CreateDirectory($sky)
    [IO.File]::WriteAllBytes((Join-Path $sky 'SkyrimSE.exe'), [byte[]]@())
    $noFork = Join-Path $T 'no fork yet'
    $ErrorActionPreference = 'Continue'
    $out = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $Repo 'scripts\release\Build-Engine.ps1') -Check -Fork $noFork -SkyrimDir $sky -NoPause 2>&1 | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($out -match 'MISSING  (Visual Studio|CMake|Node|yarn|Git for)') {
        Write-Host 'SKIP  Build-Engine -Check: this machine lacks a build tool, so -Check stops before the fork'
    } else {
        Yes 'Build-Engine -Check with no fork says this run would fetch it' ($out -match 'this run would fetch it')
        Yes ("  and goes on to the end (exit {0}), with no NativeCommandError" -f $code) ($code -eq 0 -and $out -match 'Check finished' -and $out -notmatch 'NativeCommandError')
        Yes '  having made nothing' (-not (Test-Path -LiteralPath $noFork))
    }
}
finally { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }