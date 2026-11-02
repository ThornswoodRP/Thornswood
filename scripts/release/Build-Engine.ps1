<#
  Build-Engine.ps1

  Takes a machine from a fresh clone to a built engine: the SkyMP server and
  the client runtime, out of the fork in engine\skymp. Any developer runs it
  on their own machine; nothing about it is Patrick's.

      .\scripts\release\Build-Engine.ps1                first time: checks, configures, builds
      .\scripts\release\Build-Engine.ps1 -Check         says what is missing, changes nothing
      .\scripts\release\Build-Engine.ps1 -Jobs 2        two projects at a time, whatever is free
      .\scripts\release\Build-Engine.ps1 -NoSkyrim      on a machine with no game (a build runner)

  WHY THIS EXISTS. Until 25 September a dev Ship worked only on Patrick's
  machine: Ship checks the client runtime against records\client-build.json,
  and the only built engine was his, configured by hand from a line in
  engine\README.md that no script ran (issue #545). Patrick, asked whether to
  work around it: "Can't we just add the ability and instructions for people
  to do that instead of doing workarounds". This is the ability;
  engine\README.md is the instructions.

  WHAT IT DOES, IN ORDER
    1. Checks the tools: Visual Studio 2022 or its Build Tools with MSBuild
       ("Desktop development with C++"), CMake (the one in Visual Studio is
       found), git, node and yarn. Says exactly what to install for anything
       missing and stops before building.
    2. Fetches the fork at the commit this repository pins, and the fork's own
       submodules (vcpkg among them).
    3. Configures engine\skymp\build if it has never been configured, with
       the settings engine\README.md gives (read off the shipping machine's
       CMakeCache, 24 Sep; the option names checked against the fork's
       CMakeLists.txt on 25 Sep). SKYRIM_DIR is the game folder with
       SkyrimSE.exe in it: Game in the install Where.ps1 Install finds
       (C:\Thornswood\Game on most machines) unless -SkyrimDir says another.
       The first configure builds every vcpkg library and takes a long time.
       A fork whose path has an & in it is reached through a drive letter of
       its own (subst) for configure and build, removed again at the end by
       the last run on it; two builds at once each get their own (#1993).
    4. Builds everything, Release. After the first time only what changed is
       rebuilt, so a fork change that touches the client bundle is quick.
       It compiles as many projects at once as the memory free allows, two
       compilers each, or -Jobs of them (EngineJobs.ps1 says how many and
       why, issue #1203). A compile that runs the machine out of memory says
       so and gives the line to build with fewer.
    5. Compares the six client files with records\client-build.json, the check
       Ship makes, and says whether this build is the recorded one.

  WITH NO GAME ON THE MACHINE (-NoSkyrim, #459). The engine build in CI
  (.github\workflows\engine.yml) runs on a runner with no Skyrim. SKYRIM_DIR
  is left out of the configure, and the fork then does what upstream's own CI
  build does: no Creation Kit compiler is found, so the committed Papyrus
  (skymp5-scripts\pex and TESModPlatform.pex) goes into the build as it is
  (fork #31, #1220; New-ServerBuildRecord.ps1 holds data\scripts to it), and
  the server-settings.json the configure writes names no plugin paths, which
  no deploy takes from a build before Deploy-Gamemode.ps1 writes them. Every
  recorded server file and the six client files are built from the fork's
  source either way. On a runner, CI=true is taken out of the run's
  environment first, so the fork builds with its own vcpkg (EngineJobs.ps1,
  Clear-EngineCiSwitch).

  WHAT IT DOES NOT DO. It never changes a record: when the build is not the
  recorded one it says so, and New-ClientBuildRecord.ps1 is the step for a
  deliberate engine change (engine\README.md). It sends nothing anywhere and
  never touches the game folder; Sync-Client.ps1 copies the files in.
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [string]$SkyrimDir = ((& (Join-Path $PSScriptRoot 'Where.ps1') Install) + '\Game'),
    [string]$Fork = (& (Join-Path $PSScriptRoot 'Where.ps1') Engine),
    # Projects compiled at once, two compilers each. 0, the default, works
    # it out from the memory free when the build starts (EngineJobs.ps1).
    [ValidateRange(0, 64)]
    [int]$Jobs = 0,
    # Configure with no SKYRIM_DIR, on a machine with no game (#459, the
    # header's WITH NO GAME ON THE MACHINE).
    [switch]$NoSkyrim,
    [switch]$NoPause
)
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named

function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Ok($m) { Write-Host ('  ok       ' + $m) -ForegroundColor Green }
function Miss($m) { Write-Host ('  MISSING  ' + $m) -ForegroundColor Red }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }
. (Join-Path $PSScriptRoot 'EngineJobs.ps1')
# The fork's own vcpkg on a build runner too, before anything runs cmake (#459).
$ciSaid = Clear-EngineCiSwitch
if ($ciSaid) { Say ('  ' + $ciSaid) 'DarkGray' }
# Native tools write progress to stderr; the exit code alone decides. Their
# output is written to the screen, not returned: returned, every line cmake
# printed came back with the code, "$code -ne 0" was true for any configure
# or build that printed anything, and a configure that succeeded stopped with
# "cmake configure exited with ... 0" (found building for #919).
# $script:RunOutOfMemory is the first out of memory error the tool printed,
# or '' (#1203), so a failed build can say the machine ran out.
function Run {
    $ErrorActionPreference = 'Continue'
    $script:RunOutOfMemory = ''
    & $args[0] @($args | Select-Object -Skip 1) 2>&1 | ForEach-Object {
        $oom = Get-EngineOutOfMemoryCode ([string]$_)
        if ($oom -and -not $script:RunOutOfMemory) { $script:RunOutOfMemory = $oom }
        Write-Host $_
    }
    return [int]$LASTEXITCODE
}

# A fork under a path cmd.exe splits (issue #1025). vcpkg bootstraps through
# bootstrap-vcpkg.bat, and cmd ends a command at a bare &, so a fork under
# C:\ThornswoodTemps&Worktrees, where every worktree went until #2900, stopped at
# Configure with "'C:\ThornswoodTemps' is not recognized". So for configure
# and build the fork's parent folder is reached through a drive letter of its
# own (subst), and the letter is removed again when this ends. The parent and
# not the fork itself: the fork's CMakeLists.txt compares the build folder
# with <fork>/build, and a drive root gives J://build. A build configured
# through a letter is built through the same one, or cmake refuses the cache.
function Test-CmdSplitsPath([string]$Path) { return ($Path -match '[&|<>^%!]') }
function Get-SubstMap {
    $map = @{}
    foreach ($l in @(& (Join-Path $env:SystemRoot 'System32\subst.exe') 2>$null)) {
        $m = [regex]::Match([string]$l, '^([A-Za-z]):\\: => (.+)$')
        if ($m.Success) { $map[$m.Groups[1].Value.ToUpper()] = $m.Groups[2].Value.TrimEnd('\') }
    }
    return $map
}
# Two builds at once (issue #1993). Measured on One on 5 Oct: two forks under
# C:\ThornswoodTemps&Worktrees\worktrees shared one letter, because a run
# reused whatever letter already stood for the parent, and the run that made
# it removed it when it ended, so the other lost its paths mid-compile. Now:
#  - a fork not yet configured gets a letter of its own, never one another run
#    stands on, so two first builds never share one;
#  - a fork configured through a letter must be built through that letter, so
#    two such forks can still need the same one. Every run on a letter holds a
#    file for it under %TEMP%\thornswood-engine-subst\<letter>, open with no
#    sharing, and the letter is removed only by the last run to let go, and
#    only if a build made it (a letter made by hand is left as it was).
# Picking and making a letter, and letting go of one, are done under one
# mutex, so two runs cannot pick the same free letter at the same moment.
function Get-EngineSubstDir([string]$Letter) {
    $d = Join-Path (Join-Path ([IO.Path]::GetTempPath()) 'thornswood-engine-subst') $Letter.ToUpper()
    $null = [IO.Directory]::CreateDirectory($d)
    return $d
}
function Enter-EngineSubstLock {
    $mx = New-Object Threading.Mutex($false, 'Local\ThornswoodEngineSubst')
    # An abandoned mutex is still handed to this run: WaitOne throws to say the
    # run that held it ended without letting go, and this run holds it now.
    # Written with Write-Host, not Say, because tests\test-engine-drive-letter.ps1
    # lifts these functions on their own.
    try { $null = $mx.WaitOne() } catch [Threading.AbandonedMutexException] {
        Write-Host '  note: the last run to hold the drive letter lock ended without letting it go; this run holds it now' -ForegroundColor DarkGray
    }
    return $mx
}
# A file under the letter's folder, held open for as long as this run uses it.
function Add-EngineSubstHold([string]$Letter) {
    $f = Join-Path (Get-EngineSubstDir $Letter) ('hold-' + $PID + '-' + [Guid]::NewGuid().ToString('N'))
    return [IO.File]::Open($f, 'CreateNew', 'ReadWrite', 'None')
}
# How many other runs still hold the letter: a hold file that cannot be
# deleted is open in a run that is still going; one that can was left by a
# run that ended without letting go, and is cleared.
function Get-EngineSubstHolders([string]$Letter) {
    $n = 0
    foreach ($h in @(Get-ChildItem -LiteralPath (Get-EngineSubstDir $Letter) -Filter 'hold-*' -File -ErrorAction SilentlyContinue)) {
        try { [IO.File]::Delete($h.FullName) } catch { $n++ }
    }
    return $n
}
# @{ Fork = the fork's path to build from; Drive = 'J:' or ''; Made = whether
# this run made the letter; Hold = this run's hold on it; Why = why it could not }.
function Mount-EngineFork([string]$Fork) {
    $r = @{ Fork = $Fork; Drive = ''; Made = $false; Hold = $null; Why = '' }
    if (-not (Test-CmdSplitsPath $Fork)) { return $r }
    $parent = (Split-Path -Parent $Fork).TrimEnd('\')
    $leaf = Split-Path -Leaf $Fork
    $mx = Enter-EngineSubstLock
    try {
        $subst = Get-SubstMap
        $letter = ''
        $cache = Join-Path $Fork 'build\CMakeCache.txt'
        if (Test-Path -LiteralPath $cache) {
            $m = [regex]::Match((Get-Content -LiteralPath $cache -Raw), '(?m)^CMAKE_CACHEFILE_DIR:INTERNAL=(([A-Za-z]):/[^\r\n]*)')
            # Configured on the path itself (vcpkg was bootstrapped some other
            # way): build it where it was configured.
            if ($m.Success -and $m.Groups[1].Value.TrimEnd('/') -eq ($Fork.TrimEnd('\') + '\build').Replace('\', '/')) { return $r }
            if ($m.Success) { $letter = $m.Groups[2].Value.ToUpper() }
            if ($letter -and -not $subst.ContainsKey($letter) -and (Test-Path -LiteralPath ($letter + ':\'))) {
                $r.Why = ('the build in ' + (Join-Path $Fork 'build') + ' was configured through ' + $letter + ':, which is now another drive. Free ' + $letter + ': or delete that build folder to configure it again.')
                return $r
            }
        }
        if (-not $letter) {
            # A letter of this run's own: not a drive, not a subst, and not one
            # another run holds (its subst could be gone a moment before ours).
            $taken = @([IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name.Substring(0, 1).ToUpper() })
            $letter = @('T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'S', 'R', 'Q', 'P', 'O', 'N', 'M', 'L', 'K', 'J', 'I', 'H') |
                      Where-Object { $taken -notcontains $_ -and -not $subst.ContainsKey($_) -and -not (Get-EngineSubstHolders $_) } | Select-Object -First 1
            if (-not $letter) { $r.Why = 'no drive letter is free to reach ' + $parent + ' through.'; return $r }
        }
        if ($subst.ContainsKey($letter)) {
            if ($subst[$letter] -ne $parent) {
                $r.Why = ($letter + ': already stands for ' + $subst[$letter] + ', and the build in ' + (Join-Path $Fork 'build') + ' was configured through it. Remove it (subst ' + $letter + ': /d) and run this again.')
                return $r
            }
        } else {
            & (Join-Path $env:SystemRoot 'System32\subst.exe') ($letter + ':') $parent | Out-Null
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path ($letter + ':\') $leaf))) {
                $r.Why = 'subst could not make ' + $letter + ': stand for ' + $parent + '.'
                return $r
            }
            $r.Made = $true
            # Marks the letter as a build's, so the last run off it removes it.
            [IO.File]::WriteAllText((Join-Path (Get-EngineSubstDir $letter) 'made'), $parent)
        }
        $r.Hold = Add-EngineSubstHold $letter
        $r.Drive = $letter + ':'
        $r.Fork = $letter + ':\' + $leaf
        return $r
    } finally { $mx.ReleaseMutex(); $mx.Dispose() }
}
# Lets go of the letter; removes it when no other run holds it and a build made it.
function Dismount-EngineFork($Mount) {
    if (-not $Mount -or -not $Mount.Drive) { return }
    $letter = $Mount.Drive.Substring(0, 1)
    $mx = Enter-EngineSubstLock
    try {
        if ($Mount.Hold) {
            $f = $Mount.Hold.Name
            $Mount.Hold.Dispose(); $Mount.Hold = $null
            Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
        }
        $made = Join-Path (Get-EngineSubstDir $letter) 'made'
        if ((Test-Path -LiteralPath $made) -and -not (Get-EngineSubstHolders $letter)) {
            & (Join-Path $env:SystemRoot 'System32\subst.exe') $Mount.Drive /d | Out-Null
            Remove-Item -LiteralPath $made -Force -ErrorAction SilentlyContinue
        }
    } finally { $mx.ReleaseMutex(); $mx.Dispose() }
}
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$build = Join-Path $Fork 'build'
$record = Join-Path $repo 'records\client-build.json'

# ---- 1. tools ---------------------------------------------------------------
Head 'Tools'
$missing = 0
$msbuild = $null; $vsPath = $null
$vswhere = $null
if (${env:ProgramFiles(x86)}) { $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe' }
if ($vswhere -and (Test-Path -LiteralPath $vswhere)) {
    $vsPath = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath 2>$null | Select-Object -First 1
}
if ($vsPath -and (Test-Path -LiteralPath (Join-Path $vsPath 'MSBuild\Current\Bin\MSBuild.exe'))) {
    $msbuild = Join-Path $vsPath 'MSBuild\Current\Bin\MSBuild.exe'; Ok "MSBuild, $vsPath"
} else { Miss 'Visual Studio 2022 or Build Tools 2022 with the "Desktop development with C++" workload: https://visualstudio.microsoft.com/downloads/'; $missing++ }

$cmake = (Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $cmake -and $vsPath) {
    $c = Join-Path $vsPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
    if (Test-Path -LiteralPath $c) { $cmake = $c }
}
if ($cmake) { Ok "cmake, $cmake" } else { Miss 'CMake: the C++ workload above installs it'; $missing++ }
foreach ($t in @(
        @{ Name = 'git'; How = 'Git for Windows: https://git-scm.com/download/win' },
        @{ Name = 'node'; How = 'Node.js 24: https://nodejs.org/' },
        @{ Name = 'yarn'; How = 'yarn: run  corepack enable  in an administrator PowerShell once Node is in (the fork builds its client with yarn)' })) {
    $g = Get-Command $t.Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($g) { Ok ($t.Name + ', ' + $g.Source) } else { Miss $t.How; $missing++ }
}
if ($NoSkyrim) { Ok 'no game needed: -NoSkyrim configures without SKYRIM_DIR, so the committed Papyrus goes in' }
elseif (Test-Path -LiteralPath (Join-Path $SkyrimDir 'SkyrimSE.exe')) { Ok "SkyrimSE.exe in $SkyrimDir" }
else { Miss "SkyrimSE.exe in $SkyrimDir. Install Thornswood first (the launcher makes that folder), or pass -SkyrimDir with the folder that has it."; $missing++ }
if ($missing) { Die "$missing thing(s) missing, listed above. Nothing was built." }

# ---- 2. the fork ------------------------------------------------------------
Head 'The fork'
if (-not (Test-Path -LiteralPath (Join-Path $Fork 'CMakeLists.txt'))) {
    if ($Check) { Miss "the fork is not checked out at $Fork; this run would fetch it" }
    else {
        Say "  fetching the fork into $Fork (the commit this repository pins)"
        if ((Run git -C $repo submodule update --init engine/skymp) -ne 0) { Die 'git could not fetch engine\skymp. Is this a clone of the repository, and can this account read ThornswoodRP/skymp?' }
    }
}
# Read with Continue: a fork that is not there yet (-Check says this run would
# fetch it) makes git say "fatal" on stderr, and under Stop Windows
# PowerShell 5.1 ended -Check there, even through 2>$null. The exit code decides.
$ErrorActionPreference = 'Continue'
$pinned = ((& git -C $repo ls-tree HEAD engine/skymp 2>$null) -split '\s+')[2]
$at = (& git -C $Fork rev-parse HEAD 2>$null | Select-Object -First 1)
if ($LASTEXITCODE -ne 0) { $at = $null }
$ErrorActionPreference = 'Stop'
if ($at) {
    Say ("  pinned   {0}" -f $pinned)
    Say ("  at       {0}" -f $at)
    if ($pinned -and $at -ne $pinned) { Say '  NOTE: the fork is not at the pinned commit. That is expected while you change the engine; otherwise run  git submodule update engine/skymp' 'Yellow' }
}
if (-not $Check -and (Test-Path -LiteralPath (Join-Path $Fork 'CMakeLists.txt'))) {
    Say '  the fork''s own submodules (vcpkg among them)'
    if ((Run git -C $Fork submodule update --init --recursive) -ne 0) { Die 'git could not fetch the fork''s submodules.' }
    Ok 'fork ready'
}

# The path cmake and vcpkg are given: through a drive letter of its own when
# cmd.exe would split the fork's (Mount-EngineFork above says why).
$mount = $null
if (Test-CmdSplitsPath $Fork) {
    if ($Check) { Say ('  {0} has a character cmd.exe splits a path at; configure and build reach it through a drive letter of their own (subst), removed again at the end' -f $Fork) 'Yellow' }
    else {
        $mount = Mount-EngineFork $Fork
        if ($mount.Why) { Die ('the fork''s path has a character cmd.exe splits a path at, and ' + $mount.Why) }
        Ok ('{0} stands for {1} while this runs, so vcpkg''s bootstrap gets a path cmd.exe can take' -f $mount.Drive, (Split-Path -Parent $Fork))
        $Fork = $mount.Fork
        $build = Join-Path $Fork 'build'
    }
}
# Steps 3 to 5 run inside this try, so the letter goes however they end.
try {

# ---- 3. configure -----------------------------------------------------------
Head 'Configure'
# Configured means the solution the build step runs is there. CMakeCache.txt is
# written at the start of a configure, so one that stopped part way (a vcpkg
# download that could not resolve its host, 5 Oct) left the cache and no
# ALL_BUILD.vcxproj, and the next run skipped the configure and stopped at
# MSB1009. A configure over that cache carries on from it.
$cache = Join-Path $build 'CMakeCache.txt'
$solution = Join-Path $build 'ALL_BUILD.vcxproj'
# A build already configured is generated again over its own cache every run
# (#2157). The fork's CMakeLists collect their sources with GLOB_RECURSE, and
# a glob is read at configure time, so a fork change that adds a .cpp (fork
# #54's PageHeldKeys.cpp, 11 Oct) was in no project and the link failed with
# LNK2019 until somebody configured by hand. Given only the build folder,
# cmake takes the source, the generator and every setting from the cache, so
# nothing is rebuilt in vcpkg; it took 16 s on One.
# vcpkg runs its applocal.ps1 after each link through the PowerShell its
# toolchain found at the first configure, kept in the cache. find_program
# turns the Store's pwsh alias into the version's own folder
# (WindowsApps\Microsoft.PowerShell_7.6.6.0_x64__...), and a Store update
# removes that folder: on 15 Oct 7.6.6 became 7.6.7 and every link stopped
# with "The system cannot find the path specified" (MSB3073, exit 3). So the
# build is given the pwsh this machine runs by the path Get-Command names,
# the alias itself, which stays put across updates, on every configure.
$vcpkgPwsh = Get-Command pwsh -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
$pwshArg = @(if ($vcpkgPwsh) { "-DZ_VCPKG_POWERSHELL_PATH=$vcpkgPwsh" })
if ((Test-Path -LiteralPath $solution) -and $Check) { Ok "already configured: $build; this run would generate it again over its cache, so a source file the fork added is built" }
elseif (Test-Path -LiteralPath $solution) {
    Say '  already configured; generating again over its cache, so a source file the fork added since is in the build'
    $code = Run $cmake @pwshArg $build
    if ($code -ne 0) { Die "cmake exited with $code generating $build again over its cache. The first error above is usually the real one." }
    Ok "generated again: $build"
}
elseif ($Check -and (Test-Path -LiteralPath $cache)) { Miss "$build was configured part way (no ALL_BUILD.vcxproj); this run would configure it again from where it stopped" }
elseif ($Check) { Miss "$build is not configured; this run would configure it (the first time builds every vcpkg library, which is slow)" }
else {
    $toolchain = Join-Path $Fork 'vcpkg\scripts\buildsystems\vcpkg.cmake'
    Say '  configuring. The first time builds every vcpkg library; expect it to take a long while.'
    # -NoSkyrim leaves SKYRIM_DIR out (the header's WITH NO GAME ON THE MACHINE).
    $skyrimArg = @(if (-not $NoSkyrim) { "-DSKYRIM_DIR=$SkyrimDir" })
    $code = Run $cmake -S $Fork -B $build -G 'Visual Studio 17 2022' -A x64 "-DCMAKE_TOOLCHAIN_FILE=$toolchain" '-DVCPKG_TARGET_TRIPLET=x64-windows-sp' '-DOFFLINE_MODE=ON' '-DBUILD_CLIENT=ON' '-DBUILD_SKYRIM_PLATFORM=ON' @skyrimArg @pwshArg
    if ($code -ne 0) { Die "cmake configure exited with $code. The first error above is usually the real one." }
    Ok 'configured'
}

if ($Check) {
    Head 'Check finished'
    Say '  Nothing was changed. Run without -Check to fetch, configure and build.' 'Yellow'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ---- 4. build ---------------------------------------------------------------
Head 'Build'
Say '  Release, everything (only what changed, after the first time)'
# Projects at once from the memory free, not a bare /m, which started one per
# core and ran a busy machine out of memory (#1203, EngineJobs.ps1).
$free = Get-EngineFreeBytes
$atOnce = $Jobs
if ($atOnce -lt 1) {
    $atOnce = Get-EngineJobs $free ([Environment]::ProcessorCount)
    Say ('  {0} project(s) at once, {1} compilers each, for {2:N1} GB free (-Jobs sets it)' -f $atOnce, $EngineCompilersPerJob, ($free / 1GB))
} else {
    Say ('  {0} project(s) at once, {1} compilers each, as -Jobs says ({2:N1} GB free)' -f $atOnce, $EngineCompilersPerJob, ($free / 1GB))
}
$jobArgs = Get-EngineMSBuildArgs $atOnce
# '--' is quoted: bare, PowerShell takes it as the end of Run's own
# parameters and drops it, and cmake then refuses /m as its own argument.
$code = Run $cmake --build $build --config Release '--' @jobArgs /v:minimal /nologo
if ($code -ne 0 -and $script:RunOutOfMemory) {
    Die (Get-EngineOutOfMemoryAdvice $script:RunOutOfMemory $atOnce $free (Get-EngineAgainLine '.\scripts\release\Build-Engine.ps1' $PSBoundParameters))
}
if ($code -ne 0) { Die "the build exited with $code. The errors are above; the first one is usually the only real one." }
Ok 'built'

# ---- 5. the recorded client -------------------------------------------------
Head 'Is this the recorded client?'
$rec = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $record -Raw) $record
$dist = Join-Path $build 'dist\client'
$differ = 0
foreach ($rel in @($rec.files.PSObject.Properties.Name)) {
    $p = Join-Path $dist $rel
    if (-not (Test-Path -LiteralPath $p)) { Miss $rel; $differ++; continue }
    $h = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($h -eq $rec.files.$rel.sha256) { Ok $rel } else { Say ('  differs  ' + $rel) 'Yellow'; $differ++ }
}
Say ''
if ($differ) {
    Say "  $differ of the six are not the recorded build (records\client-build.json, fork $($rec.forkCommit))." 'Yellow'
    Say '  If you changed the engine on purpose: .\scripts\release\New-ClientBuildRecord.ps1, and the new record goes in your pull request.' 'Gray'
    Say '  If you did not: the fork is not at the pinned commit, or this machine builds the native files differently; engine\README.md says what to do.' 'Gray'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 2
}
Say '  All six are the recorded build. .\scripts\release\Sync-Client.ps1 puts them in the game, and a dev Ship will accept them.' 'Green'
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0

} finally { Dismount-EngineFork $mount }
