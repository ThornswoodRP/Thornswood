<#
  test-5765-pack-reason.ps1

      pwsh -NoProfile -File .\tests\test-5765-pack-reason.ps1

  Issue #5765. When vpk pack failed in merge-release.yml's step "Pack the
  launcher and the game files with Velopack", its one annotation was "vpk
  pack for dev failed; the lines above say why" (Merge release run 121, job
  130005007520), and vpk's reason was in the job log alone, which is too big
  for a Bot to read (Ops #266). The step now runs each command of its own
  through scripts\release\Invoke-Said.ps1, which writes the command's
  reason into its ::error line.

  A. Invoke-Said against stand-in commands, real processes:
    1. a command that fails with an error line among others: one ::error
       line naming what failed, its exit code and its error line, every
       line it wrote still printed, and $LASTEXITCODE its own;
    2. a command that passes: no ::error line, $LASTEXITCODE 0;
    3. a failure with no error line: its last lines, and it says so;
    4. 30 error lines: the last 10, and how many there were;
    5. a % goes in as %25 and a 1000 character line is cut at 300;
    6. a failure that printed nothing says so.
  B. merge-release.yml's Velopack step loads Invoke-Said.ps1 and runs the
     vpk install, the move program's build, the delta's download and vpk
     pack through it, with no "the lines above say why" left, and its
     script parses.

  Writes only into a scratch folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$said = Join-Path (Join-Path (Join-Path $repo 'scripts') 'release') 'Invoke-Said.ps1'
$wfPath = Join-Path (Join-Path (Join-Path $repo '.github') 'workflows') 'merge-release.yml'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# ---- A. Invoke-Said ---------------------------------------------------------------------
$have = Test-Path -LiteralPath $said
Yes 'scripts\release\Invoke-Said.ps1 is there' $have
if ($have) {
    . $said
    $ps = Get-BoxPowerShell
    $work = Join-Path ([IO.Path]::GetTempPath()) ('ts-5765-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $work
    $utf8 = New-Object Text.UTF8Encoding($false)
    $n = 0
    # A stand-in command: a pwsh script of its own, run as a process, as vpk is.
    function Stand-In([string]$body) {
        $script:n++
        $f = Join-Path $work ('stand-in-' + $script:n + '.ps1')
        [IO.File]::WriteAllText($f, $body, $utf8)
        return $f
    }
    function Run-Said([string]$what, [string]$file) {
        $out = @(Invoke-Said $what { & $ps -NoProfile -NonInteractive -File $file } 6>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Out = $out; Code = $LASTEXITCODE; Error = @($out | Where-Object { $_ -like '::error::*' }) }
    }
    try {
        $f = Stand-In ("Write-Host 'Preparing to pack Thornswood 2026.1111.3'`nWrite-Host 'Signing 4 files'`n" +
            "[Console]::Error.WriteLine('[ERR] Could not find the main exe Thornswood.exe in the pack folder')`nWrite-Host 'Done in 2.1 s'`nexit 3`n")
        $r = Run-Said 'vpk pack for dev' $f
        Yes ('1. a failed command gives one ::error line with what failed, its exit and its error line (' + ($r.Error -join ' | ') + ')') (
            $r.Error.Count -eq 1 -and $r.Error[0] -eq '::error::vpk pack for dev failed (exit 3): its error lines%0A[ERR] Could not find the main exe Thornswood.exe in the pack folder')
        Yes '   every line it wrote is still printed, as before' (
            $r.Out -contains 'Preparing to pack Thornswood 2026.1111.3' -and $r.Out -contains 'Done in 2.1 s' -and $r.Out -contains '[ERR] Could not find the main exe Thornswood.exe in the pack folder')
        Yes ("   and `$LASTEXITCODE is the command's ($($r.Code))") ($r.Code -eq 3)

        $r = Run-Said 'vpk pack for main' (Stand-In "Write-Host 'Packed'`nexit 0`n")
        Yes "2. a command that passes has no ::error line, and `$LASTEXITCODE 0 ($($r.Code))" ($r.Error.Count -eq 0 -and $r.Code -eq 0 -and $r.Out -contains 'Packed')

        $r = Run-Said 'installing vpk 1.2.161' (Stand-In "Write-Host 'one'`nWrite-Host 'two'`nexit 1`n")
        Yes ('3. with no error line, its last lines, saying so (' + ($r.Error -join ' | ') + ')') ($r.Error.Count -eq 1 -and $r.Error[0] -eq '::error::installing vpk 1.2.161 failed (exit 1): no error line; its last lines%0Aone%0Atwo')

        $r = Run-Said 'vpk pack for dev' (Stand-In "1..30 | ForEach-Object { Write-Host (`"error number `$_`") }`nexit 2`n")
        $shown = @([regex]::Matches("$($r.Error)", 'error number \d+')).Count
        Yes ('4. 30 error lines: the last 10 (' + $shown + ' shown), and how many there were') (
            $shown -eq 10 -and "$($r.Error)".Contains('its error lines, the last 10 of 30%0A') -and "$($r.Error)".Contains('error number 21%0A') -and "$($r.Error)".EndsWith('error number 30') -and -not "$($r.Error)".Contains('error number 20%0A'))

        $r = Run-Said 'vpk pack for dev' (Stand-In ("Write-Host 'error: 100% of the disk, %0A not a new line'`nWrite-Host ('error ' + ('x' * 1000))`nexit 1`n"))
        Yes ('5. a % goes in as %25, and a long line is cut at 300 (' + "$($r.Error)".Length + ' characters)') (
            "$($r.Error)".Contains('error: 100%25 of the disk, %250A not a new line%0A') -and "$($r.Error)".EndsWith('error ' + ('x' * 294) + '...'))

        $r = Run-Said 'building the move program' (Stand-In "exit 4`n")
        Yes ('6. a failure that printed nothing says so (' + ($r.Error -join ' | ') + ')') ($r.Error.Count -eq 1 -and $r.Error[0] -eq '::error::building the move program failed (exit 4): it printed nothing' -and $r.Code -eq 4)
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---- B. the Velopack step runs its commands through it ------------------------------------
$wf = [IO.File]::ReadAllText($wfPath)
$m = [regex]::Match($wf, '(?s)\n      - name: Pack the launcher and the game files with Velopack\r?\n.*?(?=\n      - name: |\z)')
$step = $m.Value
Yes 'merge-release.yml has the Velopack step' ($m.Success)
Yes '  it loads Invoke-Said.ps1' ($step.Contains('. .\scripts\release\Invoke-Said.ps1'))
$through = [ordered]@{
    'the vpk install' = 'Invoke-Said "installing vpk [^\r\n]*\{ dotnet tool install vpk '
    'the move program''s build' = 'Invoke-Said ''building the move program'' \{ dotnet build launcher\\move\\Move\.csproj '
    'the delta''s download' = 'Invoke-Said "taking the full package [^\r\n]*\{ gh release download '
    'vpk pack' = 'Invoke-Said "vpk pack for \$ch" \{\s*\r?\n\s*& \$vpk pack '
}
foreach ($k in $through.Keys) { Yes ('  ' + $k + ' runs through it') ($step -match $through[$k]) }
Yes '  and none of them runs bare beside it' (
    $step -notmatch '(?m)^\s*dotnet tool install vpk' -and $step -notmatch '(?m)^\s*dotnet build launcher' -and $step -notmatch '(?m)^\s*gh release download' -and $step -notmatch '(?m)^\s{12}& \$vpk pack ')
Yes '  no annotation in it sends the reader to "the lines above"' (-not $step.Contains('the lines above say why'))
# The step's script parses, so a wrapped command's braces close: a block left
# open still matches every line above (measured while building this).
$run = [regex]::Match($step, '(?s)\n        run: \|\r?\n(.*)$')
$body = (@($run.Groups[1].Value -split '\r?\n' | ForEach-Object { if ($_.Length -ge 10) { $_.Substring(10) } else { $_.Trim() } }) -join "`n")
$perr = $null
$null = [System.Management.Automation.Language.Parser]::ParseInput($body, [ref]$null, [ref]$perr)
Yes ('  and its script parses as PowerShell (' + (@($perr | ForEach-Object { $_.Message }) -join '; ') + ')') ($run.Success -and $body.Contains('Invoke-Said') -and @($perr).Count -eq 0)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
