<#
  test-4538-install-sizes.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4538-install-sizes.ps1

  Setup and packaging say the build's own sizes, not the old 18 GB build's
  (#4538). The install window said "Several thousand files, a few minutes"
  before copying the mods, a figure typed in for a build that was 18 GB. The
  build is now a few hundred files and a download under 100 MB, so the line
  told a new person to expect something that never came.

  What it holds:
    1. No file in launcher\app, scripts\release or installer\ says "several
       thousand", "half a gigabyte" or "18 GB".
    2. The real install steps (InstallSteps.cs, built with a driver by the
       .NET SDK the launcher builds with, tests\Launcher-Csc.ps1), run against
       a pretend Steam copy and a pretend package of three files, say how many
       files the mods are and how big, as counted in that package: "3 files,"
       and the size in MB.

  Nothing outside its own scratch folder is written, beyond the build
  Launcher-Csc.ps1 keeps under out\harness.
#>
[CmdletBinding()]
param([string]$Repo, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $Here) }
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$why = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host ("FAIL  $what" + $(if ($why) { ' | ' + $why } else { '' })) }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}

$sep = [IO.Path]::DirectorySeparatorChar
function Under([string]$dir, [string]$rel) { return [IO.Path]::Combine($dir, $rel.Replace('\', [string]$sep)) }
function Put([string]$path, [string]$text) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path)
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

# ---- 1. no old figure in setup or packaging -----------------------------------
$old = @(
    @{ Name = 'several thousand'; Rx = '(?i)\bseveral thousand\b' }
    @{ Name = 'half a gigabyte';  Rx = '(?i)\bhalf a gigabyte\b' }
    @{ Name = '18 GB';            Rx = '(?i)\b18\s?GB\b' }
)
$text = '\.(cs|axaml|xaml|ps1|psm1|psd1|cmd|bat|json|md|txt|iss|nsi|wxs|xml|csproj|props|targets)$'
$files = @()
foreach ($d in @('launcher\app', 'scripts\release', 'installer')) {
    $dir = Under $Repo $d
    if (Test-Path -LiteralPath $dir) {
        $files += @(Get-ChildItem -LiteralPath $dir -Recurse -File | Where-Object { $_.Name -match $text -and $_.FullName -notmatch '[\\/](bin|obj)[\\/]' })
    }
}
Yes ('setup and packaging files are read (' + $files.Count + ')') ($files.Count -gt 50)
foreach ($o in $old) {
    $hits = @()
    foreach ($f in $files) {
        $n = 0
        foreach ($l in [IO.File]::ReadAllLines($f.FullName)) {
            $n++
            if ($l -match $o.Rx) { $hits += ($f.FullName.Substring($Repo.Length + 1).Replace('\', '/') + ':' + $n + ': ' + $l.Trim()) }
        }
    }
    Yes ('1. no setup or packaging file says "' + $o.Name + '"') ($hits.Count -eq 0) ($hits -join ' ; ')
}

# ---- 2. the install says the build's own count and size --------------------------
$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using Thornswood;

static class InstallSizesDriver
{
    static int Main(string[] a)
    {
        var c = new InstallChoice { Root = a[0], Package = a[1], SteamRoot = a[2], SteamGame = a[3], MakeOwnGame = true };
        var lines = new List<string>();
        var s = new InstallSteps(c, lines.Add, f => { });
        var o = new MemoryStream();
        using (var w = new Utf8JsonWriter(o))
        {
            w.WriteStartObject();
            try { s.Run(); w.WriteNull("stop"); }
            catch (InstallStop e) { w.WriteString("stop", e.Message); }
            w.WriteStartArray("lines");
            foreach (string l in lines) w.WriteStringValue(l);
            w.WriteEndArray();
            w.WriteEndObject();
        }
        Console.Out.Write(Encoding.UTF8.GetString(o.ToArray()));
        return 0;
    }
}
'@

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet) $LauncherDotnet
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$App = Under $Repo 'launcher\app'
$dll = $null
try {
    $dll = Build-LauncherCode -Exe -Source $driver -File @(
        (Join-Path $App 'InstallSteps.cs'), (Join-Path $App 'InstallAgreements.cs'),
        (Join-Path $App 'InstallPlace.cs'), (Join-Path $App 'InstallShortcut.cs')) `
        -Resource @{ 'skyrim-files.json' = (Under $Repo 'records\skyrim-files.json') }
} catch { Yes 'the install steps build with a driver' $false $_.Exception.Message; Done }
Yes 'the install steps build with a driver' ($null -ne $dll)

$T = Join-Path $Scratch ('install-sizes-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $steam = Join-Path $T 'Steam'
    $game = Under $steam 'steamapps\common\Skyrim Special Edition'
    Put (Join-Path $game 'SkyrimSE.exe') 'not 1.6.1170'
    Put (Under $game 'Data\Skyrim.esm') 'bethesda'
    $pkg = Join-Path $T 'package'
    # Three files of known sizes: 1.5 MB in all.
    $sizes = @{ 'Data\Thornswood.esp' = 524288; 'Data\SKSE\Plugins\MpClientPlugin.dll' = 786432; 'Data\Platform\Plugins\thornswood.js' = 262144 }
    foreach ($k in $sizes.Keys) {
        $p = Under (Join-Path $pkg 'Game') $k
        $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p)
        [IO.File]::WriteAllBytes($p, (New-Object byte[] $sizes[$k]))
    }
    $root = Join-Path $T 'Thornswood'
    Put (Under $root 'Profile\accepted.json') '{}'

    $out = @(Invoke-LauncherExe $dll $root $pkg $steam $game)
    $code = $LASTEXITCODE
    $said = ($out -join "`n")
    $r = $null
    try { $r = $said | ConvertFrom-Json } catch { }
    Yes '2. the install ran to the end' ($code -eq 0 -and $null -ne $r -and $null -eq $r.stop) $(if ($r) { [string]$r.stop } else { $said })
    $lines = @(if ($r) { $r.lines } else { @() })
    $at = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match 'Installing the mods') { $at = $i; break } }
    $section = @(if ($at -ge 0) { $lines[$at..([Math]::Min($lines.Count - 1, $at + 6))] } else { @() })
    Yes '2. it has its "Installing the mods" step' ($at -ge 0) ($lines -join ' / ')
    Yes '2. that step says the package''s own count and size: 3 files, 1.5 MB' (@($section | Where-Object { $_ -match '\b3 files, 1\.5 MB\b' }).Count -eq 1) ($section -join ' / ')
    Yes '2. and no fixed figure' (@($section | Where-Object { $_ -match '(?i)several thousand|a few minutes' }).Count -eq 0) ($section -join ' / ')
}
finally {
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
}
Done
