<#
  Check-CollectionRules.ps1

      .\scripts\mods\Check-CollectionRules.ps1
      .\scripts\mods\Check-CollectionRules.ps1 -List "$env:LOCALAPPDATA\Skyrim Special Edition\plugins.txt"
      .\scripts\mods\Check-CollectionRules.ps1 -Collection <collection.json or its folder> -List <plugins.txt> -Data <Data folder>

  Whether the plugin rules the Nexus collection carries hold a clean install
  to a plugin list's order. Entry 274 on the To Do List.

  WHY IT EXISTS. Revisions 2 to 4 of the old ombo2a collection carried no
  plugin rules at all, so a first-time person installed, got whatever order
  LOOT picked, pressed Play and was refused. ombo2a's revision 5, on
  22 September, carried 51 "load after" rules, one chain over the 52 full
  plugins from Water for ENB.esm to Playable Rieklings.esp. LOOT treats those
  as hard constraints, so a sort can put other plugins between them but cannot
  swap two of them, and that day a Sort Now put all 52 in exactly the server's
  order. The collection is 7essxf now (docs\COLLECTION-REVISIONS.md says which
  revision), and its rules are read the same way.

  What the chain cannot do is look after itself. The entry says it plainly: "A
  PLUGIN ADDED LATER IS NOT PINNED UNTIL SOMEBODY GIVES IT A RULE. ... Forget
  that and the new plugin floats, which is the same load order mismatch this
  entry exists to stop, arriving one revision later with nobody connecting
  the two." Nothing read the rules against a list, so nothing would have said
  so. This does. It says NO, and exits 1, for any of five things:

    - a full plugin the list enables that no rule names. It floats. The next
      upload needs a rule loading it after the full plugin above it.
    - a rule the list breaks: a plugin listed above the one it must load after.
    - two full plugins next to each other that no chain of rules keeps in that
      order, so LOOT is free to swap them.
    - a full plugin a rule names that the list does not enable, which means
      the collection and the list disagree about what is in the order. One
      the collection installs switched off on purpose (records\collection.json,
      enabled false) and that is in Data is allowed, and named as allowed
      (#4728).
    - a rule that goes round in a circle with the order the game itself
      sets (every master first, each plugin after its own masters), light
      plugins included. LOOT can never keep it and says "cyclic interaction"
      on every install, as revision 5's cheddars_mashups.esl rule did
      (PluginRuleLoops.ps1).

  Light plugins (an .esl, or the ESL flag in the header, read out of the Data
  folder) are left out of the first four, because the server's position check leaves them out
  and LOOT moving one changes nothing it counts. So are the five base masters,
  which the game loads first whatever any list says. Only "after" and
  "before" rules are read. A collection that ordered plugins by LOOT groups
  instead would be reported as floating: a false alarm, never a quiet pass.

  MEASURED 24 SEPTEMBER on Patrick's machine, against ombo2a's revision 5. The list the
  dev server runs (the 23 September 22:46 dev pack's profile\plugins.txt,
  byte for byte the same as %LOCALAPPDATA%\Skyrim Special Edition\plugins.txt)
  passes: 94 enabled, 52 full, all 52 named, 51 pairs held. The reference copy
  this defaults to, Profile\Default\plugins.txt, does NOT: it was rewritten at
  22:39 on 23 September with Thornswood-Content.esp moved from line 31 to the
  end, which breaks "Populated Cities Towns Villages Legendary.esp loads after
  Thornswood-Content.esp". Publish-Update put it back in the server's order
  for the pack, so nobody received it, but it is what this machine holds.

  WHERE THE COLLECTION.JSON COMES FROM, corrected 27 September. A subscribed
  install leaves it loose in the staging folder. An AUTHORED collection, which
  is what the shipping machine has, leaves no loose copy at all: the only one
  is inside export\collection_0.7z. Measured that morning, this stopped with
  "no collection.json at ...\vortex_collection_ZRT7NjhN_\collection.json" and
  exited 1 on the one machine it matters most on, and the only way past it was
  to unpack the archive by hand and pass -Collection. Get-CollectionJsonPath
  in LoadOrder.ps1 now reads either shape.

  Read only where it matters. It reads Vortex's copy of the collection, one
  plugin list and the plugin headers in one Data folder, and writes nothing
  into any of them. The one thing it writes is the collection.json it unpacks
  out of an export archive, into a temp folder keyed by that archive's size
  and write time, so a second run costs nothing. With no revision of the
  collection installed in Vortex it says SKIP and exits 0, so it can run on a
  machine without Vortex.
#>
[CmdletBinding()]
param(
  [string]$List,
  [string]$Collection,
  [string]$Data,
  [string]$Root
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'LoadOrder.ps1')
. (Join-Path $Here 'PluginRuleLoops.ps1')
. (Join-Path $Here '..\dev\OwnPlugins.ps1')   # $OwnPluginsMadeInData

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Stop-Check([string]$m) {
  Write-Host ''
  Say "  STOP. $m" 'Red'
  Write-Host ''
  exit 1
}

# The launcher install, which Where.ps1 Install finds (#3003): C:\Thornswood,
# or the first drive with a Thornswood launcher on it.
if (-not $Root) { $Root = [string](& (Join-Path $Here '..\release\Where.ps1') Install) }
if (-not $List) { $List = Join-Path $Root 'Profile\Default\plugins.txt' }
if (-not $Data) { $Data = Join-Path $Root 'Game\Data' }

Write-Host ''
Write-Host "  THORNSWOOD  -  do the collection's plugin rules hold this list's order?" -ForegroundColor White
Write-Host ''

# ------------------------------------------------------------ the collection --
# The address comes out of this machine's config.json, as Check-ShipReady
# reads it, and falls back to the one the launcher ships with (Config.Collection
# in launcher\app\Config.cs). The newest revision Vortex has installed is the one
# read, and it is named in the output, because a stale revision was the whole
# problem on 22 September.
$revision = 0
$collectionFolder = ''
if (-not $Collection) {
  $url = ''
  try { $url = [string](Get-Content -LiteralPath (Join-Path $Root 'config.json') -Raw | ConvertFrom-Json).CollectionUrl } catch { }
  if (-not $url) { $url = 'https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf' }
  $slug = Get-CollectionSlug $url
  # A Vortex database that does not read, or a moved staging folder whose
  # record cannot be read, stops with the reason: SKIP would say the
  # collection is not installed when nobody could tell (#4735).
  $dir = $null
  try {
    $revision = Get-CollectionRevision $slug
    # The folder is no longer named for the collection: current Vortex writes
    # vortex_collection_<opaque id>_, with no slug in it, so a
    # collection_<slug>_<rev>_* search finds nothing. Get-CollectionInstalledFolder
    # maps the slug to its mod folder through state and falls back to the legacy
    # name, in the staging folder Vortex records for the game this install was
    # made from; $null means the collection is not installed here.
    $dir = Get-CollectionInstalledFolder $slug $Root
  } catch { Stop-Check $_.Exception.Message }
  if (-not $dir) {
    Say "  SKIP  Vortex on this machine has no revision of collection '$slug' installed, so there are no rules to check." 'DarkGray'
    Write-Host ''
    exit 0
  }
  # An authored collection leaves no loose collection.json in its staging
  # folder: the JSON is inside export\collection_0.7z. Get-CollectionJsonPath
  # reads either shape, unpacking to a temp cache when it has to, so the
  # normal machine needs no -Collection. Measured 27 September, and what it
  # cost before this: "no collection.json at ...\vortex_collection_ZRT7NjhN_\collection.json".
  $collectionFolder = $dir.FullName
  $Collection = Get-CollectionJsonPath $collectionFolder
  if (-not $Collection) { $Collection = Join-Path $collectionFolder 'collection.json' }
}
elseif (Test-Path -LiteralPath $Collection -PathType Container) {
  $collectionFolder = $Collection
  $Collection = Get-CollectionJsonPath $collectionFolder
  if (-not $Collection) { $Collection = Join-Path $collectionFolder 'collection.json' }
}
else {
  $collectionFolder = Split-Path -Parent $Collection
}
$readFrom = $script:CollectionJsonFrom
if (-not (Test-Path -LiteralPath $Collection -PathType Leaf)) {
  $archives = @(Get-CollectionExportArchive $collectionFolder)
  if ($archives.Count -gt 0) {
    $why = 'that archive holds no collection.json'
    # Only a .7z needs 7-Zip. A .zip is opened with what .NET has, so on a
    # machine without 7-Zip an empty .zip still holds no collection.json, and
    # saying 7-Zip is missing would send somebody to install it for nothing.
    if ($archives[0].Extension -ne '.zip' -and -not (Get-SevenZipPath)) { $why = 'reading a .7z needs 7-Zip and this machine has none' }
    Stop-Check ("no loose collection.json in {0}, and none could be read out of {1}: {2}. Unpack it and pass the collection.json with -Collection." -f $collectionFolder, $archives[0].Name, $why)
  }
  Stop-Check "no collection.json at $Collection"
}
if ($revision -le 0) {
  $folderName = Split-Path -Leaf (Split-Path -Parent $Collection)
  if ($collectionFolder) { $folderName = Split-Path -Leaf $collectionFolder }
  $m = [regex]::Match($folderName, '^collection_[A-Za-z0-9]+_(\d+)_')
  if ($m.Success) { $revision = [int]$m.Groups[1].Value }
}

try {
  $raw = [IO.File]::ReadAllBytes($Collection)
  $skip = 0
  if ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF) { $skip = 3 }
  $doc = [Text.Encoding]::UTF8.GetString($raw, $skip, $raw.Length - $skip) | ConvertFrom-Json
} catch { Stop-Check ("$Collection is not JSON: " + $_.Exception.Message) }

