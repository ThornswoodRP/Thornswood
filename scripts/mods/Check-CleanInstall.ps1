<#
.SYNOPSIS
  After installing the Nexus collection into a clean Vortex profile: does the plugin list that install wrote give the game the load order the server checks, with the server's files?

.DESCRIPTION
  .\scripts\mods\Check-CleanInstall.ps1
      .\scripts\mods\Check-CleanInstall.ps1 -Server dev
      .\scripts\mods\Check-CleanInstall.ps1 -List <plugins.txt> -Data <Data folder>
      .\scripts\mods\Check-CleanInstall.ps1 -Manifest <manifest.json>

  After installing the Nexus collection into a clean Vortex profile: does the
  plugin list that install wrote give the game the load order the server
  checks, with the server's files? It prints PASS, or every difference, one
  line each, and says what to do about it. Issue #476.

  WHY IT EXISTS. The collection carries "load after" rules so that a clean
  install lands in the server's order (docs\COLLECTION-REVISION-2.md has the
  order and the rules). Whether it really does can only be proved by
  installing it and comparing, and until 29 September the comparison was a
  Compare-Object against a reference file on the shipping machine, which is a
  copy of the truth and has been out of order before (Check-CollectionRules.ps1
  records the day it was). This compares against what the servers hand out.

  WHAT IT COMPARES, the same way the launcher does (launcher\app\LoadOrder.cs,
  Verify.cs; scripts\mods\LoadOrder.ps1 for the shared rule):
    - the order: the five base masters, then every switched on line of the
      plugin list whose file is in Data and is not light (an .esl, or the ESL
      flag in its header). Light plugins take no position, so they are not
      counted, wherever they sit. Skyrim.ccc is not read: this checks the list
      Vortex wrote. Nor are official Creation Club plugins (#479): the server
      needs only Special Edition, and Thornswood's own game folder leaves any
      Creation Club plugin out (OwnGame.UnwantedCreation), so somebody who owns
      the Anniversary upgrade and has its plugins switched on still passes.
    - the files: size, then crc32, of every plugin the server names that is in
      Data, apart from the ten storefront files the launcher does not compare.

  Each difference is one of:
    missing       the server loads it, and this install does not (with why:
                  not in the list, switched off, not in Data, or light here)
    extra         this install loads a full plugin the server does not
    out of place  both load it, at different places in the order
    wrong file    both have it, and the bytes are not the server's

  THE SERVERS. By default both: live (resources on port 3000) and dev (the dev
  game port plus one, 7788), addresses from scripts\vps\vps.json, read over
  plain HTTP the way the launcher reads them. -Server live or -Server dev asks
  one. -Manifest reads a manifest saved to disk instead and asks nobody.

  Read only. It reads one plugin list, the plugin files in one Data folder
  and the manifests, and writes nothing.

  Exit 0: PASS for every server asked. Exit 1: a difference. Exit 2: it could
  not check (no plugin list, no Data folder, no server answered).
#>
[CmdletBinding()]
param(
  # The plugin list to check. Default: the one Skyrim reads, which Vortex
  # writes for the active profile.
  [string]$List,
  # The Data folder the plugins are in. Default: the Steam copy of Skyrim
  # Special Edition, which is where Vortex deploys.
  [string]$Data,
  [ValidateSet('live', 'dev', 'both')]
  [string]$Server = 'both',
  # A manifest on disk (the JSON the server publishes). Replaces -Server.
  [string]$Manifest,
  [string]$Vps = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'LoadOrder.ps1')
. (Join-Path $Here 'SteamLibrary.ps1')

function Say($m, $c = 'Gray') {
  if ($m -match '^\s*(STOP\.|PASS\b|NO\s|NOT THE SERVER)') { Write-Output $m }
  else { Write-Host $m -ForegroundColor $c }
}
function Stop-Check([string]$m) {
  Write-Host ''
  Say "  STOP. $m" 'Red'
  Write-Host ''
  exit 2
}

# A crc32 one byte at a time in PowerShell takes minutes on a big plugin;
# compiled it is under a second. The same type Check-Build.ps1 defines.
if (-not ('Thornswood.Crc32' -as [type])) {
  Add-Type -TypeDefinition @'
namespace Thornswood {
  public static class Crc32 {
    static readonly uint[] T = Build();
    static uint[] Build() {
      var t = new uint[256];
      for (uint i = 0; i < 256; i++) {
        uint c = i;
        for (int k = 0; k < 8; k++) c = ((c & 1) != 0) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
        t[i] = c;
      }
      return t;
    }
    public static int OfFile(string path) {
      uint c = 0xFFFFFFFFu;
      using (var fs = System.IO.File.OpenRead(path)) {
        var buf = new byte[1 << 20];
        int n;
        while ((n = fs.Read(buf, 0, buf.Length)) > 0)
          for (int i = 0; i < n; i++) c = T[(c ^ buf[i]) & 0xFF] ^ (c >> 8);
      }
      return unchecked((int)(c ^ 0xFFFFFFFFu));
    }
  }
}
'@
}

# The files the launcher does not compare by bytes (Verify.Storefront): the
# game's own masters and the storefront extras, which differ by edition.
$storefront = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm',
                'ccBGSSSE001-Fish.esm', 'ccBGSSSE025-AdvDSGS.esm', 'ccBGSSSE037-Curios.esl',
                'ccQDRSSE001-SurvivalMode.esl', '_ResourcePack.esl')
