<#
  test-build-engine.ps1

  scripts\release\Build-Engine.ps1, the script any developer runs to build
  the engine on their own machine (issue #545), and the two reorganisation
  leftovers the 25 September audit found beside it.

  WHY THIS EXISTS. The configure line lived only in engine\README.md, typed by
  hand, and Build-Server.ps1 refuses to configure, so no machine but
  Patrick's had ever built the engine and only his could Ship. This holds the
  script to the settings engine\README.md gives and to the fork's own option
  names, and checks that on a machine missing the tools it says so and builds
  nothing.

  It also checks Publish-Update.ps1 no longer hashes the launcher source at
  all (it read tools\ until the audit, then launcher\; since #4825 no launcher
  goes on the feed, so its source is no part of a release), and that
  Check-VoiceInstall.ps1 no longer names one person's Downloads folder.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$root = Split-Path -Parent $Here
$script = Join-Path $root 'scripts\release\Build-Engine.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$text = Get-Content -LiteralPath $script -Raw
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$errs)
Yes 'Build-Engine.ps1 parses' ($errs.Count -eq 0)

# The configure settings, the same as engine\README.md's.
$readme = Get-Content -LiteralPath (Join-Path $root 'engine\README.md') -Raw
foreach ($s in 'Visual Studio 17 2022', '-A x64', 'VCPKG_TARGET_TRIPLET=x64-windows-sp', 'OFFLINE_MODE=ON', 'BUILD_CLIENT=ON', 'BUILD_SKYRIM_PLATFORM=ON', 'SKYRIM_DIR') {
    Yes "it configures with $s, as engine\README.md does" ($text.Contains($s) -and $readme.Contains($s))
}
Yes 'it points the toolchain at the fork''s own vcpkg' ($text.Contains('vcpkg\scripts\buildsystems\vcpkg.cmake'))
Yes 'it never writes a record' ($text -notmatch '&\s*\(?Join-Path[^\n]*New-(Client|Server)BuildRecord')
Yes 'it compares the six client files with records\client-build.json' ($text.Contains('records\client-build.json') -and $text.Contains('Get-FileHash'))