$rules = @()
if ($null -ne $doc -and $doc.PSObject.Properties.Name -contains 'pluginRules' -and $null -ne $doc.pluginRules -and
    $doc.pluginRules.PSObject.Properties.Name -contains 'plugins' -and $null -ne $doc.pluginRules.plugins) {
  $rules = @($doc.pluginRules.plugins)
}

# Every rule as edges, A loads before B. The collection writes names in lower
# case and the list does not, so everything compares without case.
$next = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
$named = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$edgeSeen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$edges = New-Object Collections.Generic.List[object]
function Add-Edge([string]$a, [string]$b) {
  if (-not $edgeSeen.Add($a + '|' + $b)) { return }
  [void]$named.Add($a)
  [void]$named.Add($b)
  if (-not $next.ContainsKey($a)) { $next[$a] = New-Object Collections.Generic.List[string] }
  [void]$next[$a].Add($b)
  [void]$edges.Add([pscustomobject]@{ A = $a; B = $b })
}
foreach ($r in $rules) {
  if ($null -eq $r -or -not ($r.PSObject.Properties.Name -contains 'name')) { continue }
  $b = "$($r.name)".Trim()
  if (-not $b) { continue }
  if ($r.PSObject.Properties.Name -contains 'after') {
    foreach ($a in @($r.after)) { $a = "$a".Trim(); if ($a) { Add-Edge $a $b } }
  }
  if ($r.PSObject.Properties.Name -contains 'before') {
    foreach ($c in @($r.before)) { $c = "$c".Trim(); if ($c) { Add-Edge $b $c } }
  }
}

