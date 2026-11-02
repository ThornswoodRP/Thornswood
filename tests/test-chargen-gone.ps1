<#
  test-chargen-gone.ps1

      pwsh -NoProfile -File .\tests\test-chargen-gone.ps1

  The retired dresser, thornswood-chargen.js, is out of the repo, nothing that
  installs or ships the game names it except the rules that keep it out, every
  pack deletes it from the machines that already have it, and the launcher's
  own game folder does not copy it back in from the Steam copy afterwards.

  WHY. To Do List entry 127. On 20 September the dresser was found putting the
  best armour it could find into every empty slot five seconds after any pack
  change, which is Patrick's "it is auto equipping things sometimes, like a
  hat". It was retired that day (c529c67) to print one line and do nothing, and
  the entry left the rest as "delete the file and the four scripts that name it
  (Install-Emotes, Install-Thornswood, Revert, Check-Chargen), which is a small
  tidy".

  There were two copies, not one. game\plugins is where Ship takes the
  plugins from. tools\emotes is where Install-Emotes.ps1 and Revert.ps1 took it
  from, and that copy was the dresser from BEFORE it was retired, with no
  whose-game gate and its equipItem call intact, so running either script put
  the hat back on people.

  THE COPY THE LAUNCHER WOULD HAVE BROUGHT BACK. Found in review on 24
  September, while the first version of this harness passed 19 of 19. The
  Steam copy on Patrick's machine still has the dresser from before it was
  retired: 11,654 bytes, dated 16 Sep, pc.equipItem at line 210 and an update
  handler at line 238. Profile\OwnGame\files.txt in both roots lists it as
  C|O|11654, which is the launcher's record that the game folder's copy was
  built from that Steam copy file. OwnGame.Foreign called any thornswood-*.js
  ours, so once a pack deleted the game folder's copy and Keep.Forget the kept
  one, the next refresh found the name missing and copied the 16 Sep file in,
  and Keep.Seed took it for a kept copy at the next launcher start, because
  the 17 Sep and 20 Sep pack records list it and its time is older than
  theirs. Keep.Restore then put it back before every Play. That is the hat
  again. The first version read the O in that record as good news; it is the
  evidence that the Steam copy has the file.

  What it checks:
    1. Neither copy is in the repo, and no script, launcher source or plugin
       under tools names it, apart from OwnGame.cs and Ship-Rules.ps1, which
       name it to keep it out. Harnesses are left out of that search, since
       this one has to.
    2. Go.ps1's sweep of the plugin folder, lifted by text and run against a
       scratch folder, takes a leftover copy out and leaves ours and the
       client alone. Ship runs Go.ps1 into the shipping machine's game folder
       before it scans, so this is what takes it out of the folder a pack is
       made from.
    3. Ship-Rules never ships it and puts it on the list every pack deletes.
       Publish-Update.ps1's scan, diff, collection filter and that list,
       lifted by text the way test-ship-rules.ps1 does, name it in delete.txt
       whether or not the last pack carried it, and leave a copy still on the
       shipping machine out of the pack.
    4. The launcher side, compiled. OwnGame's Skip and Foreign, and Keep's
       Seed and Forget, are lifted by text out of the launcher source and
       compiled against stubs for Paths and Checks, with the .NET SDK the
       launcher builds with (Add-LauncherType, tests\Launcher-Csc.ps1, #2821,
       #4823), on every machine. OwnGame and Keep read the game's files by
       Windows paths, so from here 4 and 5 run on Windows only and say SKIP
       elsewhere. Then the whole sequence
       runs on scratch folders: a Steam copy holding the old dresser, a game
       folder and a kept copy holding the stub, the pack's delete.txt with
       Keep.Forget, a refresh modelled on OwnGame.Refresh's own loop, and
       Keep.Seed. At the end the dresser must be in neither the game folder
       nor the kept copies. A thornswood- plugin the game folder is missing
       must still come back and be kept, so the model is not testing nothing.
    5. On this machine, where it can: the Steam copy's file, which baselines
       carry it, and what the launcher's record says, read the right way.

  Read only, apart from scratch folders under TEMP that it removes.
#>
[CmdletBinding()]
param(
    [string]$Root = (& (Join-Path $PSScriptRoot '..\scripts\release\Where.ps1') Install),
    [string]$Steam = 'C:\Program Files (x86)\Steam\steamapps\common\Skyrim Special Edition'
)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$name = 'thornswood-chargen.js'
$rel  = 'Data\Platform\Plugins\' + $name

# ---- 1. the file and every name of it ------------------------------------------
Yes 'game\plugins no longer holds the retired dresser' (-not (Test-Path -LiteralPath (Join-Path $Here "game\plugins\$name")))

# The two files that name it to keep it out. Sections 3 and 4 check what they
# say about it.
# By path from the repository root. The scripts are in scripts\<area> and the
# launcher in launcher\ since issue #440; scripts\oneoff is parked history and
# still names the tools it once ran beside, so it is not read.
$repoRoot = $Here
function RepoRel($f) { return $f.FullName.Substring($repoRoot.Length).TrimStart('\', '/').Replace('/', '\') }
$keepsItOut = @('launcher\app\OwnGame.cs', 'scripts\release\Ship-Rules.ps1')
$sources = @()
foreach ($d in 'scripts', 'launcher', 'game\plugins', 'game\ui') {
    $p = Join-Path $repoRoot $d
    if (Test-Path -LiteralPath $p) {
        $sources += @(Get-ChildItem -LiteralPath $p -File -Recurse | Where-Object {
            $_.Extension -in '.ps1', '.js', '.cs', '.xaml', '.html' -and (RepoRel $_) -notlike 'scripts\oneoff\*' })
    }
}
$sources = @($sources | Where-Object { $_.Name -notlike 'test-*' })
$naming = @($sources | Where-Object {
    ($keepsItOut -notcontains (RepoRel $_)) -and
    ([IO.File]::ReadAllText($_.FullName)).IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
Yes ("no script, launcher source or plugin names it but the two rules that keep it out ({0} files read)" -f $sources.Count) ($naming.Count -eq 0)
foreach ($n in $naming) { Write-Host ('      still named in ' + (RepoRel $n)) }

# Not $keep: the Go.ps1 block lifted below has a $keep of its own.
$keepCs = [IO.File]::ReadAllText((Join-Path $Here 'launcher\app\Keep.cs'))
Yes 'Keep.cs still calls any thornswood-*.js in the plugin folder ours, so a copy not yet removed is never parked' ($keepCs.IndexOf('name.StartsWith("thornswood-"', [StringComparison]::Ordinal) -ge 0)

# ---- 2. Go.ps1 takes a leftover copy out of the game folder ---------------------
$go = [IO.File]::ReadAllText((Join-Path $Here 'scripts\release\Go.ps1'))
$sweep = [regex]::Match($go, '(?ms)^\$keep = @\(''skymp5-client\.js''.*?^\}\r?$')
Yes 'Go.ps1 still builds its keep list from game\plugins and sweeps the plugin folder against it' ($sweep.Success -and $sweep.Value.Contains('Remove-Item -LiteralPath $s.FullName'))

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-chargen-gone-' + [Diagnostics.Process]::GetCurrentProcess().Id)
$ours = @(Get-ChildItem -LiteralPath (Join-Path $Here 'game\plugins') -Filter *.js -File | ForEach-Object { $_.Name })
try {
    if ($sweep.Success) {
        $plugins = Join-Path $scratch 'Data\Platform\Plugins'
        New-Item -ItemType Directory -Force -Path $plugins | Out-Null
        $there = @('skymp5-client.js', 'skymp5-client-settings.txt', $name) + $ours
        foreach ($n in ($there | Select-Object -Unique)) { [IO.File]::WriteAllText((Join-Path $plugins $n), 'x') }
        $plSrc = Join-Path $Here 'game\plugins'
        function Bad($t) { }
        . ([scriptblock]::Create($sweep.Value))
        $left = @(Get-ChildItem -LiteralPath $plugins -File | ForEach-Object { $_.Name })
        Yes 'the sweep takes a leftover thornswood-chargen.js out of the game folder' ($left -notcontains $name)
        Yes ('and leaves the client, its settings and our {0} plugin(s) where they are' -f $ours.Count) (
            ($left -contains 'skymp5-client.js') -and ($left -contains 'skymp5-client-settings.txt') -and
            (@($ours | Where-Object { $left -notcontains $_ }).Count -eq 0))
    }
} finally {
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}

# ---- 3. every pack names it in delete.txt, and none carries it -------------------
. (Join-Path $Here 'scripts\release\Ship-Rules.ps1')
Yes 'Ship-Rules calls it not ours, so no pack or installer carries it again' (Test-ShipOtherServer $rel)
Yes 'and it is on the list every pack deletes, which is what gets it past that rule into delete.txt' (@(Get-ShipDeleteAlways) -contains $rel)
Yes 'and it is not a runtime path' (-not (Test-ShipRuntime $rel))
Yes 'our own plugins are still ours to ship' (@($ours | Where-Object { Test-ShipMachine ('Data\Platform\Plugins\' + $_) }).Count -eq 0)

$pub = [IO.File]::ReadAllText((Join-Path $Here 'scripts\release\Publish-Update.ps1'))
$tm   = [regex]::Match($pub, '(?m)^function Test-Machine\(.*$')
$fc   = [regex]::Match($pub, '(?ms)^function Test-FromCollection\(.*?^\}\r?$')
# What Test-FromCollection reads beside the collection record: the files
# Thornswood generated itself (#1247). It replaced $DevShipsOurs in #1177,
# when Thornswood-Content.esp became ours on every channel.
$diff = [regex]::Match($pub, '(?ms)^\$changed = @\(\); \$removed = @\(\)\r?$.*?^\$removed\s+= @\(\$removed \| Where-Object \{[^\r\n]*Test-Machine[^\r\n]*\r?$')
$coll = [regex]::Match($pub, '(?ms)^\$collectionRemovals = .*?^\}\r?$')
$alw  = [regex]::Match($pub, '(?ms)^\$alwaysGone = @\(Get-ShipDeleteAlways\)\r?\nforeach \(\$d in \$alwaysGone\) \{.*?^\}\r?$')
Yes 'Publish-Update.ps1 still has Test-Machine, Test-FromCollection, the diff, the collection filter and the always list to lift' (
    $tm.Success -and $fc.Success -and $diff.Success -and $coll.Success -and $alw.Success)
Yes 'and its scan still leaves out what Test-Machine claims' ($pub -match 'if \(Test-Machine \$rel\) \{ continue \}')
Yes 'and it adds the always list after the collection filter, so no record of the collection can drop it' (
    $alw.Success -and $coll.Success -and $alw.Index -gt $coll.Index)
Yes 'and still writes every removal into delete.txt' ($pub.Contains('foreach ($rel in $removed) { $sw.WriteLine(($rel -replace ''\\'', ''/'')) }'))
if (-not ($tm.Success -and $fc.Success -and $diff.Success -and $coll.Success -and $alw.Success)) { Done }
. ([scriptblock]::Create($tm.Value))
. ([scriptblock]::Create($fc.Value))
# A profile with no generated record: nothing generated, so the list is empty.
$ProfileDir = Join-Path ([IO.Path]::GetTempPath()) ('ts-chargen-profile-' + [Guid]::NewGuid().ToString('N'))

# A dev pack, as Ship -Channel dev makes one. The collection record is a made
# up one that claims a texture and nothing of ours. The shipping machine's
# folder has our plugins, and in the second run a copy of the dresser that
# nothing swept, which the scan has to leave out the way Publish-Update's does.
$Dev = $true
$vortexFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
[void]$vortexFiles.Add('Data\textures\gone\collection.dds')
function Pack([bool]$lastCarried, [bool]$stillHere) {
    $script:prev = @{}
    if ($lastCarried) { $script:prev[$rel] = '11654:639252007700000000' }
    $script:prev['Data\textures\gone\collection.dds'] = '10:1'
    $onDisk = @()
    foreach ($o in $ours) { $script:prev['Data\Platform\Plugins\' + $o] = '10:1'; $onDisk += ('Data\Platform\Plugins\' + $o) }
    if ($stillHere) { $onDisk += $rel }
    $script:now = @{}
    foreach ($r in $onDisk) {
        if (Test-Machine $r) { continue }
        $script:now[$r] = '10:1'
    }
}
Pack $true $false
. ([scriptblock]::Create($diff.Value))
. ([scriptblock]::Create($coll.Value))
. ([scriptblock]::Create($alw.Value))
Yes 'a pack after one that carried it names it in delete.txt' ($removed -contains $rel)
Yes 'and removes none of our plugins that are still there' (@($removed | Where-Object { $_ -like 'Data\Platform\Plugins\thornswood-*' -and $_ -ne $rel }).Count -eq 0)
Yes 'the lifted collection filter is live: a collection file that went is not removed' ($removed -notcontains 'Data\textures\gone\collection.dds')
$delete = @($removed | ForEach-Object { $_ -replace '\\', '/' })

Pack $false $true
. ([scriptblock]::Create($diff.Value))
. ([scriptblock]::Create($coll.Value))
. ([scriptblock]::Create($alw.Value))
Yes 'a pack whose baseline never carried it still names it in delete.txt' ($removed -contains $rel)
Yes 'and a copy still on the shipping machine does not go into the pack' ((-not $now.ContainsKey($rel)) -and ($changed -notcontains $rel))

$upd = [IO.File]::ReadAllText((Join-Path $Here 'launcher\app\Updater.cs'))
Yes 'Updater deletes each delete.txt line from the game folder and remembers it as removed' (
    $upd.Contains('ar.GetEntry("delete.txt")') -and $upd.Contains('File.Delete(target)') -and $upd.Contains('removed.Add(rel);'))
Yes 'and hands that list to Keep.Forget, so Keep does not put the file back at the next Play' ($upd.Contains('Keep.Forget(removed);'))

# ---- 4. the launcher's own folder does not bring it back -------------------------
#
# The text of one member of a C# class, from its declaration to the brace that
# closes it, stepping over braces inside strings, characters and comments.
function Get-CsMember([string]$text, [string]$declaration) {
    $at = $text.IndexOf($declaration, [StringComparison]::Ordinal)
    if ($at -lt 0) { return $null }
    $i = $text.IndexOf('{', $at + $declaration.Length)
    if ($i -lt 0) { return $null }
    $depth = 0
    while ($i -lt $text.Length) {
        $c = $text[$i]
        $n = if ($i + 1 -lt $text.Length) { $text[$i + 1] } else { [char]0 }
        if ($c -eq '/' -and $n -eq '/') { $i = $text.IndexOf("`n", $i); if ($i -lt 0) { return $null }; continue }
        if ($c -eq '/' -and $n -eq '*') { $i = $text.IndexOf('*/', $i + 2); if ($i -lt 0) { return $null }; $i += 2; continue }
        if ($c -eq '@' -and $n -eq '"') {
            $i += 2
            while ($i -lt $text.Length) {
                if ($text[$i] -eq '"') { if ($i + 1 -lt $text.Length -and $text[$i + 1] -eq '"') { $i += 2; continue }; break }
                $i++
            }
            $i++; continue
        }
        if ($c -eq '"' -or $c -eq "'") {
            $q = $c; $i++
            while ($i -lt $text.Length -and $text[$i] -ne $q) { if ($text[$i] -eq '\') { $i++ }; $i++ }
            $i++; continue
        }
        if ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') {
            $depth--
            if ($depth -eq 0) { return $text.Substring($at, $i + 1 - $at) }
        }
        $i++
    }
    return $null
}
function Get-CsLine([string]$text, [string]$pattern) {
    $m = [regex]::Match($text, $pattern)
    if ($m.Success) { return $m.Value.Trim() }
    return $null
}

$og = [IO.File]::ReadAllText((Join-Path $Here 'launcher\app\OwnGame.cs'))
$ck = [IO.File]::ReadAllText((Join-Path $Here 'launcher\app\Checks.cs'))
$lifted = [ordered]@{
    'OwnGame.Skip'             = Get-CsMember $og 'static string Skip(string rel)'
    'OwnGame.CrashesUs'        = Get-CsMember $og 'static bool CrashesUs(string rel)'
    'OwnGame.RetiredFiles'     = (Get-CsMember $og 'static readonly string[] RetiredFiles =') + ';'
    'OwnGame.Retired'          = Get-CsMember $og 'static bool Retired(string rel)'
    'OwnGame.BodyShapeFiles'   = (Get-CsMember $og 'static readonly string[] BodyShapeFiles =') + ';'
    'OwnGame.BodyShape'        = Get-CsMember $og 'static bool BodyShape(string rel)'
    'OwnGame.BethesdaToolDirs'  = (Get-CsMember $og 'static readonly string[] BethesdaToolDirs =') + ';'
    'OwnGame.BethesdaToolFiles' = (Get-CsMember $og 'static readonly string[] BethesdaToolFiles =') + ';'
    'OwnGame.BethesdaTool'      = Get-CsMember $og 'static bool BethesdaTool(string rel)'
    'OwnGame.Parked'          = Get-CsMember $og 'static bool Parked(string rel)'
    'OwnGame.wantedPlugins'    = Get-CsLine $og '(?m)^\s*static HashSet<string> wantedPlugins = [^\r\n]*;'
    'OwnGame.UnwantedCreation' = Get-CsMember $og 'static bool UnwantedCreation(string rel)'
    'OwnGame.ClientFiles'      = (Get-CsMember $og 'public static readonly string[] ClientFiles =') + ';'
    'OwnGame.ClientFile'       = Get-CsMember $og 'public static bool ClientFile(string rel)'
    'OwnGame.UiAssetsRel'      = Get-CsLine $og '(?m)^\s*const string UiAssetsRel = [^\r\n]*;'
    'OwnGame.UiHashedName'     = Get-CsLine $og '(?m)^\s*static readonly Regex UiHashedName = [^\r\n]*;'
    'OwnGame.uiHashedOursField' = Get-CsLine $og '(?m)^\s*static HashSet<string> uiHashedOurs;'
    'OwnGame.uiHashedWalkRoot' = Get-CsLine $og '(?m)^\s*static string uiHashedWalkRoot = [^\r\n]*;'
    'OwnGame.uiGoneRecordText' = Get-CsLine $og '(?m)^\s*static string uiGoneRecordText;'
    'OwnGame.uiGoneLeaves'     = Get-CsLine $og '(?m)^\s*static HashSet<string> uiGoneLeaves;'
    'OwnGame.uiGoneHashes'     = Get-CsLine $og '(?m)^\s*static HashSet<string> uiGoneHashes;'
    'OwnGame.ReadUiGoneRecord' = Get-CsMember $og 'static string ReadUiGoneRecord()'
    'OwnGame.EnsureUiGone'     = Get-CsMember $og 'static void EnsureUiGone()'
    'OwnGame.UiGoneLeaf'       = Get-CsMember $og 'static bool UiGoneLeaf(string leaf)'
    'OwnGame.UiFileSha256'     = Get-CsMember $og 'static string UiFileSha256(string full, out bool unreadable)'
    'OwnGame.UiGoneHashRoots'  = Get-CsMember $og 'static List<string> UiGoneHashRoots()'
    'OwnGame.UiGoneByHash'     = Get-CsMember $og 'static bool UiGoneByHash(string rel)'
    'OwnGame.UiHashedAssetName' = Get-CsMember $og 'static bool UiHashedAssetName(string leaf)'
    'OwnGame.ResetUiHashedOurs' = Get-CsMember $og 'static void ResetUiHashedOurs()'
    'OwnGame.LoadUiHashedList' = Get-CsMember $og 'static void LoadUiHashedList(HashSet<string> set, string path)'
    'OwnGame.LoadUiHashedFromRoot' = Get-CsMember $og 'static void LoadUiHashedFromRoot(HashSet<string> set, string root)'
    'OwnGame.UiHashedOurs'     = Get-CsMember $og 'static HashSet<string> UiHashedOurs()'
    'OwnGame.Foreign'          = Get-CsMember $og 'public static bool Foreign(string rel)'
    'Checks.OffSuffix'         = Get-CsLine $ck '(?m)^\s*public const string OffSuffix = "[^"\r\n]*";'
    'Keep.Platform'            = Get-CsLine $keepCs '(?m)^\s*const string Platform = [^\r\n]*;'
    'Keep.PluginDir'           = Get-CsLine $keepCs '(?m)^\s*const string PluginDir = [^\r\n]*;'
    'Keep.Dir'                 = Get-CsMember $keepCs 'public static string Dir'
    'Keep.UnderPlatform'       = Get-CsMember $keepCs 'static bool UnderPlatform(string rel)'
    'Keep.Forget'              = Get-CsMember $keepCs 'public static int Forget(IEnumerable<string> rels)'
    'Keep.Seed'                = Get-CsMember $keepCs 'public static int Seed()'
}
$missing = @($lifted.Keys | Where-Object { [string]::IsNullOrEmpty($lifted[$_]) -or $lifted[$_] -eq ';' })
Yes ('the launcher members this runs are all still there to lift ({0})' -f $lifted.Count) ($missing.Count -eq 0)
foreach ($m in $missing) { Write-Host "      not found: $m" }
if ($missing.Count) { Done }

$ns = 'TsChargenGone' + [Diagnostics.Process]::GetCurrentProcess().Id
$cs = @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
namespace $ns
{
    public static class Paths { public static string PacksDir; public static string ProfileDir; public static string Game; }
    // Stands in for launcher\app\Swallow.cs, which the lifted Keep.Forget
    // calls from its catch blocks since the silent catches were given a log
    // line (#461).
    public static class Swallow { public static void Note(string where, Exception e) { } }
    public static class Checks
    {
        $($lifted['Checks.OffSuffix'])
    }
    public static class OwnGame
    {
        $($lifted['OwnGame.Skip'])
        $($lifted['OwnGame.CrashesUs'])
        $($lifted['OwnGame.RetiredFiles'])
        $($lifted['OwnGame.Retired'])
        $($lifted['OwnGame.BodyShapeFiles'])
        $($lifted['OwnGame.BodyShape'])
        $($lifted['OwnGame.BethesdaToolDirs'])
        $($lifted['OwnGame.BethesdaToolFiles'])
        $($lifted['OwnGame.BethesdaTool'])
        $($lifted['OwnGame.Parked'])
        $($lifted['OwnGame.wantedPlugins'])
        $($lifted['OwnGame.UnwantedCreation'])
        $($lifted['OwnGame.ClientFiles'])
        $($lifted['OwnGame.ClientFile'])
        $($lifted['OwnGame.UiAssetsRel'])
        $($lifted['OwnGame.UiHashedName'])
        $($lifted['OwnGame.uiHashedOursField'])
        $($lifted['OwnGame.uiHashedWalkRoot'])
        $($lifted['OwnGame.uiGoneRecordText'])
        $($lifted['OwnGame.uiGoneLeaves'])
        $($lifted['OwnGame.uiGoneHashes'])
        $($lifted['OwnGame.ReadUiGoneRecord'])
        $($lifted['OwnGame.EnsureUiGone'])
        $($lifted['OwnGame.UiGoneLeaf'])
        $($lifted['OwnGame.UiFileSha256'])
        $($lifted['OwnGame.UiGoneHashRoots'])
        $($lifted['OwnGame.UiGoneByHash'])
        $($lifted['OwnGame.UiHashedAssetName'])
        $($lifted['OwnGame.ResetUiHashedOurs'])
        $($lifted['OwnGame.LoadUiHashedList'])
        $($lifted['OwnGame.LoadUiHashedFromRoot'])
        $($lifted['OwnGame.UiHashedOurs'])
        $($lifted['OwnGame.Foreign'])
        public static string SkipOf(string rel) { return Skip(rel); }
        public static void ResetUiHashedOursForTest() { ResetUiHashedOurs(); }
        public static void SetUiGoneRecordForTest(string text) {
            uiGoneRecordText = text;
            uiGoneLeaves = null;
            uiGoneHashes = null;
        }
    }
    public static class Keep
    {
        $($lifted['Keep.Platform'])
        $($lifted['Keep.PluginDir'])
        $($lifted['Keep.Dir'])
        $($lifted['Keep.UnderPlatform'])
        $($lifted['Keep.Forget'])
        $($lifted['Keep.Seed'])
    }
}
"@
$compiled = $true
try { $null = Add-LauncherType -Source $cs }
catch { $compiled = $false; Write-Host ('      ' + $_.Exception.Message) }
Yes 'OwnGame''s Skip and Foreign and Keep''s Seed and Forget compile as lifted, with the .NET SDK the launcher builds with' $compiled
if (-not $compiled) { Done }

$rulesNum = [regex]::Match($og, '(?m)^\s*const int Rules = (\d+);')
$rulesDoc = [regex]::Match($og, '(?m)^\s*/// (\d+): the retired dresser, thornswood-chargen\.js')
# At least the dresser's number, not equal to it: rules 5 and 6 (#640 and the
# Distribution links) moved Rules on past it on purpose, and a folder made
# under anything before 4 still refreshes once.
Yes 'OwnGame.Rules moved for it, so every folder made under the old rules refreshes once and records it as left out' (
    $rulesNum.Success -and $rulesDoc.Success -and [int]$rulesNum.Groups[1].Value -ge [int]$rulesDoc.Groups[1].Value)

# The model of Refresh below has two branches: a name Skip lets through that
# the folder lacks is copied in, and one it holds is left alone. That is only
# true while Refresh's own loop reads that way.
$refresh = Get-CsMember $og 'static string RefreshNow(Config cfg, Action<string> say)'
$order = @(
    'foreach (Found f in all)',
    'string skip = Skip(f.Rel);',
    'if (skip != null) { left.Add(f.Rel + "  (" + skip + ")"); continue; }',
    'bool exists = File.Exists(dest);',
    'if (exists && (',
    'if (exists) DropName(dest);',
    # f.From since the Vortex folder fix: each file is placed from where Gather
    # found it, which is the Steam copy for the game and Vortex's mods folder
    # for what Vortex deployed. The loop's shape, and so this model, is the same.
    'Place(f.From, dest, copy, out asLink);'
)
$inOrder = $null -ne $refresh
$from = 0
foreach ($o in $order) {
    if (-not $inOrder) { break }
    $at = $refresh.IndexOf($o, $from, [StringComparison]::Ordinal)
    if ($at -lt 0) { $inOrder = $false; Write-Host "      Refresh no longer has: $o" } else { $from = $at + $o.Length }
}
Yes 'OwnGame.Refresh still asks Skip first and copies in whatever it lets through that the folder lacks' $inOrder
$place = Get-CsMember $og 'static void Place(string from, string to, bool copy, out bool linked)'
Yes 'and Place copies a script with File.Copy, which keeps the Steam copy''s write time' ($null -ne $place -and $place.Contains('File.Copy(from, to, false);'))

# OwnGame and Keep name the game's files by Windows paths (Path.GetFileName on
# Data\Platform\..., Path.Combine with Data\...), so they are asked and run on
# Windows only; the build above and the source checks run everywhere.
if (-not $OnWindows) {
    Write-Host 'SKIP  4 and 5, OwnGame''s Skip and Foreign and Keep''s Seed and Forget asked and run on scratch folders, and this machine''s Steam copy and records: OwnGame and Keep read and lay out the game''s files by Windows paths, so they run on Windows only'
    Done
}
$OwnGameT = [type]($ns + '.OwnGame')
$KeepT    = [type]($ns + '.Keep')
$PathsT   = [type]($ns + '.Paths')

# Foreign on a UI path loads the gone record. The lifted type has no
# embedded copy, so the override must be in place before those paths.
$goneText = [IO.File]::ReadAllText((Join-Path $Here 'records\ui-gone.json'))
$OwnGameT::SetUiGoneRecordForTest($goneText)

Yes 'OwnGame.Foreign calls the dresser not ours' ($OwnGameT::Foreign($rel))
Yes 'so a refresh leaves it out of the game folder' ($null -ne $OwnGameT::SkipOf($rel))
Yes ('and still takes our {0} plugin(s)' -f $ours.Count) (@($ours | Where-Object { $null -ne $OwnGameT::SkipOf('Data\Platform\Plugins\' + $_) }).Count -eq 0)

# OwnGame.Foreign and Test-ShipOtherServer are one rule in two languages. The
# bundle is left out of this: Ship-Rules calls it ours by record, and OwnGame
# answers it before Foreign as a ClientFile.
$twins = @($rel, 'Data\Platform\Plugins\somebody-else.js', 'Data\Interface\map.swf',
           # #690: Elysium Estate's old plugin is left out, the collection's is not.
           'Data\ElysiumEstateSSE.esp', 'Data\ElysiumEstate.esp',
           'Data\Platform\UI\assets\app-1.js', 'Data\Platform\UI\thornswood-chat.js',
           # #1318: another server's menu and unused fork assets are left out;
           # the two keeps still ship.
           'Data\Platform\UI\menu_theme.mp3', 'Data\Platform\UI\bg.png',
           'Data\Platform\UI\thornswood-menu.jpg', 'Data\Platform\UI\thornswood-theme.mp3',
           'Data\Platform\UI\logo.png',
           'Data\Platform\PluginsNoLoad\auth-data-no-load.js',
           # #960: SkyUI 5.2's loose scripts are left out, MCM Recorder's are not.
           'Data\Scripts\ski_main.pex', 'Data\Scripts\SKI_WidgetManager.pex',
           'Data\Scripts\SKI_ConfigBase.pex', 'Data\Scripts\ski_configmanager.pex')
$twins += @($ours | ForEach-Object { 'Data\Platform\Plugins\' + $_ })
$apart = @($twins | Where-Object { [bool]$OwnGameT::Foreign($_) -ne [bool](Test-ShipOtherServer $_) })
Yes ('OwnGame.Foreign and Test-ShipOtherServer agree on all {0} paths asked, the dresser among them' -f $twins.Count) ($apart.Count -eq 0)
foreach ($a in $apart) { Write-Host "      they disagree on $a" }

# OwnGame reads the pack list. A listed hashed name is ours. An install
# with no list yet must not drop hashed front assets on a refresh. The
# Daedric set and unused fork assets stay out either way, from the same
# records\ui-gone.json Ship-Rules loaded.
$uiOwn = Join-Path ([IO.Path]::GetTempPath()) ('ts-ui-own-' + [Diagnostics.Process]::GetCurrentProcess().Id)
try {
    $uiGame = Join-Path $uiOwn 'Game'
    $uiProf = Join-Path $uiOwn 'Profile'
    New-Item -ItemType Directory -Force -Path (Join-Path $uiGame 'Data\Platform\UI') | Out-Null
    New-Item -ItemType Directory -Force -Path $uiProf | Out-Null
    $listed = 'cafebabeface0123.png'
    $otherHashed = 'deadbeefdeadbeef.png'
    $fontRel = 'Data\Platform\UI\' + $listed
    $otherRel = 'Data\Platform\UI\' + $otherHashed
    $daedricJpg = @($ShipDaedricMenu.Keys | Where-Object { $_ -like '*.jpg' } | Select-Object -First 1)[0]
    $daedricTtf = @($ShipDaedricMenu.Keys | Where-Object { $_ -like '*.ttf' } | Select-Object -First 1)[0]
    $unusedSvg  = @($ShipUnusedFrontAssets | Where-Object { $_ -like '*.svg' } | Select-Object -First 1)[0]
    $savedGame = $PathsT::Game
    $savedProf = $PathsT::ProfileDir
    $PathsT::Game = $null
    $PathsT::ProfileDir = $null
    $OwnGameT::ResetUiHashedOursForTest()
    Yes 'OwnGame: with no ui-assets list yet, a hashed front asset is ours so a refresh cannot drop it' (-not $OwnGameT::Foreign($fontRel))
    Yes '  and a non-hash bare name like logo.png is still not ours' ($OwnGameT::Foreign('Data\Platform\UI\logo.png'))
    Yes '  and a Daedric jpg is not ours, even with no list' ($OwnGameT::Foreign('Data\Platform\UI\' + $daedricJpg))
    Yes '  and a Daedric ttf is not ours, even with no list' ($OwnGameT::Foreign('Data\Platform\UI\' + $daedricTtf))
    Yes '  and an unused fork svg is not ours, even with no list' ($OwnGameT::Foreign('Data\Platform\UI\' + $unusedSvg))

    $PathsT::Game = $uiGame
    $PathsT::ProfileDir = $uiProf
    $renamedRel = 'Data\Platform\UI\abcdef0123456789.jpg'
    $renamedFull = Join-Path $uiGame $renamedRel
    [IO.File]::WriteAllText($renamedFull, 'daedric-renamed-copy')
    $renamedSha = Get-ShipFileSha256 $renamedFull
    $injected = $goneText.Replace('"daedric": {', ('"daedric": { "zz-test.jpg": "' + $renamedSha + '",'))
    $OwnGameT::SetUiGoneRecordForTest($injected)
    $OwnGameT::ResetUiHashedOursForTest()
    Yes '  and a renamed Daedric file is caught by hash, even with no list' ($OwnGameT::Foreign($renamedRel))

    # Unreadable hashed file, still no list. The old fail-open treated a
    # hashed name as ours when the list was missing, so this case would
    # pass that code. With a list, a hashed name not on it is already
    # not ours even without the unreadable check.
    $OwnGameT::SetUiGoneRecordForTest($goneText)
    $lockedRel = 'Data\Platform\UI\fedcba9876543210.jpg'
    $lockedFull = Join-Path $uiGame $lockedRel
    [IO.File]::WriteAllText($lockedFull, 'hashed-but-unreadable')
    $lock = [IO.File]::Open($lockedFull, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    try {
        $OwnGameT::ResetUiHashedOursForTest()
        Yes '  and an unreadable hashed UI file is not ours, even with no list' ($OwnGameT::Foreign($lockedRel))
    } finally { $lock.Dispose() }

    $listPath = Join-Path $uiGame 'Data\Platform\UI\thornswood-ui-assets.txt'
    [IO.File]::WriteAllLines($listPath, @('# hashed assets build.js named, #1318', $listed))
    $OwnGameT::ResetUiHashedOursForTest()
    Yes 'OwnGame counts a listed hashed name as ours' (-not $OwnGameT::Foreign($fontRel))
    Yes '  and a hashed name the list does not carry is not ours' ($OwnGameT::Foreign($otherRel))
    Yes '  and a Daedric jpg is still not ours when a ui-assets list is present' ($OwnGameT::Foreign('Data\Platform\UI\' + $daedricJpg))

    $lock = [IO.File]::Open($lockedFull, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    try {
        $OwnGameT::ResetUiHashedOursForTest()
        Yes '  and an unreadable hashed UI file is not ours' ($OwnGameT::Foreign($lockedRel))
    } finally { $lock.Dispose() }

    $OwnGameT::SetUiGoneRecordForTest($null)
    $missingThrew = $false
    $missingSaid = ''
    try { [void]$OwnGameT::Foreign($fontRel) } catch { $missingThrew = $true; $missingSaid = $_.Exception.Message }
    Yes 'OwnGame refuses when the gone record is missing' ($missingThrew -and ($missingSaid -match 'ui-gone\.json'))

    $OwnGameT::SetUiGoneRecordForTest('{ "not": "the gone set" }')
    $corruptThrew = $false
    $corruptSaid = ''
    try { [void]$OwnGameT::Foreign($fontRel) } catch { $corruptThrew = $true; $corruptSaid = $_.Exception.Message }
    Yes '  and refuses when the gone record is corrupt' ($corruptThrew -and ($corruptSaid -match 'ui-gone\.json'))

    # Empty embedded record. SetUiGoneRecordForTest('') is IsNullOrEmpty, so
    # ReadUiGoneRecord falls through to the missing-resource path. A second
    # compile of the lifted OwnGame with a 0-byte ui-gone.json is the empty
    # ReadToEnd branch.
    $emptyNs = $ns + 'Empty'
    $csEmpty = $cs.Replace("namespace $ns", "namespace $emptyNs")
    $emptyDir = Join-Path $uiOwn 'empty-gone'
    New-Item -ItemType Directory -Force -Path $emptyDir | Out-Null
    $emptyRes = Join-Path $emptyDir 'ui-gone.json'
    [IO.File]::WriteAllBytes($emptyRes, [byte[]]@())
    $emptyDriver = @"
using System;
namespace $emptyNs {
    static class EmptyGoneProgram {
        static int Main() {
            try {
                Console.Write(OwnGame.Foreign("Data\\Platform\\UI\\cafebabeface0123.png"));
                return 2;
            } catch (Exception ex) {
                Console.Write(ex.Message ?? "");
                return 0;
            }
        }
    }
}
"@
    $emptyExe = $null
    try { $emptyExe = Build-LauncherCode -Exe -Main ($emptyNs + '.EmptyGoneProgram') -Source $csEmpty, $emptyDriver -Resource @{ 'ui-gone.json' = $emptyRes } }
    catch { Write-Host ('      ' + $_.Exception.Message.Trim()) }
    Yes 'the lifted OwnGame with an empty ui-gone.json embedded builds with the .NET SDK the launcher builds with' ($null -ne $emptyExe)
    $emptySaid = ''
    if ($emptyExe) { $emptySaid = Invoke-LauncherExe $emptyExe 2>&1 | Out-String }
    Yes 'OwnGame refuses when the embedded gone record is empty' (
        $emptySaid -match 'is empty' -and $emptySaid -match 'ui-gone\.json')

    $OwnGameT::SetUiGoneRecordForTest($goneText)
    $PathsT::Game = $savedGame
    $PathsT::ProfileDir = $savedProf
    $OwnGameT::ResetUiHashedOursForTest()
} finally {
    Remove-Item -LiteralPath $uiOwn -Recurse -Force -ErrorAction SilentlyContinue
}

# The sequence, on scratch folders. Times are the ones measured on Patrick's
# machine: the Steam copy's dresser 16 Sep 18:12:50 MDT, the stub 20 Sep
# 19:01:45 MDT, the two pack records that list it 18 Sep 04:34 and 21 Sep
# 03:05 UTC. Our front and mark plugins stand in for the rest. The game folder
# is missing thornswood-mark.js, which the refresh has to bring back.
function Utc($y, $mo, $d, $h, $mi, $s) { return (New-Object DateTime $y, $mo, $d, $h, $mi, $s, ([DateTimeKind]::Utc)) }
function Put([string]$path, [string]$text, [DateTime]$when) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text)
    [IO.File]::SetLastWriteTimeUtc($path, $when)
}
$front = 'Data\Platform\Plugins\thornswood-front.js'
$mark  = 'Data\Platform\Plugins\thornswood-mark.js'
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-chargen-back-' + [Diagnostics.Process]::GetCurrentProcess().Id)
try {
    $src     = Join-Path $scratch 'Steam'
    $game    = Join-Path $scratch 'Game'
    # Not $profile, which PowerShell already means as something else.
    $prof    = Join-Path $scratch 'Profile'
    $packs   = Join-Path $prof 'Packs'
    $kept    = Join-Path $prof 'Keep'
    $PathsT::PacksDir = $packs
    $PathsT::ProfileDir = $prof
    $PathsT::Game = $game

    Put (Join-Path $src $rel)   "// the dresser from before it was retired`r`npc.equipItem(item.form, false, true);`r`n" (Utc 2026 9 17 0 12 50)
    Put (Join-Path $src $front) 'front' (Utc 2026 9 17 0 0 0)
    Put (Join-Path $src $mark)  'mark'  (Utc 2026 9 17 0 0 0)
    Put (Join-Path $game $rel)   '// RETIRED' (Utc 2026 9 21 1 1 45)
    Put (Join-Path $game $front) 'front' (Utc 2026 9 17 0 0 0)
    Put (Join-Path $kept $rel)   '// RETIRED' (Utc 2026 9 21 1 1 44)
    $record = @('# fence=game', "R|game\$rel", "R|game\$front", "R|game\$mark")
    Put (Join-Path $packs '20260917-1647.files') ($record -join "`r`n") (Utc 2026 9 18 4 34 32)
    Put (Join-Path $packs '20260920-1902.files') ($record -join "`r`n") (Utc 2026 9 21 3 5 50)

    # The pack, as Updater.Install and Keep.Forget take it.
    $gone = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in $delete) {
        $r = $line.Replace('/', '\')
        $t = Join-Path $game $r
        if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Force }
        $gone.Add($r)
    }
    [void]$KeepT::Forget($gone)
    Yes 'the pack takes the stub out of the game folder and its kept copy with it' (
        -not (Test-Path -LiteralPath (Join-Path $game $rel)) -and -not (Test-Path -LiteralPath (Join-Path $kept $rel)))

    # The refresh, as OwnGame.Refresh's loop reads above.
    $broughtIn = @()
    foreach ($f in @(Get-ChildItem -LiteralPath $src -File -Recurse)) {
        $r = $f.FullName.Substring($src.Length).TrimStart('\')
        if ($null -ne $OwnGameT::SkipOf($r)) { continue }
        $dest = Join-Path $game $r
        if (Test-Path -LiteralPath $dest) { continue }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
        [IO.File]::Copy($f.FullName, $dest, $false)
        $broughtIn += $r
    }

    # The next launcher start.
    $seeded = $KeepT::Seed()

    Yes 'after the pack, a refresh and the next launcher start, the game folder has no thornswood-chargen.js' (-not (Test-Path -LiteralPath (Join-Path $game $rel)))
    Yes 'and Profile\Keep has no kept copy, so Restore has nothing to put back before Play and Hold nothing to hold' (-not (Test-Path -LiteralPath (Join-Path $kept $rel)))
    if ($broughtIn -contains $rel) { Write-Host '      the refresh copied the Steam copy''s dresser back into the game folder' }
    Yes 'the model is live: the refresh brought back the plugin the game folder was missing' ($broughtIn -contains $mark -and (Test-Path -LiteralPath (Join-Path $game $mark)))
    Yes ('and Keep.Seed took it for a kept copy, as it would have taken the dresser ({0} taken)' -f $seeded) (Test-Path -LiteralPath (Join-Path $kept $mark))
} finally {
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}

# ---- 5. measured on this machine, where it can be -------------------------------
$steamFile = Join-Path $Steam $rel
if (Test-Path -LiteralPath $steamFile) {
    $sf = Get-Item -LiteralPath $steamFile
    $body = [IO.File]::ReadAllText($steamFile)
    Write-Host ("      the Steam copy has {0}: {1:n0} bytes, {2:yyyy-MM-dd HH:mm}, {3}" -f $name, $sf.Length, $sf.LastWriteTime,
        $(if ($body.Contains('RETIRED')) { 'the retired stub' } elseif ($body.Contains('equipItem')) { 'the dresser from before it was retired, equipItem and all' } else { 'neither the stub nor the dresser' }))
    Yes 'the Steam copy''s file is one a refresh now leaves out' ($null -ne $OwnGameT::SkipOf($rel))
} else {
    Write-Host ("SKIP  no {0} in the Steam copy at {1}" -f $name, $Steam)
}
# This machine's working copies of the baselines (Feed-Store.ps1, #907).
$releasesMain = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Thornswood\feed\main' } else { '' }
$releasesDev  = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Thornswood\feed\dev' } else { '' }
$legacyDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Thornswood' } else { '' }
foreach ($ch in @(
    @{ Label = 'main'; Base = 'published.json'; Rel = $releasesMain; Legacy = 'published.json';     Root = $Root },
    @{ Label = 'dev';  Base = 'published.json'; Rel = $releasesDev;  Legacy = 'published-dev.json'; Root = ($Root + '-DevBuild') }
)) {
    $base = ''
    if ($ch.Rel -and (Test-Path -LiteralPath (Join-Path $ch.Rel $ch.Base))) { $base = Join-Path $ch.Rel $ch.Base }
    elseif ($legacyDir -and (Test-Path -LiteralPath (Join-Path $legacyDir $ch.Legacy))) { $base = Join-Path $legacyDir $ch.Legacy }
    if ($base -and (Test-Path -LiteralPath $base)) {
        $keys = @(((Get-Content -LiteralPath $base -Raw) -replace '^\uFEFF', '' | ConvertFrom-Json).PSObject.Properties.Name)
        if ($keys -contains $rel) {
            Write-Host ("      the {0} baseline carries {1}; the next {0} pack names it in delete.txt either way" -f $ch.Label, $name)
        } else {
            Write-Host ("      the {0} baseline does not carry {1}; the next {0} pack names it in delete.txt anyway" -f $ch.Label, $name)
        }
    } else {
        Write-Host ("SKIP  no {0} publish baseline on this machine" -f $ch.Label)
    }
    $rec = Join-Path $ch.Root 'Profile\OwnGame\files.txt'
    if (Test-Path -LiteralPath $rec) {
        $line = @(Get-Content -LiteralPath $rec | Where-Object { $_.EndsWith('|' + $rel, [StringComparison]::OrdinalIgnoreCase) }) | Select-Object -First 1
        if ($line) {
            # Kind|Origin|Size|Ticks|Rel. O means the folder took the file from
            # the Steam copy and Vortex did not deploy it: the Steam copy has it.
            Write-Host ("      {0} lists it as {1}: the folder's copy was built from the Steam copy's, which is what a refresh would copy back" -f $rec, $line.Substring(0, $line.Length - $rel.Length - 1))
            Yes ("{0}: the next refresh under these rules leaves the recorded file out" -f $ch.Label) ($null -ne $OwnGameT::SkipOf($rel))
        } else {
            Write-Host ("      {0} does not list it" -f $rec)
        }
    } else {
        Write-Host ("SKIP  no {0} on this machine" -f $rec)
    }
    foreach ($w in @(@{ Where = 'Game'; Say = 'game folder' }, @{ Where = 'Profile\Keep'; Say = 'kept copies' })) {
        $p = Join-Path $ch.Root ($w.Where + '\' + $rel)
        if (Test-Path -LiteralPath $p) {
            Write-Host ("      {0} is still in {1}'s {2}; the next {3} pack deletes it" -f $name, $ch.Root, $w.Say, $ch.Label)
        }
    }
}

Done
