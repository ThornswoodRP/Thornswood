<#
  test-build-generated.ps1

      pwsh -NoProfile -File .\tests\test-build-generated.ps1

  scripts\mods\Build-Generated.ps1 builds Thornswood's animation and body
  files in Thornswood's own folder and nowhere else, records them as
  Thornswood's, refuses while the folder is in use, and keeps the bodies
  covered and unshaped. Issue #1247. Since #3715 the build is the launcher's
  own (launcher\app\GeneratedBuild.cs), which runs it on each computer
  before Play, and Build-Generated.ps1 runs that same code; so this holds the
  launcher's build to all of it too, and no release carries what it builds.

  WHY THIS EXISTS. Patrick, 29 Sep: the behavior files and BodySlide's body
  meshes are made in Thornswood's own folder; Steam's copy stays the person's
  own. Patrick, 27 Oct (#3715): "The launcher makes all 45 files on each
  computer", because they are other people's work. The behavior
  files come from Pandora Behaviour Engine+, because Nemesis' -generate never
  starts its work. Most of Thornswood's folder is hard links to Vortex's
  copies, which the Steam copy links too, and a tool that writes in place
  there writes into Vortex's copy and the Steam copy as well. And a build the
  launcher does not know is Thornswood's is put back to Vortex's at the next
  refresh.

  HOW. Stand-ins for the two tools, compiled here with the .NET Framework csc,
  do what the real ones do: Pandora reads its folders from the Settings.json
  beside it (never -o), turns on the patches its ActiveMods.json says, and
  writes its files, in its own letter case, only into its output folder;
  BodySlide reads Config.xml, the group, the slider set and the preset, builds
  each body as a nif with the set's shapes less any the preset zaps, into
  --targetdir, and writes its own settings file in place. A pretend
  Vortex staging folder, Steam copy and Thornswood install are built with
  every mod file hard linked into both game folders, the worst case, and
  Build-Generated.ps1 runs against the install as a child process.

    A  a build: the output is in Thornswood's folder, each file its own copy,
       the Steam copy and Vortex's staging byte and time identical; the bodies
       are covered; the preset names every slider at its default and no morph
       file is asked for; the record lists every file made and nothing of the
       tools' own folders; Ship-Rules keeps them off every release, never
       shipped and never removed
    B  stale: the mod list, a file Pandora reads, a file BodySlide reads, the
       build list, a built file changed, and no record, each make it stale;
       Ship asks a dry run whether the collection can build them
    C  in use: Skyrim or the launcher run from the install: refused, nothing written
    D  never the Steam copy: a folder with Vortex's record in it, or the one the
       launcher made the folder from: refused, nothing written
    E  the body rules: a breast slider moved, the bra zapped: refused before
       BodySlide runs; a nude slider set: built, read, refused, nothing placed
    F  a write through a link the script did not foresee: refused, not recorded
    G  Pandora: it runs from a copy in the work folder with its settings naming
       only this folder and the work folder; its log with an error, Pandora
       writing into the game folder, no Pandora, and one that sits waiting
       (the stall check) are each refused, nothing recorded
    H  BodySlide writing into the game folder itself: refused
    I  what the last build made and this one did not: Vortex's copy put back
    J  a dry run writes nothing

  Writes only under its own scratch folder.
#>
[CmdletBinding()]
param([string]$Scratch)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }
$Build = Join-Path $Repo 'scripts\mods\Build-Generated.ps1'
$Lib = Join-Path $Repo 'scripts\mods\Generated.ps1'
$Ship = Join-Path $Repo 'scripts\release\Ship.ps1'
$Ready = Join-Path $Repo 'scripts\release\Check-ShipReady.ps1'
$pwsh = (Get-Process -Id $PID).Path

$script:pass = 0
$script:fail = 0
$script:lastOut = ''
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else {
        $script:fail++; Write-Host "FAIL  $what"
        # What the last run of Build-Generated said, so a failure says why.
        if ($script:lastOut) { foreach ($l in @($script:lastOut -split "`r?`n" | Where-Object { $_ -match 'STOP|exit code|in use by|Exception|error' } | Select-Object -Last 8)) { Write-Host "      $l" } }
    }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

foreach ($f in $Build, $Lib, (Join-Path $Repo 'scripts\release\Ship-Rules.ps1'), $Ship, $Ready) {
    $e = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$e)
    Yes ("$(Split-Path -Leaf $f) parses") (@($e).Count -eq 0)
}

. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'SKIP  the runs: the stand-ins for the two tools are .NET Framework programs, built with the .NET Framework csc, which only Windows has'; Done }
$csc = @(
    (Get-WindowsPath 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Get-WindowsPath 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
Yes 'the .NET Framework csc is here to build the stand-ins' ([bool]$csc)
if (-not $csc) { Done }

# ------------------------------------------------------------ the stand-ins
$common = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Xml;

static class Standin
{
    // Opens an existing file and truncates it, the way the tools write: the
    // same file under every name it has, so through a hard link too.
    public static void InPlace(string path, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
        {
            byte[] b = Encoding.ASCII.GetBytes(text);
            fs.Write(b, 0, b.Length);
        }
    }
    public static void Log(string what)
    {
        string log = Environment.GetEnvironmentVariable("STANDIN_LOG");
        if (!string.IsNullOrEmpty(log)) File.AppendAllText(log, what + "\r\n");
    }
    public static string Dir() { return AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'); }
}
'@

$pandora = $common + @'
static class Pandora
{
    // Pandora v4.4.0 reads its folders from Settings.json beside itself, not
    // from -o; with none it would take the registry's Skyrim.
    static string Field(string json, string name)
    {
        var m = System.Text.RegularExpressions.Regex.Match(json, "\"" + name + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        return m.Success ? m.Groups[1].Value.Replace("\\\\", "\\") : null;
    }

    static int Main(string[] args)
    {
        string dir = Standin.Dir();
        Standin.Log("pandora from " + dir + " : " + string.Join(" ", args));
        if (Environment.GetEnvironmentVariable("STANDIN_HANG") != null) { System.Threading.Thread.Sleep(600000); return 0; }
        // Its own templates beside it, as the real one reads them.
        if (!Directory.Exists(Path.Combine(dir, "Pandora_Engine\\Skyrim\\Template"))) return 6;
        string settings = Path.Combine(dir, "Settings.json");
        if (!File.Exists(settings)) return 8;
        string json = File.ReadAllText(settings);
        string data = Field(json, "gameDataPath"), output = Field(json, "outputPath");
        if (data == null || output == null) return 8;
        string active = File.ReadAllText(Path.Combine(output, "Pandora_Engine\\ActiveMods.json"));
        var codes = new List<string>();
        foreach (System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(active, "\"code\"\\s*:\\s*\"(\\w+)\"\\s*,\\s*\"active\"\\s*:\\s*true"))
            codes.Add(m.Groups[1].Value);
        Standin.Log("pandora active " + string.Join(" ", codes.ToArray()));
        var log = new StringBuilder("INFO : Skyrim Patcher 4.4.0-beta\r\n");
        int i = 1;
        foreach (string c in codes)
        {
            string name = c;
            string ini = Path.Combine(data, "Nemesis_Engine\\mod\\" + c + "\\info.ini");
            if (File.Exists(ini)) foreach (string line in File.ReadAllLines(ini)) if (line.StartsWith("name=")) name = line.Substring(5);
            log.Append("INFO : Pandora Mod " + (i++) + " : " + name + " - v.1.0.0\r\n");
        }
        log.Append("INFO : Pandora Mod " + (i++) + " : Pandora Base - v.1.0.0\r\n");
        if (Environment.GetEnvironmentVariable("STANDIN_PANDORA_ERROR") != null) log.Append("ERROR : Could not export 0_master\r\n");
        string said = "PANDORA " + string.Join(" ", codes.ToArray());
        // Its own letter case, which is not the folder's.
        Standin.InPlace(Path.Combine(output, "meshes\\actors\\character\\Behaviors\\0_Master.hkx"), said);
        Standin.InPlace(Path.Combine(output, "meshes\\actors\\character\\Characters\\DefaultMale.hkx"), said);
        Standin.InPlace(Path.Combine(output, "meshes\\animationdatasinglefile.txt"), "ANIMATIONS " + said);
        Standin.InPlace(Path.Combine(output, "Pandora_Engine\\PreviousOutput.txt"), "listed");
        if (Environment.GetEnvironmentVariable("STANDIN_PANDORA_INTO_DATA") != null) Standin.InPlace(Path.Combine(data, "meshes\\pandora_stray.txt"), "stray");
        if (Environment.GetEnvironmentVariable("STANDIN_PANDORA_DELETE") != null) File.Delete(Path.Combine(data, "meshes\\ts\\bench.nif"));
        File.WriteAllText(Path.Combine(output, "Engine.log"), log.ToString());
        return 0;
    }
}
'@

$bodyslide = $common + @'
static class BodySlide
{
    static string Arg(string[] args, string name)
    {
        for (int i = 0; i + 1 < args.Length; i++) if (args[i] == name) return args[i + 1];
        return null;
    }

    static void Nif(string path, List<string> shapes)
    {
        var names = new List<string>();
        names.Add("Scene Root");
        names.AddRange(shapes);
        int longest = 0;
        foreach (string n in names) longest = Math.Max(longest, n.Length);
        using (var ms = new MemoryStream())
        using (var w = new BinaryWriter(ms))
        {
            w.Write(Encoding.ASCII.GetBytes("Gamebryo File Format, Version 20.2.0.7\n"));
            w.Write((uint)0x14020007); w.Write((byte)1); w.Write((uint)12);
            w.Write((uint)names.Count); w.Write((uint)100);
            for (int k = 0; k < 3; k++) { w.Write((byte)1); w.Write((byte)0); }
            string[] types = { "NiNode", "BSTriShape" };
            w.Write((ushort)types.Length);
            foreach (string t in types) { w.Write((uint)t.Length); w.Write(Encoding.ASCII.GetBytes(t)); }
            for (int i = 0; i < names.Count; i++) w.Write((ushort)(i == 0 ? 0 : 1));
            for (int i = 0; i < names.Count; i++) w.Write((uint)12);
            w.Write((uint)names.Count); w.Write((uint)longest);
            foreach (string n in names) { w.Write((uint)n.Length); w.Write(Encoding.ASCII.GetBytes(n)); }
            w.Write((uint)0);
            for (int k = 0; k < names.Count; k++) { w.Write((int)k); w.Write((ulong)0); }
            w.Flush();
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path, ms.ToArray());
        }
    }

    static int Main(string[] args)
    {
        string dir = Standin.Dir();
        Standin.Log("bodyslide " + string.Join(" ", args));
        var cfg = new XmlDocument();
        cfg.Load(Path.Combine(dir, "Config.xml"));
        XmlNode game = cfg.SelectSingleNode("/Config/TargetGame");
        XmlNode dataPath = cfg.SelectSingleNode("/Config/GameDataPath");
        // Unset, the real one asks which game on its first start.
        if (game == null || game.InnerText != "4" || dataPath == null || dataPath.InnerText.Length == 0) return 5;
        string group = Arg(args, "--groupbuild"), target = Arg(args, "--targetdir"), preset = Arg(args, "--preset");
        if (Environment.GetEnvironmentVariable("STANDIN_BS_INTO_GAME") != null) target = dataPath.InnerText.TrimEnd('\\');
        Standin.InPlace(Path.Combine(dir, "BodySlide.xml"), "<BodySlideConfig><LastPreset>" + preset + "</LastPreset></BodySlideConfig>");
        string rogue = Environment.GetEnvironmentVariable("STANDIN_ROGUE");
        if (!string.IsNullOrEmpty(rogue)) Standin.InPlace(Path.Combine(dataPath.InnerText, rogue), "ROGUE");

        var members = new List<string>();
        foreach (string f in Directory.GetFiles(Path.Combine(dir, "SliderGroups"), "*.xml"))
        {
            var x = new XmlDocument(); x.Load(f);
            foreach (XmlElement g in x.SelectNodes("/SliderGroups/Group"))
                if (g.GetAttribute("name") == group)
                    foreach (XmlElement m in g.SelectNodes("Member")) members.Add(m.GetAttribute("name"));
        }
        var values = new Dictionary<string, double>();
        foreach (string f in Directory.GetFiles(Path.Combine(dir, "SliderPresets"), "*.xml"))
        {
            var x = new XmlDocument(); x.Load(f);
            foreach (XmlElement p in x.SelectNodes("/SliderPresets/Preset"))
                if (p.GetAttribute("name") == preset)
                    foreach (XmlElement s in p.SelectNodes("SetSlider"))
                        if (s.GetAttribute("size") == "big") values[s.GetAttribute("name")] = double.Parse(s.GetAttribute("value"), System.Globalization.CultureInfo.InvariantCulture);
        }
        int built = 0;
        foreach (string f in Directory.GetFiles(Path.Combine(dir, "SliderSets"), "*.osp"))
        {
            var x = new XmlDocument(); x.Load(f);
            foreach (XmlElement set in x.SelectNodes("/SliderSetInfo/SliderSet"))
            {
                if (!members.Contains(set.GetAttribute("name"))) continue;
                var shapes = new List<string>();
                foreach (XmlElement sh in set.SelectNodes("Shape")) shapes.Add(sh.InnerText);
                // A zap at anything above 0 takes its shape off the mesh.
                foreach (XmlElement sl in set.SelectNodes("Slider"))
                {
                    double v;
                    if (sl.GetAttribute("zap") == "true" && values.TryGetValue(sl.GetAttribute("name"), out v) && v > 0) shapes.Remove(sl.GetAttribute("name"));
                }
                XmlElement outFile = (XmlElement)set.SelectSingleNode("OutputFile");
                string baseName = Path.Combine(Path.Combine(target, set.SelectSingleNode("OutputPath").InnerText), outFile.InnerText);
                if (outFile.GetAttribute("GenWeights") == "true") { Nif(baseName + "_0.nif", shapes); Nif(baseName + "_1.nif", shapes); }
                else Nif(baseName + ".nif", shapes);
                if (Array.IndexOf(args, "--trimorphs") >= 0) File.WriteAllText(baseName + ".tri", "morphs");
                built++;
            }
        }
        return built > 0 ? 0 : 7;
    }
}
'@

$sleeper = @'
static class Sleeper { static void Main() { System.Threading.Thread.Sleep(120000); } }
'@

$work = Join-Path $Scratch ('thornswood-build-generated-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$fw = Split-Path -Parent $csc
$bin = Join-Path $work 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)
function Compile([string]$name, [string]$source) {
    $src = Join-Path $bin ($name + '.cs')
    [IO.File]::WriteAllText($src, $source, $utf8)
    $out = Join-Path $bin ($name + '.exe')
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $said = & $csc /noconfig /nologo /target:exe /warn:0 "/out:$out" "/reference:$(Join-Path $fw 'System.dll')" "/reference:$(Join-Path $fw 'System.Xml.dll')" $src 2>&1
    $ErrorActionPreference = $old
    $ok = ($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath $out)
    if (-not $ok) { foreach ($l in @($said)) { Write-Host "      $l" } }
    return $ok
}

# ------------------------------------------------------------ a nif, the same shape Check-CoveredBodies reads
function New-Nif([string]$Path, [string[]]$Shapes) {
    $ms = New-Object IO.MemoryStream
    $w = New-Object IO.BinaryWriter($ms)
    $w.Write([Text.Encoding]::ASCII.GetBytes("Gamebryo File Format, Version 20.2.0.7`n"))
    $w.Write([uint32]0x14020007); $w.Write([byte]1); $w.Write([uint32]12)
    $names = @('Scene Root') + $Shapes
    $w.Write([uint32]$names.Count); $w.Write([uint32]100)
    for ($k = 0; $k -lt 3; $k++) { $w.Write([byte]1); $w.Write([byte]0) }
    $types = @('NiNode', 'BSTriShape')
    $w.Write([uint16]$types.Count)
    foreach ($t in $types) { $w.Write([uint32]$t.Length); $w.Write([Text.Encoding]::ASCII.GetBytes($t)) }
    for ($i = 0; $i -lt $names.Count; $i++) { if ($i -eq 0) { $w.Write([uint16]0) } else { $w.Write([uint16]1) } }
    foreach ($n in $names) { $w.Write([uint32]12) }
    $w.Write([uint32]$names.Count)
    $w.Write([uint32](($names | Measure-Object -Property Length -Maximum).Maximum))
    foreach ($n in $names) { $w.Write([uint32]$n.Length); $w.Write([Text.Encoding]::ASCII.GetBytes($n)) }
    $w.Write([uint32]0)
    for ($k = 0; $k -lt $names.Count; $k++) { $w.Write([int32]$k); $w.Write([uint64]0) }
    $w.Flush()
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    [IO.File]::WriteAllBytes($Path, $ms.ToArray())
}

function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Text([string]$path) { if (Test-Path -LiteralPath $path) { return [IO.File]::ReadAllText($path) } return $null }

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class GenTestIds
{
    [StructLayout(LayoutKind.Sequential)]
    struct Info
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME C, A, W;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle h, out Info info);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateHardLink(string newName, string existing, IntPtr security);
    static Info Get(string path)
    {
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            Info i; GetFileInformationByHandle(fs.SafeFileHandle, out i); return i;
        }
    }
    public static string Id(string path) { Info i = Get(path); return i.Volume + ":" + i.IndexHigh + ":" + i.IndexLow; }
    public static int Links(string path) { return (int)Get(path).Links; }
}
'@

# Every file under a folder with its bytes and its write time.
function Snap([string]$dir) {
    $d = @{}
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force)) {
        # The time from the file itself: a folder's listing keeps the time a
        # hard linked file had when it was last opened by that name.
        $d[$f.FullName.Substring($dir.Length)] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash + '|' + [IO.File]::GetLastWriteTimeUtc($f.FullName).Ticks
    }
    return $d
}
function Same($a, $b) {
    if ($a.Count -ne $b.Count) { return $false }
    foreach ($k in $a.Keys) { if (-not $b.ContainsKey($k) -or $b[$k] -ne $a[$k]) { Write-Host "      differs: $k"; return $false } }
    return $true
}

