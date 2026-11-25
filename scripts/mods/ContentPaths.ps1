<#
.SYNOPSIS
  What a content build on the box reads and what it writes, worked out from scripts\mods\content-tables.json and the builders themselves (#5191).

.DESCRIPTION
  What a content build on the box reads and what it writes, worked out from
  scripts\mods\content-tables.json and the builders themselves (#5191). One
  copy, for Run-OnBox.ps1 (what it sends and what it brings back) and
  Build-ContentOnBox.ps1 (what a build's inputs are, and what it keeps).
  Defines functions and nothing else. Also the key a build is kept by,
  for Build-ContentOnBox.ps1 and the merge release that takes the build
  (scripts\release\Get-ContentBuild.ps1).
#>
#Requires -Version 7

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
    # As hashtables, read by key: a step names only the lists it has (reads,
    # readsBack, uses, writes), and a missing key reads as nothing even under
    # Set-StrictMode, which Ship.ps1 runs with (#5191).
    $chain = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/content-tables.json')) | ConvertFrom-Json -AsHashtable
    $paths = @('scripts/mods', 'scripts/dev', 'game/content', 'game/data', 'records', 'layout.json')
    foreach ($s in @($chain['steps'])) {
        foreach ($p in @(@($s['reads']) + @($s['readsBack']) + @($s['uses']) + @($s['writes']) | Where-Object { $_ })) {
            $p = [string]$p
            if (-not @($paths | Where-Object { $p -eq $_ -or $p.StartsWith($_ + '/') }).Count) { $paths += $p }
        }
    }
    $watch = @('game', 'records', 'docs/systems')
    $writes = @()
    foreach ($p in @($chain['steps'] | ForEach-Object { @($_['writes']) } | Where-Object { $_ })) {
        $p = [string]$p
        if ($writes -notcontains $p) { $writes += $p }
        if (-not @($watch | Where-Object { $p -eq $_ -or $p.StartsWith($_ + '/') }).Count) { $watch += $p }
    }
    $load = New-Object 'Collections.Generic.Queue[string]'
    # This reader also runs inside the packed checkout. Its own transitive
    # helpers must travel even when the requested tool is the plugin builder.
    $tools = @('scripts/mods/ContentPaths.ps1') + @(@($chain['steps'] | ForEach-Object { [string]$_['tool'] }) + @($chain['steps'] | ForEach-Object { @($_['uses']) } | Where-Object { $_ -like '*.js' -or $_ -like '*.ps1' }))
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
  order records\load-order.json records, moved to the revision
  records\collection-plugins.json names by Get-ThornswoodServerOrder. Until
  13 Nov 2026 only a server's own settings moved the recorded order
  (Build-NpcPopulation.py --settings), and a server moves only to the order
  the commit records (Deploy-DevGamemode -LoadOrder -FromRecord), so a
  plugin a new revision added was in no order anywhere but One's Vortex
  game: revision 8's Improved Eyes Skyrim.esp stopped the box's first
  content build at Build-BuildingHolds.py. Until 16 Nov 2026 the recorded
  order was game\data\npc-population.json's loadOrder, a table the build
  writes, so a build read its order back from the last one and the table
  could not leave git; it is records\load-order.json now, which
  scripts\mods\Set-LoadOrder.ps1 moves to a new revision in the pull
  request that moves the records. records\collection-dropped.json takes out
  what it names only when it is for that revision. Hands back Names (the
  order, the five masters first and Thornswood-Last.esp last), Recorded
  (load-order.json's), Moved (the two differ), Added, Dropped, Slug and
  Revision. Throws when the records are not of one revision, since there is
  then no telling which order is meant.
#>
# One proof list for building tables and checking the tables already laid.
# The Last plugin is not an input until its own step has run.
function Get-ThornswoodTableOrderProofs($Chain, [string[]]$Order) {
    $proofs = @{}
    if (-not $Chain.PSObject.Properties['orderProof']) { return $proofs }
    $withoutLast = @($Order | Where-Object { $_ -ine 'Thornswood-Last.esp' })
    $phase = $withoutLast
    $scopes = $Chain.orderProof.PSObject.Properties
    foreach ($step in $Chain.steps) {
        if ($step.tool -eq 'scripts/mods/Build-LastPlugin.py') { $phase = $Order }
        foreach ($path in @($step.PSObject.Properties['writes'].Value)) {
            if (-not $path -or -not $scopes[$path]) { continue }
            switch -CaseSensitive ($scopes[$path].Value) {
                'phase' { $proofs[$path] = Get-LoadOrderName $phase }
                'masters' { $proofs[$path] = Get-LoadOrderName ($Order[0..4]) }
                default { throw "content-tables.json has no valid order proof for $path" }
            }
        }
    }
    foreach ($entry in $scopes) {
        if (-not $proofs.ContainsKey($entry.Name)) { throw ('content-tables.json has no writer for order proof ' + $entry.Name) }
    }
    return $proofs
}

function Assert-ThornswoodTableOrder([string]$Repo, [string]$Path, [string]$Expected) {
    try { $table = [IO.File]::ReadAllText((Join-Path $Repo $Path)) | ConvertFrom-Json -AsHashtable }
    catch { throw "${Path}: could not read table order proof: $($_.Exception.Message)" }
    $source = [string]$table['source']
    $marks = [regex]::Matches($source, '\b[0-9]+ plugins in load order \(names sha256 [0-9a-f]{12}\)')
    if ($marks.Count -ne 1 -or $marks[0].Value -cne $Expected) {
        throw "$Path does not record the expected order: $Expected. The table says: $source"
    }
}

function Assert-ThornswoodLaidTableOrders([string]$Repo) {
    $chain = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/content-tables.json')) | ConvertFrom-Json
    $order = (Get-ThornswoodContentOrder -Repo $Repo).Names
    $path = 'game/data/npc-population.json'
    $catalogue = [IO.File]::ReadAllText((Join-Path $Repo $path)) | ConvertFrom-Json
    $catalogued = @($catalogue.loadOrder | ForEach-Object { [string]$_.name })
    if (($catalogued -join '|') -ine ($order -join '|')) {
        throw "$path does not record the checkout's load order: $(Get-LoadOrderName $order). The catalogue says: $(Get-LoadOrderName $catalogued)"
    }
    $proofs = Get-ThornswoodTableOrderProofs $chain $catalogued
    foreach ($path in ($proofs.Keys | Sort-Object)) { Assert-ThornswoodTableOrder $Repo $path $proofs[$path] }
}

function Get-ThornswoodContentOrder {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $read = { param($rel) [IO.File]::ReadAllText((Join-Path $Repo $rel)) | ConvertFrom-Json }
    $record = & $read 'records/collection.json'
    . (Join-Path $PSScriptRoot '..\release\RecordShape.ps1')
    $plugins = Read-ThornswoodRecord -Path (Join-Path $Repo 'records/collection-plugins.json') -Kind collection-plugins
    if ([string]$record.collection -ne [string]$plugins.collection -or [string]$record.revision -ne [string]$plugins.revision) {
        throw ('records\collection.json is collection ' + $record.collection + ' revision ' + $record.revision + ', and records\collection-plugins.json ' + $plugins.collection + ' revision ' + $plugins.revision + ': they move together, so there is no telling which load order is meant.')
    }
    $recorded = [string[]]@((& $read 'records/load-order.json').loadOrder | ForEach-Object { [string]$_ } | Where-Object { $_ })
    if (-not $recorded.Count) { throw 'records\load-order.json records no load order, so there is no order to move to the record''s revision.' }
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

<#
  The text of records\load-order.json for -Order, the order the servers run
  on collection -Slug revision -Revision (Get-ThornswoodContentOrder's
  Names): written by hand, one name a line, LF and no byte order mark, so the
  same order gives the same bytes on every machine (Set-LoadOrder.ps1).
#>
function Format-ThornswoodLoadOrderRecord {
    param(
        [Parameter(Mandatory = $true)][string]$Slug,
        [Parameter(Mandatory = $true)][int]$Revision,
        [Parameter(Mandatory = $true)][string[]]$Order
    )
    $esc = { param($v) ([string]$v).Replace('\', '\\').Replace('"', '\"') }
    $lines = New-Object 'Collections.Generic.List[string]'
    $lines.Add('{')
    $lines.Add('  "version": 1,')
    $lines.Add('  "issue": 5191,')
    $lines.Add('  "what": "The load order the servers run and every content build reads, at the collection revision records/collection-plugins.json names: the five masters first and Thornswood-Last.esp last. A plugin a revision adds goes on the end of its kind and none moves to another index (docs/LIGHT-ORDER-DRIFT.md). scripts/mods/Set-LoadOrder.ps1 writes it in the pull request that moves the records to a new revision, and tests/test-5191-load-order.ps1 fails while it is another revision''s.",')
    $lines.Add('  "builtBy": "scripts/mods/Set-LoadOrder.ps1",')
    $lines.Add('  "collection": "' + (& $esc $Slug) + '",')
    $lines.Add('  "revision": ' + $Revision + ',')
    $lines.Add('  "loadOrder": [')
    for ($i = 0; $i -lt $Order.Count; $i++) {
        $lines.Add('    "' + (& $esc $Order[$i]) + '"' + $(if ($i -lt $Order.Count - 1) { ',' } else { '' }))
    }
    $lines.Add('  ]')
    $lines.Add('}')
    return (($lines -join "`n") + "`n")
}

<#
  The key a content build is kept by (#5191): the sha256 of "server <name>"
  and every input file's mode, blob id and path in -Commit, in ordinal
  order, one a line, -Paths being Get-ThornswoodContentPaths's. The same commit
  gives the same key wherever it is read, a box checkout or GitHub's runner.
  Returns { Key; Files }, or throws when git cannot list the inputs.
#>
function Get-ThornswoodContentKey {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][string]$Commit,
        [Parameter(Mandatory = $true)][ValidateSet('dev', 'main')][string]$Server,
        [Parameter(Mandatory = $true)][string[]]$Paths
    )
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = @(& git -C $Repo ls-tree -r --full-tree $Commit -- @Paths 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $was }
    if ($LASTEXITCODE -ne 0) { throw ('the inputs could not be listed: ' + ($out -join ' ')) }
    # Ordinal: Sort-Object follows the culture, and Windows' and Linux's
    # cultures order a hyphen apart differently, so the box and GitHub's
    # runner would give one commit two keys.
    $lines = [string[]]@($out)
    [Array]::Sort($lines, [StringComparer]::Ordinal)
    $text = "server $Server`n" + ($lines -join "`n") + "`n"
    $key = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($text))).ToLowerInvariant()
    return [pscustomobject]@{ Key = $key; Files = $out.Count }
}

<#
  What a content build lays over a checkout (#5191, stage 4e): the content
  plugin, the catalogue Build-ContentOnBox.ps1 makes in the record's order
  ahead of the chain, and every path the chain writes. Nothing generated is
  committed (Patrick's B on #5191), so a reader outside the chain reads these
  from a laid build, never from the commit.
#>
function Get-ThornswoodBuiltPaths {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        # Only the ones git does not hold: content-tables.json's committed
        # names the few a step writes that are sources as well (the cut
        # decisions), and .gitignore lists every other one.
        [switch]$NotCommitted
    )
    $chain = Get-ThornswoodContentPaths -Repo $Repo
    $kept = @()
    if ($NotCommitted) {
        $doc = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/content-tables.json')) | ConvertFrom-Json -AsHashtable
        if ($doc['committed']) { $kept = @($doc['committed'].Keys) }
    }
    $out = New-Object 'Collections.Generic.List[string]'
    foreach ($p in @(@('game/content/Thornswood-Content.esp', 'game/data/npc-population.json') + @($chain.Writes))) {
        if ($kept -ccontains [string]$p) { continue }
        if (-not $out.Contains([string]$p)) { $out.Add([string]$p) }
    }
    return [string[]]$out.ToArray()
}

# Whether repository path -Path is one of -Built, or lies under one (a
# step that writes a folder: docs/systems/lists).
function Test-ThornswoodBuiltPath([string[]]$Built, [string]$Path) {
    $p = $Path.Replace('\', '/').Trim('/')
    return [bool]@($Built | Where-Object { $p -ceq $_ -or $p.StartsWith($_ + '/') }).Count
}

<#
  WHAT A BOX RUN SENDS (#6351). -Paths as a box run of commit -Commit can
  send them: a path the commit holds nothing at or under is left out when the
  build makes it (a built path, or a folder a built path lies in), since an
  earlier step of the build has still to write it there and commit it
  (Build-ContentOnBox.ps1, Save-Step). Any other path stays, so a source the
  commit lacks still stops the artifact by name.

  game/content held only the content plugin. Once #6345 took the plugin out
  of git, main had nothing at game/content, the first step's run kept the
  folder because the folder is not itself built, and New-ThornswoodArtifact
  stopped on it ("has nothing at game/content"): every box content build
  from 67c120a on ended 1 before it reached the box.
#>
function Select-ThornswoodSentPaths {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][string]$Commit,
        [Parameter(Mandatory = $true)][string[]]$Paths,
        [string[]]$Built = @()
    )
    if (-not $PSBoundParameters.ContainsKey('Built')) { $Built = Get-ThornswoodBuiltPaths -Repo $Repo }
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $lines = @(& git -C $Repo ls-tree -r --name-only --full-tree $Commit -- @Paths 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $was }
    if ($code -ne 0) { throw ("git could not list $Commit's files (exit $code): " + (@($lines | Select-Object -First 2) -join ' ')) }
    $out = New-Object 'Collections.Generic.List[string]'
    foreach ($raw in $Paths) {
        $p = $raw.Replace('\', '/').Trim('/')
        $held = @($lines | Where-Object { $_ -ceq $p -or $_.StartsWith($p + '/') }).Count
        $made = (Test-ThornswoodBuiltPath $Built $p) -or @($Built | Where-Object { $_.StartsWith($p + '/') }).Count
        if ($held -or -not $made) { $out.Add($raw) }
    }
    return [string[]]$out.ToArray()
}

<#
  THE LAID BUILD. Get-ContentBuild.ps1 writes what it laid over a checkout to
  temp\content-laid.json there (temp\ is ignored): the build's server, key
  and commit, and every file it wrote with its sha256. Get-ThornswoodLaidBuild
  reads it back held: for -Server, the key of -Commit's inputs, and each file
  still its sha256 in the working tree. So a deploy that sends a built file
  (New-ThornswoodArtifact -Content) sends the box's build of the commit it
  names, as it sends the commit's own files, and refuses anything else.
#>
function Get-ThornswoodLaidBuildFile([string]$Repo) { return (Join-Path $Repo 'temp/content-laid.json') }

function Save-ThornswoodLaidBuild {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][string]$Server,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][string]$Commit,
        [Parameter(Mandatory = $true)][string]$From,
        [Parameter(Mandatory = $true)][Collections.IDictionary]$Files
    )
    $names = [string[]]@($Files.Keys)
    [Array]::Sort($names, [StringComparer]::Ordinal)
    $sorted = [ordered]@{}
    foreach ($n in $names) { $sorted[$n] = [string]$Files[$n] }
    $rec = [ordered]@{ issue = 5191; server = $Server; key = $Key; commit = $Commit; from = $From; files = $sorted }
    $to = Get-ThornswoodLaidBuildFile $Repo
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
    [IO.File]::WriteAllText($to, ($rec | ConvertTo-Json -Depth 4) + "`n", (New-Object Text.UTF8Encoding($false)))
}

function Get-ThornswoodLaidBuild {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][ValidateSet('dev', 'main')][string]$Server,
        [string]$Commit = 'HEAD'
    )
    $how = "pwsh scripts/release/Get-ContentBuild.ps1 -Take -Server $Server lays the box's build of this commit's inputs (on the box, -Kept)"
    $at = Get-ThornswoodLaidBuildFile $Repo
    if (-not (Test-Path -LiteralPath $at -PathType Leaf)) { throw "no content build is laid over $Repo (there is no temp\content-laid.json). $how." }
    try { $rec = [IO.File]::ReadAllText($at) | ConvertFrom-Json -AsHashtable } catch { throw "temp\content-laid.json in $Repo does not read: $($_.Exception.Message). $how." }
    if ([string]$rec.server -cne $Server) { throw "the content build laid over $Repo is the $($rec.server) server's, not $Server's. $how." }
    $sha = (& git -C $Repo rev-parse --verify ($Commit + '^{commit}') 2>$null) -join ''
    if ($LASTEXITCODE -ne 0 -or $sha -cnotmatch '^[0-9a-f]{40}$') { throw "there is no commit $Commit in $Repo" }
    $chain = Get-ThornswoodContentPaths -Repo $Repo -Tool 'scripts/mods/Add-ContentRecords.py'
    $mine = (Get-ThornswoodContentKey -Repo $Repo -Commit $sha -Server $Server -Paths $chain.Paths).Key
    if ([string]$rec.key -cne $mine) { throw "the content build laid over $Repo is of other inputs ($($rec.key), built from $($rec.commit)) than $($sha.Substring(0, 12))'s ($mine). $how." }
    $files = $rec.files
    if (-not ($files -is [Collections.IDictionary]) -or -not $files.Count) { throw "temp\content-laid.json in $Repo names no files. $how." }
    $off = @()
    foreach ($n in @($files.Keys)) {
        $p = Join-Path $Repo $n
        if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { $off += "$n (gone)"; continue }
        $h = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($p))).ToLowerInvariant()
        if ($h -cne [string]$files[$n]) { $off += "$n (changed)" }
    }
    if ($off.Count) { throw ("the content build laid over $Repo is not what it laid any more: " + (@($off | Select-Object -First 5) -join ', ') + $(if ($off.Count -gt 5) { ", and $($off.Count - 5) more" } else { '' }) + ". $how.") }
    return [pscustomobject]@{ Server = $Server; Key = [string]$rec.key; Commit = [string]$rec.commit; From = [string]$rec.from; Files = $files }
}

