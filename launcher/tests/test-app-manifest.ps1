<#
  test-app-manifest.ps1

  Issue #463. The launcher (Thornswood.exe), the exe a stranger runs, carries
  an application manifest of our own:
    - dpiAwareness PerMonitorV2, and the legacy dpiAware "true" (system aware,
      never the per-monitor legacy form);
    - supportedOS for Windows 10 and 11, 8.1, 8, 7 and Vista;
    - requestedExecutionLevel asInvoker with uiAccess false, so it never asks
      for administrator;
    - an assemblyIdentity, Thornswood.Launcher.Thornswood, whose version is
      the launcher's own, the number the build passes as -p:Version, in four
      parts. That is the same number the exe's file version carries and
      Updater.Version reads back from the assembly (#4825), so the three
      cannot drift. The manifest file in the repository holds a placeholder
      and the project's ThornswoodManifest target stamps a copy in obj on
      every build.
  Until then the identity sat at 1.1.101.0 while the launcher was 1.1.102,
  and the setup program (retired with #4824) carried csc's default manifest,
  named MyApplication.app 1.0.0.0 with no DPI awareness at all, so Windows
  stretched its window blurry at any scale above 100 percent.

  What it checks:
    1. the manifest file and the build wiring, as text, and the stamping
       target itself, run alone with a version of its own (three parts, four
       parts, and one that is not numbers, which must stop the build);
    2. the manifest really embedded in the built exe, read back out of the
       exe's resources (RT_MANIFEST, id 1), not by what the build says, with
       its file version beside it;
    3. the window fit (launcher\app\WindowFit.cs), compiled with the
       launcher's project settings and run for the window's own size on
       1366x768, 1920x1080, 2560x1440 and 3840x2160 screens at 100, 125, 150,
       175 and 200 percent, and moving from a 200 percent screen back to a
       100 percent one: never bigger than the screen, never smaller than it
       has to be, and the full size wherever it fits.
  All of it runs on Linux as well as Windows. With no -Exe, step 2 on Windows
  builds the release way (Build-Launcher.ps1, Native AOT, which links on
  Windows only), and elsewhere publishes the same project for win-x64 without
  Native AOT, which embeds the same stamped manifest.
  What a person still checks: a real mixed-DPI desktop, window sharp on both
  monitors, and the Downgrade click still landing in Steam's console.

  Usage:
    pwsh -File launcher\tests\test-app-manifest.ps1 -Exe <Thornswood.exe> [-Version <a.b.c>]
    pwsh -File launcher\tests\test-app-manifest.ps1 -Root <scratch folder>    builds there first
  -Version is the number the exe was built with; without it, the number this
  checkout's history gives (scripts\release\LauncherVersion.ps1), which is the
  one Build-Launcher.ps1 takes when it is given none.
  With neither -Exe nor -Root, on the build runner it reads the exe the build
  step made ($env:RUNNER_TEMP\Thornswood\Launcher\Thornswood.exe), and
  otherwise it builds one of its own in the temp folder.
  Read only, apart from that build and a scratch folder for step 1.
#>
[CmdletBinding()]
param(
    [string]$Exe,
    [string]$Root,
    [string]$Scratch,
    [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the launcher's compiler and settings (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $Here)
$app = Join-Path $repo (Join-Path 'launcher' 'app')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# The number the built exe should carry: -Version, else the one this
# checkout's history gives (LauncherVersion.ps1, #5179), worked out only
# where there is an exe to read, so a shallow checkout's text checks still run.
function Get-WantVersion {
    $v = $Version
    if (-not $v) {
        . (Join-Path $repo (Join-Path 'scripts' (Join-Path 'release' 'LauncherVersion.ps1')))
        try { $v = Get-LauncherVersion -RepoDir $repo }
        catch { Yes ("the launcher's number for this checkout is known (pass -Version): " + $_.Exception.Message) $false; $v = '' }
    }
    $four = $v
    while ($four -and ($four -split '\.').Count -lt 4) { $four = "$four.0" }
    if ($v) { Write-Host "      launcher version $v" }
    return @($v, $four)
}

$win10 = '{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}'
$allOs = @($win10, '{1f676c76-80e1-4239-95bb-83d0f6d0da78}', '{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}',
           '{35138b9a-5d96-4fbd-8e2d-a2440225f93a}', '{e2011457-1546-43c5-a5fe-008deee3d3f0}')

# One manifest's contents, held to the rules above. $wantVersion is the
# placeholder for the repository file and the launcher version for the exe.
function Check-Manifest([string]$label, [string]$text, [string]$wantName, [string]$wantVersion) {
    $x = $null
    try { $x = [xml]$text } catch { $x = $null }
    Yes "$label parses as XML" ($null -ne $x)
    if ($null -eq $x) { return }
    $ns = New-Object Xml.XmlNamespaceManager($x.NameTable)
    $ns.AddNamespace('a1', 'urn:schemas-microsoft-com:asm.v1')
    $ns.AddNamespace('a3', 'urn:schemas-microsoft-com:asm.v3')
    $ns.AddNamespace('c', 'urn:schemas-microsoft-com:compatibility.v1')
    $ns.AddNamespace('w16', 'http://schemas.microsoft.com/SMI/2016/WindowsSettings')
    $ns.AddNamespace('w05', 'http://schemas.microsoft.com/SMI/2005/WindowsSettings')
    $id = $x.SelectSingleNode('/a1:assembly/a1:assemblyIdentity', $ns)
    Yes "$label has an assemblyIdentity" ($null -ne $id)
    if ($id) {
        Yes "$label identity is type win32" ($id.GetAttribute('type') -eq 'win32')
        Yes "$label identity name is $wantName" ($id.GetAttribute('name') -eq $wantName)
        Yes "$label identity version is $wantVersion (it says $($id.GetAttribute('version')))" ($id.GetAttribute('version') -eq $wantVersion)
    }
    $lvl = $x.SelectSingleNode('//a3:requestedExecutionLevel', $ns)
    Yes "$label asks for asInvoker, so no administrator prompt" ($lvl -and $lvl.GetAttribute('level') -eq 'asInvoker')
    Yes "$label has uiAccess false" ($lvl -and $lvl.GetAttribute('uiAccess') -eq 'false')
    Yes "$label asks for nothing above asInvoker anywhere" ($text -notmatch 'requireAdministrator|highestAvailable')
    $os = @($x.SelectNodes('//c:supportedOS', $ns) | ForEach-Object { $_.GetAttribute('Id').ToLowerInvariant() })
    Yes "$label declares Windows 10 and 11" ($os -contains $win10)
    Yes "$label declares all five supportedOS entries" (@($allOs | Where-Object { $os -notcontains $_ }).Count -eq 0)
    $pm = $x.SelectSingleNode('//w16:dpiAwareness', $ns)
    Yes "$label is PerMonitorV2" ($pm -and $pm.InnerText.Trim() -eq 'PerMonitorV2')
    $legacy = $x.SelectSingleNode('//w05:dpiAware', $ns)
    Yes "$label legacy dpiAware is true (system aware), not true/pm" ($legacy -and $legacy.InnerText.Trim() -eq 'true')
}

if (-not $Scratch) { $Scratch = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-test-app-manifest-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)); $ownScratch = $true }
else { $ownScratch = $false }
$null = New-Item -ItemType Directory -Force -Path $Scratch

# ---- 1. the file and the build wiring ----------------------------------------
$tplApp = Join-Path $app 'Thornswood.manifest'
Yes 'launcher\app\Thornswood.manifest is there' (Test-Path -LiteralPath $tplApp)
if (Test-Path -LiteralPath $tplApp) { Check-Manifest 'the launcher manifest file' ([IO.File]::ReadAllText($tplApp)) 'Thornswood.Launcher.Thornswood' '0.0.0.0' }

# The project stamps and embeds the manifest on every build, and
# Build-Launcher.ps1 signs only after dotnet publish has built the exe.
$projPath = Join-Path $app 'Thornswood.csproj'
$appProjText = [IO.File]::ReadAllText($projPath)
$poke = 'Query="/asm:assembly/asm:assemblyIdentity/@version" Value="$(ThornswoodVersionFour)"'
Yes 'the launcher project stamps Thornswood.manifest with the four part version, before every build' (
    $appProjText.Contains('<Target Name="ThornswoodManifest" BeforeTargets="PrepareForBuild">') -and
    $appProjText.Contains('SourceFiles="$(MSBuildThisFileDirectory)Thornswood.manifest"') -and $appProjText.Contains($poke))
Yes 'and embeds that copy as the application manifest' ($appProjText.Contains('<ApplicationManifest>$(BaseIntermediateOutputPath)Thornswood.stamped.manifest</ApplicationManifest>'))
Yes 'no Win32Resource, which would fight the application manifest' ($appProjText -notmatch '<Win32Resource>')
$updater = [IO.File]::ReadAllText((Join-Path $app 'Updater.cs'))
Yes 'Updater.Version is the assembly''s own version, the -p:Version the identity is stamped from' (
    $updater.Contains('public static readonly string Version = BuiltVersion();') -and
    $updater.Contains('typeof(Updater).Assembly.GetName().Version') -and $updater -notmatch 'Version\s*=\s*"[0-9.]+"')
$bl = [IO.File]::ReadAllText((Join-Path $repo (Join-Path 'scripts' (Join-Path 'release' 'Build-Launcher.ps1'))))
$buildAt = $bl.IndexOf('& $dotnet.Source publish (Resolve-Path -LiteralPath $proj).Path')
$signAt = $bl.IndexOf('& $signer -Path')
Yes 'the manifest is embedded by the build before the launcher is signed' ($buildAt -gt 0 -and $signAt -gt $buildAt)

# The target alone, the way every build runs it, into a scratch obj: the
# copy it writes is the manifest file with only the version changed.
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Yes "the .NET SDK the launcher builds with is on this machine ($LauncherDotnet)" $false }
else {
    $sep = [IO.Path]::DirectorySeparatorChar
    $tplXml = [xml][IO.File]::ReadAllText($tplApp)
    foreach ($case in @(@('1.2.3', '1.2.3.0'), @('2026.1101.1745', '2026.1101.1745.0'), @('1.2.3.4', '1.2.3.4'))) {
        $obj = Join-Path $Scratch ('stamp-' + $case[0])
        $said = & $LauncherDotnet msbuild $projPath -nologo -v:q -t:ThornswoodManifest ('-p:Version=' + $case[0]) ('-p:BaseIntermediateOutputPath=' + $obj + $sep) 2>&1 | Out-String
        $copy = Join-Path $obj 'Thornswood.stamped.manifest'
        $ok = $LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $copy)
        Yes "the stamping target runs for version $($case[0])" $ok
        if (-not $ok) { Write-Host ('      ' + $said.Trim()); continue }
        $got = [xml][IO.File]::ReadAllText($copy)
        $ns = New-Object Xml.XmlNamespaceManager($got.NameTable)
        $ns.AddNamespace('a1', 'urn:schemas-microsoft-com:asm.v1')
        $v = $got.SelectSingleNode('/a1:assembly/a1:assemblyIdentity', $ns).GetAttribute('version')
        Yes "and writes $($case[1]) into the copy (it wrote $v)" ($v -eq $case[1])
        $got.SelectSingleNode('/a1:assembly/a1:assemblyIdentity', $ns).SetAttribute('version', '0.0.0.0')
        Yes 'and changes nothing else in it' ($got.DocumentElement.OuterXml -eq $tplXml.DocumentElement.OuterXml)
    }
    $obj = Join-Path $Scratch 'stamp-bad'
    $said = & $LauncherDotnet msbuild $projPath -nologo -v:q -t:ThornswoodManifest '-p:Version=1.2.3-dev' ('-p:BaseIntermediateOutputPath=' + $obj + $sep) 2>&1 | Out-String
    Yes 'a version that is not three or four numbers stops the build, saying why' (
        $LASTEXITCODE -ne 0 -and $said.Contains("The launcher's version is '1.2.3-dev', which is not three or four numbers") -and
        -not (Test-Path -LiteralPath (Join-Path $obj 'Thornswood.stamped.manifest')))
}

