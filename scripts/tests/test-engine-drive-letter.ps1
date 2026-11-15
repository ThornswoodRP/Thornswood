<#
  test-engine-drive-letter.ps1

  Two engine builds at once under one parent folder with an & in it, each
  through the drive letter scripts\release\Build-Engine.ps1 gives it, and both
  finish (issue #1993).

  WHY THIS EXISTS. Measured on One on 5 Oct: a light plugins build broke
  mid-compile while a teleport-flood build ran, because both forks sat under
  C:\ThornswoodTemps&Worktrees\worktrees, the second run reused the letter the
  first made for that parent, and the first removed it when it ended.

  HOW. A full engine build takes hours and needs Visual Studio, vcpkg and the
  game, so the build here is a stand-in: Build-Engine's own letter functions,
  lifted by the parser, run in two separate PowerShell processes at once, each
  mounting its fork and running a .bat through cmd.exe from the letter (as
  vcpkg's bootstrap and the build are run) that keeps reading its fork through
  that letter for several seconds, then letting go. The short one ends while
  the long one is still building. Two cases:
    - two forks never configured: each gets a letter of its own;
    - two forks configured through the same letter (which they must be built
      through again): they share it, and the run that made it ending first
      leaves it to the other, the last one off removing it.
  Each build passes only if every read through its letter found its fork.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$engine = Join-Path $root 'scripts\release\Build-Engine.ps1'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  a build''s drive letter is a subst, and the stand-in build a cmd.exe run, and only Windows has either'; exit 0 }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$text = [IO.File]::ReadAllText($engine)
$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$null)
$names = 'Test-CmdSplitsPath', 'Get-SubstMap', 'Get-EngineSubstDir', 'Enter-EngineSubstLock', 'Add-EngineSubstHold', 'Get-EngineSubstHolders', 'Mount-EngineFork', 'Dismount-EngineFork'
$lift = @()
foreach ($fn in $names) {
    $d = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $fn }, $true)
    if ($d) { $lift += $d.Extent.Text }
}
Yes 'Build-Engine has every letter function this lifts' ($lift.Count -eq $names.Count)

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-letters-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$parent = Join-Path $work 'wt&x'
$null = [IO.Directory]::CreateDirectory($parent)
$funcs = Join-Path $work 'letters.ps1'
[IO.File]::WriteAllText($funcs, ($lift -join "`r`n"), (New-Object Text.UTF8Encoding($true)))

# One stand-in build, in a process of its own: mount, build through the
# letter for the seconds given, let go, and say how it went as JSON.
$buildText = @(
    'param([string]$Funcs, [string]$Fork, [int]$Seconds, [string]$Out)'
    '$ErrorActionPreference = ''Stop'''
    '. $Funcs'
    '$m = Mount-EngineFork $Fork'
    '$res = [ordered]@{ Fork = $Fork; Drive = $m.Drive; Made = $m.Made; Why = $m.Why; Reads = 0; Missed = 0; Exit = -1 }'
    'try {'
    '    if ($m.Drive) {'
    '        $bat = Join-Path $m.Fork ''build.bat'''
    '        $o = & ''__CMD__'' /d /c (''"'' + $bat + ''" '' + ($Seconds * 2)) 2>&1'
    '        $res.Exit = $LASTEXITCODE'
    '        $res.Reads = @($o | Where-Object { "$_" -match ''^read '' }).Count'
    '        $res.Missed = @($o | Where-Object { "$_" -match ''^missed '' }).Count'
    '    }'
    '} finally { Dismount-EngineFork $m }'
    '[IO.File]::WriteAllText($Out, ($res | ConvertTo-Json -Compress))'
) -join "`r`n"
$buildText = $buildText.Replace('__CMD__', (Get-WindowsPath 'System32\cmd.exe').Replace("'", "''"))
$build = Join-Path $work 'build.ps1'
[IO.File]::WriteAllText($build, $buildText, (New-Object Text.UTF8Encoding($true)))

