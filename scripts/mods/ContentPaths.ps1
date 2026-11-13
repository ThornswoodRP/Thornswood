<#
  ContentPaths.ps1

  What a content build on the box reads and what it writes, worked out from
  scripts\mods\content-tables.json and the builders themselves (#5191). One
  copy, for Run-OnBox.ps1 (what it sends and what it brings back) and
  Build-ContentOnBox.ps1 (what a build's inputs are, and what it keeps).
  Defines functions and nothing else.
#>

<#
  The repository paths a content run reads, -Paths, and the paths it may
  write, -Watch, for the chain of content-tables.json and -Tool, at -Repo.

  Paths: scripts\mods, scripts\dev, game\content, game\data, records and
  layout.json, and whatever else a builder of the chain reads, uses or
  writes. Until #2962 the artifact held only those folders, so every builder
  that writes its table into game\gamemode.js stopped on the box with "No
  such file" for gamemode.js, and the one that reads docs\systems\cut-items.json
  would have too. Until #3425 the list named only the tables, so the K
  panel's book that Build-SpellTable.ps1 reads (game\ui) and the game
  scripts Build-MerchantGamemode.js embeds never went up, and the run
  stopped at the spell table; their uses name them now. And every script a
  builder, or -Tool, loads from beside it outside those folders, and what
  that one loads in turn: a .ps1's . (Join-Path $PSScriptRoot '<path>') and
  a .js's require('./<path>'). Build-RecipeTable.ps1 loads
  scripts\deploy\ServerOrder.ps1, which loads scripts\release\Read-JsonFile.ps1;
  game\merchant-commissions.js requires .\merchant-commission-state.js.

  Watch: game\, records\ and docs\systems\, and every file a step writes
  outside them, so a table a builder writes is never left on the box (#3425).

  Writes: every path a step of the chain says it writes, in the chain's
  order, each once.
#>
function Get-ThornswoodContentPaths {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [string]$Tool = ''
    )
    $chain = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/content-tables.json')) | ConvertFrom-Json
    $paths = @('scripts/mods', 'scripts/dev', 'game/content', 'game/data', 'records', 'layout.json')
    foreach ($s in @($chain.steps)) {
        foreach ($p in @(@($s.reads) + @($s.readsBack) + @($s.uses) + @($s.writes) | Where-Object { $_ })) {
            $p = [string]$p
            if (-not @($paths | Where-Object { $p -eq $_ -or $p.StartsWith($_ + '/') }).Count) { $paths += $p }
        }
    }
    $watch = @('game', 'records', 'docs/systems')
    $writes = @()
    foreach ($p in @($chain.steps | ForEach-Object { @($_.writes) } | Where-Object { $_ })) {
        $p = [string]$p
        if ($writes -notcontains $p) { $writes += $p }
        if (-not @($watch | Where-Object { $p -eq $_ -or $p.StartsWith($_ + '/') }).Count) { $watch += $p }
    }
    $load = New-Object 'Collections.Generic.Queue[string]'
    $tools = @(@($chain.steps | ForEach-Object { [string]$_.tool }) + @($chain.steps | ForEach-Object { @($_.uses) } | Where-Object { $_ -like '*.js' -or $_ -like '*.ps1' }))
    if ($Tool) { $tools += $Tool }
    foreach ($t in $tools) { $load.Enqueue([string]$t) }
    $seen = @{}
    while ($load.Count) {
        $t = $load.Dequeue()
        if ($seen.ContainsKey($t)) { continue }
        $seen[$t] = $true
        $full = Join-Path $Repo $t
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
        $text = [IO.File]::ReadAllText($full)
        $found = @([regex]::Matches($text, "\.\s+\(Join-Path\s+\`$PSScriptRoot\s+'([^']+)'\)") + [regex]::Matches($text, "require\(\s*['""](\.\.?/[^'""]+)['""]\s*\)"))
        foreach ($m in $found) {
            $parts = New-Object 'Collections.Generic.List[string]'
            foreach ($w in @(($t.Substring(0, $t.LastIndexOf('/')) + '/' + $m.Groups[1].Value.Replace('\', '/')).Split('/'))) {
                if ($w -eq '..') { if ($parts.Count) { $parts.RemoveAt($parts.Count - 1) } } elseif ($w -and $w -ne '.') { $parts.Add($w) }
            }
            $p = $parts -join '/'
            if ($t -like '*.js' -and -not [IO.Path]::GetExtension($p)) { $p += '.js' }
            if ($p -notmatch '^(scripts|game)/' -or -not (Test-Path -LiteralPath (Join-Path $Repo $p) -PathType Leaf)) { continue }
            if (-not @($paths | Where-Object { $p -eq $_ -or $p.StartsWith($_ + '/') }).Count) { $paths += $p }
            $load.Enqueue($p)
        }
    }
    return [pscustomobject]@{ Paths = $paths; Watch = $watch; Writes = $writes }
}

<#
  The load order the servers run on the record's collection revision, from
  the records alone (#5191, #5648): $Order is the order they run now, $Drop
  the plugins the revision takes out (records\collection-dropped.json), and
  $Record records\collection.json, read. What $Drop names goes; every plugin
  the record switches on that the order does not load yet goes on the end;
  then masters before the rest, as the game loads them, so a new master goes
  on the end of the masters and a new full plugin on the end of the rest, and
  no plugin the servers load moves to another index (docs\LIGHT-ORDER-DRIFT.md).
  A master is what the record says, or by its extension for a plugin the
  record does not install (the game's own). Thornswood-Last.esp loads last
  whatever the order. CollectionRecord.ps1 holds the record's rules to this
  same order (Get-CollectionRecordServerOrderProblems).
#>
function Get-ThornswoodServerOrder($Record, [string[]]$Order, [string[]]$Drop = @()) {
    $byKey = @{}
    foreach ($p in @($Record.plugins)) { $byKey[([string]$p.name).ToLowerInvariant()] = $p }
    $gone = @{}
    foreach ($d in @($Drop)) { if ($d) { $gone[([string]$d).ToLowerInvariant()] = $true } }
    $list = New-Object 'Collections.Generic.List[string]'
    $loads = @{}
    foreach ($n in @(@($Order) + @(@($Record.plugins) | Where-Object { $_.enabled -ne $false } | ForEach-Object { [string]$_.name }))) {
        if (-not $n) { continue }
        $k = ([string]$n).ToLowerInvariant()
        if ($loads.ContainsKey($k) -or $gone.ContainsKey($k)) { continue }
        $loads[$k] = $true
        $list.Add([string]$n)
    }
    $isMaster = { param($n) $k = $n.ToLowerInvariant(); if ($byKey.ContainsKey($k)) { [bool]$byKey[$k].master } else { $n -match '\.(esm|esl)$' } }
    $rest = @($list | Where-Object { $_ -ine 'Thornswood-Last.esp' })
    return [string[]]@(@($rest | Where-Object { & $isMaster $_ }) + @($rest | Where-Object { -not (& $isMaster $_) }) + @($list | Where-Object { $_ -ieq 'Thornswood-Last.esp' }))
}

<#
  The load order a content build at -Repo is built against (#5191): the
  order game\data\npc-population.json records (the one every table and the
  Last plugin read), moved to the revision records\collection-plugins.json
  names by Get-ThornswoodServerOrder. Until 13 Nov 2026 only a server's own
  settings moved that record (Build-NpcPopulation.py --settings), and a
  server moves only to the order the commit records (Deploy-DevGamemode
  -LoadOrder -FromRecord), so a plugin a new revision added was in no order
  anywhere but One's Vortex game: revision 8's Improved Eyes Skyrim.esp
  stopped the box's first content build at Build-BuildingHolds.py.
  records\collection-dropped.json takes out what it names only when it is
  for that revision. Hands back Names (the order, the five masters first and
  Thornswood-Last.esp last), Recorded (the catalogue's), Moved (the two
  differ), Added, Dropped, Slug and Revision. Throws when the records are
  not of one revision, since there is then no telling which order is meant.
#>
function Get-ThornswoodContentOrder {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $read = { param($rel) [IO.File]::ReadAllText((Join-Path $Repo $rel)) | ConvertFrom-Json }
    $record = & $read 'records/collection.json'
    $plugins = & $read 'records/collection-plugins.json'
    if ([string]$record.collection -ne [string]$plugins.collection -or [string]$record.revision -ne [string]$plugins.revision) {
        throw ('records\collection.json is collection ' + $record.collection + ' revision ' + $record.revision + ', and records\collection-plugins.json ' + $plugins.collection + ' revision ' + $plugins.revision + ': they move together, so there is no telling which load order is meant.')
    }
    $recorded = [string[]]@((& $read 'game/data/npc-population.json').loadOrder | ForEach-Object { [string]$_.name })
    $drop = @()
    $dropPath = Join-Path $Repo 'records/collection-dropped.json'
    if (Test-Path -LiteralPath $dropPath -PathType Leaf) {
        $dd = & $read 'records/collection-dropped.json'
        if ([string]$dd.collection -eq [string]$plugins.collection -and [string]$dd.revision -eq [string]$plugins.revision) {
            $drop = @(@($dd.dropped) | ForEach-Object { [string]$_.name } | Where-Object { $_ })
        }
    }
    $names = Get-ThornswoodServerOrder $record $recorded $drop
    $was = @{}
    foreach ($n in $recorded) { $was[$n.ToLowerInvariant()] = $true }
    $now = @{}
    foreach ($n in $names) { $now[$n.ToLowerInvariant()] = $true }
    return [pscustomobject]@{
        Names    = $names
        Recorded = $recorded
        Moved    = (($names -join '|') -ne ($recorded -join '|'))
        Added    = [string[]]@($names | Where-Object { -not $was.ContainsKey($_.ToLowerInvariant()) })
        Dropped  = [string[]]@($recorded | Where-Object { -not $now.ContainsKey($_.ToLowerInvariant()) })
        Slug     = [string]$plugins.collection
        Revision = [int]$plugins.revision
    }
}