# The launcher fits its window to the screen before centring it, and again
# whenever the window lands on a monitor with another scale.
$shell = [IO.File]::ReadAllText((Join-Path $app 'Shell.cs'))
$fit = [IO.File]::ReadAllText((Join-Path $app 'WindowFit.cs'))
Yes 'the launcher fits its window before centring it' ($shell.IndexOf('WindowFit.Keep(win)') -gt 0 -and $shell.IndexOf('WindowFit.Keep(win)') -lt $shell.IndexOf('CentreOnMainScreen();'))
Yes 'and fits it again when the scale changes, as it moves between monitors' ($fit.Contains('win.ScalingChanged += delegate'))

# ---- 2. the manifest inside the built exe --------------------------------------
# With no -Exe and no -Root: the build step's exe on the runner when there is
# one, and otherwise a build of its own in the temp folder. The nightly runs
# every harness before its build step, and a person runs this bare, so until
# then both ended red on an exe that had not been built yet (issue #1120).
$ownRoot = $null
if (-not $Exe -and -not $Root) {
    $runnerExe = if ($env:RUNNER_TEMP) { Join-Path $env:RUNNER_TEMP (Join-Path 'Thornswood' (Join-Path 'Launcher' 'Thornswood.exe')) } else { '' }
    if ($runnerExe -and (Test-Path -LiteralPath $runnerExe)) { $Exe = $runnerExe }
    else {
        $ownRoot = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-test-app-manifest-build-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
        $null = New-Item -ItemType Directory -Force -Path (Join-Path $ownRoot 'Launcher')
        $Root = $ownRoot
    }
}
$want = Get-WantVersion
$ver4 = $want[1]
# Without the number there is nothing to build with or to hold the exe to,
# and that has already been said as a FAIL above.
if (-not $want[0]) { $Exe = $null; $Root = $null }
elseif (-not $Exe -and $Root) {
    if ($OnWindows) {
        Write-Host "      building into $Root"
        & pwsh -NoProfile -File (Join-Path $repo 'scripts\release\Build-Launcher.ps1') -Root $Root -NoPause -Version $want[0] | Out-Null
        Yes 'Build-Launcher built' ($LASTEXITCODE -eq 0)
    } else {
        # Native AOT links on Windows only; the same project published for
        # win-x64 without it embeds the same stamped manifest in the exe.
        Write-Host "      publishing for win-x64 into $Root (without Native AOT, which links on Windows only)"
        $sep = [IO.Path]::DirectorySeparatorChar
        $said = & $LauncherDotnet publish $projPath -nologo -v:q '-clp:NoSummary;ErrorsOnly' -c Release -r win-x64 --self-contained true `
            '-p:PublishAot=false' ('-p:Version=' + $want[0]) -o (Join-Path $Root 'Launcher') `
            ('-p:BaseIntermediateOutputPath=' + (Join-Path $Root 'obj') + $sep) ('-p:BaseOutputPath=' + (Join-Path $Root 'bin') + $sep) 2>&1 | Out-String
        Yes 'dotnet publish built the launcher for win-x64' ($LASTEXITCODE -eq 0)
        if ($LASTEXITCODE -ne 0) { Write-Host ('      ' + $said.Trim()) }
    }
    $Exe = Join-Path $Root (Join-Path 'Launcher' 'Thornswood.exe')
}