# Run hands back the exit code alone. It used to return the tool's output
# with it, so a configure that printed anything and exited 0 stopped as a
# failure (#919). The real function, run on a tool that prints and exits 0,
# then on one that prints and exits 3.
$runAst = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$null).Find({
        param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Run' }, $true)
Yes 'it has a Run function' ($null -ne $runAst)
if ($runAst) {
    # Run notes out of memory errors with EngineJobs.ps1, which the script
    # dot-sources (#1203; scripts\tests\test-1203-engine-jobs.ps1 holds that half).
    $withJobs = ". '" + (Join-Path $root 'scripts\release\EngineJobs.ps1') + "'; " + $runAst.Extent.Text
    # The tool is this PowerShell, started as a program, so the check runs
    # wherever the harness does (#2957; it was cmd.exe, which only Windows has).
    $tool = "'" + (Get-Process -Id $PID).Path.Replace("'", "''") + "'"
    $runOk = & ([scriptblock]::Create($withJobs + '; Run ' + $tool + ' -NoProfile -NonInteractive -Command "[Console]::Out.WriteLine(''printed''); [Console]::Error.WriteLine(''also'')"')) 6>$null
    Yes 'Run returns 0, and only 0, for a tool that prints and succeeds' ((@($runOk).Count -eq 1) -and ($runOk -eq 0))
    $runBad = & ([scriptblock]::Create($withJobs + '; Run ' + $tool + ' -NoProfile -NonInteractive -Command "[Console]::Out.WriteLine(''printed''); exit 3"')) 6>$null
    Yes 'Run returns 3, and only 3, for a tool that prints and fails with 3' ((@($runBad).Count -eq 1) -and ($runBad -eq 3))
}
# A bare -- in a call to Run is eaten by PowerShell, so cmake got /m as its
# own argument and refused it. The build line quotes it, and what follows is
# the bounded /m:N of #1203.
$buildLine = @($text -split "`n" | Where-Object { $_ -match '^\s*\$code = Run \$cmake --build' })
Yes 'the build passes -- through to MSBuild quoted' ($buildLine.Count -eq 1 -and $buildLine[0] -match "'--' @jobArgs")

# Against the fork, when it is checked out here.
$cm = Join-Path $root 'engine\skymp\CMakeLists.txt'
if (Test-Path -LiteralPath $cm) {
    $c = Get-Content -LiteralPath $cm -Raw
    foreach ($o in 'OFFLINE_MODE', 'BUILD_CLIENT', 'BUILD_SKYRIM_PLATFORM', 'SKYRIM_DIR') {
        Yes "the fork's CMakeLists.txt has the option $o" ($c -match "option\($o\b")
    }
    Yes 'the fork defaults its triplet to x64-windows-sp' ($c.Contains('x64-windows-sp'))
} else { Write-Host 'SKIP  the fork is not checked out here, so its option names were not read' }

# A configure that stopped part way leaves CMakeCache.txt and no solution; on
# 5 Oct the next run took the cache as configured and MSBuild stopped at
# MSB1009 for want of ALL_BUILD.vcxproj. Configured is the solution.
Yes 'it calls the build configured only when ALL_BUILD.vcxproj is there' (
    $text -match "\`$solution = Join-Path \`$build 'ALL_BUILD\.vcxproj'" -and
    $text -match 'if \(\(Test-Path -LiteralPath \$solution\) -and \$Check\) \{ Ok "already configured' -and
    $text -match 'elseif \(Test-Path -LiteralPath \$solution\) \{' -and
    $text -notmatch 'if \(Test-Path -LiteralPath \$cache\) \{ Ok "already configured')

# On a machine without the tools: it says what is missing and builds nothing.
$fake = Join-Path ([IO.Path]::GetTempPath()) ('ts-engine-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fake | Out-Null
try {
    $saved = ${env:ProgramFiles(x86)}
    ${env:ProgramFiles(x86)} = $fake
    $out = & $script -Check -NoPause -SkyrimDir (Join-Path $fake 'nogame') -Fork (Join-Path $fake 'fork') *>&1 | Out-String
    $code = $LASTEXITCODE
    ${env:ProgramFiles(x86)} = $saved
    Yes 'with no Visual Studio it stops' ($code -eq 1 -and $out -match 'Nothing was built')
    Yes '  and names Visual Studio and the workload' ($out -match 'Desktop development with C\+\+')
    Yes '  and names the missing game folder' ($out -match 'SkyrimSE\.exe in')
    Yes '  and made no build folder' (-not (Test-Path -LiteralPath (Join-Path $fake 'fork\build')))
}
finally { Remove-Item -LiteralPath $fake -Recurse -Force -ErrorAction SilentlyContinue }

# A fork under a path with an & in it (#1025): vcpkg bootstraps through a
# .bat, and cmd.exe cuts the path at the &. Build-Engine reaches the fork's
# parent through a drive letter of its own for the run and removes it after.
# The real functions, lifted by the parser, on a scratch fork whose .bat
# stands in for vcpkg's bootstrap.
$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$null)
$lift = @()
$liftNames = 'Test-CmdSplitsPath', 'Get-SubstMap', 'Get-EngineSubstDir', 'Enter-EngineSubstLock', 'Add-EngineSubstHold', 'Get-EngineSubstHolders', 'Mount-EngineFork', 'Dismount-EngineFork'
foreach ($fn in $liftNames) {
    $d = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $fn }, $true)
    Yes "it has $fn" ($null -ne $d)
    if ($d) { $lift += $d.Extent.Text }
}
Yes 'configure and build run inside a try whose finally removes the letter' ($text -match '(?s)\$mount = Mount-EngineFork \$Fork.*\} finally \{ Dismount-EngineFork \$mount \}\s*$')