try {
    $okN = Compile 'pandora' $pandora
    $okB = Compile 'bodyslide' $bodyslide
    $okS = Compile 'sleeper' $sleeper
    Yes 'the stand-ins for Pandora, BodySlide and a running game compile' ($okN -and $okB -and $okS)
    if (-not ($okN -and $okB -and $okS)) { Done }

    # -------------------------------------------------------- the machine
    $staging = Join-Path $work 'vortex\mods'
    $steam = Join-Path $work 'steam\steamapps\common\Skyrim Special Edition'
    $root = Join-Path $work 'Thornswood-DevBuild'
    $game = Join-Path $root 'Game'
    $own = Join-Path $root 'Profile\OwnGame'
    $log = Join-Path $work 'tools.log'
    $env:STANDIN_LOG = $log

    $osp = @'
<SliderSetInfo version="1">
    <SliderSet name="CBBE 3BBB Amazing NeverNude">
        <OutputPath>meshes\actors\character\character assets</OutputPath>
        <OutputFile GenWeights="true">femalebody</OutputFile>
        <Shape target="3BA">3BA</Shape>
        <Shape target="3BA_Anus">3BA_Anus</Shape>
        <Shape target="3BA_Vagina">3BA_Vagina</Shape>
        <Shape target="Bra">Bra</Shape>
        <Shape target="Panty">Panty</Shape>
        <Slider name="Breasts" invert="false" small="0" big="0"/>
        <Slider name="ButtShape2" invert="false" small="0" big="0"/>
        <Slider name="AnkleSize" invert="false" small="100" big="0"/>
        <Slider name="NippleZap" invert="false" small="100" big="100" hidden="true" zap="true"/>
        <Slider name="Bra" invert="false" small="0" big="0" zap="true"/>
        <Slider name="Panty" invert="false" small="0" big="0" zap="true"/>
    </SliderSet>
    <SliderSet name="CBBE 3BBB Body Amazing">
        <OutputPath>meshes\actors\character\character assets</OutputPath>
        <OutputFile GenWeights="true">femalebody</OutputFile>
        <Shape target="3BA">3BA</Shape>
        <Shape target="3BA_Anus">3BA_Anus</Shape>
        <Shape target="3BA_Vagina">3BA_Vagina</Shape>
        <Slider name="Breasts" invert="false" small="0" big="0"/>
    </SliderSet>
    <SliderSet name="HIMBO Body - Vanilla Nevernude">
        <OutputPath>meshes\actors\character\character assets</OutputPath>
        <OutputFile GenWeights="true">malebody</OutputFile>
        <Shape target="HIMBO - Body">HIMBO - Body</Shape>
        <Shape target="HIMBO - Boxers">HIMBO - Boxers</Shape>
        <Slider name="ButtBooty" invert="false" small="0" big="0"/>
        <Slider name="Weight 0 to 1" invert="false" small="0" big="100" hidden="true"/>
    </SliderSet>
</SliderSetInfo>
'@
    # What Vortex has, mod by mod: path under Data, then the bytes (a
    # string, or a script block that writes the file).
    $mods = [ordered]@{
        'Pandora' = @(
            @('Pandora Behaviour Engine\Pandora Behaviour Engine+.exe', { param($p) Copy-Item -LiteralPath (Join-Path $bin 'pandora.exe') -Destination $p }),
            @('Pandora Behaviour Engine\Pandora_Engine\Skyrim\Template\vanilla.txt', 'TEMPLATE')
        )
        'Precision' = @(
            ,@('Nemesis_Engine\mod\colis\info.ini', "name=Precision`r`n")
        )
        'TK Dodge' = @(
            # A patch the collection has and the list does not name: it stays off.
            ,@('Nemesis_Engine\mod\tkuc\info.ini', "name=Ultimate Combat / TK Dodge`r`n")
        )
        'TDM' = @(
            @('Nemesis_Engine\mod\tdmh\info.ini', "name=TDM Horse`r`n"),
            @('Nemesis_Engine\mod\tdmlen\info.ini', "name=TDM Leaning`r`n"),
            @('Nemesis_Engine\mod\tdmv\info.ini', "name=TDM Headtracking`r`n"),
            @('meshes\actors\character\behaviors\0_master.hkx', 'VORTEX-TDM-BEHAVIOR'),
            @('scripts\FNIS.pex', 'VORTEX-FNIS'),
            @('meshes\ts\bench.nif', 'VORTEX-BENCH')
        )
        'BodySlide' = @(
            @('CalienteTools\BodySlide\BodySlide.exe', { param($p) Copy-Item -LiteralPath (Join-Path $bin 'bodyslide.exe') -Destination $p }),
            @('CalienteTools\BodySlide\Config.xml', "<Config>`r`n    <TargetGame>-1</TargetGame>`r`n    <GameDataPath></GameDataPath>`r`n</Config>`r`n"),
            @('CalienteTools\BodySlide\SliderSets\Test.osp', $osp),
            @('CalienteTools\BodySlide\SliderGroups\CBBE.xml', "<SliderGroups><Group name=`"CBBE`"><Member name=`"CBBE 3BBB Amazing NeverNude`"/></Group></SliderGroups>"),
            # The preset the person last used, which a build must not pick up.
            @('CalienteTools\BodySlide\SliderPresets\CBBE.xml', "<SliderPresets><Preset name=`"CBBE Curvy`" set=`"CBBE Body`"><Group name=`"CBBE`"/><SetSlider name=`"Breasts`" size=`"big`" value=`"80`"/></Preset></SliderPresets>")
        )
        '3BA' = @(
            @('meshes\actors\character\character assets\femalebody_0.nif', { param($p) New-Nif $p @('3BA', '3BA_Vagina', '3BA_Anus') }),
            @('meshes\actors\character\character assets\femalebody_1.nif', { param($p) New-Nif $p @('3BA', '3BA_Vagina', '3BA_Anus') })
        )
        'HIMBO' = @(
            @('meshes\actors\character\character assets\malebody_0.nif', { param($p) New-Nif $p @('HIMBO - Body', 'HIMBO - Boxers', 'VORTEX') }),
            @('meshes\actors\character\character assets\malebody_1.nif', { param($p) New-Nif $p @('HIMBO - Body', 'HIMBO - Boxers', 'VORTEX') })
        )
    }
    Put (Join-Path $steam 'SkyrimSE.exe') 'STEAM-EXE'
    Copy-Item -LiteralPath (Join-Path $bin 'sleeper.exe') -Destination (New-Item -ItemType Directory -Force -Path $game).FullName
    Rename-Item -LiteralPath (Join-Path $game 'sleeper.exe') -NewName 'SkyrimSE.exe'
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'Launcher') | Out-Null
    Copy-Item -LiteralPath (Join-Path $bin 'sleeper.exe') -Destination (Join-Path $root 'Launcher\Thornswood.exe')
    $filesTxt = New-Object Collections.Generic.List[string]
    $deploy = New-Object Collections.Generic.List[string]
    foreach ($mod in $mods.Keys) {
        foreach ($f in $mods[$mod]) {
            $rel = $f[0]
            $st = Join-Path $staging "$mod\$rel"
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $st) | Out-Null
            if ($f[1] -is [scriptblock]) { & $f[1] $st } else { Put $st $f[1] }
            foreach ($into in (Join-Path $steam "Data\$rel"), (Join-Path $game "Data\$rel")) {
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $into) | Out-Null
                [void][GenTestIds]::CreateHardLink($into, $st, [IntPtr]::Zero)
            }
            $fi = Get-Item -LiteralPath $st
            $filesTxt.Add(('L|V|{0}|{1}|Data\{2}' -f $fi.Length, $fi.LastWriteTimeUtc.Ticks, $rel))
            $deploy.Add(('{{ "relPath": "{0}", "source": "{1}" }}' -f $rel.Replace('\', '\\'), $mod))
        }
    }
    Put (Join-Path $steam 'Data\vortex.deployment.json') ('{ "stagingPath": "' + $staging.Replace('\', '\\') + '", "files": [ ' + ($deploy -join ', ') + ' ] }')
    $filesTxt.Add('C|O|9|1|SkyrimSE.exe')
    Put (Join-Path $own 'files.txt') (($filesTxt -join "`r`n") + "`r`n")
    Put (Join-Path $own 'made.txt') ("source=$steam`r`ngame=$steam`r`nrules=13`r`nkinds=1`r`n")
    Put (Join-Path $own 'plugins.txt') "*TsOne.esp`r`n*Precision.esp`r`n"
    $list = Join-Path $work 'generated.json'
    $listText = '{ "pandora": { "patches": ["colis", "tdmh", "tdmlen", "tdmv"] }, "bodyslide": { "sets": ["CBBE 3BBB Amazing NeverNude", "HIMBO Body - Vanilla Nevernude"], "sliders": {} } }'
    Put $list $listText
    Yes '(every mod file is one file under three names: Vortex''s, the Steam copy''s and Thornswood''s)' (
        [GenTestIds]::Links((Join-Path $game 'Data\meshes\actors\character\character assets\femalebody_1.nif')) -eq 3 -and
        [GenTestIds]::Links((Join-Path $game 'Data\Pandora Behaviour Engine\Pandora Behaviour Engine+.exe')) -eq 3)

    function Invoke-Build([string[]]$more) {
        $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Build, '-Root', $root, '-BuildList', $list, '-NoPause') + $more
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $out = & $pwsh @a 2>&1 | Out-String
        $code = $LASTEXITCODE
        $ErrorActionPreference = $old
        $script:lastOut = $out + "
exit code $code"
        return [pscustomobject]@{ Code = $code; Out = $out }
    }
    function Log { if (Test-Path -LiteralPath $log) { return [IO.File]::ReadAllText($log) } return '' }
    $record = Join-Path $own 'generated.txt'
    $A = 'Data\meshes\actors\character\character assets\'

    # ======================================================== J: a dry run
    $gameBefore = Snap $game; $ownBefore = Snap $own
    $r = Invoke-Build @('-DryRun')
    Yes ('J: a dry run exits 0 (got {0})' -f $r.Code) ($r.Code -eq 0)
    Yes 'J: and says what it would run, both tools' ($r.Out -match '--auto_run --auto_close, with the patches colis tdmh tdmlen tdmv' -and $r.Out -match '--groupbuild "Thornswood 1"')
    Yes 'J: and writes nothing: not the game folder, not the records, no tool started' ((Same $gameBefore (Snap $game)) -and (Same $ownBefore (Snap $own)) -and -not (Log))

    # ======================================================== A: a build
    $steamBefore = Snap $steam; $stagingBefore = Snap $staging
    $r = Invoke-Build @()
    if ($r.Code -ne 0) { Write-Host $r.Out }
    Yes ('A: the build works (exit {0})' -f $r.Code) ($r.Code -eq 0)
    Yes 'A: the Steam copy is byte for byte and time for time what it was' (Same $steamBefore (Snap $steam))
    Yes 'A: and so is Vortex''s staging folder, the tools'' own files in it included' (Same $stagingBefore (Snap $staging))
    $beh = Join-Path $game 'Data\meshes\actors\character\behaviors\0_master.hkx'
    Yes 'A: Pandora''s behavior files are in Thornswood''s folder, made with exactly the patches the list names' (
        (Text $beh) -eq 'PANDORA colis tdmh tdmlen tdmv' -and
        (Text (Join-Path $game 'Data\meshes\actors\character\Characters\DefaultMale.hkx')) -eq 'PANDORA colis tdmh tdmlen tdmv')
    Yes 'A: and every other patch was off (the one the list does not name)' ((Log) -match '(?m)^pandora active colis tdmh tdmlen tdmv\r?$')
    Yes 'A: each a new file of this folder''s own, and Vortex''s behavior file is as it was' (
        [GenTestIds]::Links($beh) -eq 1 -and (Text (Join-Path $staging 'TDM\meshes\actors\character\behaviors\0_master.hkx')) -eq 'VORTEX-TDM-BEHAVIOR')
    Yes 'A: in the letter case the folder already had (behaviors\0_master.hkx, though Pandora wrote Behaviors\0_Master.hkx)' (
        @(Get-ChildItem -LiteralPath (Split-Path -Parent $beh) -File | Where-Object { $_.Name -ceq '0_master.hkx' }).Count -eq 1 -and
        @(Get-ChildItem -LiteralPath (Join-Path $game 'Data\meshes\actors\character') -Directory | Where-Object { $_.Name -ceq 'behaviors' }).Count -eq 1)
    Yes 'A: Pandora ran from a copy in the work folder, never the one in the game folder' (
        (Log) -match '(?m)^pandora from .*\\Profile\\OwnGame\\build-generated\\pandora :' -and (Log) -match [regex]::Escape('--tesv ' + $game) -and
        -not (Test-Path -LiteralPath (Join-Path $game 'Data\Pandora Behaviour Engine\Settings.json')))
    Yes 'A: and Pandora''s own files in the game folder are as Vortex put them' (
        [GenTestIds]::Links((Join-Path $game 'Data\Pandora Behaviour Engine\Pandora Behaviour Engine+.exe')) -eq 3)
    Yes 'A: its log and its own records stayed in the work folder, not in the game folder' (
        -not (Test-Path -LiteralPath (Join-Path $game 'Data\Engine.log')) -and -not (Test-Path -LiteralPath (Join-Path $game 'Data\Pandora_Engine')))
    $cov = & $pwsh -NoProfile -File (Join-Path $Repo 'scripts\mods\Check-CoveredBodies.ps1') -Game $game 2>&1 | Out-String
    Yes ('A: every body in Thornswood''s folder is covered now (Check-CoveredBodies exit {0})' -f $LASTEXITCODE) ($LASTEXITCODE -eq 0 -and $cov -match 'covered\s+femalebody_1\.nif\s+shapes: 3BA, 3BA_Anus, 3BA_Vagina, Bra, Panty')
    Yes 'A: the bodies are new files of this folder''s own; Vortex''s nude 3BA body is as it was' (
        [GenTestIds]::Links((Join-Path $game ($A + 'femalebody_1.nif'))) -eq 1 -and
        [GenTestIds]::Links((Join-Path $staging ('3BA\' + $A.Substring(5) + 'femalebody_1.nif'))) -eq 2)
    $bsLog = @((Log) -split "`r?`n" | Where-Object { $_ -like 'bodyslide *' })
    Yes 'A: BodySlide built each set with the preset made for it, and was never asked for morph files' (
        $bsLog.Count -eq 2 -and ($bsLog -join "`n") -match '--preset Thornswood 1' -and ($bsLog -join "`n") -notmatch 'trimorphs')
    Yes 'A: into a folder of its own, not the game folder' (($bsLog -join "`n") -notmatch [regex]::Escape('--targetdir ' + $game))
    $preset = [xml](Text (Join-Path $game 'Data\CalienteTools\BodySlide\SliderPresets\Thornswood.xml'))
    $p1 = @($preset.SliderPresets.Preset | Where-Object { $_.name -eq 'Thornswood 1' })[0]
    $val = { param($n, $s) @($p1.SetSlider | Where-Object { $_.name -eq $n -and $_.size -eq $s })[0].value }
    Yes 'A: the preset names every slider of the set at its default: Breasts 0, AnkleSize small 100, NippleZap 100, Bra and Panty 0' (
        (& $val 'Breasts' 'big') -eq '0' -and (& $val 'AnkleSize' 'small') -eq '100' -and (& $val 'NippleZap' 'big') -eq '100' -and
        (& $val 'Bra' 'big') -eq '0' -and (& $val 'Panty' 'small') -eq '0' -and @($p1.SetSlider).Count -eq 12)
    Yes 'A: BodySlide was set to Skyrim Special Edition and this folder''s Data, in this folder''s own copy of its settings' (
        (Text (Join-Path $game 'Data\CalienteTools\BodySlide\Config.xml')) -match '<TargetGame>4</TargetGame>' -and
        (Text (Join-Path $staging 'BodySlide\CalienteTools\BodySlide\Config.xml')) -match '<TargetGame>-1</TargetGame>')

    . $Lib
    $rec = Read-GeneratedRecord $record
    $want = @('Data\meshes\actors\character\behaviors\0_master.hkx', 'Data\meshes\actors\character\Characters\DefaultMale.hkx',
              'Data\meshes\animationdatasinglefile.txt',
              ($A + 'femalebody_0.nif'), ($A + 'femalebody_1.nif'), ($A + 'malebody_0.nif'), ($A + 'malebody_1.nif'))
    $got = @($rec.Files | ForEach-Object { $_.Rel })
    Yes ('A: the record lists every file made, and nothing of the tools'' own folders ({0})' -f $got.Count) (
        $got.Count -eq $want.Count -and @($want | Where-Object { $got -notcontains $_ }).Count -eq 0)
    $shaOk = $true
    foreach ($f in $rec.Files) { if ((Get-FileHash -LiteralPath (Join-Path $game $f.Rel) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $f.Sha) { $shaOk = $false } }
    Yes 'A: each with the sha256 of what is in the folder' $shaOk
    Yes 'A: and what it was built from: the build list, the mod list, Pandora''s files, BodySlide''s' (
        $rec.Part('list') -and $rec.Part('plugins') -and $rec.Part('behaviors') -and $rec.Part('bodyslide') -and $rec.Game -eq $game)
    Yes 'A: its work folder is gone' (-not (Test-Path -LiteralPath (Join-Path $own 'build-generated')))
    $state = Get-GeneratedState $root $list
    Yes 'A: and it reads back as current' ($state.Current)

    . (Join-Path $Repo 'scripts\release\Ship-Rules.ps1')
    $machine = @($got | Where-Object { (Test-ShipGenerated $_) -and (Test-ShipMachine $_) })
    Yes 'A: no release carries them: Ship-Rules counts every file the record has as built on each computer, never shipped and never removed (#3715)' (
        $machine.Count -eq $want.Count)
    $col = Get-ShipOwnGameCollection (Join-Path $root 'Profile')
    Yes 'A: and still counts the rest of Vortex''s files as the collection''s, the tools among them' (
        $col.Contains('Data\meshes\ts\bench.nif') -and $col.Contains('Data\Pandora Behaviour Engine\Pandora Behaviour Engine+.exe') -and $col.Contains('Data\CalienteTools\BodySlide\BodySlide.exe'))
    Yes 'A: and a file of the collection is not taken for one built here' (-not (Test-ShipGenerated 'Data\meshes\ts\bench.nif'))

    # ======================================================== B: stale
    $plugins = Join-Path $own 'plugins.txt'
    $keep = Text $plugins
    Put $plugins ($keep + "*NewMod.esp`r`n")
    $s = Get-GeneratedState $root $list
    Yes 'B: a changed mod list makes it stale, and says so' (-not $s.Current -and ($s.Why -join ';') -match 'the mod list changed')
    Put $plugins $keep
    Yes 'B: put back, it is current again' ((Get-GeneratedState $root $list).Current)

    $ft = Text (Join-Path $own 'files.txt')
    $line = @($ft -split "`r`n" | Where-Object { $_ -like '*|Data\Nemesis_Engine\mod\colis\info.ini' })[0]
    Put (Join-Path $own 'files.txt') ($ft.Replace($line, ($line -replace '\|(\d+)\|Data', '|999|Data')))
    $s = Get-GeneratedState $root $list
    Yes 'B: Vortex changing a file Pandora reads (a patch) makes it stale, and says Pandora' (-not $s.Current -and ($s.Why -join ';') -match 'Pandora reads')
    $line3 = @($ft -split "`r`n" | Where-Object { $_ -like '*|Data\Pandora Behaviour Engine\Pandora Behaviour Engine+.exe' })[0]
    Put (Join-Path $own 'files.txt') ($ft.Replace($line3, ($line3 -replace '\|(\d+)\|Data', '|999|Data')))
    $s = Get-GeneratedState $root $list
    Yes 'B: and so does a new Pandora' (-not $s.Current -and ($s.Why -join ';') -match 'Pandora reads')
    $line2 = @($ft -split "`r`n" | Where-Object { $_ -like '*|Data\CalienteTools\BodySlide\SliderSets\Test.osp' })[0]
    Put (Join-Path $own 'files.txt') ($ft.Replace($line2, ($line2 -replace '\|(\d+)\|Data', '|999|Data')))
    $s = Get-GeneratedState $root $list
    Yes 'B: Vortex changing a slider set makes it stale, and says BodySlide' (-not $s.Current -and ($s.Why -join ';') -match 'BodySlide builds from' -and ($s.Why -join ';') -notmatch 'Pandora reads')
    Put (Join-Path $own 'files.txt') $ft
    Put $list ($listText.Replace('"tdmv"', '"tdmv", "tkuc"'))
    $s = Get-GeneratedState $root $list
    Yes 'B: a changed build list makes it stale' (-not $s.Current -and ($s.Why -join ';') -match 'records\\generated\.json')
    Put $list $listText
    $bodyBytes = [IO.File]::ReadAllBytes((Join-Path $game ($A + 'femalebody_1.nif')))
    [IO.File]::WriteAllText((Join-Path $game ($A + 'femalebody_1.nif')), 'put back by somebody')
    $s = Get-GeneratedState $root $list
    Yes 'B: a built file not as built makes it stale, and names it' (-not $s.Current -and ($s.Why -join ';') -match 'femalebody_1\.nif is not as built')
    [IO.File]::WriteAllBytes((Join-Path $game ($A + 'femalebody_1.nif')), $bodyBytes)
    Yes 'B: put back, current again' ((Get-GeneratedState $root $list).Current)
    Move-Item -LiteralPath $record -Destination ($record + '.aside')
    $s = Get-GeneratedState $root $list
    Yes 'B: no record at all is stale: never built' (-not $s.Current -and ($s.Why -join ';') -match 'never been built')

    Move-Item -LiteralPath ($record + '.aside') -Destination $record
    Yes 'B: and put back, current' ((Get-GeneratedState $root $list).Current)
    $readyText = [IO.File]::ReadAllText($Ready)
    Yes 'B: Check-ShipReady asks nothing of them: no release carries them (#3715)' ($readyText -notmatch 'Get-GeneratedRows' -and $readyText -notmatch 'Generated\.ps1')

    # Ship's step, read out of Ship.ps1: a dry run of this script, which
    # writes nothing and starts no tool, says whether the collection installed
    # here can build them. Every launcher builds them before Play.
    $shipText = [IO.File]::ReadAllText($Ship)
    $at = $shipText.IndexOf("Head 'Animation and body files'")
    Yes 'B: Ship.ps1 has an Animation and body files step' ($at -gt 0)
    $buildAt = if ($at -gt 0) { $shipText.IndexOf('# ------------------------------------------------------------ node', $at) } else { -1 }
    $step = if ($at -gt 0 -and $buildAt -gt $at) { $shipText.Substring($at, $buildAt - $at) } else { '' }
    # Nothing to put back first since #4825: the number goes into the build as
    # -p:Version and no source file holds it (Unbump went).
    Yes 'B: it runs Build-Generated.ps1 -DryRun on this install''s folder, and stops on both channels when that stops' (
        $step.Contains("& (Join-Path `$Here '..\mods\Build-Generated.ps1') -Root `$Root -DryRun -NoPause") -and
        $step -match "if \(\`$genExit -ne 0\) \{\s*Die " -and $step -notmatch '\$Dev')
    $buildCall = $shipText.IndexOf("'Build-Launcher.ps1') -Root")
    $installCall = $shipText.IndexOf("'Install-Launcher.ps1')")
    $publish = $shipText.IndexOf("Publish-Update.ps1", $at + 1)
    # Ship builds and installs no launcher since #4825 (it ran before both, #1692).
    Yes 'B: before anything is published, and Ship builds and installs no launcher' (
        $buildCall -lt 0 -and $installCall -lt 0 -and ($publish -lt 0 -or $publish -gt $at))
    Yes 'B: and Ship no longer reads the record or the covered bodies itself' ($shipText -notmatch "Head 'Covered bodies'" -and $shipText -notmatch 'Get-GeneratedStaleSays')

    # ======================================================== C: in use
    $recBefore = Text $record
    $gameBefore = Snap $game
    foreach ($who in @(@('Skyrim', (Join-Path $game 'SkyrimSE.exe')), @('the launcher', (Join-Path $root 'Launcher\Thornswood.exe')))) {
        $p = Start-Process -FilePath $who[1] -PassThru -WindowStyle Hidden
        try {
            Start-Sleep -Milliseconds 400
            $r = Invoke-Build @()
            Yes ('C: with ' + $who[0] + ' run from the install, it refuses: exit 3 (got ' + $r.Code + ')') ($r.Code -eq 3)
            Yes ('C: and says the folder is in use and what to close') ($r.Out -match 'is in use' -and $r.Out -match 'Close Skyrim and the Thornswood launcher')
        } finally { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; $p.WaitForExit() }
    }
    Yes 'C: and nothing was written: the game folder and the record are as they were' ((Same $gameBefore (Snap $game)) -and (Text $record) -eq $recBefore)

    # ======================================================== D: never the Steam copy
    Put (Join-Path $game 'Data\vortex.deployment.json') '{}'
    $gameBefore = Snap $game
    $r = Invoke-Build @()
    Yes 'D: a folder with Vortex''s own record in it is refused as not Thornswood''s own' ($r.Code -eq 1 -and $r.Out -match 'folder Vortex deploys into')
    Yes 'D: and nothing is written' ((Same $gameBefore (Snap $game)) -and (Text $record) -eq $recBefore)
    Remove-Item -LiteralPath (Join-Path $game 'Data\vortex.deployment.json')
    $madeTxt = Text (Join-Path $own 'made.txt')
    Put (Join-Path $own 'made.txt') ($madeTxt.Replace("source=$steam", "source=$game"))
    $r = Invoke-Build @()
    Yes 'D: the folder the launcher made Thornswood''s from is refused' ($r.Code -eq 1 -and $r.Out -match 'the Steam copy\. Nothing is built there')
    Put (Join-Path $own 'made.txt') $madeTxt

    # ======================================================== E: the body rules
    [IO.File]::Delete($log)
    foreach ($case in @(
        @('a breast slider moved', '{ "CBBE 3BBB Amazing NeverNude": { "Breasts": { "big": 60 } } }', "'Breasts' in CBBE 3BBB Amazing NeverNude shapes the body at 60"),
        @('the seat shaped on the men''s body', '{ "HIMBO Body - Vanilla Nevernude": { "ButtBooty": { "small": 30 } } }', "'ButtBooty' in HIMBO Body - Vanilla Nevernude shapes the body at 30"),
        @('the bra zapped', '{ "CBBE 3BBB Amazing NeverNude": { "Bra": { "big": 100, "small": 100 } } }', "'Bra' in CBBE 3BBB Amazing NeverNude takes the underwear off"),
        @('another zap moved from its default', '{ "CBBE 3BBB Amazing NeverNude": { "NippleZap": { "big": 0 } } }', "'NippleZap' in CBBE 3BBB Amazing NeverNude is a zap moved from its default"),
        @('a slider the set does not have', '{ "CBBE 3BBB Amazing NeverNude": { "NoSuch": { "big": 1 } } }', "moves 'NoSuch'"))) {
        Put $list ($listText.Replace('"sliders": {}', '"sliders": ' + $case[1]))
        $gameBefore = Snap $game
        $r = Invoke-Build @()
        Yes ('E: ' + $case[0] + ': refused, and the line names it') ($r.Code -eq 1 -and $r.Out.Contains($case[2]) -and $r.Out -match 'against the body rules')
        Yes ('E: ' + $case[0] + ': before anything was written or run') ((Same $gameBefore (Snap $game)) -and -not (Log) -and (Text $record) -eq $recBefore)
    }
    Put $list ($listText.Replace('"CBBE 3BBB Amazing NeverNude"', '"CBBE 3BBB Body Amazing"'))
    $bodyBefore = (Get-FileHash -LiteralPath (Join-Path $game ($A + 'femalebody_1.nif'))).Hash
    $r = Invoke-Build @()
    Yes 'E: a slider set with nothing over the body is built, read and refused as nude' ($r.Code -eq 1 -and $r.Out -match 'NUDE\s+femalebody_1\.nif' -and $r.Out -match 'is not covered')
    Yes 'E: and nothing it built was put in the folder, nor recorded' ((Get-FileHash -LiteralPath (Join-Path $game ($A + 'femalebody_1.nif'))).Hash -eq $bodyBefore -and (Text $record) -eq $recBefore)
    Put $list $listText

    # ======================================================== F: a write it did not foresee
    $steamBefore = Snap $steam
    $env:STANDIN_ROGUE = 'meshes\ts\bench.nif'
    $r = Invoke-Build @()
    Remove-Item Env:\STANDIN_ROGUE
    Yes 'F: a tool writing a shared file in place is caught and refused' ($r.Code -eq 1 -and $r.Out -match 'BodySlide wrote into 1 file\(s\) this folder shares with another \(Data\\meshes\\ts\\bench\.nif\)')
    Yes 'F: and nothing is recorded' ((Text $record) -eq $recBefore)
    Yes '(F: the stand-in really did write through: the Steam copy''s file changed with it)' ((Text (Join-Path $steam 'Data\meshes\ts\bench.nif')) -eq 'ROGUE')
    foreach ($p in (Join-Path $staging 'TDM\meshes\ts\bench.nif')) { [IO.File]::WriteAllText($p, 'VORTEX-BENCH') }

    # ======================================================== G: Pandora's refusals
    foreach ($case in @(
        @('its log has an error', 'STANDIN_PANDORA_ERROR', "Pandora's log has errors"),
        @('it writes into the game folder', 'STANDIN_PANDORA_INTO_DATA', 'Pandora wrote into the game folder itself'),
        @('it deletes from the game folder', 'STANDIN_PANDORA_DELETE', 'Pandora wrote into the game folder itself'))) {
        Set-Item -Path ('Env:\' + $case[1]) -Value '1'
        $gameBefore = Snap $game
        $r = Invoke-Build @()
        Remove-Item -Path ('Env:\' + $case[1])
        Yes ('G: when ' + $case[0] + ', it is refused and nothing is recorded') ($r.Code -eq 1 -and $r.Out.Contains($case[2]) -and (Text $record) -eq $recBefore)
        Yes ('G: when ' + $case[0] + ', nothing Pandora made is put in the folder') ((Text $beh) -eq 'PANDORA colis tdmh tdmlen tdmv' -and (Test-Path -LiteralPath (Join-Path $own 'build-generated')) -eq $false)
    }
    [void][GenTestIds]::CreateHardLink((Join-Path $game 'Data\meshes\ts\bench.nif'), (Join-Path $staging 'TDM\meshes\ts\bench.nif'), [IntPtr]::Zero)
    Remove-Item -LiteralPath (Join-Path $game 'Data\meshes\pandora_stray.txt') -ErrorAction SilentlyContinue
    $env:STANDIN_HANG = '1'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-Build @('-StallSeconds', '6')
    Remove-Item Env:\STANDIN_HANG
    Yes ('G: a Pandora that sits using nothing and writing nothing is stopped by the stall check (' + [int]$sw.Elapsed.TotalSeconds + ' s)') (
        $r.Code -eq 1 -and $r.Out -match 'used almost no processor time and changed no file for 6 seconds' -and (Text $record) -eq $recBefore)
    # Path asks the process again on every read; read once, a process that has ended reads as "" (#4059).
    Yes 'G: and it is not left running' (@(Get-Process -ErrorAction SilentlyContinue | Where-Object { ([string]$_.Path).StartsWith($root, [StringComparison]::OrdinalIgnoreCase) }).Count -eq 0)
    $pExe = Join-Path $game 'Data\Pandora Behaviour Engine\Pandora Behaviour Engine+.exe'
    Rename-Item -LiteralPath $pExe -NewName 'aside.exe'
    $r = Invoke-Build @()
    Rename-Item -LiteralPath (Join-Path (Split-Path -Parent $pExe) 'aside.exe') -NewName 'Pandora Behaviour Engine+.exe'
    Yes 'G: with no Pandora in the folder it stops, and says it comes with collection revision 2' ($r.Code -eq 1 -and $r.Out -match 'Pandora Behaviour Engine\+ is not in this folder' -and $r.Out -match 'revision 2')
    # ======================================================== H: BodySlide aimed at the game
    $env:STANDIN_BS_INTO_GAME = '1'
    $r = Invoke-Build @()
    Remove-Item Env:\STANDIN_BS_INTO_GAME
    Yes 'H: BodySlide writing into the game folder itself is refused and not recorded' ($r.Code -eq 1 -and $r.Out -match 'BodySlide wrote into the game folder itself' -and (Text $record) -eq $recBefore)

    # ======================================================== I: no longer made
    Put $list ($listText.Replace(', "HIMBO Body - Vanilla Nevernude"', ''))
    $steamBefore = Snap $steam
    $r = Invoke-Build @()
    if ($r.Code -ne 0) { Write-Host $r.Out }
    $male = Join-Path $game ($A + 'malebody_1.nif')
    Yes 'I: a build that no longer makes the men''s body works' ($r.Code -eq 0)
    Yes 'I: and the men''s body in the folder is Vortex''s again, as its own copy' (
        (Get-FileHash -LiteralPath $male).Hash -eq (Get-FileHash -LiteralPath (Join-Path $staging ('HIMBO\' + $A.Substring(5) + 'malebody_1.nif'))).Hash -and [GenTestIds]::Links($male) -eq 1)
    $rec = Read-GeneratedRecord $record
    Yes 'I: and the record no longer lists it' (@($rec.Files | Where-Object { $_.Rel -like '*\malebody*' }).Count -eq 0 -and $rec.Files.Count -eq 5)
    Yes 'I: the Steam copy is untouched' (Same $steamBefore (Snap $steam))
    Put $list $listText

    # ======================================================== K: Pandora loose in Data
    # Its archive has no folder at the top, so Vortex may deploy its exe, its
    # libraries and its Pandora_Engine folder straight into Data. The script
    # then takes its files by Vortex's record of Pandora's mod.
    $looseMod = Join-Path $staging 'PandoraLoose'
    $looseFiles = @('Pandora Behaviour Engine+.exe', 'Pandora_Engine\Skyrim\Template\vanilla.txt', 'PatcherSupport.dll')
    Copy-Item -LiteralPath (Join-Path $bin 'pandora.exe') -Destination (New-Item -ItemType Directory -Force -Path $looseMod).FullName
    Rename-Item -LiteralPath (Join-Path $looseMod 'pandora.exe') -NewName 'Pandora Behaviour Engine+.exe'
    Put (Join-Path $looseMod 'Pandora_Engine\Skyrim\Template\vanilla.txt') 'TEMPLATE'
    Put (Join-Path $looseMod 'PatcherSupport.dll') 'SUPPORT'
    foreach ($rel in $looseFiles) {
        foreach ($into in (Join-Path $steam "Data\$rel"), (Join-Path $game "Data\$rel")) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $into) | Out-Null
            [void][GenTestIds]::CreateHardLink($into, (Join-Path $looseMod $rel), [IntPtr]::Zero)
        }
    }
    $manifest = Join-Path $steam 'Data\vortex.deployment.json'
    $keepManifest = Text $manifest
    $extra = @($looseFiles | ForEach-Object { '{{ "relPath": "{0}", "source": "PandoraLoose" }}' -f $_.Replace('\', '\\') }) -join ', '
    Put $manifest ($keepManifest.Replace('"files": [ ', '"files": [ ' + $extra + ', '))
    $looseRecord = (Text (Join-Path $own 'files.txt')).TrimEnd() + "`r`n"
    foreach ($rel in $looseFiles) { $looseRecord += ('L|V|123|1|Data\{0}' -f $rel) + "`r`n" }
    Put (Join-Path $own 'files.txt') $looseRecord
    $inFolder = Join-Path $game 'Data\Pandora Behaviour Engine'
    Move-Item -LiteralPath $inFolder -Destination (Join-Path $work 'pandora-folder-aside')
    [IO.File]::Delete($log)
    $steamBefore = Snap $steam
    $r = Invoke-Build @()
    if ($r.Code -ne 0) { Write-Host $r.Out }
    Yes 'K: with Pandora loose in Data, the build works, from a copy of the files Vortex''s record lists for it' (
        $r.Code -eq 0 -and (Log) -match '(?m)^pandora from .*\\build-generated\\pandora :' -and (Log) -match '(?m)^pandora active colis tdmh tdmlen tdmv\r?$')
    Yes 'K: and nothing of the Steam copy changed' (Same $steamBefore (Snap $steam))
    Yes 'K: its generated record starts current' ((Get-GeneratedState $root $list).Current)
    foreach ($rel in @('Pandora Behaviour Engine+.exe', 'PatcherSupport.dll')) {
        $row = 'L|V|123|1|Data\' + $rel
        Put (Join-Path $own 'files.txt') ($looseRecord.Replace($row, $row.Replace('|123|', '|456|')))
        $state = Get-GeneratedState $root $list
        Yes ('K: a changed loose Pandora input is stale: ' + $rel) (-not $state.Current -and ($state.Why -join ';') -match 'Pandora reads')
    }
    Put (Join-Path $own 'files.txt') $looseRecord
    Move-Item -LiteralPath (Join-Path $work 'pandora-folder-aside') -Destination $inFolder
    $r = Invoke-Build @('-DryRun')
    Yes 'K: with it in Data twice (loose and in its folder), which one runs cannot be told, so it stops' ($r.Code -eq 1 -and $r.Out -match 'more than once')
} finally {
    Remove-Item Env:\STANDIN_LOG -ErrorAction SilentlyContinue
    Get-Process -ErrorAction SilentlyContinue | Where-Object { ([string]$_.Path).StartsWith($work, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

# ============================================================ the real build list
. $Lib
$real = Get-GeneratedBuildList (Join-Path $Repo 'records\generated.json')
Yes 'records\generated.json builds the women''s NeverNude body and the men''s body with boxers (issue #405)' (
    $real.Sets -contains 'CBBE 3BBB Amazing NeverNude' -and $real.Sets -contains 'HIMBO Body - Vanilla Nevernude')
Yes 'and moves no slider, so every body is its set''s own default shape (issue #1004)' ($real.Sliders.Count -eq 0)
Yes 'the burned body is also rebuilt from the collection, replacing the old genital mesh' ($real.Sets -contains 'CBBE Vanilla - Body - Astrid')
Yes 'and generates with the four patches the releases were made with' (($real.Patches -join ',') -eq 'colis,tdmh,tdmlen,tdmv')
# The build itself is the launcher's (#3715), which Build-Generated.ps1 runs.
$buildText = [IO.File]::ReadAllText((Join-Path $Repo 'launcher\app\GeneratedBuild.cs'))
$wrapText = [IO.File]::ReadAllText($Build)
Yes 'Build-Generated.ps1 runs the launcher''s build, and builds nothing of its own' (
    $wrapText -match 'New-Object Thornswood\.GeneratedBuild' -and $wrapText -match '\$build\.Run\(\)' -and $wrapText -notmatch 'Invoke-Tool|Start-Process')
Yes 'the build never runs Nemesis: no -generate, no -update, no manual step' (
    $buildText -notmatch '"-generate"|"-update"|NemesisDone|Nemesis Unlimited Behavior Engine\.exe')
Yes 'and gives Pandora its folders by Settings.json beside a copy of it, the game folder''s Data and a work folder' (
    $buildText.Contains('File.WriteAllText(Path.Combine(pRun, "Settings.json")') -and $buildText.Contains('"gameDataPath\": ").Append(Json(data))') -and
    $buildText.Contains('"outputPath\": ").Append(Json(pOut))') -and $buildText.Contains('string pOut = Path.Combine(workDir, "pandora-out");'))
Yes 'the build never asks BodySlide for RaceMenu morph files' ($buildText -notmatch '"--trimorphs"|"-tri"')

Done