# ------------------------------------------------------------------ the list --
# The plugins the collection installs switched off on purpose, as the record
# of the collection writes them (records\collection.json, enabled false). They
# are in Data, and the launcher switches on the ones the servers load, so a
# rule may name one and a list may leave one off (#4728).
$offOnPurpose = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::OrdinalIgnoreCase)
$recordPath = Join-Path $Here '..\..\records\collection.json'
if (Test-Path -LiteralPath $recordPath -PathType Leaf) {
  try { $record = [IO.File]::ReadAllText($recordPath) | ConvertFrom-Json } catch { Stop-Check ("$recordPath is not JSON: " + $_.Exception.Message) }
  foreach ($p in @($record.plugins)) { if ($null -ne $p -and $p.enabled -eq $false) { $offOnPurpose[[string]$p.name] = [string]$p.name } }
}

if (-not (Test-Path -LiteralPath $List -PathType Leaf)) { Stop-Check "no plugin list at $List. Pass the one to check with -List." }
if (-not (Test-Path -LiteralPath $Data -PathType Container)) {
  Stop-Check "no Data folder at $Data. Light plugins cannot be told from full ones without their headers. Pass the game's Data folder with -Data."
}

$file = Read-LoadOrderFile $List
$lineOf = [Collections.Generic.Dictionary[string, int]]::new([StringComparer]::OrdinalIgnoreCase)
$present = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$full = New-Object Collections.Generic.List[string]
$absent = New-Object Collections.Generic.List[string]
$lightCount = 0
# Made on each machine from its recipe and always loaded last
# (OwnPlugins.ps1): no collection installs it, so no rule can name it.
$madeHere = New-Object Collections.Generic.List[string]
foreach ($m in $script:LoadOrderMasters) { [void]$present.Add($m) }
for ($i = 0; $i -lt $file.Lines.Count; $i++) {
  $n = Get-LoadOrderEnabledName $file.Lines[$i]
  # The first line that enables a plugin is the one the game keeps.
  if ($null -eq $n -or $lineOf.ContainsKey($n)) { continue }
  $lineOf[$n] = $i + 1
  [void]$present.Add($n)
  if (Test-LoadOrderMaster $n) { continue }
  if (@($script:OwnPluginsMadeInData) -icontains $n) { [void]$madeHere.Add($n); continue }
  $path = Join-Path $Data $n
  if ($n -notmatch '\.esl$' -and -not [IO.File]::Exists($path)) { [void]$absent.Add($n) }
  if (Test-LoadOrderLight $path) { $lightCount++; continue }
  [void]$full.Add($n)
}
if ($lineOf.Count -eq 0) { Stop-Check "$List enables nothing." }