# The exe's resources, read from its own bytes by the PE format, on any
# system: the resource table's type, then id, then the first language, the
# way Windows finds RT_MANIFEST 1 for an exe. Harness code, not launcher
# code, so plain Add-Type (#2821 is about launcher code).
if (-not ('ThornswoodHarness.PeResources' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;

namespace ThornswoodHarness
{
    public static class PeResources
    {
        public static byte[] Find(string path, int type, int id)
        {
            byte[] b = File.ReadAllBytes(path);
            if (b.Length < 0x40 || b[0] != (byte)'M' || b[1] != (byte)'Z') return null;
            int pe = BitConverter.ToInt32(b, 0x3C);
            if (pe < 0 || pe + 24 > b.Length || BitConverter.ToUInt32(b, pe) != 0x00004550) return null;
            int coff = pe + 4;
            int sections = BitConverter.ToUInt16(b, coff + 2), optSize = BitConverter.ToUInt16(b, coff + 16);
            int opt = coff + 20;
            int dirs = opt + (BitConverter.ToUInt16(b, opt) == 0x20b ? 112 : 96);
            int rsrcRva = BitConverter.ToInt32(b, dirs + 2 * 8);   // data directory 2, the resource table
            if (rsrcRva == 0) return null;
            int table = opt + optSize;
            Func<int, int> at = delegate (int rva)
            {
                for (int i = 0; i < sections; i++)
                {
                    int s = table + 40 * i;
                    int va = BitConverter.ToInt32(b, s + 12), len = Math.Max(BitConverter.ToInt32(b, s + 8), BitConverter.ToInt32(b, s + 16));
                    if (rva >= va && rva < va + len) return BitConverter.ToInt32(b, s + 20) + (rva - va);
                }
                return -1;
            };
            int root = at(rsrcRva);
            if (root < 0) return null;
            int e = Entry(b, root, 0, type);
            if (e < 0 || (e & 0x40000000) == 0) return null;
            e = Entry(b, root, e & 0x3FFFFFFF, id);
            if (e < 0 || (e & 0x40000000) == 0) return null;
            e = Entry(b, root, e & 0x3FFFFFFF, -1);
            if (e < 0 || (e & 0x40000000) != 0) return null;
            int data = at(BitConverter.ToInt32(b, root + e));
            int size = BitConverter.ToInt32(b, root + e + 4);
            if (data < 0 || data + size > b.Length) return null;
            byte[] r = new byte[size];
            Array.Copy(b, data, r, 0, size);
            return r;
        }

        // The entry for id in the directory at dir, an offset from the
        // resource table (the first entry when id is -1): its own offset, with
        // bit 30 set when it is a directory, or -1 when there is none.
        static int Entry(byte[] b, int root, int dir, int id)
        {
            int named = BitConverter.ToUInt16(b, root + dir + 12), ids = BitConverter.ToUInt16(b, root + dir + 14);
            for (int i = 0; i < named + ids; i++)
            {
                int e = root + dir + 16 + 8 * i;
                uint name = BitConverter.ToUInt32(b, e), to = BitConverter.ToUInt32(b, e + 4);
                if (id >= 0 && ((name & 0x80000000) != 0 || name != (uint)id)) continue;
                int off = (int)(to & 0x7FFFFFFF);
                return (to & 0x80000000) != 0 ? off | 0x40000000 : off;
            }
            return -1;
        }

        // RT_VERSION's fixed file version, a.b.c.d, or null.
        public static string FileVersion(string path)
        {
            byte[] v = Find(path, 16, 1);
            if (v == null) return null;
            for (int i = 0; i + 16 <= v.Length; i += 4)
            {
                if (BitConverter.ToUInt32(v, i) != 0xFEEF04BD) continue;
                uint ms = BitConverter.ToUInt32(v, i + 8), ls = BitConverter.ToUInt32(v, i + 12);
                return (ms >> 16) + "." + (ms & 0xFFFF) + "." + (ls >> 16) + "." + (ls & 0xFFFF);
            }
            return null;
        }
    }
}
'@
}

$label = 'the built launcher'
if ($want[0] -and (-not $Exe -or -not (Test-Path -LiteralPath $Exe))) {
    Yes "$label is at $Exe (pass -Exe, or -Root to build)" $false
} elseif ($want[0]) {
    $full = (Resolve-Path -LiteralPath $Exe).Path
    $bytes = [ThornswoodHarness.PeResources]::Find($full, 24, 1)   # RT_MANIFEST, id 1: the one Windows reads for an exe
    $text = if ($bytes) { [Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF).TrimEnd([char]0, ' ', "`r", "`n") } else { $null }
    Yes "$label has an embedded manifest (RT_MANIFEST 1)" ($null -ne $text)
    if ($null -ne $text) {
        Yes "$label does not carry a default manifest" ($text -notmatch 'name="MyApplication\.app"')
        Check-Manifest $label $text 'Thornswood.Launcher.Thornswood' $ver4
        Yes "$label has only the one manifest (no RT_MANIFEST 2)" ($null -eq [ThornswoodHarness.PeResources]::Find($full, 24, 2))
        $fv = [ThornswoodHarness.PeResources]::FileVersion($full)
        Yes "$label file version ($fv) is the same number as its identity" ($fv -eq $ver4)
    }
}
if ($ownRoot) { Remove-Item -LiteralPath $ownRoot -Recurse -Force }

# ---- 3. the window fit at 100 to 200 percent -------------------------------------
$axaml = [IO.File]::ReadAllText((Join-Path $app 'MainWindow.axaml'))
$at = $axaml.IndexOf('<Window')
$head = if ($at -ge 0) { $axaml.Substring($at, $axaml.IndexOf('>', $at) - $at) } else { '' }
$sz = @{}
foreach ($k in 'Width', 'Height', 'MinWidth', 'MinHeight') {
    $mm = [regex]::Match($head, '(?<![A-Za-z])' + $k + '="(\d+)"')
    $sz[$k] = if ($mm.Success) { [int]$mm.Groups[1].Value } else { 0 }
}
Yes "the launcher window size read from its markup ($($sz.Width)x$($sz.Height), least $($sz.MinWidth)x$($sz.MinHeight))" (
    $sz.Width -gt 0 -and $sz.Height -gt 0 -and $sz.MinWidth -gt 0 -and $sz.MinHeight -gt 0)

$driver = @'
using System;
using System.Globalization;
static class FitDriver
{
    // args: designW designH designMinW designMinH. Prints one line per case:
    // screenW screenH percent workW workH -> w h minW minH
    static int Main(string[] a)
    {
        var c = CultureInfo.InvariantCulture;
        double dw = double.Parse(a[0], c), dh = double.Parse(a[1], c), dmw = double.Parse(a[2], c), dmh = double.Parse(a[3], c);
        int[][] screens = { new[] { 1366, 768 }, new[] { 1920, 1080 }, new[] { 2560, 1440 }, new[] { 3840, 2160 } };
        int[] percents = { 100, 125, 150, 175, 200 };
        foreach (var s in screens)
            foreach (int p in percents)
            {
                double scale = p / 100.0;
                // A 48 pixel taskbar at 100 percent, scaled like everything else.
                double workW = s[0] / scale, workH = (s[1] - 48 * scale) / scale;
                double w = dw, h = dh, minW, minH;
                Thornswood.WindowFit.Clamp(workW, workH, dmw, dmh, ref w, ref h, out minW, out minH);
                Console.WriteLine(string.Format(c, "{0} {1} {2} {3:0.###} {4:0.###} {5:0.###} {6:0.###} {7:0.###} {8:0.###}",
                    s[0], s[1], p, workW, workH, w, h, minW, minH));
            }
        // Moving: a 1080 line screen at 200 percent, then a 1440 line one at 100.
        double mw = dw, mh = dh, a1, b1, a2, b2;
        Thornswood.WindowFit.Clamp(1920 / 2.0, (1080 - 96) / 2.0, dmw, dmh, ref mw, ref mh, out a1, out b1);
        Thornswood.WindowFit.Clamp(2560, 1440 - 48, dmw, dmh, ref mw, ref mh, out a2, out b2);
        Console.WriteLine(string.Format(c, "MOVE {0:0.###} {1:0.###} {2:0.###} {3:0.###} {4:0.###} {5:0.###}", a1, b1, a2, b2, mw, mh));
        return 0;
    }
}
'@
$fitDll = $null
try {
    $fitDll = Build-LauncherCode -File (Join-Path $app 'WindowFit.cs') -Source $driver -Exe -Main 'FitDriver'
    Yes 'WindowFit.cs compiles with the launcher''s settings, beside the driver' $true
} catch {
    Yes 'WindowFit.cs compiles with the launcher''s settings, beside the driver' $false
    Write-Host ('      ' + $_.Exception.Message)
}
if ($fitDll) {
    $inv = [Globalization.CultureInfo]::InvariantCulture
    $who = 'the launcher'
    $lines = @(Invoke-LauncherExe $fitDll $sz.Width $sz.Height $sz.MinWidth $sz.MinHeight)
    Yes "$who, the fit ran" ($LASTEXITCODE -eq 0)
    $bad = New-Object Collections.Generic.List[string]
    $cases = 0; $shrunk = 0
    foreach ($ln in $lines) {
        $f = $ln -split ' '
        if ($f[0] -eq 'MOVE') {
            $a1 = [double]::Parse($f[1], $inv); $b1 = [double]::Parse($f[2], $inv)
            $a2 = [double]::Parse($f[3], $inv); $b2 = [double]::Parse($f[4], $inv)
            Yes "$who, moved to a 200 percent 1080 line screen: minimum drops to fit ($a1 x $b1)" ($a1 -le 960 -and $b1 -le 492)
            Yes "$who, then to a 100 percent 1440 line screen: its own minimum is back ($a2 x $b2)" ($a2 -eq $sz.MinWidth -and $b2 -eq $sz.MinHeight)
            continue
        }
        $cases++
        $sw = $f[0]; $sh = $f[1]; $pc = $f[2]
        $workW = [double]::Parse($f[3], $inv); $workH = [double]::Parse($f[4], $inv)
        $w = [double]::Parse($f[5], $inv); $h = [double]::Parse($f[6], $inv)
        $mw = [double]::Parse($f[7], $inv); $mh = [double]::Parse($f[8], $inv)
        $tag = "${sw}x${sh} at $pc percent"
        if ($w -gt $workW + 0.001 -or $h -gt $workH + 0.001) { $bad.Add("$tag is bigger than the screen ($w x $h in $workW x $workH)") }
        if ($mw -gt $workW + 0.001 -or $mh -gt $workH + 0.001) { $bad.Add("$tag has a minimum bigger than the screen") }
        if ($w -lt $mw - 0.001 -or $h -lt $mh - 0.001) { $bad.Add("$tag is smaller than its minimum") }
        # Not tiny: wherever the full size fits it is kept, and a
        # dimension is only ever cut down to the screen, not below it.
        $wantW = [Math]::Min([double]$sz.Width, $workW); $wantH = [Math]::Min([double]$sz.Height, $workH)
        if ([Math]::Abs($w - $wantW) -gt 0.001 -or [Math]::Abs($h - $wantH) -gt 0.001) { $bad.Add("$tag is $w x $h, not $wantW x $wantH") }
        if ($w -lt $sz.Width -or $h -lt $sz.Height) { $shrunk++ }
    }
    Yes "$who window fits every screen at every scale ($cases cases, $shrunk cut to the screen)" ($cases -eq 20 -and $bad.Count -eq 0)
    foreach ($b in $bad) { Write-Host "      $b" }
    Yes "$who at 100 percent on 1920x1080 keeps its full size" (@($lines | Where-Object { $_ -like "1920 1080 100 *" } | ForEach-Object {
        $f = $_ -split ' '; ([double]::Parse($f[5], $inv) -eq $sz.Width) -and ([double]::Parse($f[6], $inv) -eq $sz.Height) }) -contains $true)
}

if ($ownScratch) { Remove-Item -LiteralPath $Scratch -Recurse -Force }

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
