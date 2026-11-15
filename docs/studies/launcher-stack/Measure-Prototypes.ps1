<#
.SYNOPSIS
  Builds every prototype of the launcher stack study (#3209) on this Windows
  machine and measures what a person would notice: how big each one is, how
  long its window takes to show, how much memory it holds, and what the
  Windows Volume Mixer shows for its sound.

.DESCRIPTION
  Every toolchain it needs goes under -Work, nothing is installed for the
  machine and nothing outside -Work is written, apart from the web view data
  folders the web view stacks make for themselves under %LOCALAPPDATA% (the
  script names and removes them at the end). Visual Studio's C++ build tools
  must already be there (One has them for the engine); the script stops and
  says so when they are not.

  For each prototype it then runs the exe -Runs times. A run waits for the
  prototype to write its ready file (README.md, "The contract"), which it does
  once its first frame with the art is on screen, and takes that wait as the
  start time. Three seconds later it reads the memory of the prototype and
  every process under it (idle). The prototype starts its music and a
  stand-in for Play at four seconds; at eight seconds the memory is read again
  (active) together with every Windows audio session that belongs to the
  prototype's processes, which is what the Volume Mixer lists. Then the
  process tree is closed. The first run of each prototype is reported on its
  own (the first start after a build), the rest as a median. For a run that
  writes no ready file it keeps the prototype's exit code, the last lines of
  its stdout and stderr, the log it wrote beside the ready file (Electron
  does), and what the Application event log says about it, and results.md
  shows them.

  The music is a quiet hiss a few steps above silence, so a run makes an
  audio session without being heard.

  It writes results.json and results.md into -Work. results.md is what goes
  on the issue.

.PARAMETER Work
  Where the toolchains, builds and results go. Removed by -Clean. By default
  the 3209-launcher-stack folder in the checkout's temp folder
  (scripts\release\Get-ScratchDir.ps1).

.PARAMETER Only
  Build and measure only these prototypes (names as in the table of
  README.md, for example tauri, wpf-net10), separated by commas. It works the
  same through pwsh -File and from a pwsh prompt.

.PARAMETER Runs
  Runs per prototype, the first included. Five by default.

.PARAMETER MeasureOnly
  Measure the builds already in -Work without building again.

.PARAMETER Clean
  Remove -Work and the web view data folders, and do nothing else.

.EXAMPLE
  pwsh -File docs\studies\launcher-stack\Measure-Prototypes.ps1
#>
[CmdletBinding()]
param(
    [string]$Work = '',
    [string[]]$Only,
    [int]$Runs = 5,
    [switch]$MeasureOnly,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Study = $PSScriptRoot
$Proto = Join-Path $Study 'prototypes'
$Repo = (Resolve-Path (Join-Path $Study '..\..\..')).Path
if (-not $Work) { $Work = & (Join-Path $Repo 'scripts\release\Get-ScratchDir.ps1') '3209-launcher-stack' }
$Tools = Join-Path $Work 'tools'
$Out = Join-Path $Work 'out'
$Art = Join-Path $Repo 'launcher\art\thornswood-art-1536.png'

# The web view data folders the web view prototypes make for themselves, by
# the identifier or exe name each one runs under.
$WebViewData = @(
    (Join-Path $env:LOCALAPPDATA 'net.thornswood.proto.tauri'),
    (Join-Path $env:LOCALAPPDATA 'proto-wails.exe'),
    (Join-Path $env:APPDATA 'proto-electron'),
    (Join-Path $env:TEMP 'proto-wpf-net481-webview2-webview'),
    (Join-Path $env:TEMP 'proto-wpf-net10-webview2-webview')
)

# Remove-Item stalls on a path with an ampersand in it, and -Work can sit
# under one (it did on 27 Oct, under C:\ThornswoodTemps&Worktrees, the
# shipping machine's temps folder before #2900), so folders and files are removed
# through .NET instead. .NET refuses a read-only file (the .NET SDK's
# hostfxr.dll, Flutter's .gitignore: the -Clean of 27 Oct stopped on them), so
# every attribute is cleared first.
function Remove-Tree([string]$path) {
    if ([IO.Directory]::Exists($path)) {
        $d = [IO.DirectoryInfo]::new($path)
        foreach ($e in $d.EnumerateFileSystemInfos('*', [IO.SearchOption]::AllDirectories)) { $e.Attributes = [IO.FileAttributes]::Normal }
        $d.Attributes = [IO.FileAttributes]::Normal
        $d.Delete($true)
    } elseif ([IO.File]::Exists($path)) {
        [IO.File]::SetAttributes($path, [IO.FileAttributes]::Normal)
        [IO.File]::Delete($path)
    }
}

if ($Clean) {
    foreach ($p in @($Work) + $WebViewData) {
        if (Test-Path -LiteralPath $p) { Remove-Tree $p; Write-Host "removed $p" }
    }
    return
}

# cmd.exe splits a command line at an ampersand, and npm's npx.cmd, Flutter's
# flutter.bat and the batch steps of Flutter's Visual Studio build all go
# through cmd, so with -Work under C:\ThornswoodTemps&Worktrees Electron and
# Flutter stopped on 27 Oct with '"C:\ThornswoodTemps"' is not recognized. A folder
# whose name has the ampersand gets a drive letter of its own (subst, for this
# sign in only), every path below goes through it, and it is taken away at the
# end.
$script:Substs = @()
function Use-Drive([string]$path) {
    $full = [IO.Path]::GetFullPath($path)
    $amp = $full.IndexOf('&')
    if ($amp -lt 0) { return $full }
    $cut = $full.IndexOf('\', $amp)
    $root = if ($cut -lt 0) { $full } else { $full.Substring(0, $cut) }
    $have = $script:Substs | Where-Object { $_.Root -eq $root } | Select-Object -First 1
    if (-not $have) {
        $used = @([IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name.Substring(0, 1).ToUpperInvariant() })
        $letter = [char[]]'TSRQPONMLKJIHG' | Where-Object { "$_" -notin $used } | Select-Object -First 1
        if (-not $letter) { throw "No free drive letter to stand for $root." }
        & subst.exe "$($letter):" $root | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "subst $($letter): $root failed with exit code $LASTEXITCODE" }
        $have = [pscustomobject]@{ Root = $root; Drive = "$($letter):" }
        $script:Substs += $have
        Say "$($have.Drive) stands for $root until the run ends"
    }
    $rest = $full.Substring($root.Length)
    $have.Drive + $(if ($rest) { $rest } else { '\' })
}

function Say([string]$text) { Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $text) }

function Invoke-Checked([string]$what, [scriptblock]$block) {
    Say $what
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$what failed with exit code $LASTEXITCODE" }
}

function Get-File([string]$url, [string]$to) {
    if (Test-Path -LiteralPath $to) { return }
    Say "download $url"
    Invoke-WebRequest -Uri $url -OutFile "$to.part" -UseBasicParsing
    Move-Item -LiteralPath "$to.part" -Destination $to
}

# --- Toolchains -------------------------------------------------------------

function Find-VcVars {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio is not installed here (no vswhere.exe); the Rust, Qt, Flutter and Avalonia AOT builds need its C++ build tools.' }
    $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $vs) { throw 'Visual Studio has no C++ build tools (Microsoft.VisualStudio.Component.VC.Tools.x86.x64).' }
    Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
}

# Takes the environment vcvars64.bat makes into this session, so cl, link,
# cmake and ninja from Visual Studio are on PATH for every build below.
function Use-VcVars([string]$bat) {
    $lines = cmd.exe /c "`"$bat`" >nul && set"
    if ($LASTEXITCODE -ne 0) { throw "vcvars64.bat failed: $bat" }
    foreach ($l in $lines) {
        $i = $l.IndexOf('=')
        if ($i -gt 0) { [Environment]::SetEnvironmentVariable($l.Substring(0, $i), $l.Substring($i + 1), 'Process') }
    }
    # The NativeAOT link step (avalonia-aot) runs vswhere.exe by bare name to
    # find the linker, and vcvars64.bat does not put the Visual Studio
    # Installer folder on PATH: on 27 Oct that build stopped with "'vswhere.exe'
    # is not recognized". The folder Find-VcVars took vswhere from goes on PATH.
    $env:PATH = "$(Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer');$env:PATH"
}

function Install-Tools {
    New-Item -ItemType Directory -Force -Path $Tools | Out-Null

    $dotnet = Join-Path $Tools 'dotnet'
    if (-not (Test-Path -LiteralPath (Join-Path $dotnet 'dotnet.exe'))) {
        $installer = Join-Path $Tools 'dotnet-install.ps1'
        Get-File 'https://dot.net/v1/dotnet-install.ps1' $installer
        Invoke-Checked 'install the .NET 10 SDK' { & $installer -Channel 10.0 -InstallDir $dotnet -NoPath; $global:LASTEXITCODE = 0 }
    }
    $env:DOTNET_ROOT = $dotnet
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $env:DOTNET_NOLOGO = '1'
    $env:PATH = "$dotnet;$env:PATH"
    # A NuGet source of the run's own: One's user NuGet.Config has an empty
    # packageSources, and every .NET restore stopped there with NU1100 on 27
    # Oct. The packages go under -Work too.
    $script:NuGetConfig = Join-Path $Tools 'NuGet.Config'
    Set-Content -LiteralPath $script:NuGetConfig -Encoding utf8 -Value @(
        '<?xml version="1.0" encoding="utf-8"?>',
        '<configuration>',
        '  <packageSources>',
        '    <clear />',
        '    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />',
        '  </packageSources>',
        '</configuration>')
    $env:NUGET_PACKAGES = Join-Path $Tools 'nuget-packages'

    $env:RUSTUP_HOME = Join-Path $Tools 'rustup'
    $env:CARGO_HOME = Join-Path $Tools 'cargo'
    if (-not (Test-Path -LiteralPath (Join-Path $env:CARGO_HOME 'bin\cargo.exe'))) {
        $rustup = Join-Path $Tools 'rustup-init.exe'
        Get-File 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' $rustup
        Invoke-Checked 'install Rust' { & $rustup -y --no-modify-path --profile minimal --default-toolchain stable }
    }
    $env:PATH = "$(Join-Path $env:CARGO_HOME 'bin');$env:PATH"

    $go = Join-Path $Tools 'go'
    if (-not (Test-Path -LiteralPath (Join-Path $go 'bin\go.exe'))) {
        $zip = Join-Path $Tools 'go.zip'
        Get-File 'https://go.dev/dl/go1.27.3.windows-amd64.zip' $zip
        Say 'unpack Go'
        Expand-Archive -LiteralPath $zip -DestinationPath $Tools
    }
    $env:GOROOT = $go
    $env:GOPATH = Join-Path $Tools 'gopath'
    $env:GOCACHE = Join-Path $Tools 'gocache'
    $env:PATH = "$(Join-Path $go 'bin');$env:PATH"

    $node = Join-Path $Tools 'node-v22.23.4-win-x64'
    if (-not (Test-Path -LiteralPath (Join-Path $node 'node.exe'))) {
        $zip = Join-Path $Tools 'node.zip'
        Get-File 'https://nodejs.org/dist/v22.23.4/node-v22.23.4-win-x64.zip' $zip
        Say 'unpack Node'
        Expand-Archive -LiteralPath $zip -DestinationPath $Tools
    }
    $env:PATH = "$node;$env:PATH"
    $env:npm_config_cache = Join-Path $Tools 'npm-cache'

    $flutter = Join-Path $Tools 'flutter'
    if (-not (Test-Path -LiteralPath (Join-Path $flutter 'bin\flutter.bat'))) {
        $zip = Join-Path $Tools 'flutter.zip'
        Get-File 'https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.47.8-stable.zip' $zip
        Say 'unpack Flutter'
        Expand-Archive -LiteralPath $zip -DestinationPath $Tools
    }
    $env:PATH = "$(Join-Path $flutter 'bin');$env:PATH"
    $env:PUB_CACHE = Join-Path $Tools 'pub-cache'
    $env:FLUTTER_SUPPRESS_ANALYTICS = 'true'

    # Qt through aqtinstall in its own Python environment. 6.10.2 is the
    # newest whose Windows packages aqtinstall could read on 26 Oct 2026.
    $qt = Join-Path $Tools 'qt\6.10.2\msvc2022_64'
    if (-not (Test-Path -LiteralPath (Join-Path $qt 'bin\windeployqt.exe'))) {
        $venv = Join-Path $Tools 'aqt'
        if (-not (Test-Path -LiteralPath (Join-Path $venv 'Scripts\python.exe'))) {
            $py = Get-Command py, python -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $py) { throw 'No Python here for aqtinstall (the Qt build).' }
            Invoke-Checked 'make the Python environment for aqtinstall' { & $py.Source -m venv $venv }
            Invoke-Checked 'install aqtinstall' { & (Join-Path $venv 'Scripts\python.exe') -m pip install --quiet aqtinstall }
        }
        Invoke-Checked 'install Qt 6.10.2' { & (Join-Path $venv 'Scripts\aqt.exe') install-qt windows desktop 6.10.2 win64_msvc2022_64 -O (Join-Path $Tools 'qt') }
    }
    $script:QtDir = $qt
}

# --- Builds -----------------------------------------------------------------

function Write-QuietWav([string]$to) {
    # Two seconds of 44.1 kHz stereo, 16 bit, a hiss of +/- 2 steps: an audio
    # session opens and plays, and nobody in the room hears it.
    $frames = 44100 * 2
    $data = New-Object byte[] ($frames * 4)
    $rand = [System.Random]::new(3209)
    for ($i = 0; $i -lt $data.Length; $i += 2) {
        $v = [int16]$rand.Next(-2, 3)
        $b = [BitConverter]::GetBytes($v)
        $data[$i] = $b[0]; $data[$i + 1] = $b[1]
    }
    $ms = [System.IO.MemoryStream]::new()
    $w = [System.IO.BinaryWriter]::new($ms)
    $w.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $w.Write([int](36 + $data.Length))
    $w.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt ')); $w.Write([int]16); $w.Write([int16]1); $w.Write([int16]2)
    $w.Write([int]44100); $w.Write([int](44100 * 4)); $w.Write([int16]4); $w.Write([int16]16)
    $w.Write([Text.Encoding]::ASCII.GetBytes('data')); $w.Write([int]$data.Length); $w.Write($data)
    $w.Flush()
    [IO.File]::WriteAllBytes($to, $ms.ToArray())
}

function Add-Assets([string]$dir, [switch]$Page) {
    Copy-Item -LiteralPath $Art -Destination (Join-Path $dir 'art.png') -Force
    Copy-Item -LiteralPath $script:Wav -Destination (Join-Path $dir 'loop.wav') -Force
    if ($Page) { Copy-Item -LiteralPath (Join-Path $Proto 'index.html') -Destination $dir -Force }
}

function Reset-Dir([string]$dir) {
    Remove-Tree $dir
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

# Each build: the folder that is run (with the art and the music beside the
# exe, or inside it for the stacks that embed their page) and, where the
# assets are built into the exe, a second build without them that is only
# weighed. Sizes never count the art, the music, or debug symbols.
$Builds = [ordered]@{
    'wpf-net481-webview2' = {
        $o = Join-Path $Out 'wpf-net481-webview2'; Reset-Dir $o
        Invoke-Checked 'build wpf-net481-webview2' { dotnet publish "-p:RestoreConfigFile=$($script:NuGetConfig)" (Join-Path $Proto 'wpf\wpf-net481-webview2.csproj') -c Release -o $o }
        Add-Assets $o -Page
    }
    'wpf-net10' = {
        $o = Join-Path $Out 'wpf-net10'; Reset-Dir $o
        Invoke-Checked 'build wpf-net10 (needs the .NET 10 Desktop Runtime)' { dotnet publish "-p:RestoreConfigFile=$($script:NuGetConfig)" (Join-Path $Proto 'wpf\wpf-net10.csproj') -c Release -r win-x64 --self-contained false -o $o }
        Add-Assets $o
    }
    'wpf-net10-sc' = {
        $o = Join-Path $Out 'wpf-net10-sc'; Reset-Dir $o
        Invoke-Checked 'build wpf-net10-sc (self-contained, one file)' { dotnet publish "-p:RestoreConfigFile=$($script:NuGetConfig)" (Join-Path $Proto 'wpf\wpf-net10.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o $o }
        Add-Assets $o
    }
    'wpf-net10-webview2-sc' = {
        $o = Join-Path $Out 'wpf-net10-webview2-sc'; Reset-Dir $o
        Invoke-Checked 'build wpf-net10-webview2-sc' { dotnet publish "-p:RestoreConfigFile=$($script:NuGetConfig)" (Join-Path $Proto 'wpf\wpf-net10-webview2.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o $o }
        Add-Assets $o -Page
    }
    'winui3' = {
        $o = Join-Path $Out 'winui3'; Reset-Dir $o
        Invoke-Checked 'build winui3 (unpackaged, self-contained)' { dotnet publish "-p:RestoreConfigFile=$($script:NuGetConfig)" (Join-Path $Proto 'winui3\proto-winui3.csproj') -c Release -o $o }
        Add-Assets $o
    }
    'avalonia' = {
        $o = Join-Path $Out 'avalonia'; Reset-Dir $o
        Invoke-Checked 'build avalonia (self-contained, trimmed, one file)' { dotnet publish "-p:RestoreConfigFile=$($script:NuGetConfig)" (Join-Path $Proto 'avalonia\proto-avalonia.csproj') -c Release -r win-x64 --self-contained true -p:PublishTrimmed=true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o $o }
        Add-Assets $o
    }
    'avalonia-aot' = {
        $o = Join-Path $Out 'avalonia-aot'; Reset-Dir $o
        Invoke-Checked 'build avalonia-aot (native code, no JIT)' { dotnet publish "-p:RestoreConfigFile=$($script:NuGetConfig)" (Join-Path $Proto 'avalonia\proto-avalonia.csproj') -c Release -r win-x64 -p:PublishAot=true -o $o }
        Add-Assets $o
    }
    'tauri' = {
        $src = Join-Path $Proto 'tauri'; $dist = Join-Path $src 'dist'
        $o = Join-Path $Out 'tauri'; $w = Join-Path $Out 'tauri-weigh'; Reset-Dir $o; Reset-Dir $w
        Reset-Dir $dist; Copy-Item -LiteralPath (Join-Path $Proto 'index.html') -Destination $dist
        Push-Location $src
        try {
            Invoke-Checked 'build tauri (weighed, page only)' { cargo build --release }
            Copy-Item -LiteralPath 'target\release\proto-tauri.exe' -Destination $w
            Add-Assets $dist
            (Get-Item 'main.rs').LastWriteTime = Get-Date
            Invoke-Checked 'build tauri (run, page with art and music)' { cargo build --release }
            Copy-Item -LiteralPath 'target\release\proto-tauri.exe' -Destination $o
        } finally { Pop-Location }
    }
    'slint' = {
        $o = Join-Path $Out 'slint'; Reset-Dir $o
        Push-Location (Join-Path $Proto 'slint')
        try { Invoke-Checked 'build slint' { cargo build --release }; Copy-Item -LiteralPath 'target\release\proto-slint.exe' -Destination $o } finally { Pop-Location }
        Add-Assets $o
    }
    'egui' = {
        $o = Join-Path $Out 'egui'; Reset-Dir $o
        Push-Location (Join-Path $Proto 'egui')
        try { Invoke-Checked 'build egui' { cargo build --release }; Copy-Item -LiteralPath 'target\release\proto-egui.exe' -Destination $o } finally { Pop-Location }
        Add-Assets $o
    }
    'wails' = {
        $src = Join-Path $Proto 'wails'; $front = Join-Path $src 'frontend'
        $o = Join-Path $Out 'wails'; $w = Join-Path $Out 'wails-weigh'; Reset-Dir $o; Reset-Dir $w
        Reset-Dir $front; Copy-Item -LiteralPath (Join-Path $Proto 'index.html') -Destination $front
        Push-Location $src
        try {
            Invoke-Checked 'build wails (weighed, page only)' { go build -tags desktop,production -ldflags '-w -s -H windowsgui' -o (Join-Path $w 'proto-wails.exe') . }
            Add-Assets $front
            Invoke-Checked 'build wails (run, page with art and music)' { go build -tags desktop,production -ldflags '-w -s -H windowsgui' -o (Join-Path $o 'proto-wails.exe') . }
        } finally { Pop-Location }
    }
    'electron' = {
        $src = Join-Path $Proto 'electron'
        $o = Join-Path $Out 'electron'; $w = Join-Path $Out 'electron-weigh'; Reset-Dir $o; Reset-Dir $w
        Push-Location $src
        try {
            Invoke-Checked 'install electron' { npm install --no-audit --no-fund }
            Remove-Tree (Join-Path $src 'art.png'); Remove-Tree (Join-Path $src 'loop.wav')
            Copy-Item -LiteralPath (Join-Path $Proto 'index.html') -Destination $src -Force
            Invoke-Checked 'package electron (weighed, page only)' { npx electron-packager . proto-electron --platform=win32 --arch=x64 --out $w --overwrite --ignore='^/node_modules' }
            Add-Assets $src
            Invoke-Checked 'package electron (run, page with art and music)' { npx electron-packager . proto-electron --platform=win32 --arch=x64 --out $o --overwrite --ignore='^/node_modules' }
        } finally { Pop-Location }
    }
    'qt' = {
        $src = Join-Path $Proto 'qt'; $b = Join-Path $Work 'build-qt'
        $o = Join-Path $Out 'qt'; Reset-Dir $o; Reset-Dir $b
        Invoke-Checked 'configure qt' { cmake -S $src -B $b -G Ninja -DCMAKE_BUILD_TYPE=Release "-DCMAKE_PREFIX_PATH=$script:QtDir" }
        Invoke-Checked 'build qt' { cmake --build $b }
        Copy-Item -LiteralPath (Join-Path $b 'proto-qt.exe') -Destination $o
        Invoke-Checked 'deploy qt' { & (Join-Path $script:QtDir 'bin\windeployqt.exe') --release --qmldir $src --no-translations --no-opengl-sw (Join-Path $o 'proto-qt.exe') }
        Add-Assets $o
    }
    'flutter' = {
        $src = Join-Path $Proto 'flutter'
        $o = Join-Path $Out 'flutter'; Reset-Dir $o
        Push-Location $src
        try {
            Invoke-Checked 'make the flutter platform folder' { flutter create --platforms=windows --project-name proto_flutter . }
            Invoke-Checked 'build flutter' { flutter build windows --release -t main.dart }
            Copy-Item -Path 'build\windows\x64\runner\Release\*' -Destination $o -Recurse
        } finally { Pop-Location }
        Add-Assets $o
    }
}

# Which exe each build runs, inside its folder.
$Exe = @{
    'wpf-net481-webview2' = 'wpf-net481-webview2.exe'; 'wpf-net10' = 'wpf-net10.exe'; 'wpf-net10-sc' = 'wpf-net10.exe'
    'wpf-net10-webview2-sc' = 'wpf-net10-webview2.exe'; 'winui3' = 'proto-winui3.exe'; 'avalonia' = 'proto-avalonia.exe'
    'avalonia-aot' = 'proto-avalonia.exe'; 'tauri' = 'proto-tauri.exe'; 'slint' = 'proto-slint.exe'; 'egui' = 'proto-egui.exe'
    'wails' = 'proto-wails.exe'; 'electron' = 'proto-electron-win32-x64\proto-electron.exe'; 'qt' = 'proto-qt.exe'; 'flutter' = 'proto_flutter.exe'
}

# --- Measuring --------------------------------------------------------------

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// Every audio session on the default playback device, as the Volume Mixer
// sees them: the process that owns it, the name and icon it set for itself
// (empty when it set none, and the mixer then shows the exe's description),
// and whether it is playing.
public static class ProtoAudio
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object result);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        int GetAudioSessionControl(IntPtr groupingParam, int flags, out IntPtr control);
        int GetSimpleAudioVolume(IntPtr groupingParam, int flags, out IntPtr volume);
        int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        int GetCount(out int count);
        int GetSession(int index, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        int GetState(out int state);
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        int SetDisplayName(string name, ref Guid context);
        int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        int SetIconPath(string path, ref Guid context);
        int GetGroupingParam(out Guid grouping);
        int SetGroupingParam(ref Guid grouping, ref Guid context);
        int RegisterAudioSessionNotification(IntPtr client);
        int UnregisterAudioSessionNotification(IntPtr client);
        int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetProcessId(out uint pid);
    }

    public class Session
    {
        public uint Pid;
        public string DisplayName;
        public string IconPath;
        public int State;
    }

    public static List<Session> List()
    {
        var list = new List<Session>();
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
        Guid iid = typeof(IAudioSessionManager2).GUID;
        object o;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 1, IntPtr.Zero, out o));
        IAudioSessionEnumerator sessions;
        Marshal.ThrowExceptionForHR(((IAudioSessionManager2)o).GetSessionEnumerator(out sessions));
        int count;
        Marshal.ThrowExceptionForHR(sessions.GetCount(out count));
        for (int i = 0; i < count; i++)
        {
            IAudioSessionControl2 s;
            Marshal.ThrowExceptionForHR(sessions.GetSession(i, out s));
            var r = new Session();
            s.GetProcessId(out r.Pid);
            s.GetDisplayName(out r.DisplayName);
            s.GetIconPath(out r.IconPath);
            s.GetState(out r.State);
            list.Add(r);
        }
        return list;
    }
}
'@

function Get-Tree([int]$root) {
    $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount, ExecutablePath
    $ids = [System.Collections.Generic.List[int]]::new(); $ids.Add($root)
    for ($i = 0; $i -lt $ids.Count; $i++) {
        foreach ($p in $all) { if ($p.ParentProcessId -eq $ids[$i] -and -not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId) } }
    }
    $all | Where-Object { $ids.Contains([int]$_.ProcessId) }
}

function Measure-Tree([int]$root) {
    $tree = @(Get-Tree $root)
    [pscustomobject]@{
        Processes = $tree.Count
        WorkingSetMB = [math]::Round((($tree | Measure-Object WorkingSetSize -Sum).Sum) / 1MB, 1)
        PrivateMB = [math]::Round((($tree | Measure-Object PrivatePageCount -Sum).Sum) / 1MB, 1)
        Tree = $tree
    }
}

# What the mixer shows for each session of the prototype's processes: the
# session's own name when it set one, otherwise the description of the exe
# that owns it, which for a web view is the web view's exe, not ours.
function Get-MixerEntries($tree, [int]$root) {
    $byPid = @{}; foreach ($p in $tree) { $byPid[[int]$p.ProcessId] = $p }
    foreach ($s in [ProtoAudio]::List()) {
        $p = $byPid[[int]$s.Pid]
        if (-not $p) { continue }
        $desc = $null
        if ($p.ExecutablePath) { $desc = (Get-Item -LiteralPath $p.ExecutablePath).VersionInfo.FileDescription }
        [pscustomobject]@{
            Process = $p.Name
            OwnProcess = ([int]$s.Pid -eq $root)
            DisplayName = $s.DisplayName
            ExeDescription = $desc
            MixerShows = $(if ($s.DisplayName -and -not $s.DisplayName.StartsWith('@')) { $s.DisplayName } elseif ($desc) { $desc } else { $p.Name })
            Playing = ($s.State -eq 1)
        }
    }
}

function Stop-Tree([int]$root) {
    $p = Get-Process -Id $root -ErrorAction SilentlyContinue
    if ($p) { [void]$p.CloseMainWindow(); [void]$p.WaitForExit(3000) }
    if (Get-Process -Id $root -ErrorAction SilentlyContinue) { & taskkill.exe /T /F /PID $root | Out-Null }
}

function Get-Size([string]$dir) {
    $files = Get-ChildItem -LiteralPath $dir -Recurse -File | Where-Object { $_.Extension -ne '.pdb' -and $_.Name -notin 'art.png', 'loop.wav' }
    $stage = Join-Path $Work ('weigh-' + [guid]::NewGuid().ToString('n'))
    foreach ($f in $files) {
        $to = Join-Path $stage $f.FullName.Substring($dir.Length).TrimStart('\')
        New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
        Copy-Item -LiteralPath $f.FullName -Destination $to
    }
    $zip = "$stage.zip"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
    $r = [pscustomobject]@{
        InstallMB = [math]::Round((($files | Measure-Object Length -Sum).Sum) / 1MB, 2)
        ZipMB = [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 2)
        Files = $files.Count
    }
    Remove-Tree $stage; Remove-Tree $zip
    $r
}

# The last lines a prototype wrote, once its pipe has closed.
function Get-Tail($task) {
    if (-not $task.Wait(5000)) { return '(still open)' }
    $lines = @($task.Result -split "`r?`n" | Where-Object { $_.Trim() })
    ($lines | Select-Object -Last 15) -join "`n"
}

# What Windows logged about the prototype since the run started: a .NET
# exception that ended it (.NET Runtime 1026) or a native crash (Application
# Error 1000), with the exception and the module it happened in.
function Get-CrashEvents([datetime]$since, [string]$exeName) {
    $filter = @{ LogName = 'Application'; ProviderName = '.NET Runtime', 'Application Error'; StartTime = $since }
    Get-WinEvent -FilterHashtable $filter -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -like "*$exeName*" } |
        ForEach-Object { "$($_.ProviderName) $($_.Id): " + (($_.Message -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 12) -join ' | ') }
}

function Measure-One([string]$name) {
    $dir = Join-Path $Out $name
    # PowerShell names are not case sensitive: a local $runs or $exe would be
    # the script's $Runs and $Exe (the run of 27 Oct compared 1 to an empty
    # list for that reason), so the locals here have names of their own.
    $exePath = Join-Path $dir $Exe[$name]
    if (-not (Test-Path -LiteralPath $exePath)) { throw "$name has no build at $exePath" }
    $weigh = Join-Path $Out "$name-weigh"
    $size = Get-Size $(if (Test-Path -LiteralPath $weigh) { $weigh } else { $dir })
    $done = @()
    for ($r = 1; $r -le $Runs; $r++) {
        $ready = Join-Path $Work "ready-$name-$r"
        Remove-Tree $ready; Remove-Tree "$ready.active"; Remove-Tree "$ready.log"
        $psi = [Diagnostics.ProcessStartInfo]::new($exePath)
        $psi.WorkingDirectory = Split-Path $exePath
        $psi.UseShellExecute = $false
        # What a prototype says when it stops, kept for the runs that write no
        # ready file (on 27 Oct winui3, egui and electron wrote none and said
        # nothing the console kept).
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.EnvironmentVariables['PROTO_READY'] = $ready
        $psi.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--autoplay-policy=no-user-gesture-required'
        $psi.EnvironmentVariables['ELECTRON_ENABLE_LOGGING'] = '1'
        $psi.EnvironmentVariables['RUST_BACKTRACE'] = '1'
        # Set by an Electron app for the tools it starts (a Claude or a code
        # editor running this script): with it an Electron exe runs as plain
        # Node and opens no window. A person starting the launcher from
        # Explorer never has it, so no prototype gets it; results.md says when
        # this machine had it.
        $script:RunAsNode = $psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE']
        [void]$psi.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
        $started = Get-Date
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $p = [Diagnostics.Process]::Start($psi)
        $stdout = $p.StandardOutput.ReadToEndAsync()
        $stderr = $p.StandardError.ReadToEndAsync()
        while (-not (Test-Path -LiteralPath $ready) -and $clock.ElapsedMilliseconds -lt 30000 -and -not $p.HasExited) { Start-Sleep -Milliseconds 5 }
        $readyMs = if (Test-Path -LiteralPath $ready) { $clock.ElapsedMilliseconds } else { $null }
        $run = [ordered]@{ Run = $r; ReadyMs = $readyMs; Exited = $p.HasExited }
        if ($p.HasExited) { $run.ExitCode = $p.ExitCode }
        if ($readyMs) {
            Start-Sleep -Milliseconds 3000
            $idle = Measure-Tree $p.Id
            Start-Sleep -Milliseconds 5000
            $active = Measure-Tree $p.Id
            $run.IdleWorkingSetMB = $idle.WorkingSetMB; $run.IdlePrivateMB = $idle.PrivateMB
            $run.ActiveWorkingSetMB = $active.WorkingSetMB; $run.ActivePrivateMB = $active.PrivateMB
            $run.Processes = $active.Processes
            $run.PlayStarted = (Test-Path -LiteralPath "$ready.active")
            if ($r -eq 1) { $run.Mixer = @(Get-MixerEntries $active.Tree $p.Id) }
        }
        Stop-Tree $p.Id
        if (-not $readyMs) {
            [void]$p.WaitForExit(5000)
            $run.Stdout = Get-Tail $stdout
            $run.Stderr = Get-Tail $stderr
            $run.Crash = @(Get-CrashEvents $started (Split-Path $exePath -Leaf))
            if (Test-Path -LiteralPath "$ready.log") { $run.Log = (Get-Content -LiteralPath "$ready.log" | Select-Object -Last 25) -join "`n" }
        }
        Remove-Tree $ready; Remove-Tree "$ready.active"; Remove-Tree "$ready.log"
        $done += [pscustomobject]$run
        Say ("{0} run {1}: ready {2} ms" -f $name, $r, $readyMs)
        Start-Sleep -Milliseconds 1000
    }
    $warm = @($done | Select-Object -Skip 1 | Where-Object ReadyMs)
    function Median($xs) { $s = @($xs | Sort-Object); if ($s.Count) { $s[[int][math]::Floor(($s.Count - 1) / 2)] } }
    [pscustomobject]@{
        Name = $name
        Size = $size
        FirstReadyMs = $done[0].ReadyMs
        WarmReadyMs = Median ($warm | ForEach-Object ReadyMs)
        IdlePrivateMB = Median ($warm | ForEach-Object IdlePrivateMB)
        IdleWorkingSetMB = Median ($warm | ForEach-Object IdleWorkingSetMB)
        ActivePrivateMB = Median ($warm | ForEach-Object ActivePrivateMB)
        ActiveWorkingSetMB = Median ($warm | ForEach-Object ActiveWorkingSetMB)
        Processes = Median ($warm | ForEach-Object Processes)
        Mixer = $done[0].Mixer
        Runs = $done
    }
}

# --- Run --------------------------------------------------------------------

# Every run opens a window that takes the focus, so none starts while
# somebody is playing on this machine: checked at the start and again before
# the runs, which come after builds that can take most of an hour.
function Assert-NoGame {
    $game = Get-Process -Name SkyrimSE, skse64_loader -ErrorAction SilentlyContinue
    if ($game) { throw "Skyrim is running here (pid $($game.Id -join ', ')); measure once it is closed." }
}
Assert-NoGame

try {
$Study = Use-Drive $Study
$Work = Use-Drive $Work
$Proto = Join-Path $Study 'prototypes'
$Repo = (Resolve-Path (Join-Path $Study '..\..\..')).Path
$Tools = Join-Path $Work 'tools'
$Out = Join-Path $Work 'out'
$Art = Join-Path $Repo 'launcher\art\thornswood-art-1536.png'

New-Item -ItemType Directory -Force -Path $Work, $Out | Out-Null
$script:Wav = Join-Path $Work 'loop.wav'
Write-QuietWav $script:Wav
# pwsh -File hands "-Only a,b,c" over as the one string 'a,b,c', and on 27
# Oct a run that way matched no prototype and built nothing; so the list is
# split on commas here, and a name that is not a prototype stops the run.
$Only = @($Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$unknown = @($Only | Where-Object { $_ -notin $Builds.Keys })
if ($unknown) { throw "-Only names no prototype called $($unknown -join ', '); the prototypes are $(@($Builds.Keys) -join ', ')." }
$names = @($Builds.Keys | Where-Object { -not $Only -or $_ -in $Only })
$failed = [ordered]@{}

if (-not $MeasureOnly) {
    Use-VcVars (Find-VcVars)
    Install-Tools
    foreach ($n in $names) {
        try { & $Builds[$n] }
        catch { $failed[$n] = "build: $($_.Exception.Message)"; Say "BUILD FAILED $n : $($_.Exception.Message)" }
    }
}

Assert-NoGame
$results = @()
foreach ($n in $names) {
    if ($failed.Contains($n)) { continue }
    try { $results += Measure-One $n }
    catch { $failed[$n] = "measure: $($_.Exception.Message)"; Say "MEASURE FAILED $n : $($_.Exception.Message)" }
}

$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$gpu = (Get-CimInstance Win32_VideoController | ForEach-Object Name) -join ', '
$ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$os = (Get-CimInstance Win32_OperatingSystem)
$wv2 = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue).pv
$machine = [ordered]@{
    When = (Get-Date).ToString('yyyy-MM-dd HH:mm zzz'); Os = "$($os.Caption) $($os.Version)"; Cpu = $cpu; Gpu = $gpu; RamGB = $ram
    WebView2Runtime = $wv2; Commit = (git -C $Repo rev-parse --short HEAD)
}
[ordered]@{ Machine = $machine; Results = $results; Failed = $failed } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Work 'results.json') -Encoding utf8

$md = [System.Collections.Generic.List[string]]::new()
$md.Add("Launcher stack prototypes measured on $($machine.Os), $cpu, $gpu, $ram GB, WebView2 runtime $wv2, at $($machine.When), from $($machine.Commit). $Runs runs each: the first start after the build, then the median of the rest. Memory is the prototype and every process under it; private is what only it holds, working set what it has in memory now.")
$md.Add('')
$md.Add('| Prototype | Install MB | Zip MB | First start ms | Start ms | Idle private MB | Idle working set MB | Active private MB | Active working set MB | Processes | Volume Mixer shows |')
$md.Add('|---|---|---|---|---|---|---|---|---|---|---|')
foreach ($r in $results) {
    $mix = if ($r.Mixer) { ($r.Mixer | ForEach-Object { "$($_.MixerShows) ($($_.Process)$(if (-not $_.OwnProcess) { ', child' }))" }) -join '; ' } else { 'no session' }
    $md.Add("| $($r.Name) | $($r.Size.InstallMB) | $($r.Size.ZipMB) | $($r.FirstReadyMs) | $($r.WarmReadyMs) | $($r.IdlePrivateMB) | $($r.IdleWorkingSetMB) | $($r.ActivePrivateMB) | $($r.ActiveWorkingSetMB) | $($r.Processes) | $mix |")
}
foreach ($k in $failed.Keys) { $md.Add(''); $md.Add("$k did not finish: $($failed[$k])") }
if ($script:RunAsNode) { $md.Add(''); $md.Add("This session had ELECTRON_RUN_AS_NODE=$script:RunAsNode; the prototypes were started without it.") }
foreach ($r in $results) {
    $silent = @($r.Runs | Where-Object { -not $_.ReadyMs })
    if (-not $silent.Count) { continue }
    $first = $silent[0]
    $md.Add('')
    $md.Add("$($r.Name) wrote no ready file in $($silent.Count) of $Runs runs. Run $($first.Run): " + $(if ($first.Exited) { "it ended by itself with exit code $($first.ExitCode)." } else { 'it was still running after 30 seconds.' }))
    foreach ($part in @(@('stdout', $first.Stdout), @('stderr', $first.Stderr), @('its own log', $first.Log))) {
        if ($part[1]) { $md.Add(''); $md.Add("$($part[0]):"); $md.Add('```'); $md.Add($part[1]); $md.Add('```') }
    }
    foreach ($c in $first.Crash) { $md.Add(''); $md.Add("Event log: $c") }
}
$md | Set-Content -LiteralPath (Join-Path $Work 'results.md') -Encoding utf8
Say "wrote $(Join-Path $Work 'results.md')"
Get-Content -LiteralPath (Join-Path $Work 'results.md')
}
finally {
    foreach ($s in $script:Substs) { & subst.exe $s.Drive /d; Say "$($s.Drive) taken away" }
}
