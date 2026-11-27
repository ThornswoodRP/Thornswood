<#
  test-4680-collection-load-order.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4680-collection-load-order.ps1

  A collection install with no plugin list yet ends green (#4680).

  The install's last check counted Skyrim's plugin list in AppData
  (%LOCALAPPDATA%\Skyrim Special Edition\plugins.txt) as missing whatever
  shape the install was. Until the launcher has made Thornswood's own folder
  (no Root\Game yet, Paths.Collection), that list is the one Vortex writes
  when it deploys the collection, which is the step after the install. On a
  PC where Skyrim and Vortex never ran there is none, so every such install
  ended "1 check failed" and the launcher never opened.

  WHAT THIS HOLDS THE INSTALL TO. It runs the real InstallSteps against a
  pretend Steam copy and package, with no plugin list in AppData:
    1. The own folder not chosen (the Steam copy): the install ends with no
       failed check, and the window says the load order comes with the
       collection.
    2. The own folder chosen, not made yet: the same.
    3. The own folder already made (Root\Game with Profile\OwnGame\files.txt):
       Vortex has deployed for that folder to exist, so a missing list is
       still a failed check.
    4. Off Windows, the made folder with the list there: the check passes.

  HOW. InstallSteps.cs, the three install files it uses and Failure.cs are
  built with a driver and a stand-in Swallow by the .NET SDK the launcher
  builds with (tests\Launcher-Csc.ps1), with records\skyrim-files.json
  embedded as the launcher embeds it. Off Windows the check's AppData is
  $XDG_DATA_HOME, pointed at a scratch folder. Windows answers its own
  folder whatever the environment says; a hosted runner has no Skyrim list
  there, and if this PC has one, cases 1 to 3 say so and do not count as a
  pass.

  Nothing outside its own scratch folder is written, beyond the build
  Launcher-Csc.ps1 keeps under out\harness.
#>
[CmdletBinding()]
param([string]$Repo, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')        # $OnWindows (#2957)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $Here) }
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }

$script:pass = 0
$script:fail = 0
$script:skip = 0
function Yes([string]$what, [bool]$cond, [string]$why = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host ("FAIL  $what" + $(if ($why) { ' | ' + $why } else { '' })) }
}
function Skip([string]$what, [string]$why) { $script:skip++; Write-Host "SKIP  $what | $why" }
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed, {2} skipped" -f $script:pass, $script:fail, $script:skip)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}