# Reads its own fork through the letter twice a second; a read that finds
# nothing is a build that lost its paths.
$bat = (@(
    '@echo off'
    'set n=0'
    ':again'
    'if exist "%~dp0CMakeLists.txt" (echo read %n%) else (echo missed %n%)'
    'set /a n+=1'
    'if %n% geq %1 goto end'
    'ping -n 1 -w 500 192.0.2.1 >nul'
    'goto again'
    ':end'
    'if exist "%~dp0CMakeLists.txt" exit /b 0'
    'exit /b 1'
) -join "`r`n") + "`r`n"
function NewFork([string]$name, [string]$cacheLetter) {
    $f = Join-Path $parent $name
    $null = [IO.Directory]::CreateDirectory((Join-Path $f 'build'))
    [IO.File]::WriteAllText((Join-Path $f 'CMakeLists.txt'), '# stand-in')
    [IO.File]::WriteAllText((Join-Path $f 'build.bat'), $bat)
    if ($cacheLetter) { [IO.File]::WriteAllText((Join-Path $f 'build\CMakeCache.txt'), ('CMAKE_CACHEFILE_DIR:INTERNAL=' + $cacheLetter + ':/' + $name + "/build`r`n")) }
    return $f
}
function SubstHas([string]$letter) {
    return [bool](@(& (Get-WindowsPath 'System32\subst.exe')) | Where-Object { "$_" -match ('^' + $letter + ':') })
}
$shell = (Get-Process -Id $PID).Path
function TwoAtOnce([string]$forkA, [string]$forkB, [switch]$ShortFirst) {
    $oa = Join-Path $work ('a-' + [Guid]::NewGuid().ToString('N') + '.json')
    $ob = Join-Path $work ('b-' + [Guid]::NewGuid().ToString('N') + '.json')
    $argLong = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $build + '"'), ('"' + $funcs + '"'), ('"' + $forkB + '"'), 10, ('"' + $ob + '"'))
    $argShort = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $build + '"'), ('"' + $funcs + '"'), ('"' + $forkA + '"'), 3, ('"' + $oa + '"'))
    if ($ShortFirst) {
        $short = Start-Process -FilePath $shell -ArgumentList $argShort -PassThru -WindowStyle Hidden
        Start-Sleep -Milliseconds 1200
        $long = Start-Process -FilePath $shell -ArgumentList $argLong -PassThru -WindowStyle Hidden
    } else {
        $long = Start-Process -FilePath $shell -ArgumentList $argLong -PassThru -WindowStyle Hidden
        Start-Sleep -Milliseconds 2500
        $short = Start-Process -FilePath $shell -ArgumentList $argShort -PassThru -WindowStyle Hidden
    }
    $null = $short.WaitForExit(60000)
    $longStill = -not $long.HasExited
    $null = $long.WaitForExit(60000)
    $ra = $null; $rb = $null
    if (Test-Path -LiteralPath $oa) { $ra = [IO.File]::ReadAllText($oa) | ConvertFrom-Json }
    if (Test-Path -LiteralPath $ob) { $rb = [IO.File]::ReadAllText($ob) | ConvertFrom-Json }
    Write-Host ('      short: ' + ($ra | ConvertTo-Json -Compress))
    Write-Host ('      long:  ' + ($rb | ConvertTo-Json -Compress))
    return [pscustomobject]@{ A = $ra; B = $rb; LongStill = $longStill }
}
function BothFinish($r) {
    return ($r.A -and $r.B -and $r.A.Exit -eq 0 -and $r.B.Exit -eq 0 -and $r.A.Missed -eq 0 -and $r.B.Missed -eq 0 -and
            $r.A.Reads -eq 6 -and $r.B.Reads -eq 20)
}

try {
    # ---- two forks never configured: a letter each
    $r = TwoAtOnce (NewFork 'fork-a' '') (NewFork 'fork-b' '')
    Yes 'two first builds at once under one parent each get a letter of their own' (
        $r.A -and $r.B -and $r.A.Drive -and $r.B.Drive -and $r.A.Drive -ne $r.B.Drive -and $r.A.Made -and $r.B.Made)
    Yes '  the short one finished while the long one was still building' ($r.LongStill)
    Yes ('  and both finish, every read through their letter finding the fork (' + $r.A.Reads + ' and ' + $r.B.Reads + ' reads)') (BothFinish $r)
    Yes '  and both letters are gone afterwards' ($r.A -and $r.B -and -not (SubstHas $r.A.Drive.Substring(0, 1)) -and -not (SubstHas $r.B.Drive.Substring(0, 1)))

    # ---- two forks configured through the same letter: shared, last off removes it
    $taken = @([IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name.Substring(0, 1).ToUpper() })
    $pick = @('Y', 'X', 'W', 'V', 'U', 'T', 'S', 'R') | Where-Object { $taken -notcontains $_ -and -not (SubstHas $_) } | Select-Object -First 1
    if ($pick) {
        # The short one starts first and so makes the letter: the run that
        # made it ends while the other is still building on it.
        $r = TwoAtOnce (NewFork 'fork-c' $pick) (NewFork 'fork-d' $pick) -ShortFirst
        Yes ('two builds configured through ' + $pick + ': at once both use ' + $pick + ':, as their caches need') ($r.A -and $r.B -and $r.A.Drive -eq ($pick + ':') -and $r.B.Drive -eq ($pick + ':'))
        Yes '  the short one made it and the long one shared it' ($r.A -and $r.B -and $r.A.Made -and -not $r.B.Made)
        Yes '  the short one finished while the long one was still building' ($r.LongStill)
        Yes ('  and both finish, every read through the letter finding the fork (' + $r.A.Reads + ' and ' + $r.B.Reads + ' reads)') (BothFinish $r)
        Yes ('  and the last one off removed ' + $pick + ':') (-not (SubstHas $pick))
    } else { Write-Host 'SKIP  no drive letter free for the shared configured-letter case' }
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