# A plugin file in Data, found by name in any case: a rule names it in lower
# case, as Vortex writes them, and a file system that keeps case (Linux) does
# not find it by that name (#2989). $null when Data has none.
function Find-DataPlugin([string]$n) {
  $path = Join-Path $Data $n
  if ([IO.File]::Exists($path)) { return $path }
  return (@([IO.Directory]::EnumerateFiles($Data)) | Where-Object { [IO.Path]::GetFileName($_) -ieq $n } | Select-Object -First 1)
}

$pos = [Collections.Generic.Dictionary[string, int]]::new([StringComparer]::OrdinalIgnoreCase)
for ($i = 0; $i -lt $full.Count; $i++) { $pos[$full[$i]] = $i }
function Show([string]$n) {
  if ($pos.ContainsKey($n) -and $lineOf.ContainsKey($n)) { return ("{0} (line {1})" -f $full[$pos[$n]], $lineOf[$n]) }
  return $n
}

$revText = if ($revision -gt 0) { "revision $revision" } else { 'revision unknown' }
Say ("  collection  {0}, {1} rules naming {2} plugins" -f $revText, $rules.Count, $named.Count) 'DarkGray'
Say ("              {0}" -f $Collection) 'DarkGray'
if ($readFrom) {
  Say ("              unpacked from {0}, which is the only copy on this machine" -f $readFrom) 'DarkGray'
}
Say ("  list        {0} enabled, {1} full, {2} light" -f $lineOf.Count, $full.Count, $lightCount) 'DarkGray'
Say ("              {0}" -f $List) 'DarkGray'
Say ("  data        {0}" -f $Data) 'DarkGray'
if ($absent.Count) {
  Say ("  note        {0} enabled plugin(s) are not in the Data folder and are counted as full: {1}" -f $absent.Count, ($absent -join ', ')) 'Yellow'
}
if ($madeHere.Count) {
  Say ("  note        {0} is made on each machine from its recipe and loads last, so no rule names it: left out" -f ($madeHere -join ', ')) 'DarkGray'
}
Write-Host ''