$App = Join-Path (Join-Path $Repo 'launcher') 'app'
$sep = [IO.Path]::DirectorySeparatorChar
function Under([string]$dir, [string]$rel) { return [IO.Path]::Combine($dir, $rel.Replace('\', [string]$sep)) }
function Put([string]$path, [string]$text) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path)
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

# ---- the build ----------------------------------------------------------------
$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using Thornswood;

static class CollectionLoadOrderDriver
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
            w.WriteNumber("bad", s.Bad);
            w.WriteNumber("later", s.Later);
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
# Failure writes what it caught through Swallow, which needs the launcher's
# Paths and log; here it only has to be there.
$swallow = @'
using System;
namespace Thornswood
{
    static class Swallow
    {
        public static void Note(string where, Exception ex) { }
    }
}
'@

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet) $LauncherDotnet
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$dll = $null
try {
    $dll = Build-LauncherCode -Exe -Source @($driver, $swallow) -File @(
        (Join-Path $App 'InstallSteps.cs'), (Join-Path $App 'InstallAgreements.cs'), (Join-Path $App 'PathFence.cs'),
        (Join-Path $App 'InstallPlace.cs'), (Join-Path $App 'InstallShortcut.cs'), (Join-Path $App 'Failure.cs'), (Join-Path $App 'WholeFile.cs')) `
        -Resource @{ 'skyrim-files.json' = (Join-Path (Join-Path $Repo 'records') 'skyrim-files.json') }
} catch { Yes 'the install steps build with a driver' $false $_.Exception.Message; Done }
Yes 'the install steps build with a driver' ($null -ne $dll)

$T = Join-Path $Scratch ('collection-load-order-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $T
# The AppData the check reads, off Windows: empty, so there is no plugin list.
$local = Join-Path $T 'LocalAppData'
$null = New-Item -ItemType Directory -Force -Path $local
$pcList = if ($OnWindows) { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Skyrim Special Edition\plugins.txt' } else { '' }
$pcHasList = $OnWindows -and (Test-Path -LiteralPath $pcList)

# A pretend Steam copy, a package and a Root with its terms on file. $made
# puts the folder the launcher made there already.
function Fixture([string]$name, [bool]$made) {
    $base = Join-Path $T $name
    $steam = Join-Path $base 'Steam'
    $game = Under $steam 'steamapps\common\Skyrim Special Edition'
    Put (Join-Path $game 'SkyrimSE.exe') 'not 1.6.1170'
    Put (Under $game 'Data\Skyrim.esm') 'bethesda'
    $pkg = Join-Path $base 'package'
    Put (Under $pkg 'Game\Data\Thornswood-Content.esp') 'ours'
    Put (Under $pkg 'Game\Data\SKSE\Plugins\MpClientPlugin.dll') 'client'
    $root = Join-Path $base 'Thornswood'
    Put (Under $root 'Profile\accepted.json') '{}'
    if ($made) {
        Put (Under $root 'Game\SkyrimSE.exe') 'not 1.6.1170'
        Put (Under $root 'Game\Data\Skyrim.esm') 'bethesda'
        Put (Under $root 'Profile\OwnGame\files.txt') "Data\Skyrim.esm`r`n"
    }
    return [pscustomobject]@{ Steam = $steam; Game = $game; Package = $pkg; Root = $root }
}

function Install($f, [bool]$own) {
    $oldXdg = $env:XDG_DATA_HOME
    $env:XDG_DATA_HOME = $local
    try { $out = @(Invoke-LauncherExe $dll $f.Root $f.Package $f.Steam $f.Game $(if ($own) { '1' } else { '0' })) }
    finally { $env:XDG_DATA_HOME = $oldXdg }
    $code = $LASTEXITCODE
    $text = ($out -join "`n")
    try { $r = $text | ConvertFrom-Json } catch { $r = $null }
    if ($code -ne 0 -or $null -eq $r) { return [pscustomobject]@{ stop = ('the driver exited ' + $code + ': ' + $text); bad = -1; lines = @() } }
    return $r
}

function Line($r, [string]$start) { return @($r.lines | Where-Object { $_.StartsWith($start) }) }

# The two shapes with no own folder made: the list is the collection's to bring.
foreach ($case in @(@{ N = '1'; Name = 'steam-copy'; Own = $false; What = 'the own folder not chosen' },
                    @{ N = '2'; Name = 'own-chosen'; Own = $true; What = 'the own folder chosen, not made yet' })) {
    Write-Host ''
    Write-Host ($case.N + '. ' + $case.What + ', no plugin list in AppData')
    $r = Install (Fixture $case.Name $false) $case.Own
    Yes ($case.N + '. the install ran to its checks') ($null -eq $r.stop) ([string]$r.stop)
    if ($pcHasList) { Skip ($case.N + '. no failed check with no plugin list') ('this PC has its own at ' + $pcList); continue }
    Yes ($case.N + '. no check failed') ($r.bad -eq 0) (((Line $r '  [MISS]') -join '; ') + ' bad=' + $r.bad)
    Yes ($case.N + '. the window says the load order comes with the collection') ((Line $r '  [next] Load order  the collection installs this').Count -eq 1) (((Line $r '  [') -join '; '))
    Yes ($case.N + '. and does not send them to staff') (@($r.lines | Where-Object { $_ -match 'Send staff a screenshot' }).Count -eq 0)
}

# The folder the launcher made: Vortex has deployed, so the list must be there.
Write-Host ''
Write-Host '3. the own folder already made, no plugin list in AppData'
$r = Install (Fixture 'made' $true) $true
Yes '3. the install ran to its checks' ($null -eq $r.stop) ([string]$r.stop)
if ($pcHasList) { Skip '3. a missing plugin list is a failed check' ('this PC has its own at ' + $pcList) }
else {
    Yes '3. a missing plugin list is still a failed check' ($r.bad -eq 1 -and (Line $r '  [MISS] Load order').Count -eq 1) (((Line $r '  [') -join '; ') + ' bad=' + $r.bad)
}

Write-Host ''
Write-Host '4. the own folder already made, with its plugin list'
if ($OnWindows) { Skip '4. the list there passes the check' 'Windows answers its own AppData whatever the environment says' }
else {
    Put (Under $local 'Skyrim Special Edition\plugins.txt') "*Thornswood-Content.esp`r`n"
    $r = Install (Fixture 'made-with-list' $true) $true
    Yes '4. the list there passes the check' ($r.bad -eq 0 -and (Line $r '  [ok]   Load order').Count -eq 1) (((Line $r '  [') -join '; ') + ' bad=' + $r.bad)
}

try { Remove-Item -LiteralPath $T -Recurse -Force } catch { Write-Host ('      the scratch folder stays, at ' + $T + ': ' + $_.Exception.Message) }
Done