function Test-Storefront([string]$n) {
  foreach ($s in $storefront) { if ([string]::Equals($s, $n, [StringComparison]::OrdinalIgnoreCase)) { return $true } }
  return $false
}

# A manifest's entries in the server's order, or $null when it is not one.
function Read-Manifest([string]$Json) {
  try { $doc = $Json | ConvertFrom-Json } catch { return $null }
  if ($null -eq $doc -or -not ($doc.PSObject.Properties.Name -contains 'mods')) { return $null }
  $out = New-Object Collections.Generic.List[object]
  foreach ($m in @($doc.mods)) {
    if ($null -eq $m -or -not "$($m.filename)") { continue }
    [void]$out.Add([pscustomobject]@{ Name = "$($m.filename)"; Size = [int64]$m.size; Crc = [int]$m.crc32 })
  }
  if ($out.Count -eq 0) { return $null }
  return ,$out.ToArray()
}

function Get-ManifestText([string]$Url) {
  try {
    $req = [Net.WebRequest]::Create($Url)
    $req.Timeout = 8000
    $req.ReadWriteTimeout = 8000
    $req.UserAgent = 'ThornswoodCheck'
    $res = $req.GetResponse()
    try {
      $sr = New-Object IO.StreamReader($res.GetResponseStream())
      try { return $sr.ReadToEnd() } finally { $sr.Close() }
    } finally { $res.Close() }
  } catch { return $null }
}

# The longest run of names both lists share in the same order. Whatever is
# outside it is what moved.
function Get-InOrder([string[]]$A, [string[]]$B) {
  $n = $A.Count; $m = $B.Count
  # One row per name of $A. A jagged array, because Windows PowerShell 5.1
  # cannot parse a two dimensional index inside a method's arguments.
  $L = New-Object 'int[][]' ($n + 1)
  for ($i = 0; $i -le $n; $i++) { $L[$i] = New-Object 'int[]' ($m + 1) }
  for ($i = $n - 1; $i -ge 0; $i--) {
    for ($j = $m - 1; $j -ge 0; $j--) {
      if ([string]::Equals($A[$i], $B[$j], [StringComparison]::OrdinalIgnoreCase)) { $L[$i][$j] = $L[$i + 1][$j + 1] + 1 }
      else {
        $down = $L[$i + 1][$j]
        $right = $L[$i][$j + 1]
        $L[$i][$j] = if ($down -ge $right) { $down } else { $right }
      }
    }
  }
  $keep = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $i = 0; $j = 0
  while ($i -lt $n -and $j -lt $m) {
    if ([string]::Equals($A[$i], $B[$j], [StringComparison]::OrdinalIgnoreCase)) { [void]$keep.Add($A[$i]); $i++; $j++ }
    elseif ($L[$i + 1][$j] -ge $L[$i][$j + 1]) { $i++ }
    else { $j++ }
  }
  return ,$keep
}

