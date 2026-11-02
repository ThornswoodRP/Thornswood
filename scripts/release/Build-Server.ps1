<#
  Build-Server.ps1

  Compiles the game server out of our fork and puts the result where
  Deploy-Server.ps1 and Publish-Server.ps1 expect to find it.

  WHY THIS EXISTS

  Every engine change we make lives in the fork, engine\skymp in this
  repository (scripts\release\Where.ps1 Engine says where), on the branch
  thornswood/engine-changes, and until now the only way to turn one into a
  running server was to remember a cmake line and a Visual Studio project name
  and type them by hand. That is fine once. It is not fine when the next
  question is "is the fix in the build that is up there", because the answer
  depends on a command nobody wrote down.

  It also means a Claude working here cannot check its own C++ compiles. The
  permission rules in .claude\settings.json name whole script paths, in the
  same shape as the Deploy and Check lines already in there, so a script is
  the thing that can be allowed. A bare compiler invocation is not.

  WHAT IT BUILDS

  Every file the fork puts in the server (scripts\deploy\ServerBuild.ps1 names
  them), from the fork as it is checked out:
    skymp5-server      the Node addon, scam_native.node, and through it
                       skymp5-server-ts, the JavaScript half the server runs
                       (dist_back\skymp5-server.js and its map), and the
                       post-build copies of package.json, yarn.lock and
                       launch_server.bat
    skymp5-scripts     the compiled Papyrus in data\scripts
  Before that, skymp5-server's packages are installed from its yarn.lock
  (yarn install --frozen-lockfile), because the bundle carries them.
  Everything else in the solution is built as a dependency of those and
  nothing else is asked for, because the client runtime is a separate build
  with its own record (records\client-build.json, Sync-Client.ps1).

  THE JAVASCRIPT HALF IS ALWAYS BUILT AGAIN (#1214). Since fork #30 (#1236)
  the fork's CMake reruns the yarn install and build-ts when a .ts file under
  skymp5-server\ts, package.json, yarn.lock or the TypeScript settings are newer than the
  bundle, so a package bump reaches the bundle on any full build. A bundle
  copied in from another build with a newer date would still be taken as
  current, so the bundle and its map are still removed before the build, and
  the build has to write them from what is checked out. esbuild writes the same bytes for the same sources, so this
  costs about ten seconds and changes nothing when nothing changed.
  New-ServerBuildRecord.ps1 then ties every file to the clone before it
  records any of them.

  WHAT IT DOES NOT DO

  It does not configure a new build folder. The build folder already carries a
  CMakeCache from a previous configure, and a first configure is a different
  job with different arguments. If the cache is missing this says so and stops
  rather than guessing at a configure line. A folder that is configured is
  generated again over its own cache (cmake <build folder>, every setting kept)
  before the compile, so a source file the fork added since is in the build
  (#2157).

  It does not deploy, it does not talk to the VPS, and it does not touch the
  game folder. It installs the server's packages, compiles and, unless told
  not to, updates the build record.

  HOW MANY AT ONCE (#1203). MSBuild compiles as many projects at once as the
  memory free allows, two compilers each, the same as Build-Engine.ps1
  (EngineJobs.ps1 says how many and why), or -Jobs of them. A bare /m started
  one per core and ran a busy machine out of memory. A compile that runs out
  anyway says so and gives the line to build with fewer.

  A fork under a path with an & in it (every worktree here) is built through
  the drive letter it was configured through, the way Build-Engine.ps1 does
  it: -Fork K:\<fork>. MSBuild refuses a cache configured through another path.

  Usage:
    .\scripts\release\Build-Server.ps1
    .\scripts\release\Build-Server.ps1 -Configuration Debug
    .\scripts\release\Build-Server.ps1 -NoRecord      compile only, leave the record alone
    .\scripts\release\Build-Server.ps1 -Jobs 2        two projects at a time, whatever is free

  Exit code 1 if Visual Studio or yarn is not installed, if the build folder
  has not been configured, if the packages or the compile fail, or if a file
  it was supposed to produce is not there afterwards.
#>
[CmdletBinding()]
param(
    # Our fork. The branch is checked and reported, never changed.
    [string]$Fork = (& (Join-Path $PSScriptRoot 'Where.ps1') Engine),
    # The already configured CMake build folder inside it.
    [string]$BuildDir = '',
    [ValidateSet('Release', 'Debug', 'RelWithDebInfo')]
    [string]$Configuration = 'Release',
    # Compile and stop. Without this, scripts\release\New-ServerBuildRecord.ps1 runs
    # afterwards so the deploy will accept what was just built.
    [switch]$NoRecord,
    # Projects compiled at once, two compilers each. 0, the default, works
    # it out from the memory free when the build starts (EngineJobs.ps1).
    [ValidateRange(0, 64)]
    [int]$Jobs = 0,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\deploy\ServerBuild.ps1')
. (Join-Path $Here 'EngineJobs.ps1')

function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Ok($m)  { Write-Host ('  ok    ' + $m) -ForegroundColor Green }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

if (-not $BuildDir) { $BuildDir = Join-Path $Fork 'build' }

# The fork's own vcpkg on a build runner too (#459): this generates the build
# again over its cache, and with CI=true in the environment the fork's
# CMakeLists would switch that cache to C:/vcpkg (EngineJobs.ps1 says why).
$ciSaid = Clear-EngineCiSwitch
if ($ciSaid) { Say ('  ' + $ciSaid) 'DarkGray' }

Head 'Where the source is'

if (-not (Test-Path -LiteralPath $Fork)) {
    Die "there is no fork at $Fork. docs/guide/set-up-a-machine.md says how a machine gets one."
}
Say ("  fork        " + $Fork)

# The branch is reported and never changed. A build off the wrong branch is a
# thing to notice, not a thing for a script to quietly correct.
# Each git question is asked through Invoke-ReleaseGit (Release-Name.ps1),
# which reads git's exit code rather than stopping on its stderr under Windows
# PowerShell 5.1. One git cannot answer is said, never read as an answer: a
# status that failed is not a clean fork.
. (Join-Path $Here 'Release-Name.ps1')
$branch = ''; $commit = ''; $pinned = ''; $dirty = @()
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Say '  NOTE: git is not on the path, so nothing here says which branch and commit the fork is on, or what in it is not committed.' 'Yellow'
} else {
    $gb = Invoke-ReleaseGit $Fork @('rev-parse', '--abbrev-ref', 'HEAD')
    $gc = Invoke-ReleaseGit $Fork @('rev-parse', '--short', 'HEAD')
    if ($gb.Code -eq 0) { $branch = $gb.First }
    if ($gc.Code -eq 0) { $commit = $gc.First }
    if ($gb.Code -ne 0 -or $gc.Code -ne 0) {
        Say ("  NOTE: git could not say which branch and commit $Fork is on (exit {0} and {1}), so this build's commit is not shown here." -f $gb.Code, $gc.Code) 'Yellow'
    }
    # The commit this repository pins. The record names the commit built, and
    # tests\test-one-engine.js holds the two to each other.
    $gp = Invoke-ReleaseGit (Join-Path $Here '..\..') @('ls-tree', 'HEAD', 'engine/skymp')
    if ($gp.Code -eq 0 -and $gp.First) { $pinned = [string](($gp.First -split '\s+')[2]) }
    elseif ($gp.Code -ne 0) { Say ("  NOTE: git could not say which engine commit this repository pins (exit {0}), so it is not compared with the fork's." -f $gp.Code) 'Yellow' }
    $gs = Invoke-ReleaseGit $Fork @('status', '--porcelain')
    if ($gs.Code -eq 0) { $dirty = @($gs.Lines | Where-Object { $_ }) }
    else { Say ("  NOTE: git status could not run in $Fork (exit {0}), so nothing here says whether files not committed will be in this build." -f $gs.Code) 'Yellow' }
}
if ($branch) {
    Say ("  branch      " + $branch + '  ' + $commit)
    if ($branch -ne 'thornswood/engine-changes' -and $branch -ne 'HEAD') {
        Say '  NOTE: that is not thornswood/engine-changes, which is the branch our engine changes live on.' 'Yellow'
    }
}
if ($pinned -and $commit -and -not $pinned.StartsWith($commit)) {
    Say ("  NOTE: this repository pins {0}. A record of this build names {1}, and the build check fails until the pin moves to it (engine\README.md, One engine)." -f $pinned.Substring(0, 8), $commit) 'Yellow'
}
if ($dirty.Count) {
    Say ("  {0} file(s) in the fork are not committed, and they WILL be in this build:" -f $dirty.Count) 'Yellow'
    foreach ($d in $dirty) { Say ('    ' + $d) 'Yellow' }
}

if (-not (Test-Path -LiteralPath (Join-Path $BuildDir 'CMakeCache.txt'))) {
    Die ("$BuildDir has no CMakeCache.txt, so it has never been configured. " +
         "Configuring is a separate job with its own arguments and this script will not guess at them. " +
         "engine\README.md has the configure line.")
}
Say ("  build       " + $BuildDir)

Head 'The compiler'

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    Die 'vswhere.exe is not there, so Visual Studio is not installed. The Build Tools are enough; the workload is "Desktop development with C++".'
}
$vsPath = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath 2>$null | Select-Object -First 1
if (-not $vsPath) {
    Die 'vswhere found no Visual Studio with MSBuild in it. Install the Build Tools with "Desktop development with C++".'
}
$msbuild = Join-Path $vsPath 'MSBuild\Current\Bin\MSBuild.exe'
if (-not (Test-Path -LiteralPath $msbuild)) {
    Die "MSBuild is not at $msbuild even though vswhere pointed at $vsPath."
}
Ok ("MSBuild from " + $vsPath)

# Generated again over its cache (#2157): the fork's CMakeLists glob their
# sources at configure time, so a .cpp the fork added since the last configure
# is in no project and the link fails. Given only the build folder, cmake
# keeps the source, the generator and every setting the cache holds.
$cmake = (Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $cmake) {
    $c = Join-Path $vsPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
    if (Test-Path -LiteralPath $c) { $cmake = $c }
}
if (-not $cmake) { Die 'cmake is not on PATH and not in Visual Studio. The "Desktop development with C++" workload installs it.' }
$ErrorActionPreference = 'Continue'
try { & $cmake $BuildDir 2>&1 | ForEach-Object { Say ('  ' + $_) 'DarkGray' }; $code = $LASTEXITCODE }
finally { $ErrorActionPreference = 'Stop' }
if ($code -ne 0) { Die "cmake exited with $code generating $BuildDir again over its cache. The lines above say why." }
Ok ('generated again over its cache, ' + $cmake)
if (-not (Get-Command yarn -ErrorAction SilentlyContinue)) {
    Die 'yarn is not on PATH, and the JavaScript half of the server is built with it. Run  corepack enable  in an administrator PowerShell once Node is in.'
}
Ok 'yarn'

# skymp5-server is the Node addon, and building it builds skymp5-server-ts,
# the JavaScript half, first (the fork's add_dependencies). skymp5-scripts is
# the compiled Papyrus the server loads, which nothing else asks for.
$projects = @(
    (Join-Path $BuildDir 'skymp5-server\skymp5-server.vcxproj'),
    (Join-Path $BuildDir 'skymp5-scripts\skymp5-scripts.vcxproj')
)
foreach ($project in $projects) {
    if (-not (Test-Path -LiteralPath $project)) {
        Die "the project is not at $project. Either the build folder was configured for something else or the fork has moved it."
    }
}

Head 'The packages the JavaScript half bundles'
# Exactly the ones skymp5-server\yarn.lock names. The fork's configure
# installs them once; a lockfile that moved since then would bundle old ones.
# Run in the folder rather than given it: yarn is a .cmd, and cmd.exe splits
# a path argument at an &.
$serverSrc = Join-Path $Fork 'skymp5-server'
Push-Location -LiteralPath $serverSrc
try {
    $ErrorActionPreference = 'Continue'
    & yarn install --frozen-lockfile --non-interactive 2>&1 | ForEach-Object { Say ('  ' + $_) 'DarkGray' }
    $code = $LASTEXITCODE
} finally { $ErrorActionPreference = 'Stop'; Pop-Location }
if ($code -ne 0) { Die "yarn install --frozen-lockfile in $serverSrc exited with $code. The lines above say why." }
Ok 'installed from yarn.lock'

Head 'Building'

$dist = Join-Path $BuildDir 'dist\server'
$binary = Join-Path $dist 'scam_native.node'
$before = @{}
foreach ($n in $ThornswoodServerForkFiles) {
    $p = Join-Path $dist ($n -replace '/', '\')
    if (Test-Path -LiteralPath $p) { $before[$n] = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
}

# See the header: the bundle is written by the build or not at all.
foreach ($n in 'dist_back\skymp5-server.js', 'dist_back\skymp5-server.js.map') {
    $p = Join-Path $dist $n
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
}

# Projects at once from the memory free, not a bare /m (#1203, EngineJobs.ps1).
$free = Get-EngineFreeBytes
$atOnce = $Jobs
if ($atOnce -lt 1) { $atOnce = Get-EngineJobs $free ([Environment]::ProcessorCount) }
$jobArgs = Get-EngineMSBuildArgs $atOnce
foreach ($project in $projects) {
    Say ('  {0}, {1}, {2} project(s) at once, {3} compilers each, {4:N1} GB free' -f $Configuration, [IO.Path]::GetFileNameWithoutExtension($project), $atOnce, $EngineCompilersPerJob, ($free / 1GB))
    Say ''
    # Each line goes to the screen as MSBuild writes it, and an out of memory
    # error is noted so the stop below can say the machine ran out.
    $oom = ''
    $ErrorActionPreference = 'Continue'
    & $msbuild $project "/p:Configuration=$Configuration" @jobArgs /v:minimal /nologo 2>&1 | ForEach-Object {
        $c = Get-EngineOutOfMemoryCode ([string]$_)
        if ($c -and -not $oom) { $oom = $c }
        Write-Host $_
    }
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Say ''
    if ($code -ne 0 -and $oom) {
        Die (Get-EngineOutOfMemoryAdvice $oom $atOnce $free (Get-EngineAgainLine '.\scripts\release\Build-Server.ps1' $PSBoundParameters))
    }
    if ($code -ne 0) {
        Die "MSBuild exited with $code. The errors are above, in the order the compiler found them; the first one is usually the only real one."
    }
}
Ok 'compiled'

Head 'What came out'

$missing = @()
foreach ($n in $ThornswoodServerForkFiles) {
    $p = Join-Path $dist ($n -replace '/', '\')
    if (-not (Test-Path -LiteralPath $p)) { $missing += $n; continue }
    $h = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
    $said = ''
    if (-not $before.ContainsKey($n)) { $said = 'new' }
    elseif ($before[$n] -eq $h) { $said = 'the same as before this run' }
    else { $said = 'changed' }
    Say ("  {0}  {1,-32} {2:N0} bytes, {3}" -f $h.Substring(0, 12).ToLowerInvariant(), $n, (Get-Item -LiteralPath $p).Length, $said)
}
$scripts = Join-Path $dist 'data\scripts'
$pex = @(if (Test-Path -LiteralPath $scripts) { Get-ChildItem -LiteralPath $scripts -Recurse -File })
foreach ($f in $pex) {
    Say ("  {0}  data/scripts/{1}" -f (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.Substring(0, 12).ToLowerInvariant(), $f.Name)
}
if (-not $pex.Count) { $missing += 'data/scripts (skymp5-scripts wrote nothing; is BUILD_SCRIPTS on in the cache?)' }
if ($missing.Count) {
    Die ("the build said it succeeded and these are not in $($dist): " + ($missing -join ', ') +
         '. That usually means a project built something else, so check what the solution calls it.')
}
if ($before.ContainsKey('scam_native.node') -and $before['scam_native.node'] -eq (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash) {
    Say '  scam_native.node is IDENTICAL to what was there before this run: no C++ change reached it.' 'Yellow'
}

if ($NoRecord) {
    Head 'The record'
    Say '  -NoRecord, so records\server-build.json was left alone.'
    Say '  Every publish and deploy refuses a server file whose sha256 is not the recorded one, so they will refuse this until the record is updated.'
} else {
    Head 'The record'
    $rec = Join-Path $Here 'New-ServerBuildRecord.ps1'
    if (-not (Test-Path -LiteralPath $rec)) { Die "not found: $rec, so the record was not updated." }
    # The same pwsh that is running this (#5356). The build and the clone
    # just built, not Where.ps1's, or a -Fork build recorded another.
    $ps = [Environment]::ProcessPath
    & $ps -NoProfile -ExecutionPolicy Bypass -File $rec -Dist $dist -Clone $Fork
    if ($LASTEXITCODE -ne 0) {
        Die "New-ServerBuildRecord.ps1 exited with $LASTEXITCODE, so records\server-build.json does not match what was just built."
    }
    Ok 'records\server-build.json now names every server file of this build'
}

Head 'Next'
Say '  Nothing has left this machine. The dev server first, as engine\README.md says:'
Say '      .\scripts\release\Publish-Server.ps1 -Channel dev' 'White'
Say '  That one goes outside. The live server only when Patrick says.'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