<#
  The box's build of -Repo's commit for -Server, laid over it, for a deploy,
  a Ship or a measurement that reads what the build writes (#5191, stage 4e):
  the one laid already when it holds (Get-ThornswoodLaidBuild), or else laid
  now by Get-ContentBuild.ps1 -Take. On the box, from the builds it keeps by
  their keys (-Kept, C:\Thornswood-ContentBuilds); anywhere else, from the
  draft Release the deploy agent makes of each build, which takes a GitHub
  sign-in (GH_TOKEN, or gh's own). Throws, naming why, when neither has a
  build of the commit's inputs: the gate's Build-Content verb makes one, and
  the merge release of each merge asks for its own.
#>
function Use-ThornswoodContentBuild {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][ValidateSet('dev', 'main')][string]$Server,
        [string]$Kept = 'C:\Thornswood-ContentBuilds'
    )
    try { return (Get-ThornswoodLaidBuild -Repo $Repo -Server $Server) } catch { $null = $_ }
    $words = @('-NoProfile', '-File', (Join-Path $Repo 'scripts/release/Get-ContentBuild.ps1'), '-Repo', $Repo, '-Server', $Server, '-Take')
    # Combine, not Join-Path: Join-Path stops on a drive this system lacks
    # (C:\ off Windows), where the builds are simply not kept.
    if ($Kept -and (Test-Path -LiteralPath ([IO.Path]::Combine($Kept, $Server)) -PathType Container)) { $words += @('-Kept', $Kept) }
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = @(& pwsh @words 2>&1 | ForEach-Object { "$_" }); $code = $LASTEXITCODE } finally { $ErrorActionPreference = $was }
    foreach ($l in $out) { Write-Host ('  ' + $l) }
    if ($code -ne 0) {
        $stop = @($out | Where-Object { $_ -match '^(STOP\.|MISSING)' })
        throw ("the box's content build of this commit for the $Server server could not be laid over $Repo (" + $(if ($stop.Count) { $stop -join ' ' } else { "Get-ContentBuild.ps1 ended $code" }) + ").")
    }
    return (Get-ThornswoodLaidBuild -Repo $Repo -Server $Server)
}