# ------------------------------------------------------------ what to read --
if (-not $List) { $List = Join-Path $env:LOCALAPPDATA 'Skyrim Special Edition\plugins.txt' }
if (-not (Test-Path -LiteralPath $List)) { Stop-Check "no plugin list at $List. Install and deploy the collection in Vortex first, or name the list with -List." }
if (-not $Data) {
  $sk = Get-SteamSkyrim
  if (-not $sk) { Stop-Check 'could not find Skyrim Special Edition through Steam. Name the Data folder with -Data.' }
  $Data = Join-Path $sk 'Data'
}
if (-not (Test-Path -LiteralPath $Data)) { Stop-Check "no Data folder at $Data." }

Write-Host ''
Write-Host '  THORNSWOOD  -  does this install load what the server loads, in the same order?' -ForegroundColor White
Write-Host ''
Say "  list  $List"
Say "  data  $Data"

# ---------------------------------------------------------- the plugin list --
$file = Read-LoadOrderFile $List
$enabled = New-Object Collections.Generic.List[string]
$off = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$twice = New-Object Collections.Generic.List[string]
$seenList = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($line in $file.Lines) {
  $s = "$line".Trim()
  if ($s.Length -eq 0 -or $s.StartsWith('#')) { continue }
  $name = Get-LoadOrderEnabledName $s
  if ($null -eq $name) { [void]$off.Add($s); continue }
  if (-not $seenList.Add($name)) { [void]$twice.Add($name); continue }
  [void]$enabled.Add($name)
}
$inData = { param($n) [IO.File]::Exists((Join-Path $Data $n)) }
$isLight = { param($n) Test-LoadOrderLight (Join-Path $Data $n) }
# Creation Club plugins take no position here, for the reason in the header.
$noPlace = { param($n) (Test-LoadOrderCreation $n) -or (Test-LoadOrderLight (Join-Path $Data $n)) }
$game = Get-LoadOrderGame -Enabled $enabled.ToArray() -IsLightOrMissing $noPlace -Ccc @() -ExistsInData $inData
$lightCount = @($enabled | Where-Object { (& $inData $_) -and (& $isLight $_) }).Count
Say ("        {0} switched on, {1} of them light, {2} positions with the base masters" -f $enabled.Count, $lightCount, $game.Count)
$creationCount = @($enabled | Where-Object { Test-LoadOrderCreation $_ }).Count
if ($creationCount -gt 0) {
  Say ("        {0} of them Creation Club plugins, not counted: Thornswood's own game folder leaves those out" -f $creationCount)
}

# ------------------------------------------------------------- the servers --
$targets = New-Object Collections.Generic.List[object]
if ($Manifest) {
  if (-not (Test-Path -LiteralPath $Manifest)) { Stop-Check "no manifest at $Manifest." }
  [void]$targets.Add([pscustomobject]@{ Label = 'manifest file'; Where = $Manifest; Text = [IO.File]::ReadAllText($Manifest) })
} else {
  . (Join-Path $Here '..\vps\Vps.ps1')
  $cfg = Get-ThornswoodVps
  if (-not $Vps) { $Vps = [string]$cfg.address }
  $want = if ($Server -eq 'both') { @('live', 'dev') } else { @($Server) }
  foreach ($w in $want) {
    $gamePort = if ($w -eq 'live') { [int]$cfg.livePort } else { [int]$cfg.devPort }
    if ($gamePort -le 0) { $gamePort = if ($w -eq 'live') { 7777 } else { 7787 } }
    # SkyMp.ResourcePortFor: the main server on 7777 serves resources on 3000,
    # any other game port on the port after it.
    $rp = if ($gamePort -eq 7777) { 3000 } else { $gamePort + 1 }
    $url = "http://${Vps}:$rp/api/servers/thornswood/manifest.json"
    [void]$targets.Add([pscustomobject]@{ Label = $w; Where = $url; Text = (Get-ManifestText $url) })
  }
}

