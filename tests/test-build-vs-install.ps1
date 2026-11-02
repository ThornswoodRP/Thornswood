<#
  test-build-vs-install.ps1

  Build-Launcher.ps1 builds and Install-Launcher.ps1 installs, and every
  caller of the build does what it did before apart from that split.

  To Do List entry 243, "Build-Launcher.ps1 is an installer wearing a build
  script's name". Until 24 September the build closed whatever Skyrim was
  running on the machine (Close-Launcher.ps1 matches SkyrimSE and
  skse64_loader by name alone), closed the launcher, wrote the icon file and
  the shortcut, and poked Explorer, on every compile check. The entry: "A build
  produces files in an output folder and does not kill processes or write to
  the Desktop."

  Nothing here closes anything, touches the Desktop or restarts Explorer. The
  two scripts are copied into a temp folder beside a stand-in Close-Launcher.ps1
  that writes down what it was asked to close and closes nothing. The build
  publishes a two line program of its own, with the real dotnet and the same
  native publish the launcher gets (#4823), so it takes a minute and not the
  launcher's ten; the real launcher's publish is the Launcher builds check
  (build.yml), which runs Build-Launcher.ps1 over launcher\app itself.

  The callers, each shown:
    .github/workflows/nightly.yml its "Build the launcher" step's lines, run the way
                                  GitHub runs them
    Ship.ps1                      its build block lifted out and run against stand-ins
    Install-Thornswood.ps1        a copy run with -Only launcher, against the same stand-ins
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
$RepoDir = $Here
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  the launcher''s native publish is for win-x64 on Windows only, and it is installed over a Windows shortcut, so this runs only on Windows'; exit 0 }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Skip([string]$what) { Write-Host "SKIP  $what" }

# The host running this harness, and pwsh for the CI step because that is the
# shell the workflow names.
$ps = (Get-Process -Id $PID).Path
$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
$pwsh = if ($pwshCmd) { $pwshCmd.Source } else { $ps }

function Invoke-Child([string]$exe, [string]$file, [string[]]$argList) {
    $ErrorActionPreference = 'Continue'
    $out = & $exe -NoProfile -ExecutionPolicy Bypass -File $file @argList 2>&1 | Out-String
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

function Read-Log([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return @() }
    return @(Get-Content -LiteralPath $path | Where-Object { $_ })
}

function Get-DesktopState {
    $desk = [Environment]::GetFolderPath('Desktop')
    $o = @()
    foreach ($n in 'Thornswood.lnk', 'Thornswood Dev.lnk') {
        # Joined only when there is a desktop: an account with none has '' here,
        # and Join-Path refuses '' before the test after it could (#2957).
        $p = if ($desk) { Join-Path $desk $n } else { '' }
        if ($p -and (Test-Path -LiteralPath $p)) { $o += ($n + '=' + (Get-Item -LiteralPath $p).LastWriteTimeUtc.Ticks) }
        else { $o += ($n + '=none') }
    }
    return ($o -join ';')
}
function Get-ExplorerState {
    $o = @()
    foreach ($p in @(Get-Process -Name explorer -ErrorAction SilentlyContinue)) {
        $t = ''
        try { $t = [string]$p.StartTime.ToUniversalTime().Ticks } catch { }
        $o += ([string]$p.Id + '@' + $t)
    }
    return (($o | Sort-Object) -join ';')
}

function Get-Ast([string]$path) {
    $tok = $null; $err = $null
    return [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tok, [ref]$err)
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-buildinstall-' + [Guid]::NewGuid().ToString('N'))
$repo = Join-Path $work 'repo'
$tmp = Join-Path $work 'tmp'
$closeLog = Join-Path $work 'close.log'
$callLog = Join-Path $work 'calls.log'

# ---- the stand-ins -----------------------------------------------------------

$fakeClose = @'
# Stand-in written by test-build-vs-install.ps1. It closes nothing. It writes
# down what it was asked to close, and how big the installed exe was at that
# moment, so the harness can tell whether closing came before the copy.
function Write-Asked([string]$what, [string]$Root) {
    $len = -1
    if ($Root) {
        $exe = Join-Path $Root 'Launcher\Thornswood.exe'
        if (Test-Path -LiteralPath $exe) { $len = (Get-Item -LiteralPath $exe).Length }
    }
    Add-Content -LiteralPath $env:TS_TEST_CLOSE_LOG -Value ($what + '|' + $Root + '|' + $len)
}
function Stop-Game { param([string]$Root) Write-Asked 'Stop-Game' $Root; return $false }
function Stop-Launcher { param([string]$Root) Write-Asked 'Stop-Launcher' $Root; return $false }
function Get-GameProcesses { param([string]$Root) Write-Asked 'Get-GameProcesses' $Root; return @() }
function Get-LauncherProcesses { param([string]$Root) Write-Asked 'Get-LauncherProcesses' $Root; return [pscustomobject]@{ Mine = @(); Unknown = 0; Exe = '' } }
function Test-GameRunning { param([string]$Root) Write-Asked 'Test-GameRunning' $Root; return $false }
'@

$stubBuild = @'
param([string]$Src, [string]$Root, [string]$OutDir, [switch]$NoPause, [switch]$NoSign, [string]$Version)
Add-Content -LiteralPath $env:TS_TEST_CALLS -Value ('build|' + $Root + '|' + $OutDir + '|' + [bool]$NoPause + '|' + $Version)
if ($env:TS_TEST_BUILD_EXIT -and $env:TS_TEST_BUILD_EXIT -ne '0') { exit ([int]$env:TS_TEST_BUILD_EXIT) }
$dir = $OutDir
if (-not $dir) { $dir = Join-Path $Root 'Launcher' }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Content -LiteralPath (Join-Path $dir 'Thornswood.exe') -Value ('built ' + [Guid]::NewGuid().ToString('N')) -Encoding ASCII
exit 0
'@

$stubInstall = @'
param([string]$Root, [string]$From, [switch]$NoPause)
Add-Content -LiteralPath $env:TS_TEST_CALLS -Value ('install|' + $Root + '|' + $From + '|' + [bool]$NoPause)
if ($env:TS_TEST_INSTALL_EXIT -and $env:TS_TEST_INSTALL_EXIT -ne '0') { exit ([int]$env:TS_TEST_INSTALL_EXIT) }
$dst = Join-Path $Root 'Launcher'
$src = $From
if (-not $src) { $src = $dst }
New-Item -ItemType Directory -Force -Path $dst | Out-Null
if ($src -ne $dst) { Copy-Item -LiteralPath (Join-Path $src 'Thornswood.exe') -Destination (Join-Path $dst 'Thornswood.exe') -Force }
exit 0
'@

$stubShip = @'
param([Parameter(Position = 0)][string]$Notes, [string]$Root, [switch]$NoPause)
Add-Content -LiteralPath $env:TS_TEST_CALLS -Value ('ship|' + $Root)
exit 0
'@

function Split-Call([string]$line) {
    $f = $line -split '\|'
    return [pscustomobject]@{ What = $f[0]; Root = $f[1]; Dir = $(if ($f.Count -gt 2) { $f[2] } else { '' }); NoPause = $(if ($f.Count -gt 3) { $f[3] } else { '' }); Version = $(if ($f.Count -gt 4) { $f[4] } else { '' }) }
}

$saved = @{ TEMP = $env:TEMP; TMP = $env:TMP; RUNNER_TEMP = $env:RUNNER_TEMP; TS_TEST_CLOSE_LOG = $env:TS_TEST_CLOSE_LOG;
            TS_TEST_CALLS = $env:TS_TEST_CALLS; TS_TEST_BUILD_EXIT = $env:TS_TEST_BUILD_EXIT; TS_TEST_INSTALL_EXIT = $env:TS_TEST_INSTALL_EXIT }
$held = $null
try {
    # Laid out like the repository: the scripts in scripts\release beside
    # scripts\dev, the launcher's project in launcher\app, its art in
    # launcher\ and the records it embeds in records\ (issue #440, phase 10).
    # The project is a two line program of its own, published the way the
    # launcher is (Build-Launcher.ps1, #4823). It is a git repository with one
    # commit, because the build takes its number from when the launcher's
    # sources last changed (LauncherVersion.ps1) when nobody passes -Version,
    # and the CI step passes none.
    $fakeRepo = $repo
    foreach ($d in @((Join-Path $fakeRepo 'scripts\release'), (Join-Path $fakeRepo 'scripts\dev'), (Join-Path $fakeRepo 'launcher\app'),
                     (Join-Path $fakeRepo 'records'), $tmp)) {
        New-Item -ItemType Directory -Force -Path $d | Out-Null
    }
    $realRepo = $Here
    Copy-Item -LiteralPath (Join-Path $realRepo 'scripts\release\Build-Launcher.ps1') -Destination (Join-Path $fakeRepo 'scripts\release')
    # Build-Launcher holds the embedded records to RecordShape.ps1 (#2180),
    # asks Where.ps1 which folders are the installs (#3031) and
    # LauncherVersion.ps1 for its number (#5179).
    foreach ($n in 'RecordShape.ps1', 'Read-JsonFile.ps1', 'Where.ps1', 'LauncherVersion.ps1') { Copy-Item -LiteralPath (Join-Path $realRepo ('scripts\release\' + $n)) -Destination (Join-Path $fakeRepo 'scripts\release') -Force }
    $haveInstall = Test-Path -LiteralPath (Join-Path $realRepo 'scripts\release\Install-Launcher.ps1')
    if ($haveInstall) { Copy-Item -LiteralPath (Join-Path $realRepo 'scripts\release\Install-Launcher.ps1') -Destination (Join-Path $fakeRepo 'scripts\release') }
    foreach ($f in 'app.ico', 'app-dev.ico', 'logo.png', 'logo-dev.png', 'logo-192.png', 'launcher-header.jpg', 'launcher-header.mp4', 'Thornswood.ini') {
        $from = Join-Path $realRepo ('launcher\' + $f)
        if (Test-Path -LiteralPath $from) { Copy-Item -LiteralPath $from -Destination (Join-Path $fakeRepo 'launcher') }
    }
    foreach ($n in 'client-build.json', 'skyrim-files.json', 'ui-gone.json', 'generated.json') {
        Copy-Item -LiteralPath (Join-Path $realRepo ('records\' + $n)) -Destination (Join-Path $fakeRepo 'records')
    }
    # The launcher's own project says the same of itself: Thornswood.exe, a
    # windowed .NET 10 program published to native code, embedding the two
    # icons under the names Build-Launcher writes beside it (#887).
    Set-Content -LiteralPath (Join-Path $repo 'launcher\app\Thornswood.csproj') -Encoding ASCII -Value @'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <AssemblyName>Thornswood</AssemblyName>
    <PublishAot>true</PublishAot>
    <InvariantGlobalization>true</InvariantGlobalization>
  </PropertyGroup>
  <ItemGroup>
    <EmbeddedResource Include="..\app.ico"><LogicalName>app.ico</LogicalName></EmbeddedResource>
    <EmbeddedResource Include="..\app-dev.ico"><LogicalName>app-dev.ico</LogicalName></EmbeddedResource>
  </ItemGroup>
</Project>
'@
    Set-Content -LiteralPath (Join-Path $repo 'launcher\app\Program.cs') -Value 'static class Program { static void Main() { } }' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $repo 'scripts\dev\Close-Launcher.ps1') -Value $fakeClose -Encoding ASCII
    # One commit, made by a name that is only this scratch repository's.
    $gitOld = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & git -C $repo init -q 2>&1 | Out-Null
    & git -C $repo add -A 2>&1 | Out-Null
    & git -C $repo -c user.name=test-build-vs-install -c user.email=test@invalid -c commit.gpgsign=false commit -q -m 'scratch' 2>&1 | Out-Null
    $gitCode = $LASTEXITCODE
    $ErrorActionPreference = $gitOld
    Yes "the scratch repository has its one commit (git exit $gitCode)" ($gitCode -eq 0)

    $env:TEMP = $tmp
    $env:TMP = $tmp
    $env:TS_TEST_CLOSE_LOG = $closeLog
    $env:TS_TEST_CALLS = $callLog
    $env:RUNNER_TEMP = Join-Path $work 'runner'
    New-Item -ItemType Directory -Force -Path $env:RUNNER_TEMP | Out-Null

    $deskBefore = Get-DesktopState
    $explorerBefore = Get-ExplorerState

    # ---- 1. the build, exactly as the CI step calls it --------------------------
    $yml = @(Get-Content -LiteralPath (Join-Path $RepoDir '.github\workflows\nightly.yml'))
    $at = -1
    for ($i = 0; $i -lt $yml.Count; $i++) { if ($yml[$i] -match '^\s*- name: Build the launcher\s*$') { $at = $i; break } }
    $stepLines = @()
    if ($at -ge 0) {
        $r = -1
        for ($i = $at + 1; $i -lt $yml.Count; $i++) { if ($yml[$i] -match '^(\s*)run: \|\s*$') { $r = $i; break } }
        $runIndent = $yml[$r].Length - $yml[$r].TrimStart().Length
        $cut = -1
        for ($i = $r + 1; $i -lt $yml.Count; $i++) {
            $l = $yml[$i]
            if (-not $l.Trim()) { continue }
            $ind = $l.Length - $l.TrimStart().Length
            if ($ind -le $runIndent) { break }
            if ($cut -lt 0) { $cut = $ind }
            $stepLines += $l.Substring([Math]::Min($cut, $ind))
        }
    }
    $stepText = $stepLines -join "`n"
    Yes 'the CI step that builds the launcher is in nightly.yml' ($stepLines.Count -gt 0)
    Yes 'CI calls Build-Launcher.ps1 with -Root, -NoSign and -NoPause, and nothing else' ($stepText -match '(?m)^\.\\scripts\\release\\Build-Launcher\.ps1 -Root \$root -NoSign -NoPause\s*$')
    Yes 'CI does not install anything' ($stepText -notmatch 'Install-Launcher')
    Yes 'CI still looks for the exe in <root>\Launcher' ($stepText -match "Launcher\\Thornswood\.exe")

    # The wrapper GitHub puts around a pwsh step: stop on errors going in, and
    # hand back the last native exit code coming out.
    $ciScript = Join-Path $work 'ci-step.ps1'
    $ciBody = @("`$ErrorActionPreference = 'stop'", ("Set-Location -LiteralPath '" + $repo.Replace("'", "''") + "'")) + $stepLines +
              @('if ((Test-Path -LiteralPath variable:\LASTEXITCODE)) { exit $LASTEXITCODE }')
    Set-Content -LiteralPath $ciScript -Value ($ciBody -join "`r`n") -Encoding ASCII
    $ci = Invoke-Child $pwsh $ciScript @()
    $ciRoot = Join-Path $env:RUNNER_TEMP 'Thornswood'
    $ciExe = Join-Path $ciRoot 'Launcher\Thornswood.exe'
    Yes "B1 the CI step passes with this build (exit $($ci.Code))" ($ci.Code -eq 0)
    if ($ci.Code -ne 0) { Write-Host $ci.Out }
    Yes 'B2 Thornswood.exe is where CI uploads it from' (Test-Path -LiteralPath $ciExe)
    # B3 was the setup stub, built into out\ beside it; it went with #4824.
    $ciFiles = @(Get-ChildItem -LiteralPath $ciRoot -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($ciRoot.Length + 1) })
    # Thornswood.pdb beside the exe is intentional since #462 (pdbonly symbols for
    # the shipping machine). Nothing packs it. app.ico and app-dev.ico are the
    # icons the exe embeds, for Install-Launcher (#887).
    $b4extra = @($ciFiles | Where-Object { $_ -notin 'Launcher\Thornswood.exe', 'Launcher\Thornswood.pdb', 'Launcher\app.ico', 'Launcher\app-dev.ico' })
    Yes ('B4 the build wrote Thornswood.exe under the root (and optionally its pdb), found: ' + ($ciFiles -join ', ')) (($ciFiles -contains 'Launcher\Thornswood.exe') -and ($b4extra.Count -eq 0))
    $sameBytes = { param($a, $b) (Test-Path -LiteralPath $a) -and (Get-FileHash -LiteralPath $a).Hash -eq (Get-FileHash -LiteralPath $b).Hash }
    Yes 'B6 and the two icons it embeds beside it, byte for byte the project''s (#887)' (
        (& $sameBytes (Join-Path $ciRoot 'Launcher\app.ico') (Join-Path $repo 'launcher\app.ico')) -and
        (& $sameBytes (Join-Path $ciRoot 'Launcher\app-dev.ico') (Join-Path $repo 'launcher\app-dev.ico')))
    $asked = @(Read-Log $closeLog)
    Yes ('B5 the build asked to close nothing, asked: ' + ($asked -join ' ; ')) ($asked.Count -eq 0)

    # ---- 2. the build into a folder of its own, which is what Ship does --------
    $stage = Join-Path $work 'stage'
    $root2 = Join-Path $work 'root2'
    $o = Invoke-Child $ps (Join-Path $repo 'scripts\release\Build-Launcher.ps1') @('-Root', $root2, '-OutDir', $stage, '-NoPause')
    Yes "O1 a build with -OutDir passes (exit $($o.Code))" ($o.Code -eq 0)
    if ($o.Code -ne 0) { Write-Host $o.Out }
    Yes 'O2 and the exe is in that folder' (Test-Path -LiteralPath (Join-Path $stage 'Thornswood.exe'))
    Yes 'O3 and the root it was named for is not even created' (-not (Test-Path -LiteralPath $root2))
    Yes 'O4 and still nothing was asked to close' (@(Read-Log $closeLog).Count -eq 0)

    # ---- 3. a launcher still open from the output folder ------------------------
    # Held open for reading and nothing else, the way a running exe is. The
    # build used to close it first; now it says so and stops, and closes nothing.
    if (Test-Path -LiteralPath $ciExe) {
        $wasTime = (Get-Item -LiteralPath $ciExe).LastWriteTimeUtc
        $held = [IO.File]::Open($ciExe, 'Open', 'Read', 'Read')
        $l = Invoke-Child $ps (Join-Path $repo 'scripts\release\Build-Launcher.ps1') @('-Root', $ciRoot, '-NoPause')
        $held.Close(); $held = $null
        Yes "L1 a build over a launcher that is still open stops (exit $($l.Code))" ($l.Code -eq 1)
        Yes 'L2 and says to close it or use -OutDir, rather than a csc error' ($l.Out -match 'in use' -and $l.Out -match '-OutDir')
        Yes 'L3 and closed nothing' (@(Read-Log $closeLog).Count -eq 0)
        Yes 'L4 and the exe there is untouched' ((Get-Item -LiteralPath $ciExe).LastWriteTimeUtc -eq $wasTime)
    } else { Skip 'L the locked-exe run, because B2 produced no exe to lock' }

    # ---- 4. the install, from the folder the build wrote -------------------------
    Yes 'I0 Install-Launcher.ps1 exists' $haveInstall
    $root3 = Join-Path $work 'root3'
    $inst = Join-Path $repo 'scripts\release\Install-Launcher.ps1'
    if ($haveInstall -and (Test-Path -LiteralPath (Join-Path $stage 'Thornswood.exe'))) {
        $l3 = Join-Path $root3 'Launcher'
        New-Item -ItemType Directory -Force -Path $l3 | Out-Null
        $staleExe = Join-Path $l3 'Thornswood.exe'
        Set-Content -LiteralPath $staleExe -Value 'old' -Encoding ASCII -NoNewline
        $staleTime = [datetime]::new(2020, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
        (Get-Item -LiteralPath $staleExe).LastWriteTimeUtc = $staleTime
        Set-Content -LiteralPath (Join-Path $l3 'icon-00000000.ico') -Value 'x' -Encoding ASCII

        $in = Invoke-Child $ps $inst @('-Root', $root3, '-From', $stage, '-NoPause')
        Yes "I1 the install passes (exit $($in.Code))" ($in.Code -eq 0)
        if ($in.Code -ne 0) { Write-Host $in.Out }
        $asked = @(Read-Log $closeLog | ForEach-Object { Split-Call $_ })
        $game = @($asked | Where-Object { $_.What -eq 'Stop-Game' })
        $launcher = @($asked | Where-Object { $_.What -eq 'Stop-Launcher' })
        Yes 'I2 the install closes a game left running, for that root' (($game.Count -eq 1) -and ($game[0].Root -eq $root3))
        Yes 'I3 and the launcher running from that root' (($launcher.Count -eq 1) -and ($launcher[0].Root -eq $root3))
        Yes 'I4 and both before the new exe went in (the old 3 byte one was still there)' (($game.Count -eq 1) -and ($game[0].Dir -eq '3') -and ($launcher.Count -eq 1) -and ($launcher[0].Dir -eq '3'))
        $same = (Get-FileHash -LiteralPath $staleExe).Hash -eq (Get-FileHash -LiteralPath (Join-Path $stage 'Thornswood.exe')).Hash
        Yes 'I5 the exe in the root is the one the build made, byte for byte, which is what Ship checks (#5156)' $same
        Yes 'I6 and it is newer than the one it replaced' ((Get-Item -LiteralPath $staleExe).LastWriteTimeUtc -gt $staleTime)
        $hash = (Get-FileHash -LiteralPath (Join-Path $Here 'launcher\app.ico') -Algorithm SHA256).Hash.Substring(0, 8).ToLower()
        Yes "I9 the icon file named after the artwork is there (icon-$hash.ico)" (Test-Path -LiteralPath (Join-Path $l3 "icon-$hash.ico"))
        Yes 'I10 and an old one is cleared away' (-not (Test-Path -LiteralPath (Join-Path $l3 'icon-00000000.ico')))
        $lnk = Join-Path $root3 'Thornswood.lnk'
        $target = ''
        if (Test-Path -LiteralPath $lnk) { $target = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk).TargetPath }
        # Compared by its tail and by the file it reaches, because a runner's
        # temp path is a short one (RUNNER~1) and the shortcut may not keep it so.
        Yes 'I11 a scratch root gets its shortcut inside its own folder, pointing at its own exe' (
            ($target -like '*\root3\Launcher\Thornswood.exe') -and (Test-Path -LiteralPath $target) -and
            ((Get-FileHash -LiteralPath $target).Hash -eq (Get-FileHash -LiteralPath $staleExe).Hash))
        Yes 'I13 a scratch install never clears the icon cache or restarts Explorer (no .iconstamp)' (-not (Test-Path -LiteralPath (Join-Path $l3 '.iconstamp')))
        Yes 'I14 and does not ask Explorer to redraw either' ($in.Out -notmatch 'Explorer told to redraw' -and $in.Out -notmatch 'Icon cache asked to refresh')

        # Nothing built: nothing closed.
        Remove-Item -LiteralPath $closeLog -Force -ErrorAction SilentlyContinue
        $root4 = Join-Path $work 'root4'
        $empty = Join-Path $work 'empty'
        New-Item -ItemType Directory -Force -Path $empty | Out-Null
        $x = Invoke-Child $ps $inst @('-Root', $root4, '-From', $empty, '-NoPause')
        Yes "X1 an install with nothing built stops (exit $($x.Code))" ($x.Code -eq 1)
        Yes 'X2 before it closes anything' (@(Read-Log $closeLog).Count -eq 0)

        # A launcher Close-Launcher could not identify, still holding the exe.
        $held = [IO.File]::Open($staleExe, 'Open', 'Read', 'Read')
        $k = Invoke-Child $ps $inst @('-Root', $root3, '-From', $stage, '-NoPause')
        $held.Close(); $held = $null
        Yes "K1 an install over an exe still open stops (exit $($k.Code)), so Ship stops too" ($k.Code -eq 1)
        Yes 'K2 and says the old one is still there' ($k.Out -match 'old Thornswood\.exe is still there')

        # Without -From the exe is taken as already in place, which is what a
        # hand build with the default -OutDir leaves.
        $wasHash = (Get-FileHash -LiteralPath $staleExe).Hash
        $p = Invoke-Child $ps $inst @('-Root', $root3, '-NoPause')
        Yes "P1 an install with no -From, over an exe already in place, passes (exit $($p.Code))" ($p.Code -eq 0)
        Yes 'P2 and leaves that exe as it was' ((Get-FileHash -LiteralPath $staleExe).Hash -eq $wasHash)
    } else { Skip 'I the install runs, because there is no Install-Launcher.ps1 or no staged exe' }

    # ---- 5. what the build script no longer does, read off its code ------------
    # The runs above take the scratch path. This reads every path, so a Desktop
    # write under a dev-root branch would still be caught. Comments are ignored.
    $bAst = Get-Ast (Join-Path $Here 'scripts\release\Build-Launcher.ps1')
    $cmds = @($bAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ })
    $members = @($bAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.MemberExpressionAst] }, $true) | ForEach-Object { $_.Member.Extent.Text })
    $strings = @($bAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true) | ForEach-Object { $_.Value })
    foreach ($c in 'Stop-Game', 'Stop-Launcher', 'taskkill', 'Start-Process') {
        Yes "N1 Build-Launcher.ps1 does not call $c" ($cmds -notcontains $c)
    }
    foreach ($m in 'CreateShortcut', 'SHChangeNotify', 'GetFolderPath') {
        Yes "N2 Build-Launcher.ps1 does not use $m" ($members -notcontains $m)
    }
    Yes 'N3 Build-Launcher.ps1 does not dot-source Close-Launcher.ps1' (@($strings | Where-Object { $_ -eq 'Close-Launcher.ps1' }).Count -eq 0)
    $closeSrc = Get-Content -LiteralPath (Join-Path $Here 'scripts\dev\Close-Launcher.ps1') -Raw
    Yes 'G1 Get-GameProcesses asks for SkyrimSE and skse64_loader only' (
        $closeSrc.Contains("foreach (`$n in 'SkyrimSE', 'skse64_loader')") -and
        -not $closeSrc.Contains("'skse64_loader', 'Thornswood'"))
    Yes 'N4 Build-Launcher.ps1 has no parameter a caller must pass, so a bare hand build still binds' (
        @($bAst.ParamBlock.Parameters | Where-Object { $_.Attributes | Where-Object { $_.Extent.Text -match 'Mandatory' } }).Count -eq 0)

    if ($haveInstall) {
        $iText = Get-Content -LiteralPath (Join-Path $Here 'scripts\release\Install-Launcher.ps1') -Raw
        foreach ($s in 'Stop-Game -Root $Root', 'Stop-Launcher -Root $Root', 'CreateShortcut', 'SHChangeNotify', 'ie4uinit',
                       'taskkill /f /im explorer.exe', 'if ($lastIcon -ne $iconHash -and -not $isScratch) {') {
            Yes "M1 the install half carries $s, moved rather than lost" ($iText.Contains($s))
        }
    }

    # ---- 6. Ship builds and installs no launcher (#4825) -------------------------
    # The launcher goes out only through Velopack (merge-release.yml), so the
    # build block this section used to lift out of Ship.ps1 and run is gone.
    $shipPath = Join-Path $Here 'scripts\release\Ship.ps1'
    $shipText = Get-Content -LiteralPath $shipPath -Raw
    Yes 'Ship.ps1 calls neither Build-Launcher.ps1 nor Install-Launcher.ps1' (
        $shipText -notmatch "'Build-Launcher\.ps1'" -and $shipText -notmatch "'Install-Launcher\.ps1'")

    # ---- 7. Install-Thornswood's launcher step ----------------------------------
    # It refuses to run beside a game run from its own root, which is the right
    # thing for it to do, and only that one: a game anywhere else on the machine
    # does not hold the root's files. Until 12 Oct it refused for any SkyrimSE on
    # the machine, so this part was skipped when one was open, and on the VPS
    # another runner's stand-in Skyrim, started between that look and the run,
    # failed T1 to T7 (#2410). U1 to U3 below prove the rule with stand-ins.
    # Laid out like the real tree after issue #440 phase 8: Install-Thornswood
    # lives in scripts\dev and reaches Build/Install/Ship/Where via ..\release,
    # and Vps.ps1 via ..\vps. Flat tools\ copies broke those relatives.
    $itDev = Join-Path $work 'it\scripts\dev'
    $itRel = Join-Path $work 'it\scripts\release'
    $itVps = Join-Path $work 'it\scripts\vps'
    $itRoot = Join-Path $work 'it\root'
    foreach ($d in @($itDev, $itRel, $itVps, $itRoot)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    Copy-Item -LiteralPath (Join-Path $Here 'scripts\dev\Install-Thornswood.ps1') -Destination $itDev
    Copy-Item -LiteralPath (Join-Path $Here 'scripts\dev\Close-Launcher.ps1') -Destination $itDev
    Copy-Item -LiteralPath (Join-Path $Here 'scripts\vps\Vps.ps1') -Destination $itVps
    Copy-Item -LiteralPath (Join-Path $Here 'scripts\vps\vps.json') -Destination $itVps
    Set-Content -LiteralPath (Join-Path $itRel 'Build-Launcher.ps1') -Value $stubBuild -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $itRel 'Install-Launcher.ps1') -Value $stubInstall -Encoding ASCII
    Copy-Item -LiteralPath (Join-Path $Here 'scripts\release\Get-ScratchDir.ps1') -Destination $itRel
    $env:TS_TEST_BUILD_EXIT = '0'
    $env:TS_TEST_INSTALL_EXIT = '0'

    Remove-Item -LiteralPath $callLog -Force -ErrorAction SilentlyContinue
    # -Server/-Client skip Where.ps1 defaults; the launcher steps do not use them.
    $t = Invoke-Child $ps (Join-Path $itDev 'Install-Thornswood.ps1') @('-Root', $itRoot, '-Only', 'launcher', '-NoShip', '-NoPause', '-Server', $itRoot, '-Client', $itRoot)
    $calls = @(Read-Log $callLog | ForEach-Object { Split-Call $_ })
    Yes "T1 Install-Thornswood -Only launcher -NoShip passes (exit $($t.Code))" ($t.Code -eq 0)
    if ($t.Code -ne 0) { Write-Host $t.Out }
    Yes 'T2 it builds and then installs, both for its own root' (($calls.Count -eq 2) -and ($calls[0].What -eq 'build') -and ($calls[1].What -eq 'install') -and ($calls[0].Root -eq $itRoot) -and ($calls[1].Root -eq $itRoot))
    Yes 'T3 the install takes the exe from the folder the build wrote' (($calls.Count -eq 2) -and $calls[0].Dir -and ($calls[1].Dir -eq $calls[0].Dir) -and ($calls[0].Dir.TrimEnd('\') -ne (Join-Path $itRoot 'Launcher')))
    Yes 'T4 so the new exe ends up in the root, as it always did' (Test-Path -LiteralPath (Join-Path $itRoot 'Launcher\Thornswood.exe'))

    # With Ship beside it and no -NoShip, Ship does both and this does neither.
    Set-Content -LiteralPath (Join-Path $itRel 'Ship.ps1') -Value $stubShip -Encoding ASCII
    Remove-Item -LiteralPath $callLog -Force -ErrorAction SilentlyContinue
    $t = Invoke-Child $ps (Join-Path $itDev 'Install-Thornswood.ps1') @('-Root', $itRoot, '-Only', 'launcher', '-NoPause', '-Notes', 'test', '-Server', $itRoot, '-Client', $itRoot)
    $calls = @(Read-Log $callLog | ForEach-Object { Split-Call $_ })
    Yes "T5 without -NoShip it passes (exit $($t.Code))" ($t.Code -eq 0)
    Yes 'T6 and hands the launcher to Ship alone, once' (($calls.Count -eq 1) -and ($calls[0].What -eq 'ship'))
    Yes 'T7 and says so once, not once per launcher step' (([regex]::Matches($t.Out, 'built as part of publishing')).Count -eq 1)

    # A stand-in Skyrim, a copy of ping.exe named SkyrimSE.exe as
    # tests\test-2233-inuse-image.ps1 makes, run from somewhere else and then
    # from the root's own Game folder.
    $elsewhere = Join-Path $work 'elsewhere'
    $itGame = Join-Path $itRoot 'Game'
    New-Item -ItemType Directory -Force -Path $elsewhere, $itGame | Out-Null
    $ping = Get-WindowsPath 'System32\PING.EXE'
    $realClose = Join-Path $itDev 'Close-Launcher.ps1'
    # The root's own Game\SkyrimSE.exe, told running by Close-Launcher.ps1 from
    # the folder's side; null when that script has no such test.
    function Test-OwnImage {
        & { . $realClose; if (Get-Command Test-GameImageRunning -ErrorAction SilentlyContinue) { Test-GameImageRunning (Join-Path $itGame 'SkyrimSE.exe') } else { $null } }
    }
    foreach ($case in @(@{ Dir = $elsewhere; Ours = $false }, @{ Dir = $itGame; Ours = $true })) {
        $sky = Join-Path $case.Dir 'SkyrimSE.exe'
        Copy-Item -LiteralPath $ping -Destination $sky -Force
        $p = Start-Process -FilePath $sky -ArgumentList '-n', '30', '127.0.0.1' -PassThru -WindowStyle Hidden
        try {
            Start-Sleep -Milliseconds 500
            Remove-Item -LiteralPath $callLog -Force -ErrorAction SilentlyContinue
            $t = Invoke-Child $ps (Join-Path $itDev 'Install-Thornswood.ps1') @('-Root', $itRoot, '-Only', 'launcher', '-NoShip', '-NoPause', '-Server', $itRoot, '-Client', $itRoot)
            $calls = @(Read-Log $callLog)
            $image = Test-OwnImage
            if (-not $case.Ours) {
                Yes "U1 a Skyrim running from another folder does not stop it (exit $($t.Code))" ($t.Code -eq 0 -and $calls.Count -eq 2)
                if ($t.Code -ne 0) { Write-Host $t.Out }
                Yes 'U1 and the root''s own Game\SkyrimSE.exe is not taken for running' ($image -eq $false)
            } else {
                Yes "U2 a Skyrim running from the root's own Game folder stops it (exit $($t.Code))" ($t.Code -eq 1)
                Yes 'U2 and says so, naming that folder' ($t.Out.Contains('STOP. Skyrim is running from ' + $itGame))
                Yes 'U2 and builds nothing' ($calls.Count -eq 0)
                # The test another account's game gets, whose path cannot be read.
                Yes 'U3 the root''s own Game\SkyrimSE.exe is told running from the folder''s side' ($image -eq $true)
            }
        } finally { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; $p.WaitForExit() }
    }
    Yes 'U3 and once it has exited, it is not' ((Test-OwnImage) -eq $false)
    $src = Get-Content -LiteralPath $realClose -Raw
    Yes 'U4 Test-GameRunning no longer counts a game it cannot read on its name alone' (
        $src -notmatch "if \(-not \`$path -or" -and $src -match "elseif \(Test-GameImageRunning \(Join-Path \`$Root \('Game\\' \+ \`$n \+ '\.exe'\)\)\)")
    Yes 'U5 and matches the root with its backslash, so C:\Thornswood is not C:\Thornswood-DevBuild' ($src.Contains("`$prefix = `$Root.TrimEnd('\') + '\'"))

    # The dev install is asked by its whole name (#2900): a folder whose name
    # merely ends in -devbuild, such as the dev release folder
    # local\release-devbuild, is a scratch root and leaves the Desktop alone.
    # The whole name is what Where.ps1 InstallDev answers (#3031).
    $inst = Get-Content -LiteralPath (Join-Path $RepoDir 'scripts\release\Install-Launcher.ps1') -Raw
    Yes 'V1 the dev install is Where.ps1 InstallDev by its whole name, not any folder ending in -DevBuild' (
        $inst.Contains("`$devInstall  = [string](& (Join-Path `$Here 'Where.ps1') InstallDev)") -and
        $inst.Contains("`$isDevRoot = `$Root.TrimEnd('\') -ieq `$devInstall") -and $inst -notmatch "isDevRoot\s*=[^\r\n]*-match")

    # ---- 8. who calls the install ------------------------------------------------
    # By code, not by comment: Build-Launcher.ps1's header names the install
    # script to say where its old half went, and that is not a call. In a
    # script a call names the file in a string; a .cmd or a workflow has no
    # comments worth the distinction.
    $callers = @()
    # scripts\dev and scripts\release since the #440 move, where every
    # Install-Launcher caller lives.
    $callerDirs = @(
        (Join-Path $RepoDir 'scripts\dev'),
        (Join-Path $RepoDir 'scripts\release')
    )
    foreach ($dir in $callerDirs) {
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        foreach ($f in @(Get-ChildItem -LiteralPath $dir -File -Filter '*.ps1')) {
            if ($f.Name -in 'Install-Launcher.ps1', 'Build-Launcher.ps1', 'test-build-vs-install.ps1') { continue }
            $names = @((Get-Ast $f.FullName).FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true) |
                       Where-Object { $_.Value -match 'Install-Launcher\.ps1' })
            if ($names.Count) { $callers += $f.Name }
        }
    }
    $plain = @(Get-ChildItem -LiteralPath $Here -File -Filter '*.cmd' -ErrorAction SilentlyContinue) +
             @(Get-ChildItem -LiteralPath (Join-Path $RepoDir '.github\workflows') -File -ErrorAction SilentlyContinue)
    # A workflow's comment that names the script runs nothing, so only its
    # other lines count.
    foreach ($f in $plain) {
        $run = @(Get-Content -LiteralPath $f.FullName | Where-Object { $_ -notmatch '^\s*(#|::|rem\s)' })
        if (($run -join "`n") -match 'Install-Launcher\.ps1') { $callers += $f.Name }
    }
    $callers = @($callers | Sort-Object)
    Yes ('W1 only Install-Thornswood.ps1 runs the install (Ship sends no launcher since #4825), found: ' + ($callers -join ', ')) (($callers -join ',') -eq 'Install-Thornswood.ps1')

    # Last, so it covers every run above.
    Yes 'D1 the Desktop shortcuts were not touched by any of it' ((Get-DesktopState) -eq $deskBefore)
    Yes 'D2 Explorer was not restarted by any of it' ((Get-ExplorerState) -eq $explorerBefore)
}
finally {
    if ($held) { $held.Close() }
    # SetEnvironmentVariable with a null value removes the variable, which is
    # what it was before this ran if it had not been set.
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
exit $(if ($script:fail) { 1 } else { 0 })