# Runs one .bat through cmd.exe and returns everything it printed as text.
# Given the bare path, cmd.exe prints "is not recognized" on its own stderr,
# and under Stop Windows PowerShell 5.1 turns a native stderr line into a
# terminating NativeCommandError, so the harness ended at that call (#1954;
# 7 does not). Continue, for this one call, lets the line arrive as output to
# be read, as Invoke-ThornswoodNative in scripts\vps\Vps.ps1 does for ssh;
# "$_" makes 5.1's error records plain text.
function Read-CmdBat([string]$Bat) {
    $ErrorActionPreference = 'Continue'
    $cmdExe = Get-WindowsPath 'System32\cmd.exe'
    return (& $cmdExe /d /c ($Bat + ' 2>&1') 2>&1 | ForEach-Object { "$_" } | Out-String)
}

if (-not $OnWindows) { Write-Host 'SKIP  a fork under a path with an &: its drive letter is a subst and its bootstrap a cmd.exe run, which only Windows has' }
elseif ($lift.Count -eq $liftNames.Count) {
    . ([scriptblock]::Create($lift -join "`n"))
    $amp = Join-Path ([IO.Path]::GetTempPath()) ('ts-engine-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '\wt&x')
    $forkA = Join-Path $amp 'fork'
    $mounts = @()
    try {
        New-Item -ItemType Directory -Force -Path $forkA | Out-Null
        [IO.File]::WriteAllText((Join-Path $forkA 'CMakeLists.txt'), '# stand-in')
        [IO.File]::WriteAllText((Join-Path $forkA 'bootstrap.bat'), "@echo off`r`necho bootstrapped from %~dp0`r`n")
        $plain = Mount-EngineFork 'C:\plain\fork'
        Yes 'a fork with no & in its path is built where it is' ($plain.Fork -eq 'C:\plain\fork' -and -not $plain.Drive -and -not $plain.Why)

        $bare = Read-CmdBat (Join-Path $forkA 'bootstrap.bat')
        Yes 'the stand-in bootstrap, given the path with the & bare, is cut at the & (as vcpkg''s was)' ($bare -notmatch 'bootstrapped from')

        $m = Mount-EngineFork $forkA
        $mounts += $m
        Yes ('a fork under a path with an & is reached through a drive letter of its own (' + $m.Drive + ' ' + $m.Why + ')') (
            $m.Drive -match '^[A-Z]:$' -and $m.Made -and $m.Fork -eq ($m.Drive + '\fork') -and (Test-Path -LiteralPath (Join-Path $m.Fork 'CMakeLists.txt')))
        Yes '  standing for the fork''s parent, not the fork, so its build folder is not J://build' ((Get-SubstMap)[$m.Drive.Substring(0, 1)] -eq $amp)
        $through = Read-CmdBat (Join-Path $m.Fork 'bootstrap.bat')
        Yes '  and the same bootstrap, given that path, runs' ($through -match ('bootstrapped from ' + [regex]::Escape($m.Fork + '\')))
        # A second run while it stands gets a letter of its own (#1993): it
        # used to reuse this one, and the first run's end took it away.
        $again = Mount-EngineFork $forkA
        $mounts += $again
        Yes ('  a second run while it stands gets a letter of its own (' + $again.Drive + ')') ($again.Drive -match '^[A-Z]:$' -and $again.Drive -ne $m.Drive -and $again.Made)
        Dismount-EngineFork $m
        Yes '  and the first run''s end removes only its own letter' (-not (Test-Path -LiteralPath ($m.Drive + '\')) -and (Test-Path -LiteralPath (Join-Path $again.Fork 'CMakeLists.txt')))
        Dismount-EngineFork $again
        Yes '  and the run that made each removes it at the end' (-not (Get-SubstMap).ContainsKey($m.Drive.Substring(0, 1)) -and -not (Get-SubstMap).ContainsKey($again.Drive.Substring(0, 1)) -and -not (Test-Path -LiteralPath ($again.Drive + '\')))

        # A build configured through a letter is built through the same one.
        $cacheDir = Join-Path $forkA 'build'
        New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
        $cacheFile = Join-Path $cacheDir 'CMakeCache.txt'
        $taken = @([IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name.Substring(0, 1).ToUpper() })
        $pick = @('Y', 'X', 'W', 'V', 'U', 'T', 'S', 'R') | Where-Object { $taken -notcontains $_ -and -not (Get-SubstMap).ContainsKey($_) } | Select-Object -First 1
        if ($pick) {
            [IO.File]::WriteAllText($cacheFile, "CMAKE_CACHEFILE_DIR:INTERNAL=${pick}:/fork/build`r`n")
            $c = Mount-EngineFork $forkA
            $mounts += $c
            Yes ('a fork configured through ' + $pick + ': is built through ' + $pick + ': again (' + $c.Drive + ')') ($c.Drive -eq ($pick + ':') -and $c.Made -and (Test-Path -LiteralPath (Join-Path $c.Fork 'CMakeLists.txt')))
            # Two runs on the same configured letter: the one that made it
            # ending first leaves it for the other, and the last one off removes it.
            $c2 = Mount-EngineFork $forkA
            $mounts += $c2
            Yes '  a second run on that configured letter shares it' ($c2.Drive -eq $c.Drive -and -not $c2.Made -and $c2.Hold)
            Dismount-EngineFork $c
            Yes '  and the run that made it ending first leaves it while the other still holds it' (Test-Path -LiteralPath (Join-Path $c2.Fork 'CMakeLists.txt'))
            Dismount-EngineFork $c2
            Yes '  and the last run off it removes it' (-not (Get-SubstMap).ContainsKey($pick) -and -not (Test-Path -LiteralPath ($pick + ':\')))
        } else { Write-Host 'SKIP  no drive letter free for the configured-through-a-letter case' }
        [IO.File]::WriteAllText($cacheFile, ('CMAKE_CACHEFILE_DIR:INTERNAL=' + $cacheDir.Replace('\', '/') + "`r`n"))
        $d = Mount-EngineFork $forkA
        $mounts += $d
        Yes 'a fork configured on its own path is built there, with no letter' ($d.Fork -eq $forkA -and -not $d.Drive -and -not $d.Why)
        [IO.File]::WriteAllText($cacheFile, "CMAKE_CACHEFILE_DIR:INTERNAL=C:/somewhere/fork/build`r`n")
        $e = Mount-EngineFork $forkA
        $mounts += $e
        Yes 'a fork configured through a letter that is now a real drive is refused, saying what to do' ($e.Why -match 'configured through C:, which is now another drive' -and -not $e.Made)
    }
    finally {
        foreach ($x in $mounts) { Dismount-EngineFork $x }
        Remove-Item -LiteralPath (Split-Path -Parent $amp) -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Yes 'engine\README.md says a fork under a path with an & builds, and how' ($readme -match 'subst' -and $readme -match '#1025')

# The audit's two leftovers.
$pu = Get-Content -LiteralPath (Join-Path $root 'scripts\release\Publish-Update.ps1') -Raw
Yes 'Publish-Update records no launcher source, which no release carries since #4825' ($pu -notmatch '\$srcDir\b' -and $pu -match '#4825')
$cv = Get-Content -LiteralPath (Join-Path $root 'scripts\vps\Check-VoiceInstall.ps1') -Raw
Yes 'Check-VoiceInstall reads Install-Voice beside it, not a Downloads folder' ($cv -notmatch 'Users\\[^\\]+\\Downloads' -and $cv.Contains("Join-Path `$PSScriptRoot '..\deploy\Install-Voice.ps1'"))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
