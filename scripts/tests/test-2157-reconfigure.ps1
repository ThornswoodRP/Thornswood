<#
  test-2157-reconfigure.ps1

  #2157: Build-Engine.ps1 skipped the configure whenever the build folder had
  ALL_BUILD.vcxproj, and Build-Server.ps1 never configured at all. The fork's
  CMakeLists collect their sources with file(GLOB_RECURSE), read at configure
  time, so a .cpp a fork change added (PageHeldKeys.cpp, fork #54) was in no
  project and the link failed with LNK2019 until somebody configured by hand.
  Both now generate a configured folder again over its own cache with
  cmake <build folder>.

  A. The fix itself, on real cmake: a scratch project that globs its sources
     is configured, a source file is added, and cmake <build folder> puts it
     in the project while keeping a setting given only at the first configure.
  B. Build-Engine.ps1's configure step, lifted from the script and run with
     Run stubbed: configured, check only, and never configured.
  C. Build-Server.ps1's step, lifted and run with a stand-in cmake: what it is
     given, and that a failing cmake stops the build.

  Scratch folders only. No engine, no fork, nothing built but the scratch
  project's generate step.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$root = Split-Path -Parent (Split-Path -Parent $Here)
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-2157-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $scratch
try {
    # ------------------------------------------------------- A. real cmake --
    $cmake = (Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
    if (-not $cmake) {
        # The folder from Windows itself, not the environment: the build runners
        # thornswood-vps-2 and -3 run with no ProgramFiles(x86) variable, and
        # Join-Path of nothing stopped this harness before it tested anything
        # (main's build at de1a598d, 15 Oct).
        $vswhere = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft Visual Studio\Installer\vswhere.exe'
        if (Test-Path -LiteralPath $vswhere) {
            $vs = & $vswhere -latest -products * -property installationPath | Select-Object -First 1
            $c = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
            if (Test-Path -LiteralPath $c) { $cmake = $c }
        }
    }
    if (-not $cmake) { Write-Host 'SKIP  A: no cmake on this machine' }
    else {
        $src = Join-Path $scratch 'proj'; $bld = Join-Path $src 'build'
        $null = New-Item -ItemType Directory -Path (Join-Path $src 'src')
        Set-Content -LiteralPath (Join-Path $src 'CMakeLists.txt') -Value @(
            'cmake_minimum_required(VERSION 3.16)', 'project(globbed CXX)',
            'file(GLOB_RECURSE sources "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp")',
            'add_library(globbed STATIC ${sources})', 'message(STATUS "KEPT=${KEPT}")') -Encoding ASCII
        Set-Content -LiteralPath (Join-Path $src 'src\a.cpp') -Value 'int a() { return 1; }' -Encoding ASCII
        $ErrorActionPreference = 'Continue'
        $null = & $cmake -S $src -B $bld '-DKEPT=from-the-first-configure' 2>&1; $c1 = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        $proj = @(Get-ChildItem -LiteralPath $bld -Filter 'globbed.*proj' -File) + @(Get-ChildItem -LiteralPath $bld -Filter 'build.ninja' -File) + @(Get-ChildItem -LiteralPath $bld -Filter 'Makefile' -File)
        $listing = { (@(Get-ChildItem -LiteralPath $bld -Recurse -File -Include '*.vcxproj', 'build.ninja', '*.make', 'Makefile' | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n") }
        Yes ('A1: the scratch project configures (exit ' + $c1 + ')') ($c1 -eq 0)
        Set-Content -LiteralPath (Join-Path $src 'src\b.cpp') -Value 'int b() { return 2; }' -Encoding ASCII
        Yes 'A2: a source file added after the configure is in no project, which is #2157' (-not ((& $listing) -match 'b\.cpp'))
        $ErrorActionPreference = 'Continue'
        $out = & $cmake $bld 2>&1 | Out-String; $c2 = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        Yes ('A3: cmake <build folder> succeeds (exit ' + $c2 + ')') ($c2 -eq 0)
        Yes 'A4: and puts the added file in the project' ((& $listing) -match 'b\.cpp')
        Yes 'A5: keeping a setting given only to the first configure' ($out -match 'KEPT=from-the-first-configure')
    }

    # ------------------------------------------- B. Build-Engine.ps1, step 3 --
    $engine = Get-Content -LiteralPath (Join-Path $root 'scripts\release\Build-Engine.ps1') -Raw
    $a = $engine.IndexOf('# ---- 3. configure'); $b = $engine.IndexOf("`nif (`$Check) {", $a)
    Yes 'B0: Build-Engine.ps1 has its configure step where it was' ($a -ge 0 -and $b -gt $a)
    $step = $engine.Substring($a, $b - $a)
    function RunStep([bool]$configured, [bool]$check) {
        $b2 = Join-Path $scratch ('eng-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
        $null = New-Item -ItemType Directory -Path $b2
        if ($configured) { Set-Content -LiteralPath (Join-Path $b2 'ALL_BUILD.vcxproj') -Value '' ; Set-Content -LiteralPath (Join-Path $b2 'CMakeCache.txt') -Value '' }
        $script:calls = New-Object System.Collections.ArrayList
        $script:died = ''
        $sb = [scriptblock]::Create(
            'param($build, $Check, $Fork, $cmake, $SkyrimDir) ' +
            'function Head($m) {}; function Say($m, $c) {}; function Ok($m) {}; function Miss($m) {}; ' +
            'function Die($m) { $script:died = $m }; ' +
            'function Run { [void]$script:calls.Add(@($args)); return 0 }; ' + $step)
        & $sb $b2 $check (Join-Path $scratch 'fork') 'C:\cm\cmake.exe' 'C:\Skyrim'
        return , $script:calls
    }
    $c = RunStep $true $false
    Yes ('B1: a configured build is generated again, once: ' + $c.Count + ' call(s)') ($c.Count -eq 1)
    $line = if ($c.Count) { ($c[0] | ForEach-Object { [string]$_ }) -join ' ' } else { '' }
    $pw = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
    Yes ('B2: with cmake, the pwsh setting and the build folder, so the cache keeps every other setting: ' + $line) ($c.Count -eq 1 -and @($c[0]).Count -eq 3 -and [string]$c[0][0] -eq 'C:\cm\cmake.exe' -and [string]$c[0][1] -eq "-DZ_VCPKG_POWERSHELL_PATH=$pw" -and ([string]$c[0][2]).StartsWith($scratch))
    # #2157 follow-up, 15 Oct: the Store moved pwsh 7.6.6 to 7.6.7 and removed
    # the folder the cache named, so vcpkg's after-link step could not start.
    # The path given is the one Get-Command names, never a WindowsApps
    # version folder.
    Yes ('B2b: the pwsh given is not a Store version folder: ' + $pw) ($pw -and $pw -notmatch 'PowerShell_\d+\.\d+\.\d+\.\d+_')
    $c = RunStep $true $true
    Yes 'B3: -Check generates nothing' ($c.Count -eq 0)
    $c = RunStep $false $false
    $line = if ($c.Count) { ($c[0] | ForEach-Object { [string]$_ }) -join ' ' } else { '' }
    Yes 'B4: a build never configured still gets the full configure line' ($c.Count -eq 1 -and $line -match '-G Visual Studio 17 2022' -and $line -match 'VCPKG_TARGET_TRIPLET=x64-windows-sp' -and $line.Contains("-DZ_VCPKG_POWERSHELL_PATH=$pw"))

    # ------------------------------------------- C. Build-Server.ps1 ---------
    $server = Get-Content -LiteralPath (Join-Path $root 'scripts\release\Build-Server.ps1') -Raw
    $a = $server.IndexOf('# Generated again over its cache (#2157)'); $b = $server.IndexOf("Ok ('generated again over its cache, ' + `$cmake)", $a)
    Yes 'C0: Build-Server.ps1 has the step' ($a -ge 0 -and $b -gt $a)
    $b = $server.IndexOf("`n", $b)
    $step = $server.Substring($a, $b - $a)
    Yes 'C1: and it comes before the compile' ($server.IndexOf('# Generated again over its cache (#2157)') -lt $server.IndexOf("Head 'Building'"))
    $bin = Join-Path $scratch 'bin'; $null = New-Item -ItemType Directory -Path $bin
    $log = Join-Path $scratch 'cmake-args.txt'
    function ServerStep([int]$exit) {
        # A .cmd runs only on Windows; elsewhere the stand-in is a shell script.
        if ($OnWindows) {
            Set-Content -LiteralPath (Join-Path $bin 'cmake.cmd') -Value ("@echo %*>" + '"' + $log + '"' + "`r`n@exit /b $exit") -Encoding ASCII
        } else {
            Set-Content -LiteralPath (Join-Path $bin 'cmake') -Value ("#!/bin/sh`nprintf '%s\n' ""`$*"" > '" + $log + "'`nexit $exit`n") -Encoding ASCII -NoNewline
            & chmod 755 (Join-Path $bin 'cmake')
        }
        Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
        $script:died = ''
        $old = $env:PATH; $env:PATH = $bin + [IO.Path]::PathSeparator + $old
        try {
            $sb = [scriptblock]::Create('param($BuildDir, $vsPath) function Say($m, $c) {}; function Ok($m) {}; function Die($m) { $script:died = $m; return }; ' + $step)
            & $sb 'C:\scratch\build' 'C:\nowhere'
        } finally { $env:PATH = $old }
    }
    ServerStep 0
    $given = if (Test-Path -LiteralPath $log) { (Get-Content -LiteralPath $log -Raw).Trim() } else { '' }
    Yes ('C2: Build-Server.ps1 gives cmake the build folder alone: ' + $given) ($given -eq 'C:\scratch\build' -and -not $script:died)
    ServerStep 3
    Yes ('C3: and stops when it fails: ' + $script:died) ($script:died -match 'exited with 3')
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