$failed = 0
$checked = 0
foreach ($t in $targets) {
  Write-Host ''
  Write-Host ("  {0}  {1}" -f $t.Label.ToUpperInvariant(), $t.Where) -ForegroundColor Cyan
  $entries = if ($t.Text) { Read-Manifest $t.Text } else { $null }
  if ($null -eq $entries) {
    Say '        no manifest came back, so this one was not checked.' 'Yellow'
    continue
  }
  $checked++
  $names = [string[]]@($entries | ForEach-Object { $_.Name })
  $serverSet = [Collections.Generic.HashSet[string]]::new([string[]]$names, [StringComparer]::OrdinalIgnoreCase)
  $gameSet = [Collections.Generic.HashSet[string]]::new([string[]]$game, [StringComparer]::OrdinalIgnoreCase)
  $lines = New-Object Collections.Generic.List[string]

  foreach ($n in $twice) { [void]$lines.Add("twice         $n is switched on on two lines of the list. Remove one in Vortex's Plugins page.") }

  for ($i = 0; $i -lt $names.Count; $i++) {
    $n = $names[$i]
    if ($gameSet.Contains($n)) { continue }
    $why = if ($off.Contains($n)) { 'it is in the list but switched off. Switch it on in Vortex''s Plugins page.' }
           elseif (-not $seenList.Contains($n)) { 'it is not in the list at all. The collection did not install it, or its mod is disabled.' }
           elseif (-not (& $inData $n)) { 'it is switched on, but the file is not in Data. Deploy in Vortex.' }
           else { 'the file in Data is light, and the server''s is not. It is a different file from the server''s.' }
    [void]$lines.Add(("missing       {0} (server position {1}): {2}" -f $n, ($i + 1), $why))
  }
  for ($i = 0; $i -lt $game.Count; $i++) {
    $n = $game[$i]
    if ($serverSet.Contains($n)) { continue }
    [void]$lines.Add(("extra         {0} (position {1} here): a full plugin the server does not load. Switch it off in Vortex, or it moves every plugin after it." -f $n, ($i + 1)))
  }
  $a = [string[]]@($game | Where-Object { $serverSet.Contains($_) })
  $b = [string[]]@($names | Where-Object { $gameSet.Contains($_) })
  $keep = Get-InOrder $a $b
  for ($i = 0; $i -lt $a.Count; $i++) {
    if ($keep.Contains($a[$i])) { continue }
    $here = [Array]::FindIndex([string[]]$game, [Predicate[string]]{ param($x) [string]::Equals($x, $a[$i], [StringComparison]::OrdinalIgnoreCase) }) + 1
    $there = [Array]::FindIndex($names, [Predicate[string]]{ param($x) [string]::Equals($x, $a[$i], [StringComparison]::OrdinalIgnoreCase) }) + 1
    $before = if ($there -gt 1) { $names[$there - 2] } else { '' }
    [void]$lines.Add(("out of place  {0} is at position {1} here and {2} on the server, where it loads right after {3}. Its load after rule is missing or was skipped." -f $a[$i], $here, $there, $before))
  }
  foreach ($e in $entries) {
    if (Test-Storefront $e.Name) { continue }
    $p = Join-Path $Data $e.Name
    if (-not [IO.File]::Exists($p)) { continue }
    $size = (Get-Item -LiteralPath $p).Length
    if ($size -ne $e.Size) {
      [void]$lines.Add(("wrong file    {0} is {1:N0} bytes here and {2:N0} on the server: a different version of the mod." -f $e.Name, $size, $e.Size))
      continue
    }
    $crc = [Thornswood.Crc32]::OfFile($p)
    if ($crc -ne $e.Crc) {
      [void]$lines.Add(("wrong file    {0} is the server's size, but not its bytes: a different build of the same file." -f $e.Name))
    }
  }

  $same = ($lines.Count -eq 0 -and (Get-LoadOrderFirstMismatch $game $names) -lt 0)
  if ($same) {
    Say ("  PASS  all {0} positions are the server's, in the server's order, with the server's files." -f $names.Count) 'Green'
  } else {
    $failed++
    if ($lines.Count -eq 0) { [void]$lines.Add('differs       the two orders part at position ' + ((Get-LoadOrderFirstMismatch $game $names) + 1) + '.') }
    Say ("  NO    {0} difference(s):" -f $lines.Count) 'Red'
    foreach ($l in $lines) { Say "          $l" 'Yellow' }
  }
}

Write-Host ''
if ($checked -eq 0) { Stop-Check 'no server answered, so nothing was compared. Try again, or pass -Manifest with a saved manifest.' }
if ($failed) {
  Say '  NOT THE SERVER''S ORDER. Fix the lines above in Vortex, then run this again.' 'Red'
  Write-Host ''
  exit 1
}
if ($checked -lt $targets.Count) {
  Write-Output '  PASS for every server that answered. The one that did not was not checked.'
} else {
  Write-Output '  PASS'
}
Write-Host ''
exit 0