$script:problems = 0
# Exact collection.json pluginRules line for the next Nexus upload.
# Names are lower case the way Vortex writes them.
function AfterRuleLine([string]$before, [string]$after) {
  return ('Exact next after-rule: { "name": "' + $after.ToLowerInvariant() + '", "after": ["' + $before.ToLowerInvariant() + '"] }')
}
function Verdict([string]$what, [string[]]$lines) {
  if ($null -eq $lines -or $lines.Count -eq 0) { Say ("  yes   " + $what) 'Green'; return }
  $script:problems += $lines.Count
  Say ("  NO    " + $what) 'Red'
  foreach ($l in $lines) { Say ("          " + $l) 'Yellow' }
}

if ($edges.Count -eq 0) {
  # Revisions 2 to 4 of the collection were exactly this.
  Verdict 'the collection carries plugin rules' @('none at all, so LOOT decides the order and nothing holds it to this list')
} else {
  # One: a full plugin no rule names floats.
  $floating = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $out = New-Object Collections.Generic.List[string]
  for ($i = 0; $i -lt $full.Count; $i++) {
    if ($named.Contains($full[$i])) { continue }
    [void]$floating.Add($full[$i])
    if ($i -gt 0) {
      [void]$out.Add((Show $full[$i]) + ': no rule names it, so LOOT may put it anywhere. The next upload needs a rule loading it after ' + $full[$i - 1] + '. ' + (AfterRuleLine $full[$i - 1] $full[$i]))
    } else {
      [void]$out.Add((Show $full[$i]) + ': no rule names it, so LOOT may put it anywhere.')
    }
  }
  Verdict ("every full plugin in the list is named by a rule ({0} of {1})" -f ($full.Count - $floating.Count), $full.Count) $out.ToArray()

  # Two: a rule the list breaks. Only between two full plugins, since a light
  # plugin's place is not counted by anybody.
  $out = New-Object Collections.Generic.List[string]
  foreach ($e in $edges) {
    if (-not $pos.ContainsKey($e.A) -or -not $pos.ContainsKey($e.B)) { continue }
    if ($pos[$e.A] -lt $pos[$e.B]) { continue }
    [void]$out.Add((Show $e.B) + ' must load after ' + (Show $e.A) + ', and the list has it above.')
  }
  Verdict 'no rule is broken by the list' $out.ToArray()

  # Three: every pair of full plugins next to each other is held in that order
  # by a chain of rules. The chain may pass through a light plugin, but only
  # through a plugin the list enables: LOOT sorts what is installed, and a
  # rule about a plugin that is not there holds nothing.
  function Test-Reaches([string]$from, [string]$to) {
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $queue = New-Object Collections.Generic.Queue[string]
    $queue.Enqueue($from)
    [void]$seen.Add($from)
    while ($queue.Count -gt 0) {
      $x = $queue.Dequeue()
      if (-not $next.ContainsKey($x)) { continue }
      foreach ($y in $next[$x]) {
        if ([string]::Equals($y, $to, [StringComparison]::OrdinalIgnoreCase)) { return $true }
        if (-not $present.Contains($y) -or $seen.Contains($y)) { continue }
        [void]$seen.Add($y)
        $queue.Enqueue($y)
      }
    }
    return $false
  }
  # A floating plugin is already reported above, so the pairs are taken with it
  # left out: the plugins either side of it are still checked against each
  # other.
  $held = @($full | Where-Object { -not $floating.Contains($_) })
  $out = New-Object Collections.Generic.List[string]
  $pairs = 0
  for ($i = 0; $i + 1 -lt $held.Count; $i++) {
    $a = $held[$i]; $b = $held[$i + 1]
    $pairs++
    if (Test-Reaches $a $b) { continue }
    if (Test-Reaches $b $a) {
      [void]$out.Add((Show $a) + ' then ' + (Show $b) + ': the rules put them the other way round.')
    } else {
      [void]$out.Add((Show $a) + ' then ' + (Show $b) + ': no rule orders the two, so LOOT may swap them. ' + (AfterRuleLine $a $b))
    }
  }
  Verdict ("every pair of full plugins next to each other is held in that order ({0} pairs)" -f $pairs) $out.ToArray()

  # Four: a full plugin a rule names that the list does not enable. One the
  # collection installs switched off on purpose (records\collection.json,
  # enabled false) and that is in Data is allowed, and named as allowed, so a
  # pass says what it passed over (#4728); any other is a disagreement about
  # what is in the order.
  $out = New-Object Collections.Generic.List[string]
  $allowedOff = New-Object Collections.Generic.List[string]
  foreach ($n in @($named | Sort-Object)) {
    if ($present.Contains($n)) { continue }
    $path = Find-DataPlugin $n
    if (-not $path) { $path = Join-Path $Data $n }
    if (Test-LoadOrderLight $path) { continue }
    if ($offOnPurpose.ContainsKey($n) -and [IO.File]::Exists($path)) {
      [void]$allowedOff.Add($offOnPurpose[$n] + ': allowed off. The collection installs it switched off on purpose (records\collection.json, enabled false) and it is in Data. Its rules hold nothing on this list, so no other plugin may hang on it alone.')
      continue
    }
    [void]$out.Add($n + ': a rule names it and the list does not enable it.')
  }
  Verdict 'every full plugin a rule names is enabled in the list, or installed switched off on purpose' $out.ToArray()
  foreach ($l in $allowedOff) { Say ("          " + $l) 'DarkGray' }

  # Five: a rule that goes round in a circle with the order the game sets,
  # every master first and each plugin after its own masters. Light plugins
  # count here: revision 5's cheddars_mashups.esl, an .esl and so a master,
  # was ruled to load after three plugins that are not, and every clean
  # install got LOOT's "cyclic interaction" for each (27 Oct). The headers
  # are read out of Data, found by name in any case as in Four.
  $headers = @{}
  $inData = @{}
  foreach ($f in @([IO.Directory]::EnumerateFiles($Data))) { $leaf = [IO.Path]::GetFileName($f); if (-not $inData.ContainsKey($leaf.ToLowerInvariant())) { $inData[$leaf.ToLowerInvariant()] = $f } }
  foreach ($n in @($lineOf.Keys) + @($script:LoadOrderMasters)) {
    $path = $inData[$n.ToLowerInvariant()]
    if (-not $path) { continue }
    $h = Read-PluginRuleHeader $path
    if ($null -ne $h) { $headers[$n] = $h }
  }
  $out = New-Object Collections.Generic.List[string]
  foreach ($l in @(Get-PluginRuleLoops $rules $headers)) {
    [void]$out.Add($l.Loop + ': ' + ($l.Why -join '; ') + '. The rule "' + $l.After + ' loads after ' + $l.Before + '" can never hold, so LOOT reports a cyclic interaction on every install.')
  }
  Verdict 'no rule goes round in a circle with the order the game sets' $out.ToArray()
}

Write-Host ''
if ($script:problems -eq 0) {
  Say "  HELD. A clean install that keeps these rules puts this list's full plugins in this list's order." 'Green'
  if ($full.Count) {
    Say ("  The chain ends at {0}. A plugin added to the collection later needs a rule loading it after that one, or it floats." -f $full[$full.Count - 1]) 'DarkGray'
  }
  Write-Host ''
  exit 0
}
Say ("  NOT HELD. {0} problem(s) above. A clean install that keeps these rules will not come out in this list's order." -f $script:problems) 'Red'
Say '  Either the list is out of the server''s order, or the collection needs a rule in its next upload. The lines above name the plugins.' 'DarkGray'
Write-Host ''
exit 1
