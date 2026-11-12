<#
  test-4180-fresh-payload.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4180-fresh-payload.ps1

  An install puts this build's files into Profile\Payload, and only them
  (#4180).

  With Thornswood's own folder chosen and not made yet, the install copies
  the package's game files into Root\Profile\Payload, and the launcher's
  Make later takes every file in that folder into the game as Thornswood's
  own (OwnGame.WithPayload). The folder being there at all is also what
  tells the launcher the own folder was chosen (Paths.OwnFirst). A Root an
  earlier install used keeps its Profile when the launcher is taken off by
  Velopack's own uninstall (#5820), so the next install can find an old
  Payload there. Copied over, it kept every file the newer build no longer
  has, and Make took them into the game; and an install that did not choose
  the own folder this time still left the launcher running from the old
  Payload.

  WHAT THIS HOLDS THE INSTALL TO. It runs the real InstallSteps against a
  pretend Steam copy and a pretend package:
    1. Own folder chosen, over a Payload an older build left (a file the new
       build dropped, read-only, one it still has with older bytes, and a
       folder only the old build had): afterwards Payload holds exactly the
       package's files with the package's bytes, and the window says the
       older Payload was taken out.
    2. Own folder not chosen, over the same old Payload: afterwards there is
       no Payload, so the launcher does not take the own folder for chosen,
       and the new files are in the Steam copy without the dropped one.
    3. Own folder chosen with no Payload before: Payload is the package's
       files, and nothing is said about an older one.
    4. A link inside the old Payload to a folder outside it: the folder it
       points at, and its file, are still there afterwards.

  HOW. InstallSteps.cs and the three install files it uses are built with a
  driver by the .NET SDK the launcher builds with (tests\Launcher-Csc.ps1),
  with records\skyrim-files.json embedded as the launcher embeds it, and the
  driver runs the steps. On every machine: nothing it runs here needs
  Windows.

  Nothing outside its own scratch folder is written, beyond the build
  Launcher-Csc.ps1 keeps under out\harness.
#>
[CmdletBinding()]
param([string]$Repo, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
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

$App = Join-Path (Join-Path $Repo 'launcher') 'app'
$sep = [IO.Path]::DirectorySeparatorChar

# A path under a folder from a relative one written with backslashes.
function Under([string]$dir, [string]$rel) { return [IO.Path]::Combine($dir, $rel.Replace('\', [string]$sep)) }
function Put([string]$path, [string]$text) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path)
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
function Text([string]$path) { if (Test-Path -LiteralPath $path) { return [IO.File]::ReadAllText($path) } return $null }
# Every file under a folder, relative with backslashes, to its text.
function Tree([string]$dir) {
    $d = @{}
    if (-not (Test-Path -LiteralPath $dir)) { return $d }
    $pfx = $dir.TrimEnd($sep) + $sep
    foreach ($f in (Get-ChildItem -LiteralPath $dir -Recurse -File -Force)) {
        $d[$f.FullName.Substring($pfx.Length).Replace([string]$sep, '\')] = [IO.File]::ReadAllText($f.FullName)
    }
    return $d
}
function SameTree($a, $b) {
    if ($a.Count -ne $b.Count) { return $false }
    foreach ($k in $a.Keys) { if (-not $b.ContainsKey($k) -or $b[$k] -cne $a[$k]) { return $false } }
    return $true
}
function Names($t) { return ((@($t.Keys) | Sort-Object) -join ', ') }

# ---- the build ---------------------------------------------------------------
$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using Thornswood;

static class FreshPayloadDriver
{
    static int Main(string[] a)
    {
        var c = new InstallChoice { Root = a[0], Package = a[1], SteamRoot = a[2], SteamGame = a[3], MakeOwnGame = a[4] == "1" };
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

$dll = $null
try {
    $dll = Build-LauncherCode -Exe -Source $driver -File @(
        (Join-Path $App 'InstallSteps.cs'), (Join-Path $App 'InstallAgreements.cs'),
        (Join-Path $App 'InstallPlace.cs'), (Join-Path $App 'InstallShortcut.cs')) `
        -Resource @{ 'skyrim-files.json' = (Join-Path (Join-Path $Repo 'records') 'skyrim-files.json') }
} catch { Yes 'the install steps build with a driver' $false $_.Exception.Message; Done }
Yes 'the install steps build with a driver' ($null -ne $dll)

$T = Join-Path $Scratch ('fresh-payload-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $T

# The newer build's game files, as the package carries them beside the launcher.
$newBuild = @{
    'Data\Thornswood.esp'                   = 'build B'
    'Data\SKSE\Plugins\MpClientPlugin.dll'  = 'client B'
    'Data\Platform\Plugins\thornswood-b.js' = 'new in B'
}
# What the older build left in Payload.
$oldPayload = @{
    'Data\Thornswood.esp'                   = 'build A'
    'Data\SKSE\Plugins\MpClientPlugin.dll'  = 'client A'
    'Data\Old-Only.esp'                     = 'dropped after A'
    'Data\Scripts\gone\OldQuest.pex'        = 'a folder only A had'
}

# A pretend Steam copy, a package and a Root with its terms on file.
function Fixture([string]$name, [bool]$oldPayloadThere) {
    $base = Join-Path $T $name
    $steam = Join-Path $base 'Steam'
    $game = Under $steam 'steamapps\common\Skyrim Special Edition'
    Put (Join-Path $game 'SkyrimSE.exe') 'not 1.6.1170'
    Put (Under $game 'Data\Skyrim.esm') 'bethesda'
    $pkg = Join-Path $base 'package'
    foreach ($k in $newBuild.Keys) { Put (Under (Join-Path $pkg 'Game') $k) $newBuild[$k] }
    $root = Join-Path $base 'Thornswood'
    Put (Under $root 'Profile\accepted.json') '{}'
    $payload = Under $root 'Profile\Payload'
    if ($oldPayloadThere) {
        foreach ($k in $oldPayload.Keys) { Put (Under $payload $k) $oldPayload[$k] }
        $ro = Get-Item -LiteralPath (Under $payload 'Data\Old-Only.esp')
        $ro.Attributes = $ro.Attributes -bor [IO.FileAttributes]::ReadOnly
    }
    return [pscustomobject]@{ Base = $base; Steam = $steam; Game = $game; Package = $pkg; Root = $root; Payload = $payload }
}

function Install($f, [bool]$own) {
    $out = @(Invoke-LauncherExe $dll $f.Root $f.Package $f.Steam $f.Game $(if ($own) { '1' } else { '0' }))
    $code = $LASTEXITCODE
    $text = ($out -join "`n")
    try { $r = $text | ConvertFrom-Json } catch { $r = $null }
    if ($code -ne 0 -or $null -eq $r) { return [pscustomobject]@{ stop = ('the driver exited ' + $code + ': ' + $text); lines = @() } }
    return $r
}

function SaidOlder($r) { return @($r.lines | Where-Object { $_ -match 'An older .*Payload was here' }).Count -gt 0 }

# ---- 1. own folder chosen, over an old Payload ---------------------------------
Write-Host ''
Write-Host '1. own folder chosen, over the Payload an older build left'
$f1 = Fixture 'chosen-over-old' $true
$r1 = Install $f1 $true
Yes '1. the install finished' ($null -eq $r1.stop) ([string]$r1.stop)
$t1 = Tree $f1.Payload
Yes '1. Payload holds exactly the newer build''s files, with its bytes' (SameTree $newBuild $t1) ('Payload has: ' + (Names $t1))
Yes '1. the file the newer build dropped is not in Payload, so Make cannot take it into the game' (-not (Test-Path -LiteralPath (Under $f1.Payload 'Data\Old-Only.esp')))
Yes '1. the folder only the older build had is gone' (-not (Test-Path -LiteralPath (Under $f1.Payload 'Data\Scripts')))
Yes '1. the window says the older Payload was taken out' (SaidOlder $r1)
Yes '1. nothing was written into the Steam copy' (-not (Test-Path -LiteralPath (Under $f1.Game 'Data\Thornswood.esp')))

# ---- 2. own folder not chosen, over an old Payload -----------------------------
Write-Host ''
Write-Host '2. own folder not chosen, over the Payload an older build left'
$f2 = Fixture 'steam-over-old' $true
$r2 = Install $f2 $false
Yes '2. the install finished' ($null -eq $r2.stop) ([string]$r2.stop)
Yes '2. there is no Payload afterwards, so the launcher does not take the own folder for chosen (Paths.OwnFirst)' (-not (Test-Path -LiteralPath $f2.Payload)) ('Payload has: ' + (Names (Tree $f2.Payload)))
Yes '2. the newer build''s files are in the Steam copy' ((Text (Under $f2.Game 'Data\Thornswood.esp')) -ceq 'build B' -and (Text (Under $f2.Game 'Data\Platform\Plugins\thornswood-b.js')) -ceq 'new in B')
Yes '2. the file the newer build dropped is not in the Steam copy' (-not (Test-Path -LiteralPath (Under $f2.Game 'Data\Old-Only.esp')))
Yes '2. the window says the older Payload was taken out' (SaidOlder $r2)

# ---- 3. own folder chosen, no Payload before -----------------------------------
Write-Host ''
Write-Host '3. own folder chosen, a first install'
$f3 = Fixture 'chosen-first' $false
$r3 = Install $f3 $true
Yes '3. the install finished' ($null -eq $r3.stop) ([string]$r3.stop)
$t3 = Tree $f3.Payload
Yes '3. Payload holds exactly the newer build''s files' (SameTree $newBuild $t3) ('Payload has: ' + (Names $t3))
Yes '3. nothing is said about an older Payload' (-not (SaidOlder $r3))

# ---- 4. a link inside the old Payload -------------------------------------------
Write-Host ''
Write-Host '4. a link inside the old Payload to a folder outside it'
$f4 = Fixture 'link-in-old' $true
$outside = Join-Path $f4.Base 'not-thornswood'
Put (Join-Path $outside 'keep.txt') 'somebody else''s'
$link = Under $f4.Payload 'Data\linked'
$made = $true
try {
    if ($OnWindows) { $null = New-Item -ItemType Junction -Path $link -Target $outside }
    else { $null = New-Item -ItemType SymbolicLink -Path $link -Target $outside }
} catch { $made = $false; Write-Host ('      the link could not be made here: ' + $_.Exception.Message) }
Yes '4. the link was made in the old Payload' $made
$r4 = Install $f4 $true
Yes '4. the install finished' ($null -eq $r4.stop) ([string]$r4.stop)
Yes '4. the folder the link pointed at, and its file, are still there' ((Text (Join-Path $outside 'keep.txt')) -ceq 'somebody else''s')
$t4 = Tree $f4.Payload
Yes '4. Payload holds exactly the newer build''s files' (SameTree $newBuild $t4) ('Payload has: ' + (Names $t4))

try {
    foreach ($f in Get-ChildItem -LiteralPath $T -Recurse -File -Force) { $f.Attributes = 'Normal' }
    Remove-Item -LiteralPath $T -Recurse -Force
} catch { Write-Host ('      the scratch folder stays, at ' + $T + ': ' + $_.Exception.Message) }
Done
