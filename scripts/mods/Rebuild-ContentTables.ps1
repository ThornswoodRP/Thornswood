<#
  Rebuild-ContentTables.ps1

  Rebuilds every table that is read out of the plugins of the load order, in
  the order they read each other, after a change to one of Thornswood's own
  plugins in game\content, and says what changed. Issue #2923.

      pwsh scripts/mods/Rebuild-ContentTables.ps1
      pwsh scripts/mods/Rebuild-ContentTables.ps1 -Data D:\Thornswood\Game\Data
      pwsh scripts/mods/Rebuild-ContentTables.ps1 -List

  WHY. Nothing said which tables a content change makes stale, so each change
  found them one red build at a time. Measured on #1382 (#2911, 20 Oct): two
  VPS builds went red after Thornswood-Content.esp gained three teas, first
  on merchant-role-tables.json, then on the merchant bundle inside
  gamemode.js; before those, four harnesses were red on One until their
  tables were rebuilt. docs\systems\station-placement.md named four builders;
  #2911 ran eleven; and the /give names table, which reads every item in the
  load order, was in neither list, so the teas and the furniture items are
  still not in it (counted in gamemode.js's ADMIN_NAMES, 20 Oct).
  Since #2923 every builder reads Thornswood's own plugins from game\content
  (scripts\dev\OwnPlugins.js, OwnPlugins.ps1, own_plugins.py), so a content
  change is built from the repository's plugin with no Data folder made for it.

  WHAT IT RUNS. scripts\mods\content-tables.json, top to bottom: every
  builder that reads a load order, with what each reads and writes, and the
  three that are left out and why. tests\test-2923-own-plugins.js holds that
  list to the builders and its order to what they read. The first builder
  that fails stops the chain; what the ones before it changed is still
  listed. -Data is handed to every builder that takes it; left out, each
  builder uses its own default, which on One is the game at C:\Thornswood.
  A step that changes a file an earlier step reads back (readsBack) runs the
  chain again from that earlier step, once (#4087): Write-CutItems.js sorts a
  new plugin's recipes into the cut file, and the recipe build applies it.

  THE LOAD ORDER IS THE ONE THE COMMIT RECORDS (#3105). Every builder that
  takes a plugin list is given the load order game\data\npc-population.json
  records, the one both game servers run (Build-NpcPopulation.py reads it
  out of a server's settings when the collection's load order moves), as a
  plugins.txt in a temp folder. Until #3105 each builder read the profile
  list of the PC it ran on: One's Default list held 101 plugins and both
  servers load 103 (Thornswood-Last.esp and _ResourcePack.esl), so main's
  door table still called the gates Last.esp unlocks locked, and a box run,
  given the dev server's list, wrote different tables from One's. Now a PC
  and the box build the same tables from the same commit. -PluginsTxt (the
  box's '{plugins}', the dev server's load order) is held to that record: a
  list that is not the same plugins in the same order stops the run before
  any builder, because the record and the server disagree and the record is
  rebuilt first.

  AFTER THE BUILDERS. records\asset-provenance.json holds each of Thornswood's
  own plugins by sha256, and tests\test-asset-provenance.js refuses a file
  that changed since it was registered. Those built here take the new hash;
  each entry's status, licence and ask stay as written, and the line printed
  for each says the entry's "what" describes what the plugin holds, which
  only the change's author can say. An entry whose status is
  built-on-the-box (Thornswood-Content.esp since #5191) holds no hash: the
  box's build holds it in its content-build.json, so nothing is written.

  WHAT IT SAYS. Every file under game, docs\systems and records, and every
  other file a step writes (tests\fixtures\merchant-retrieval-records.json,
  #3425), that is different from before it ran, by sha256. git diff then shows what each one
  is. The bytes are what git stores because .gitattributes checks every
  builder's output out with LF, as the builders write it (#3029); before it,
  a checkout with autocrlf (One) listed every output a builder wrote, changed
  or not.

  -List prints the steps it would run, with their arguments, and runs none.
#>
[CmdletBinding()]
param(
    # The game's Data folder, for every builder that reads one.
    [string]$Data = '',
    # A plugin list to check against the load order the commit records; the
    # builders are given that record's load order either way.
    [string]$PluginsTxt = '',
    [switch]$List
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path -LiteralPath (Join-Path $Here '..\..')).ProviderPath
$chain = [IO.File]::ReadAllText((Join-Path $Here 'content-tables.json')) | ConvertFrom-Json

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

function Find-Exe([string[]]$Names) {
    foreach ($n in $Names) {
        $c = Get-Command $n -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($c) { return $c.Path }
    }
    return $null
}

# Every file the builders can write, by sha256, so what changed is measured.
$watched = @('game', 'docs/systems', 'records')
foreach ($w in @($chain.steps | ForEach-Object { @($_.writes) } | Where-Object { $_ })) {
    $w = [string]$w
    if (-not @($watched | Where-Object { $w -eq $_ -or $w.StartsWith($_ + '/') }).Count) { $watched += $w }
}
function Get-TreePrint {
    $map = @{}
    foreach ($top in $watched) {
        $dir = Join-Path $repo $top
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        foreach ($f in @(Get-ChildItem -LiteralPath $dir -Recurse -File)) {
            $rel = $f.FullName.Substring($repo.Length).TrimStart('\', '/').Replace('\', '/')
            $map[$rel] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    return $map
}

$node = Find-Exe @('node')
$python = Find-Exe @('python', 'py', 'python3')
$shell = (Get-Process -Id $PID).Path
$need = @()
if (-not $node) { $need += 'node' }
if (-not $python) { $need += 'python' }
if ($need.Count -and -not $List) { throw ('not found on this machine: ' + ($need -join ', ') + '. Nothing was run.') }

# The load order the commit records, as the game's plugins.txt: the five
# masters are never written to it (OwnPlugins.ps1).
. (Join-Path $repo 'scripts\dev\OwnPlugins.ps1')
$populationPath = Join-Path $repo 'game\data\npc-population.json'
$recorded = @(([IO.File]::ReadAllText($populationPath) | ConvertFrom-Json).loadOrder | ForEach-Object { [string]$_.name })
$masters = @('skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm')
if ($recorded.Count -lt 6 -or (@($recorded[0..4] | ForEach-Object { $_.ToLowerInvariant() }) -join '|') -ne ($masters -join '|')) {
    throw ('game\data\npc-population.json records no load order that starts with the five masters. Nothing was run.')
}
if ($PluginsTxt) {
    if (-not (Test-Path -LiteralPath $PluginsTxt)) { throw "not found: $PluginsTxt. Nothing was run." }
    $given = @(Get-LoadOrder $PluginsTxt)
    $at = -1
    for ($i = 0; $i -lt [Math]::Max($given.Count, $recorded.Count); $i++) {
        if ($i -ge $given.Count -or $i -ge $recorded.Count -or $given[$i] -ine $recorded[$i]) { $at = $i; break }
    }
    if ($at -ge 0) {
        $g = $(if ($at -lt $given.Count) { $given[$at] } else { 'nothing' })
        $r = $(if ($at -lt $recorded.Count) { $recorded[$at] } else { 'nothing' })
        throw ("$PluginsTxt is not the load order game\data\npc-population.json records: $($given.Count) plugins against $($recorded.Count), and at place $($at + 1) it has $g where the record has $r. When the servers' load order moved, rebuild the record first (Build-NpcPopulation.py, then Build-ResourceLocations.py, content-tables.json's notInChain says why). Nothing was run.")
    }
}
$orderFolder = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-loadorder-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$orderList = Join-Path $orderFolder 'plugins.txt'

$steps = @($chain.steps)
$runs = @()
foreach ($s in $steps) {
    $tool = Join-Path $repo $s.tool
    if (-not (Test-Path -LiteralPath $tool)) { throw ("content-tables.json names $($s.tool), which is not in this checkout. Nothing was run.") }
    $a = @()
    if ($Data -and $s.data) { $a += @($s.data, $Data) }
    if ($s.plugins) { $a += @($s.plugins, $orderList) }
    switch ([IO.Path]::GetExtension($tool).ToLowerInvariant()) {
        '.js'  { $runs += , @($node, (@($tool) + $a)) }
        '.py'  { $runs += , @($python, (@($tool) + $a)) }
        '.ps1' { $runs += , @($shell, (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $tool) + $a)) }
        default { throw ("content-tables.json names $($s.tool), which is not a .js, .py or .ps1 builder. Nothing was run.") }
    }
}

if ($List) {
    for ($i = 0; $i -lt $steps.Count; $i++) {
        Say ('{0,2}. {1} {2}' -f ($i + 1), $steps[$i].tool, (@($runs[$i][1] | Select-Object -Skip ($(if ($steps[$i].tool -like '*.ps1') { 5 } else { 1 }))) -join ' '))
    }
    Say ('{0} steps, then the hashes of game\content in records\asset-provenance.json, each list {1}: {2}. Nothing was run.' -f $steps.Count, $orderList, (Get-LoadOrderName $recorded))
    exit 0
}

New-Item -ItemType Directory -Force -Path $orderFolder | Out-Null
[IO.File]::WriteAllLines($orderList, [string[]]@($recorded | Select-Object -Skip 5 | ForEach-Object { '*' + $_ }), (New-Object Text.UTF8Encoding($false)))
Say ('the load order: ' + (Get-LoadOrderName $recorded) + ', from game\data\npc-population.json') 'Cyan'

# A file a step reads back (readsBack in content-tables.json) is written by a
# later step. When that step changes it, the reader built from the old one, so
# the chain runs again from the reader, once (#4087): Build-RecipeTable.ps1
# reads docs\systems\cut-items.json, and Write-CutItems.js sorts a row a new
# plugin added into it, which the recipe build has to apply. A second change
# is a builder that never settles, and stops the chain.
function Get-FileSha([string]$rel) {
    $f = Join-Path $repo $rel
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return '' }
    return (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()
}
$readBackBy = @{}
for ($j = 0; $j -lt $steps.Count; $j++) {
    foreach ($r in @($steps[$j].readsBack | Where-Object { $_ })) { $readBackBy[[string]$r] = $j }
}
$readBackAt = @{}
$againFrom = @{}

$before = Get-TreePrint
$stopped = $null
$unregistered = @()
try {
    for ($i = 0; $i -lt $steps.Count; $i++) {
        Say ''
        Say ('[{0}/{1}] {2}' -f ($i + 1), $steps.Count, $steps[$i].tool) 'Cyan'
        foreach ($r in @($steps[$i].readsBack | Where-Object { $_ })) { $readBackAt[[string]$r] = Get-FileSha ([string]$r) }
        $exe = $runs[$i][0]
        $line = $runs[$i][1]
        & $exe @line
        if ($LASTEXITCODE -ne 0) { $stopped = '{0} ended with exit {1}' -f $steps[$i].tool, $LASTEXITCODE; break }
        $from = -1
        foreach ($w in @($steps[$i].writes | Where-Object { $_ })) {
            $w = [string]$w
            if (-not $readBackBy.ContainsKey($w) -or $readBackBy[$w] -ge $i) { continue }
            if ((Get-FileSha $w) -eq $readBackAt[$w]) { continue }
            $j = $readBackBy[$w]
            if ($againFrom.ContainsKey($j)) { $stopped = '{0} changed {1} again after {2} ran on it a second time' -f $steps[$i].tool, $w, $steps[$j].tool; break }
            $againFrom[$j] = $true
            Say ('{0} changed {1}, which {2} read, so the chain runs again from step {3}' -f $steps[$i].tool, $w, $steps[$j].tool, ($j + 1)) 'Yellow'
            if ($from -lt 0 -or $j -lt $from) { $from = $j }
        }
        if ($stopped) { break }
        if ($from -ge 0) { $i = $from - 1 }
    }
} finally {
    try { Remove-Item -LiteralPath $orderFolder -Recurse -Force } catch { Say ('could not remove ' + $orderFolder + ': ' + $_.Exception.Message) 'Yellow' }
}

if (-not $stopped) {
    Say ''
    Say 'records\asset-provenance.json' 'Cyan'
    $regPath = Join-Path $repo 'records\asset-provenance.json'
    $bytes = [IO.File]::ReadAllBytes($regPath)
    $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $text = [IO.File]::ReadAllText($regPath)
    $reg = $text | ConvertFrom-Json
    $wrote = $false
    $unregistered = @()
    foreach ($f in Get-ChildItem -LiteralPath (Join-Path $repo 'game\content') -File) {
        $rel = 'game/content/' + $f.Name
        $sha = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $entry = @($reg.assets | Where-Object { $_.path -eq $rel }) | Select-Object -First 1
        if (-not $entry) {
            Say ("  {0} has no entry. Register where it came from, as test-asset-provenance.js says, before it ships." -f $rel) 'Yellow'
            $unregistered += $rel
            continue
        }
        if ($entry.status -eq 'built-on-the-box') { Say ("  {0} is built on the box; its build's content-build.json holds its sha256 ({1})" -f $rel, $sha.Substring(0, 16)); continue }
        if ($entry.sha256 -eq $sha) { Say ("  {0} is the registered bytes" -f $rel); continue }
        $at = $text.IndexOf('"path": "' + $rel + '"')
        $m = ([regex]'"sha256": "[0-9a-f]{64}"').Match($text, $at)
        if ($at -lt 0 -or -not $m.Success -or $m.Value -ne ('"sha256": "' + $entry.sha256 + '"')) {
            Say ("  {0}: its sha256 is not where this reads it, so the register was left as it is." -f $rel) 'Yellow'
            $unregistered += $rel
            continue
        }
        $text = $text.Substring(0, $m.Index) + '"sha256": "' + $sha + '"' + $text.Substring($m.Index + $m.Length)
        $wrote = $true
        Say ("  {0}: sha256 {1} (status {2}). Its ""what"" says what the plugin holds: add what this change put in it." -f $rel, $sha.Substring(0, 16), $entry.status) 'Yellow'
    }
    if ($wrote) { [IO.File]::WriteAllText($regPath, $text, (New-Object System.Text.UTF8Encoding($bom))) }
}

$after = Get-TreePrint
$changed = @()
foreach ($k in $after.Keys) { if (-not $before.ContainsKey($k)) { $changed += "new      $k" } elseif ($before[$k] -ne $after[$k]) { $changed += "changed  $k" } }
foreach ($k in $before.Keys) { if (-not $after.ContainsKey($k)) { $changed += "gone     $k" } }
Say ''
if ($changed.Count) {
    Say ('{0} file(s) are different from before this ran:' -f $changed.Count) 'Cyan'
    foreach ($c in ($changed | Sort-Object { $_.Substring(9) })) { Say ('  ' + $c) }
} elseif ($stopped) {
    Say 'Nothing is different from before this ran.' 'Cyan'
} else {
    Say 'Nothing is different from before this ran: every table already read the plugins as they are.' 'Cyan'
}
if ($stopped) {
    Say ''
    Say ('STOP. ' + $stopped + '. The steps after it did not run.') 'Red'
    exit 1
}
if ($unregistered.Count) {
    Say ''
    Say ('STOP. records\asset-provenance.json does not hold ' + ($unregistered -join ', ') + ' the way this reads it; its hash was not written.') 'Red'
    exit 1
}
Say ''
Say ('All {0} builders ran. Run the harnesses next: the ones that hold a table to the plugin bytes are test-2468, test-2551, test-516 and test-asset-provenance.' -f $steps.Count) 'Green'
exit 0
