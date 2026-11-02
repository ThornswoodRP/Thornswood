<#
  Build-Launcher.ps1
  Publishes the launcher, Thornswood.exe and the native libraries beside it.
  The install is inside the launcher (launcher\app\Install*.cs, #4824), so
  there is no setup program of its own to build: Velopack's Setup.exe is made
  where the launcher is packed (merge-release.yml).

  THE LAUNCHER (#4823, #4825). Avalonia on .NET 10, compiled to native code
  and self-contained (Patrick, 27 Oct 2026, docs/studies/launcher-stack):
      dotnet publish launcher\app\Thornswood.csproj -c Release -r win-x64
                     -p:PublishAot=true -p:Version=<number>
  into -OutDir. That needs the .NET 10 SDK and, for the native step, the
  Visual Studio 2022 C++ build tools ("Desktop development with C++"), which
  Native AOT links with; it publishes on Windows only. The folder it leaves is
  what a merge release packs with Velopack (merge-release.yml): the exe, the
  native libraries Avalonia draws with, and Thornswood.pdb, the symbols, which
  nothing packs. Every program in it is signed (below), because the launcher
  refuses an update with a program in it that Thornswood did not sign
  (launcher\app\VeloPackage.cs).

  THE TWO ICONS IT EMBEDS GO BESIDE IT (#887). app.ico and app-dev.ico, the
  files the project embeds under those names, byte for byte, for
  Install-Launcher.ps1: it names the shortcuts' icon file after the art the
  exe carries, as the launcher does (Icons.IconFile), and a native exe's
  resources cannot be read back out of it. Nothing packs them; the launcher
  reads its own copies.

  Nothing here needs MSBuild or the .NET Framework any more: the setup stub,
  the last thing built with them, went with #4824. Your friends never compile
  anything - they get the finished program from Setup.exe.

  THE SWITCH (#498, Patrick's option C, 11 Oct; done 15 Oct). Until then this
  script called the .NET Framework csc that ships inside Windows directly,
  with sixty lines finding framework assemblies by hand, and held the launcher
  to C# 5, because that compiler knows nothing newer and was the only one every
  machine that built the launcher had. Since then what goes into each exe
  (sources, references, resources, icon, manifest, file details, LangVersion)
  is written in the project files and nowhere else, and this script is the
  build lines, the checks the project files cannot make, and the signing.

  It builds into the DEV install by default, not the one you play on. Running
  this by hand used to overwrite C:\Thornswood\Launcher, so a build nobody had
  tried yet became the launcher in front of you, and on 17 Sep one did exactly
  that and wrote a broken setting into the game folder on the next Play. A
  build you ran to see whether it compiles should never be able to do that.

  Ship.ps1 passes -Root itself, so a real release still builds where it should.
  Pass -Root 'C:\Thornswood' if you genuinely mean the one you play on.

  IT BUILDS AND DOES NOTHING ELSE. It writes the launcher into -OutDir, which
  is <Root>\Launcher unless told otherwise. It
  closes no game and no launcher, and it does not touch the Desktop, the icon
  cache or Explorer. Those are Install-Launcher.ps1, which Ship.ps1 runs after
  a build that worked. Until 24 September this script did both, so every
  compile check and every hand build closed whatever Skyrim was running on the
  machine. That was To Do List entry 243: "A build produces files in an output
  folder and does not kill processes or write to the Desktop."
#>
[CmdletBinding()]
param(
    [string]$Src,
    # The dev install, Where.ps1 InstallDev, unless told otherwise (#3031).
    [string]$Root,
    # Where Thornswood.exe goes. Ship builds into a folder of its own and lets
    # Install-Launcher put the exe in place, so the build never meets a
    # launcher that is still running from the install.
    [string]$OutDir,
    [switch]$NoPause,
    # Leaves the launcher unsigned even on a machine with records\signing\signing.json.
    # For a test build that never ships, so it spends no signing; Ship never
    # passes it, and Ship refuses an unsigned exe.
    [switch]$NoSign,
    # The number the exe carries, passed to the compile as -p:Version and
    # read back by the launcher from its own file (Updater.Version, #4825).
    # A merge release passes its Velopack version (MergeRelease.ps1), so the
    # exe and the package it goes out in carry one number; Ship.ps1 and
    # release.yml pass theirs (LauncherVersion.ps1, #5179). Left out, this
    # checkout's own number is worked out from its history.
    [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# $MyInvocation is not usable from inside a param block, so the script folder
# is worked out here instead.
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Src)  { $Src  = Join-Path $Here '..\..\launcher\app' }
if (-not $Root) { $Root = [string](& (Join-Path $Here 'Where.ps1') InstallDev) }
if (-not $OutDir) { $OutDir = Join-Path $Root 'Launcher' }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

Head 'Thornswood - launcher build'
Say ("  building into $OutDir") 'DarkGray'
if ($Root.TrimEnd('\\') -ieq [string](& (Join-Path $Here 'Where.ps1') Install)) {
    Say '  this is the install you play on, not the dev one' 'Yellow'
}

# ------------------------------------------------------------ the tools
# The .NET 10 SDK's dotnet (launcher\app\Thornswood.csproj is an SDK
# project, #4823).
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) { Die 'dotnet was not found on this machine. The launcher builds with the .NET 10 SDK (https://dotnet.microsoft.com/download/dotnet/10.0) and, for the native step, the Visual Studio 2022 C++ build tools; the "Setting up a machine" page of the Developer Guide has the install lines.' }
$sdks = @(& $dotnet.Source --list-sdks 2>$null | Where-Object { $_ -match '^10\.' })
if ($sdks.Count -eq 0) { Die 'This machine has dotnet but no .NET 10 SDK (dotnet --list-sdks lists none starting 10.). The launcher targets .NET 10; install the SDK and build again.' }
Say "  dotnet $(($sdks[-1] -split ' ')[0])" 'DarkGray'
$proj = Join-Path $Src 'Thornswood.csproj'
if (-not (Test-Path -LiteralPath $proj)) { Die "Thornswood.csproj is not at $proj. It is in the repository, so the path is wrong; nothing was built." }

# ------------------------------------------- the records compiled into it
# RecordShape.ps1 (#2180): the records compiled into the launcher must be
# a version this checkout knows with every field OwnGame reads, or the build
# stops here; a launcher with a half-read list in it is worse than none. The
# project file embeds them; it cannot read their shape, so this does.
. (Join-Path $Here 'RecordShape.ps1')
foreach ($embedded in @(@{ Path = (Join-Path $Here '..\..\records\skyrim-files.json'); Kind = 'skyrim-files' },
                        @{ Path = (Join-Path $Here '..\..\records\ui-gone.json'); Kind = 'ui-gone' },
                        @{ Path = (Join-Path $Here '..\..\records\generated.json'); Kind = 'generated' })) {
    if (Test-Path -LiteralPath $embedded.Path) {
        try { $null = Read-ThornswoodRecord -Path $embedded.Path -Kind $embedded.Kind } catch { Die ($_.Exception.Message + ' Nothing was built.') }
    }
}

$null = New-Item -ItemType Directory -Force -Path $outDir
$exe = Join-Path $outDir 'Thornswood.exe'

# Nothing is closed here; Install-Launcher.ps1 does that, after a build that
# worked. So a launcher still running from this folder holds its own exe and
# the build cannot replace it. That is said plainly here, before any work,
# rather than left to a file-in-use error at the end of a compile.
if (Test-Path -LiteralPath $exe) {
    try { $held = [IO.File]::Open($exe, 'Open', 'ReadWrite', 'None'); $held.Close() }
    catch { Die ("$exe is in use, most likely by the launcher running from that folder. A build closes nothing. " +
                 "Close it, or build somewhere else with -OutDir. Ship builds into a folder of its own and closes it for you.") }
}

# ------------------------------------------------------------ the number
# THE VERSION COMES FROM THE BUILD (#5179, #4825). It goes into the compile as
# -p:Version, which is the exe's file version and assembly version, and the
# launcher reads it from there (Updater.Version). Nothing writes a source
# file for it: until #4825 this wrote the number into Updater.cs for the
# compile and put git's 0.0.0 back after. A hand build or a test build takes
# this checkout's own number, so a launcher built here never sees the
# published one as newer.
. (Join-Path $Here 'LauncherVersion.ps1')
if (-not $Version) {
    try { $Version = Get-LauncherVersion -RepoDir (Join-Path $Here '..\..') }
    catch { Die ($_.Exception.Message + ' Pass -Version to build with a number of your own. Nothing was built.') }
}
if ($Version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { Die "-Version $Version is not a.b.c or a.b.c.d. Nothing was built." }
# A file version holds each part in 0 to 65534.
if (@($Version.Split('.') | Where-Object { [long]$_ -gt 65534 }).Count) { Die "-Version $Version has a part over 65534, which a Windows file version cannot hold. Nothing was built." }
Say "  launcher $Version" 'DarkGray'

Head 'Publishing the launcher'
# Native AOT for win-x64 (the project says so too; said here so a change to
# the project cannot quietly make the release a JIT build). Into a scratch
# folder first, then into -OutDir, so a publish that fails leaves the folder
# as it was. --disable-build-servers (#3169): otherwise the build servers stay
# up after the build, holding files under out\obj, and a runner names them
# as left behind.
$pubDir = Join-Path ([IO.Path]::GetTempPath()) ('ThornswoodLauncherPublish-' + [guid]::NewGuid().ToString('N'))
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
# Every line is shown as dotnet says it and kept, for the check below.
$said = New-Object System.Collections.Generic.List[string]
& $dotnet.Source publish (Resolve-Path -LiteralPath $proj).Path --nologo -v minimal --disable-build-servers `
    -c Release -r win-x64 --self-contained true -p:PublishAot=true "-p:Version=$Version" -o $pubDir 2>&1 |
    ForEach-Object { $l = [string]$_; $said.Add($l); Write-Host $l }
$rc = $LASTEXITCODE
$ErrorActionPreference = $old
$pubExe = Join-Path $pubDir 'Thornswood.exe'
if ($rc -ne 0 -or -not (Test-Path -LiteralPath $pubExe)) {
    if (Test-Path -LiteralPath $pubDir) { Remove-Item -LiteralPath $pubDir -Recurse -Force }
    Die "dotnet publish exited with $rc"
}
# NO TRIM OR NATIVE CODE WARNING GOES OUT (#4823). An IL2xxx warning is code
# the trimmer could not follow and an IL3xxx one code that needs the JIT the
# native exe does not have: each is a call that can fail in the exe people
# run and never in a JIT build. The publish says them and carries on, so the
# build stops on them here, every build alike: the Launcher builds check, a
# Ship and a merge release.
$aot = @($said | Where-Object { $_ -match '\bwarning IL[23]\d{3}\b' } | Sort-Object -Unique)
if ($aot.Count) {
    Remove-Item -LiteralPath $pubDir -Recurse -Force
    Write-Host ''
    foreach ($w in $aot) { Write-Host "  $w" -ForegroundColor Red }
    Die ("The native publish gave {0} trim or native code warning(s) (IL2xxx, IL3xxx), listed above. Each is code that may fail in the native exe; fix it at its cause. Nothing was put in $outDir." -f $aot.Count)
}
# The exe must say the number it was built with; the launcher reads it there.
$fileVersion = (Get-Item -LiteralPath $pubExe).VersionInfo.FileVersion
$want = if ($Version.Split('.').Count -eq 3) { "$Version.0" } else { $Version }
if ($fileVersion -ne $want) {
    Remove-Item -LiteralPath $pubDir -Recurse -Force
    Die "The published Thornswood.exe says file version $fileVersion, and it was built as $Version. Nothing was put in $outDir."
}
# The folder's launcher files are replaced, and nothing else in it is touched.
foreach ($f in @(Get-ChildItem -LiteralPath $pubDir -File)) {
    Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $outDir $f.Name) -Force
}
Remove-Item -LiteralPath $pubDir -Recurse -Force
# The icons the project embeds, named by their LogicalName, read off the
# project itself so the file beside the exe is the one compiled into it
# (header). A project that embeds either under another name, or not at all,
# stops the build: Install-Launcher could not name the shortcuts' icon.
$projXml = [xml](Get-Content -LiteralPath $proj -Raw)
$embedded = @($projXml.SelectNodes("//*[local-name()='EmbeddedResource']"))
foreach ($want in 'app.ico', 'app-dev.ico') {
    $items = @($embedded | Where-Object { $n = $_.SelectSingleNode("*[local-name()='LogicalName']"); $n -and $n.InnerText.Trim() -eq $want })
    if ($items.Count -ne 1) { Die "Thornswood.csproj embeds $($items.Count) resources named $want, not one, so the icon beside the exe cannot be the one inside it. Nothing more was put in $outDir." }
    $icoSrc = Join-Path (Split-Path -Parent $proj) $items[0].GetAttribute('Include')
    if (-not (Test-Path -LiteralPath $icoSrc)) { Die "$icoSrc, which Thornswood.csproj embeds as $want, is not there." }
    Copy-Item -LiteralPath $icoSrc -Destination (Join-Path $outDir $want) -Force
}
$programs = @(Get-ChildItem -LiteralPath $outDir -File | Where-Object { $_.Extension -in '.exe', '.dll' })
foreach ($p in $programs) { Say ("  {0}  {1:n0} KB" -f $p.Name, ($p.Length / 1KB)) 'Green' }
$pdb = [IO.Path]::ChangeExtension($exe, '.pdb')
if (Test-Path -LiteralPath $pdb) {
    Say ("  Thornswood.pdb  {0:n0} KB (kept beside the exe; nothing packs it)" -f ((Get-Item $pdb).Length / 1KB)) 'DarkGray'
} else {
    Say '  Thornswood.pdb did not appear beside the exe' 'Yellow'
}
Say '  app.ico, app-dev.ico (the icons it embeds, for Install-Launcher.ps1)' 'DarkGray'

# ------------------------------------------------------------ signing
#
# Sign every program of the launcher here: Thornswood.exe and each native
# library beside it, because the launcher refuses an update carrying a program
# Thornswood did not sign (VeloPackage.cs).
#
# This does nothing at all unless records\signing\signing.json exists, so Djinn's machine
# and the pull request build carry on exactly as before. See the header of
# Sign-Artifact.ps1 for what that file holds. GitHub's runner signs with Sign-OnRunner.ps1 instead,
# after a -NoSign build (merge-release.yml).
$signer = Join-Path $Here 'Sign-Artifact.ps1'
if ($NoSign) {
    Say '  not signing: -NoSign, a test build that never ships' 'DarkGray'
} elseif (Test-Path -LiteralPath $signer) {
    Head 'Signing'
    & $signer -Path @($programs | ForEach-Object { $_.FullName })
    if ($LASTEXITCODE -ne 0) { Die 'Signing failed. Nothing was published.' }
}

# The shortcut, the icon file beside the exe, Explorer's redraw and its icon
# cache used to follow here. They are Install-Launcher.ps1 now, with the
# closing of a running game and launcher, because they are what an install
# does and a build has no business doing them.

Head 'Done'
Say $exe 'Green'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }

# Said out loud rather than left to chance.
#
# A PowerShell script that runs off the end does not reset $LASTEXITCODE: the
# caller sees whatever the last native command left behind, and this script runs
# dotnet and signtool. Ship.ps1 reads that code to decide whether a
# release may go out, so a stray value here would either hide a failure or stop
# a good build for no reason.
exit 0
