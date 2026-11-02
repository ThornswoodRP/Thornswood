<#
  CollectionRecord.ps1

  The collection as it should be, records\collection.json, and everything
  that reads it (#5189). Dot-sourced by Check-CollectionRecord.ps1 (the pull
  request's check), New-CollectionRecord.ps1 (the record made from a laid out
  revision) and Publish-CollectionRecord.ps1 (the merge: draft, check,
  publish). Defines functions and nothing else.

  WHY. Until #5189 a mod change was a New-NexusRevision.ps1 line somebody
  worked out by hand (-Add, -Remove, -Mod and -FileId, -Rule), then four
  records changed after the revision was published. Nothing showed the change
  for review before it went to Nexus, and what proved it (permissions, the
  load order, the Last plugin) ran in three places at three times. Now a mod
  change is one pull request to one record: the mods and their files, the
  plugins in the collection's order with the rule that holds each, and what
  each plugin's header says. The pull request's check reads only the
  repository, and the merge drafts the revision the record describes.

  THE RECORD.
      version, issue, what   as every record has
      collection, game       the Nexus collection (7essxf) and its game
      revision               the newest published revision the record has
                             followed; a change leaves it alone, and the
                             records that follow a publish move it
      mods                   one entry per Nexus file the collection installs,
                             in modId then fileId order:
                               { modId, fileId, name, plugins, choices?, dropPatch? }
                             plugins are the plugins the file puts in Data,
                             as the plugin list spells them. choices are the
                             answers to a FOMOD installer, as Vortex writes
                             them in the collection, for a file the record
                             adds (Read-NexusFile.ps1 prints the questions).
                             dropPatch names patches of the mod's old file to
                             drop when its file moves (New-NexusRevision
                             -DropPatch)
      plugins                every plugin of the collection, in its order:
                               { name, enabled?, master, light, masters, after }
                             master and light are what the game reads them
                             as (the name, or the 0x1 and 0x200 flags),
                             masters what its header names, after the
                             collection's "load after" rule for it.
                             enabled is written only when false
      dropped                plugins the servers load that this change takes
                             out, each { name, mod, why }, as
                             collection-dropped.json has them; the records
                             that follow the publish move them there
      wipe                   only when the change moves a full plugin the
                             servers load to another index: whose decision
                             it is that both worlds are wiped for it

  Mod names are only for people reading the record: nothing compares them.

  Runs in PowerShell 7. ASCII only.
#>

$script:CollectionRecordHere = $PSScriptRoot
if (-not $script:CollectionRecordHere) { $script:CollectionRecordHere = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $script:CollectionRecordHere '..\mods\PluginRuleLoops.ps1')
. (Join-Path $script:CollectionRecordHere 'NexusModPlan.ps1')   # Get-NexusChoicesProblems

# The game's own plugins, which no collection installs: the five base
# masters the game loads first whatever any list says, and the update's
# resource pack (records\collection-plugins.json has all six from Data).
$script:CollectionBaseMasters = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm')
$script:CollectionGameOwn = @($script:CollectionBaseMasters + '_ResourcePack.esl')
# Thornswood's own plugins: Content goes up from the repository as a mod of
# the collection, and Last is built on every machine from its recipe.
$script:CollectionOurs = @('Thornswood-Content.esp', 'Thornswood-Last.esp')
$script:CollectionRecordKeys = @('version', 'issue', 'what', 'collection', 'game', 'revision', 'mods', 'plugins', 'dropped', 'wipe')
$script:CollectionModKeys = @('modId', 'fileId', 'name', 'plugins', 'choices', 'dropPatch')
$script:CollectionPluginKeys = @('name', 'enabled', 'master', 'light', 'masters', 'after')
$script:CollectionDroppedKeys = @('name', 'mod', 'why')

function Test-CollectionName([string[]]$List, [string]$Name) {
    foreach ($x in $List) { if ([string]::Equals($x, $Name, [StringComparison]::OrdinalIgnoreCase)) { return $true } }
    return $false
}
function Get-CollectionKeys($Obj) { if ($null -eq $Obj) { return @() }; return @($Obj.PSObject.Properties | ForEach-Object { $_.Name }) }
function Test-CollectionPluginName($Name) { return ($Name -is [string]) -and ($Name -match '^[^\\/:*?"<>|]+\.(esp|esm|esl)$') -and ($Name.Trim() -eq $Name) }

# The record read from its file. Throws a sentence naming the file.
function Read-CollectionRecord([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "There is no collection record at $Path." }
    try { return (([IO.File]::ReadAllText($Path) -replace ('^' + [char]0xFEFF), '') | ConvertFrom-Json) }
    catch { throw ("$Path does not read as JSON: " + ($_.Exception.Message -replace '\s+', ' ')) }
}

# What is wrong with the record's own shape, one line each. Nothing else is
# read: the other checks need a record of this shape.
function Get-CollectionRecordShapeProblems($R) {
    $out = New-Object Collections.Generic.List[string]
    if ($null -eq $R) { $out.Add('the record is empty'); return $out.ToArray() }
    foreach ($k in (Get-CollectionKeys $R)) { if ($script:CollectionRecordKeys -cnotcontains $k) { $out.Add("the record has a field it does not know: $k") } }
    if ($R.version -ne 1) { $out.Add("version is $($R.version), not 1") }
    if (-not ($R.collection -is [string]) -or $R.collection -notmatch '^[a-z0-9]+$') { $out.Add('collection is not a Nexus collection slug') }
    if (-not ($R.game -is [string]) -or $R.game -notmatch '^[a-z0-9]+$') { $out.Add('game is not a Nexus game domain') }
    if (-not ($R.revision -is [int] -or $R.revision -is [long]) -or $R.revision -lt 1) { $out.Add('revision is not a revision number') }
    if ((Get-CollectionKeys $R) -contains 'wipe' -and -not ($R.wipe -is [string] -and $R.wipe.Trim())) { $out.Add('wipe is there but says nobody''s decision') }

    $mods = @($R.mods)
    if (-not ($R.mods -is [array]) -or -not $mods.Count) { $out.Add('there are no mods') ; $mods = @() }
    $seen = @{}
    $prev = $null
    $placedBy = @{}
    foreach ($m in $mods) {
        $who = 'mod ' + $m.modId + ' file ' + $m.fileId
        foreach ($k in (Get-CollectionKeys $m)) { if ($script:CollectionModKeys -cnotcontains $k) { $out.Add("${who}: a field it does not know: $k") } }
        if (-not ($m.modId -is [int] -or $m.modId -is [long]) -or $m.modId -lt 1) { $out.Add("${who}: modId is not a mod number"); continue }
        if (-not ($m.fileId -is [int] -or $m.fileId -is [long]) -or $m.fileId -lt 1) { $out.Add("${who}: fileId is not a file number"); continue }
        $key = "$($m.modId)/$($m.fileId)"
        if ($seen.ContainsKey($key)) { $out.Add("${who}: listed twice") }
        $seen[$key] = $true
        if ($null -ne $prev -and ($m.modId -lt $prev.modId -or ($m.modId -eq $prev.modId -and $m.fileId -lt $prev.fileId))) { $out.Add("${who}: not in modId then fileId order") }
        $prev = $m
        if (-not ($m.name -is [string]) -or -not $m.name.Trim()) { $out.Add("${who}: no name") }
        if (-not ($m.plugins -is [array]) -and $null -ne $m.plugins) { $out.Add("${who}: plugins is not a list") }
        foreach ($p in @($m.plugins)) {
            if ($null -eq $p) { continue }
            if (-not (Test-CollectionPluginName $p)) { $out.Add("${who}: '$p' is not a plugin name"); continue }
            $low = $p.ToLowerInvariant()
            if ($placedBy.ContainsKey($low)) { $out.Add("$p is put in Data by two files: $($placedBy[$low]) and $who") } else { $placedBy[$low] = $who }
        }
        if ((Get-CollectionKeys $m) -contains 'choices') {
            foreach ($c in @(Get-NexusChoicesProblems $m.choices)) { $out.Add("${who}: $c") }
        }
        if ((Get-CollectionKeys $m) -contains 'dropPatch') {
            if (-not ($m.dropPatch -is [array]) -or -not @($m.dropPatch).Count) { $out.Add("${who}: dropPatch is not a list of paths") }
            foreach ($d in @($m.dropPatch)) { if (-not ($d -is [string]) -or -not $d.Trim() -or $d -match '^[\\/]|\.\.') { $out.Add("${who}: dropPatch '$d' is not a path in the mod") } }
        }
    }

    $plugins = @($R.plugins)
    if (-not ($R.plugins -is [array]) -or -not $plugins.Count) { $out.Add('there are no plugins'); $plugins = @() }
    $names = @{}
    foreach ($p in $plugins) {
        $who = 'plugin ' + $p.name
        foreach ($k in (Get-CollectionKeys $p)) { if ($script:CollectionPluginKeys -cnotcontains $k) { $out.Add("${who}: a field it does not know: $k") } }
        if (-not (Test-CollectionPluginName $p.name)) { $out.Add("'$($p.name)' is not a plugin name"); continue }
        $low = $p.name.ToLowerInvariant()
        if ($names.ContainsKey($low)) { $out.Add("${who}: listed twice") }
        $names[$low] = $p.name
        if (Test-CollectionName $script:CollectionGameOwn $p.name) { $out.Add("${who}: the game's own plugin, which no collection installs") }
        if ((Get-CollectionKeys $p) -contains 'enabled' -and $p.enabled -ne $false) { $out.Add("${who}: enabled is written only when false") }
        if (-not ($p.master -is [bool])) { $out.Add("${who}: master is not true or false") }
        if (-not ($p.light -is [bool])) { $out.Add("${who}: light is not true or false") }
        if ($p.name -match '\.(esm|esl)$' -and $p.master -ne $true) { $out.Add("${who}: the game loads an .esm or .esl as a master, so master is true") }
        if ($p.name -match '\.esl$' -and $p.light -ne $true) { $out.Add("${who}: the game loads an .esl as light, so light is true") }
        foreach ($f in @('masters', 'after')) {
            $v = $p.$f
            if (-not ($v -is [array]) -and $null -ne $v) { $out.Add("${who}: $f is not a list"); continue }
            if ($null -eq $v -and (Get-CollectionKeys $p) -notcontains $f) { $out.Add("${who}: no $f") ; continue }
            foreach ($x in @($v)) { if (-not (Test-CollectionPluginName $x)) { $out.Add("${who}: $f names '$x', which is not a plugin name") } }
        }
    }
    foreach ($low in $placedBy.Keys) { if (-not $names.ContainsKey($low)) { $out.Add("$($placedBy[$low]) puts $low in Data and the plugin list does not have it") } }
    foreach ($low in $names.Keys) {
        if (-not $placedBy.ContainsKey($low)) { $out.Add("$($names[$low]) is on the plugin list and no file puts it in Data"); continue }
    }
    # A mod's plugins as the plugin list spells them.
    foreach ($m in $mods) {
        foreach ($p in @($m.plugins)) {
            if (-not ($p -is [string])) { continue }
            $low = $p.ToLowerInvariant()
            if ($names.ContainsKey($low) -and -not [string]::Equals($names[$low], $p, [StringComparison]::Ordinal)) { $out.Add("mod $($m.modId) file $($m.fileId) spells $p, and the plugin list $($names[$low])") }
        }
    }

    if ($null -ne $R.dropped) {
        if (-not ($R.dropped -is [array])) { $out.Add('dropped is not a list') }
        foreach ($d in @($R.dropped)) {
            foreach ($k in (Get-CollectionKeys $d)) { if ($script:CollectionDroppedKeys -cnotcontains $k) { $out.Add("dropped $($d.name): a field it does not know: $k") } }
            if (-not (Test-CollectionPluginName $d.name)) { $out.Add("dropped '$($d.name)' is not a plugin name"); continue }
            if (-not ($d.mod -is [int] -or $d.mod -is [long]) -or $d.mod -lt 1) { $out.Add("dropped $($d.name): mod is not a mod number") }
            if (-not ($d.why -is [string]) -or $d.why.Trim().Length -lt 20) { $out.Add("dropped $($d.name): why does not say why every form it added can go from a world that keeps running") }
            if ($names.ContainsKey($d.name.ToLowerInvariant())) { $out.Add("dropped $($d.name): the plugin list still has it") }
        }
    } else { $out.Add('there is no dropped list (an empty one when nothing goes)') }
    return $out.ToArray()
}

# The enabled plugins as headers PluginRuleLoops.ps1 takes, keyed by name.
function Get-CollectionRecordHeaders($R) {
    $h = @{}
    foreach ($p in @($R.plugins)) {
        if ($p.enabled -eq $false) { continue }
        $h[[string]$p.name] = [pscustomobject]@{ Master = [bool]$p.master; Light = [bool]$p.light; Masters = [string[]]@($p.masters | Where-Object { $_ }) }
    }
    return $h
}

# What is wrong with the load order the record gives, one line each: the
# five things Check-CollectionRules.ps1 says NO to on an installed
# collection, read from the record instead of a Data folder.
#   - a rule naming a plugin the record does not install (or itself);
#   - a rule the list's order breaks;
#   - a rule that goes round with the order the game sets (PluginRuleLoops);
#   - two full plugins next to each other that no chain of rules keeps in
#     that order, so LOOT is free to swap them (which is also how a full
#     plugin with no rule floats).
# Light plugins are left out of the last, as there: the servers' position
# check leaves them out, and LOOT moving one changes nothing it counts.
#
# A plugin the record installs switched off (enabled false) is still in Data,
# with its mod, and the game runs it whenever the servers load it: the
# launcher writes the plugin list the servers were built against and
# switches on every plugin in it (Verify.cs, the golden plugins.txt).
# Revision 6 is so: its own list leaves out CBBE.esp and
# RaceMenuMorphsCBBE.esp, which the servers load, and CommonClothes.esp's
# rule names the second. So a rule may name such a plugin, and its rules are
# links in a chain like any other; it has no place in the list to break.
function Get-CollectionRecordOrderProblems($R) {
    $out = New-Object Collections.Generic.List[string]
    $enabled = @(@($R.plugins) | Where-Object { $_.enabled -ne $false })
    # A plugin switched off has no place in the collection's list, so the
    # layout of a revision (Install-NexusRevision.ps1) puts every one after the
    # list, in name order, and the draft is held to the record in that order.
    # The record writes them there too: on 2 Nov the first change after them
    # put Improved Eyes Skyrim.esp below CBBE.esp and RaceMenuMorphsCBBE.esp,
    # and the draft of revision 7 was discarded for it (#4603).
    $off = @(@($R.plugins) | Where-Object { $_.enabled -eq $false } | ForEach-Object { [string]$_.name })
    if ($off.Count) {
        $all = @(@($R.plugins) | ForEach-Object { [string]$_.name })
        $firstOff = [Array]::IndexOf($all, $off[0])
        $below = @($all[$firstOff..($all.Count - 1)] | Where-Object { $off -notcontains $_ })
        if ($below.Count) { $out.Add("$($below[0]) is below $($off[0]), which is switched off: a plugin switched off goes after every plugin of the list, as the layout of the revision puts it") }
        $sorted = @($off | Sort-Object { $_.ToLowerInvariant() })
        if (($sorted -join '|') -cne ($off -join '|')) { $out.Add("the plugins switched off are not in name order, the order the layout of the revision gives them: $($sorted -join ', ')") }
    }
    $pos = @{}
    for ($i = 0; $i -lt $enabled.Count; $i++) { $pos[([string]$enabled[$i].name).ToLowerInvariant()] = $i }
    $canon = @{}
    foreach ($p in @($R.plugins)) { $canon[([string]$p.name).ToLowerInvariant()] = [string]$p.name }
    foreach ($b in $script:CollectionBaseMasters) { $canon[$b.ToLowerInvariant()] = $b }
    # Rule edges, "a loads before b", by lower case name.
    $next = @{}
    $rules = New-Object Collections.Generic.List[object]
    foreach ($p in @($R.plugins)) {
        $k = ([string]$p.name).ToLowerInvariant()
        $after = @()
        foreach ($a in @($p.after)) {
            if (-not $a) { continue }
            $ak = ([string]$a).ToLowerInvariant()
            if ($ak -eq $k) { $out.Add("$($p.name) is to load after itself"); continue }
            if (-not $canon.ContainsKey($ak)) { $out.Add("$($p.name) is to load after $a, which the record does not install"); continue }
            if (Test-CollectionName $script:CollectionBaseMasters $a) { $after += $canon[$ak]; continue }
            if ($pos.ContainsKey($k) -and $pos.ContainsKey($ak) -and $pos[$ak] -gt $pos[$k]) { $out.Add("the list puts $($p.name) above $($canon[$ak]), which its rule says it loads after") }
            if (-not $next.ContainsKey($ak)) { $next[$ak] = New-Object Collections.Generic.List[string] }
            $next[$ak].Add($k)
            $after += $canon[$ak]
        }
        if ($after.Count) { $rules.Add([pscustomobject]@{ name = [string]$p.name; after = [string[]]$after }) }
    }
    foreach ($l in @(Get-PluginRuleLoops $rules.ToArray() (Get-CollectionRecordHeaders $R))) {
        $out.Add('a rule goes round with the order the game sets, which LOOT reports as a cyclic interaction on every install: ' + $l.Loop + ' (' + ($l.Why -join '; ') + ')')
    }
    # Two full plugins next to each other with no chain of rules between.
    $full = @($enabled | Where-Object { -not $_.light })
    for ($i = 0; $i + 1 -lt $full.Count; $i++) {
        $a = ([string]$full[$i].name).ToLowerInvariant()
        $b = ([string]$full[$i + 1].name).ToLowerInvariant()
        $seen = @{ $a = $true }
        $q = New-Object Collections.Generic.Queue[string]
        $q.Enqueue($a)
        $hit = $false
        while ($q.Count -and -not $hit) {
            $x = $q.Dequeue()
            if (-not $next.ContainsKey($x)) { continue }
            foreach ($y in $next[$x]) {
                if ($y -eq $b) { $hit = $true; break }
                if ($seen.ContainsKey($y)) { continue }
                $seen[$y] = $true
                $q.Enqueue($y)
            }
        }
        if (-not $hit) { $out.Add("no rule keeps $($full[$i + 1].name) after $($full[$i].name), the full plugin above it, so LOOT may swap them: give $($full[$i + 1].name) ""after"": [""$($full[$i].name)""]") }
    }
    return $out.ToArray()
}

# The full plugins the servers would load from this record, in the order the
# game loads them: the base masters, then the record's masters, then the
# rest, each in the record's order, light plugins left out (the servers'
# position check leaves them out). Thornswood-Last.esp is not counted: it is
# built for each order and always loads last.
function Get-CollectionRecordServerFull($R) {
    $en = @(@($R.plugins) | Where-Object { $_.enabled -ne $false -and -not $_.light })
    return @($script:CollectionBaseMasters + @($en | Where-Object { $_.master } | ForEach-Object { [string]$_.name }) + @($en | Where-Object { -not $_.master } | ForEach-Object { [string]$_.name }))
}

<#
  What is wrong with the record against the rest of the repository, one line
  each, with the record's own shape and order checks first.
    $Ctx.Plugins      records\collection-plugins.json, the plugins of the
                      published revision with their bytes
    $Ctx.Last         game\data\last-plugin.json: loadOrder is the order the
                      servers run, the Last plugin's sources what it reads
    $Ctx.Refusals     the mods collection-permissions.js check refuses, each
                      { modId; name; why } (the caller runs it, so this file
                      needs no node)
#>
function Get-CollectionRecordProblems($R, $Ctx) {
    $out = New-Object Collections.Generic.List[string]
    foreach ($s in (Get-CollectionRecordShapeProblems $R)) { $out.Add($s) }
    if ($out.Count) { return $out.ToArray() }
    foreach ($s in (Get-CollectionRecordOrderProblems $R)) { $out.Add($s) }

    if ($null -ne $Ctx.Plugins) {
        if ([string]$Ctx.Plugins.collection -ne [string]$R.collection) { $out.Add("the record is collection $($R.collection), and collection-plugins.json $($Ctx.Plugins.collection)") }
        if ([int]$Ctx.Plugins.revision -ne [int]$R.revision) { $out.Add("the record follows revision $($R.revision), and collection-plugins.json is revision $($Ctx.Plugins.revision): they move together, in the records that follow a publish") }
    }
    foreach ($x in @($Ctx.Refusals)) { if ($null -ne $x) { $out.Add("mod $($x.modId)$(if ($x.name) { ' (' + $x.name + ')' }): $($x.why)") } }

    if ($null -ne $Ctx.Last -and $null -ne $Ctx.Plugins) {
        $recPlugins = @{}
        foreach ($p in @($R.plugins)) { if ($p.enabled -ne $false) { $recPlugins[([string]$p.name).ToLowerInvariant()] = $p } }
        # Installed switched off is not taken out: the launcher switches on
        # what the servers load (Get-CollectionRecordOrderProblems says why).
        $installed = @{}
        foreach ($p in @($R.plugins)) { $installed[([string]$p.name).ToLowerInvariant()] = $true }
        $published = @{}
        foreach ($p in @($Ctx.Plugins.plugins)) { $published[([string]$p.name).ToLowerInvariant()] = $true }
        $published['thornswood-content.esp'] = $true
        $dropped = @{}
        foreach ($d in @($R.dropped)) { if ($d) { $dropped[([string]$d.name).ToLowerInvariant()] = $d } }
        $order = @(@($Ctx.Last.loadOrder) | ForEach-Object { [string]$_ })
        # A plugin the servers load that the record takes out has every form
        # of its own gone from the world (#2320), so it is named, with why.
        $goes = @{}
        foreach ($n in $order) {
            $k = $n.ToLowerInvariant()
            # The game's own and the Last plugin are no collection's to take
            # out; Thornswood-Content.esp is, as mod 192001.
            if ((Test-CollectionName $script:CollectionGameOwn $n) -or $k -eq 'thornswood-last.esp') { continue }
            if ($installed.ContainsKey($k)) { continue }
            if (-not $published.ContainsKey($k)) { continue }
            $goes[$k] = $n
            if (-not $dropped.ContainsKey($k)) { $out.Add("the servers load $n and the record takes it out: name it under dropped, with why every form it added can go from a world that keeps running") }
        }
        foreach ($k in $dropped.Keys) { if (-not $goes.ContainsKey($k)) { $out.Add("dropped names $($dropped[$k].name), which the servers do not load or the record keeps") } }
        # The full plugins the servers load keep their places: a form's id
        # carries its plugin's index, so a full plugin at another index has
        # every form it stored in the world pointing at another plugin.
        # A plugin under dropped is left out first: naming it takes every
        # full plugin after it one index lower, as #2320 says, and that is
        # what dropped is for.
        $runFull = @($order | Where-Object {
                $k = $_.ToLowerInvariant()
                (Test-CollectionName $script:CollectionBaseMasters $_) -or ($recPlugins.ContainsKey($k) -and -not $recPlugins[$k].light)
            })
        $newFull = @(Get-CollectionRecordServerFull $R)
        $moved = @()
        $wasAt = @{}
        for ($i = 0; $i -lt $runFull.Count; $i++) { $wasAt[$runFull[$i].ToLowerInvariant()] = $i }
        for ($i = 0; $i -lt $newFull.Count; $i++) {
            $k = $newFull[$i].ToLowerInvariant()
            if ($wasAt.ContainsKey($k) -and $wasAt[$k] -ne $i) { $moved += ($newFull[$i] + ' from ' + $wasAt[$k] + ' to ' + $i) }
        }
        if ($moved.Count -and -not ((Get-CollectionKeys $R) -contains 'wipe')) {
            $list = (@($moved | Select-Object -First 8) -join ', ') + $(if ($moved.Count -gt 8) { ', and ' + ($moved.Count - 8) + ' more' } else { '' })
            $out.Add("the record moves $($moved.Count) full plugin(s) the servers load to another index ($list), so every form they stored in both worlds would name another plugin. A new full plugin goes on the end of its own kind and a full plugin keeps its place (docs\LIGHT-ORDER-DRIFT.md); a change that has to move one waits for Patrick's decision to wipe both worlds, written under wipe")
        }
    }
    return $out.ToArray()
}

# The plugins the Last plugin's recipe reads, as { Kind; Name; Size; Sha256 }
# (scripts\mods\last_recipe.py, THE FILE). Throws on a file that is not one.
function Read-CollectionLastRecipeSources([string]$Path) {
    $b = [IO.File]::ReadAllBytes($Path)
    if ($b.Length -lt 41 -or [Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'TSLR' -or $b[4] -ne 1) { throw "$Path is not a Last plugin recipe (TSLR 1)." }
    $at = 5 + 4 + 32
    $n = Read-CollectionVarint $b ([ref]$at) $Path
    $out = New-Object Collections.Generic.List[object]
    for ($i = 0; $i -lt $n; $i++) {
        if ($at + 1 -gt $b.Length) { throw "$Path ends inside its sources." }
        $kind = $b[$at]; $at++
        $len = [int](Read-CollectionVarint $b ([ref]$at) $Path)
        if ($at + $len + 32 -gt $b.Length) { throw "$Path ends inside its sources." }
        $name = [Text.Encoding]::UTF8.GetString($b, $at, $len); $at += $len
        $size = Read-CollectionVarint $b ([ref]$at) $Path
        if ($at + 32 -gt $b.Length) { throw "$Path ends inside its sources." }
        $sha = ([BitConverter]::ToString($b, $at, 32)).Replace('-', '').ToLowerInvariant(); $at += 32
        $out.Add([pscustomobject]@{ Kind = $(if ($kind -eq 0) { 'plugin' } else { 'table' }); Name = $name; Size = $size; Sha256 = $sha })
    }
    return $out.ToArray()
}
# A LEB128 number at $At, which moves past it.
function Read-CollectionVarint([byte[]]$B, [ref]$At, [string]$Path) {
    $v = [long]0; $shift = 0
    while ($true) {
        if ($At.Value -ge $B.Length) { throw "$Path ends inside its sources." }
        $c = $B[$At.Value]; $At.Value++
        $v = $v -bor ([long]($c -band 0x7f) -shl $shift)
        if (($c -band 0x80) -eq 0) { return $v }
        $shift += 7
    }
}

# What the record changes against the published revision's plugins, for the
# pull request to say: plugins it adds and takes out, and which of them the
# Last plugin reads, so its rebuild on the new revision is expected. Lines,
# none a problem.
function Get-CollectionRecordNotes($R, $Ctx) {
    $out = New-Object Collections.Generic.List[string]
    if ($null -eq $Ctx.Plugins) { return $out.ToArray() }
    $published = @{}
    foreach ($p in @($Ctx.Plugins.plugins)) { if (-not (Test-CollectionName $script:CollectionGameOwn $p.name)) { $published[([string]$p.name).ToLowerInvariant()] = [string]$p.name } }
    $rec = @{}
    foreach ($p in @($R.plugins)) { if (-not (Test-CollectionName $script:CollectionOurs $p.name)) { $rec[([string]$p.name).ToLowerInvariant()] = [string]$p.name } }
    $added = @($rec.Keys | Where-Object { -not $published.ContainsKey($_) } | Sort-Object | ForEach-Object { $rec[$_] })
    $gone = @($published.Keys | Where-Object { -not $rec.ContainsKey($_) } | Sort-Object | ForEach-Object { $published[$_] })
    if ($added.Count) { $out.Add('plugins revision ' + $R.revision + ' does not have: ' + ($added -join ', ')) }
    if ($gone.Count) { $out.Add('plugins of revision ' + $R.revision + ' the record takes out: ' + ($gone -join ', ')) }
    $reads = @($Ctx.RecipeSources | Where-Object { $_ -and $_.Kind -eq 'plugin' -and ($gone -contains $_.Name) } | ForEach-Object { $_.Name })
    if ($reads.Count) { $out.Add('the Last plugin reads ' + ($reads -join ', ') + ', so it is rebuilt on the new revision without them') }
    return $out.ToArray()
}

# The record's text: a mod, a plugin and a dropped plugin to a line, so a mod
# change is a line or two of diff. LF, no byte order mark, the same bytes on
# Windows PowerShell 5.1 and PowerShell 7.
function ConvertTo-CollectionJsonString([string]$s) {
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $s.ToCharArray()) {
        $c = [int]$ch
        if ($ch -eq '"') { [void]$sb.Append('\"') }
        elseif ($ch -eq '\') { [void]$sb.Append('\\') }
        elseif ($c -lt 0x20 -or $c -gt 0x7e) { [void]$sb.Append(('\u{0:x4}' -f $c)) }
        else { [void]$sb.Append($ch) }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}
function ConvertTo-CollectionJsonList($xs) { return ('[' + ((@($xs | Where-Object { $null -ne $_ }) | ForEach-Object { ConvertTo-CollectionJsonString ([string]$_) }) -join ', ') + ']') }
# A FOMOD's answers on one line, the way the record writes them, and the
# way two sets of answers are compared.
function ConvertTo-CollectionChoicesText($C) {
    $q = { param($s) ConvertTo-CollectionJsonString ([string]$s) }
    $steps = @(@($C.options) | ForEach-Object {
            $groups = @(@($_.groups) | ForEach-Object {
                    $chs = @(@($_.choices) | ForEach-Object { '{ "name": ' + (& $q $_.name) + ', "idx": ' + [long]$_.idx + ' }' })
                    '{ "name": ' + (& $q $_.name) + ', "choices": [' + ($chs -join ', ') + '] }'
                })
            '{ "name": ' + (& $q $_.name) + ', "groups": [' + ($groups -join ', ') + '] }'
        })
    return ('{ "type": ' + (& $q $C.type) + ', "options": [' + ($steps -join ', ') + '] }')
}
function ConvertTo-CollectionRecordText($R) {
    $L = New-Object Collections.Generic.List[string]
    $q = { param($s) ConvertTo-CollectionJsonString ([string]$s) }
    $L.Add('{')
    $L.Add('  "version": 1,')
    $L.Add('  "issue": ' + [int]$R.issue + ',')
    $L.Add('  "what": ' + (& $q $R.what) + ',')
    $L.Add('  "collection": ' + (& $q $R.collection) + ',')
    $L.Add('  "game": ' + (& $q $R.game) + ',')
    $L.Add('  "revision": ' + [int]$R.revision + ',')
    if ((Get-CollectionKeys $R) -contains 'wipe') { $L.Add('  "wipe": ' + (& $q $R.wipe) + ',') }
    $L.Add('  "mods": [')
    $mods = @($R.mods)
    for ($i = 0; $i -lt $mods.Count; $i++) {
        $m = $mods[$i]
        $row = '    { "modId": ' + [long]$m.modId + ', "fileId": ' + [long]$m.fileId + ', "name": ' + (& $q $m.name) + ', "plugins": ' + (ConvertTo-CollectionJsonList $m.plugins)
        if ((Get-CollectionKeys $m) -contains 'choices') { $row += ', "choices": ' + (ConvertTo-CollectionChoicesText $m.choices) }
        if ((Get-CollectionKeys $m) -contains 'dropPatch') { $row += ', "dropPatch": ' + (ConvertTo-CollectionJsonList $m.dropPatch) }
        $L.Add($row + ' }' + $(if ($i -lt $mods.Count - 1) { ',' } else { '' }))
    }
    $L.Add('  ],')
    $L.Add('  "plugins": [')
    $plugins = @($R.plugins)
    for ($i = 0; $i -lt $plugins.Count; $i++) {
        $p = $plugins[$i]
        $row = '    { "name": ' + (& $q $p.name)
        if ($p.enabled -eq $false) { $row += ', "enabled": false' }
        $row += ', "master": ' + $(if ($p.master) { 'true' } else { 'false' }) + ', "light": ' + $(if ($p.light) { 'true' } else { 'false' })
        $row += ', "masters": ' + (ConvertTo-CollectionJsonList $p.masters) + ', "after": ' + (ConvertTo-CollectionJsonList $p.after) + ' }'
        $L.Add($row + $(if ($i -lt $plugins.Count - 1) { ',' } else { '' }))
    }
    $L.Add('  ],')
    $dropped = @($R.dropped | Where-Object { $_ })
    if (-not $dropped.Count) { $L.Add('  "dropped": []') }
    else {
        $L.Add('  "dropped": [')
        for ($i = 0; $i -lt $dropped.Count; $i++) {
            $d = $dropped[$i]
            $L.Add('    { "name": ' + (& $q $d.name) + ', "mod": ' + [long]$d.mod + ', "why": ' + (& $q $d.why) + ' }' + $(if ($i -lt $dropped.Count - 1) { ',' } else { '' }))
        }
        $L.Add('  ]')
    }
    $L.Add('}')
    return (($L -join "`n") + "`n")
}

# The record's line for one plugin file, read from its own header, with an
# empty "after" for the pull request's author to fill in
# (New-CollectionRecord.ps1 -Plugin). Null when the file is not a plugin
# with a TES4 header.
function ConvertTo-CollectionPluginLine([string]$Path) {
    $h = Read-PluginRuleHeader $Path
    if ($null -eq $h) { return $null }
    $name = [IO.Path]::GetFileName($Path)
    return ('    { "name": ' + (ConvertTo-CollectionJsonString $name) + ', "master": ' + $(if ($h.Master) { 'true' } else { 'false' }) +
        ', "light": ' + $(if ($h.Light) { 'true' } else { 'false' }) + ', "masters": ' + (ConvertTo-CollectionJsonList $h.Masters) + ', "after": [] },')
}

$script:CollectionRecordWhat = 'The Thornswood collection on Nexus as it should be: each Nexus file it installs and the plugins that file puts in Data, every plugin in the collection''s order with the rule that holds it there and what its header says, and the plugins the servers load that a change takes out. A mod change is a pull request to this file (docs\COLLECTION-CHANGES.md): Check-CollectionRecord.ps1 holds it to the load order, the pages'' permissions and the servers'' order, and the merge drafts the revision it describes, lays it out, holds it to this record and publishes it (Publish-CollectionRecord.ps1). revision is the newest published revision the record has followed.'

<#
  The record a laid out revision makes: Install-NexusRevision.ps1 -Record
  -KeepPlugins wrote $Dir (layout.json, files.txt and the plugins themselves
  under plugins\). Each plugin's facts are read from its own header, the
  plugins each file puts in Data from files.txt, the order and the rules from
  layout.json. Throws a sentence when something it needs is not there.
#>
function New-CollectionRecordFromLayout([string]$Dir) {
    $layoutPath = Join-Path $Dir 'layout.json'
    $filesPath = Join-Path $Dir 'files.txt'
    $pluginDir = Join-Path $Dir 'plugins'
    foreach ($p in @($layoutPath, $filesPath)) { if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "$Dir has no $(Split-Path -Leaf $p): it is not the folder Install-NexusRevision.ps1 -Record wrote." } }
    if (-not (Test-Path -LiteralPath $pluginDir -PathType Container)) { throw "$Dir has no plugins folder: lay the revision out with -KeepPlugins, so each plugin's header can be read." }
    $layout = ([IO.File]::ReadAllText($layoutPath) -replace ('^' + [char]0xFEFF), '') | ConvertFrom-Json
    $byFile = @{}
    foreach ($line in [IO.File]::ReadAllLines($filesPath)) {
        if (-not $line -or $line.StartsWith('#')) { continue }
        $c = $line.Split("`t")
        if ($c.Count -lt 4) { continue }
        if ($c[3] -notmatch '^Data\\([^\\]+\.(esp|esm|esl))$') { continue }
        $fid = [long]$c[2]
        if (-not $byFile.ContainsKey($fid)) { $byFile[$fid] = New-Object Collections.Generic.List[string] }
        $byFile[$fid].Add($Matches[1])
    }
    $canon = @{}
    foreach ($p in @($layout.plugins)) { $canon[([string]$p.name).ToLowerInvariant()] = [string]$p.name }
    foreach ($b in $script:CollectionBaseMasters) { $canon[$b.ToLowerInvariant()] = $b }
    $rules = @{}
    foreach ($r in @($layout.pluginRules)) { if ($r) { $rules[([string]$r.name).ToLowerInvariant()] = @($r.after | ForEach-Object { $k = ([string]$_).ToLowerInvariant(); if ($canon.ContainsKey($k)) { $canon[$k] } else { [string]$_ } }) } }
    $listPos = @{}
    $i = 0
    foreach ($p in @($layout.plugins)) { $listPos[([string]$p.name).ToLowerInvariant()] = $i; $i++ }
    $mods = New-Object Collections.Generic.List[object]
    foreach ($m in @(@($layout.mods) | Sort-Object { [long]$_.modId }, { [long]$_.fileId })) {
        $placed = @()
        if ($byFile.ContainsKey([long]$m.fileId)) {
            $placed = @(@($byFile[[long]$m.fileId]) | Where-Object { $listPos.ContainsKey($_.ToLowerInvariant()) } | Sort-Object { $listPos[$_.ToLowerInvariant()] } | ForEach-Object { $canon[$_.ToLowerInvariant()] })
        }
        $mods.Add([pscustomobject][ordered]@{ modId = [long]$m.modId; fileId = [long]$m.fileId; name = [string]$m.name; plugins = [string[]]$placed })
    }
    $plugins = New-Object Collections.Generic.List[object]
    foreach ($p in @($layout.plugins)) {
        $n = [string]$p.name
        $h = Read-PluginRuleHeader (Join-Path $pluginDir $n)
        if ($null -eq $h) {
            if (-not (Test-Path -LiteralPath (Join-Path $pluginDir $n) -PathType Leaf)) { throw "$pluginDir has no $n, so what its header says is not known." }
            # A file with no TES4 header is placed by its name alone, as
            # Install-NexusRevision places it.
            $h = [pscustomobject]@{ Master = ($n -match '\.(esm|esl)$'); Light = ($n -match '\.esl$'); Masters = [string[]]@() }
        }
        $o = [ordered]@{ name = $n }
        if ($p.enabled -eq $false) { $o.enabled = $false }
        $o.master = [bool]$h.Master
        $o.light = [bool]$h.Light
        $o.masters = [string[]]@($h.Masters)
        $o.after = [string[]]@($(if ($rules.ContainsKey($n.ToLowerInvariant())) { $rules[$n.ToLowerInvariant()] } else { @() }))
        $plugins.Add([pscustomobject]$o)
    }
    return [pscustomobject][ordered]@{
        version    = 1
        issue      = 5189
        what       = $script:CollectionRecordWhat
        collection = [string]$layout.collection.slug
        game       = [string]$layout.collection.domain
        revision   = [int]$layout.collection.revision
        mods       = $mods.ToArray()
        plugins    = $plugins.ToArray()
        dropped    = @()
    }
}

# Where two records part, one line each, leaving out what only people read
# (mod names), what moves only when the records follow a publish (revision)
# and what goes with the change and not the revision (dropped, wipe,
# dropPatch). Publish-CollectionRecord.ps1 holds the record a draft makes to
# the record that was merged with it.
function Compare-CollectionRecord($Want, $Got) {
    $out = New-Object Collections.Generic.List[string]
    $files = { param($r) @(@($r.mods) | ForEach-Object { "$($_.modId)/$($_.fileId)" }) }
    $w = @(& $files $Want); $g = @(& $files $Got)
    foreach ($x in $w) { if ($g -notcontains $x) { $out.Add("the record has mod/file $x and the draft does not") } }
    foreach ($x in $g) { if ($w -notcontains $x) { $out.Add("the draft has mod/file $x and the record does not") } }
    $gm = @{}
    foreach ($m in @($Got.mods)) { $gm["$($m.modId)/$($m.fileId)"] = $m }
    foreach ($m in @($Want.mods)) {
        $k = "$($m.modId)/$($m.fileId)"
        if (-not $gm.ContainsKey($k)) { continue }
        $a = (@($m.plugins) -join ', '); $b = (@($gm[$k].plugins) -join ', ')
        if ($a -cne $b) { $out.Add("mod/file ${k}: the record says it puts [$a] in Data, the draft [$b]") }
    }
    $wn = @(@($Want.plugins) | ForEach-Object { [string]$_.name })
    $gn = @(@($Got.plugins) | ForEach-Object { [string]$_.name })
    if (($wn -join '|') -cne ($gn -join '|')) {
        $out.Add('the plugin list differs: the record has ' + $wn.Count + ' plugins, the draft ' + $gn.Count)
        for ($i = 0; $i -lt [Math]::Max($wn.Count, $gn.Count); $i++) {
            $a = if ($i -lt $wn.Count) { $wn[$i] } else { '(none)' }
            $b = if ($i -lt $gn.Count) { $gn[$i] } else { '(none)' }
            if ($a -cne $b) { $out.Add("  at $($i + 1) the record has $a, the draft $b"); break }
        }
    }
    $gp = @{}
    foreach ($p in @($Got.plugins)) { $gp[([string]$p.name).ToLowerInvariant()] = $p }
    foreach ($p in @($Want.plugins)) {
        $k = ([string]$p.name).ToLowerInvariant()
        if (-not $gp.ContainsKey($k)) { continue }
        $o = $gp[$k]
        foreach ($f in @('master', 'light')) { if ([bool]$p.$f -ne [bool]$o.$f) { $out.Add("$($p.name): the record says $f $([bool]$p.$f), its header in the draft $([bool]$o.$f)") } }
        if (($p.enabled -eq $false) -ne ($o.enabled -eq $false)) { $out.Add("$($p.name): the record has it $(if ($p.enabled -eq $false) { 'off' } else { 'on' }), the draft $(if ($o.enabled -eq $false) { 'off' } else { 'on' })") }
        if ((@($p.masters) -join '|').ToLowerInvariant() -ne (@($o.masters) -join '|').ToLowerInvariant()) { $out.Add("$($p.name): the record says its masters are [$(@($p.masters) -join ', ')], its header in the draft [$(@($o.masters) -join ', ')]") }
        $wa = @(@($p.after) | ForEach-Object { ([string]$_).ToLowerInvariant() } | Sort-Object) -join '|'
        $ga = @(@($o.after) | ForEach-Object { ([string]$_).ToLowerInvariant() } | Sort-Object) -join '|'
        if ($wa -ne $ga) { $out.Add("$($p.name): the record says it loads after [$(@($p.after) -join ', ')], the draft [$(@($o.after) -join ', ')]") }
    }
    return $out.ToArray()
}

<#
  What New-NexusRevision.ps1 has to do to the published revision to make the
  revision the record describes. $Collection is the published revision's
  collection.json, as Vortex wrote it. Returns
    { Add; Remove; Move; Rule; Problems; Empty }
  Add     one per new file: { modId; fileId; plugins = [{ name; after }];
          choices? }, New-NexusRevision -Add's file
  Remove  mod numbers, every file of each gone (New-NexusRevision -Remove)
  Move    { modId; fileId; dropPatch } (-Mod, -FileId, -DropPatch)
  Rule    { name; after } for a plugin already on the list whose rule changes
          (-Rule's file)
  Problems what the record asks that New-NexusRevision cannot do, one line
          each; nothing is drafted while there is one.
  Anything else the record changes (a light flag, a plugin switched off, the
  order) New-NexusRevision does not make from a record, and the layout of the
  draft is held to the record before it is published, so it stops there.
#>
function Get-CollectionChangeSet($R, $Collection) {
    $problems = New-Object Collections.Generic.List[string]
    $pub = @(@($Collection.mods) | Where-Object { $_.source -and $_.source.type -eq 'nexus' } | ForEach-Object { [pscustomobject]@{ ModId = [long]$_.source.modId; FileId = [long]$_.source.fileId; Name = [string]$_.name } })
    $rec = @(@($R.mods) | ForEach-Object { [pscustomobject]@{ ModId = [long]$_.modId; FileId = [long]$_.fileId; Entry = $_ } })
    $pubKeys = @{}; foreach ($e in $pub) { $pubKeys["$($e.ModId)/$($e.FileId)"] = $e }
    $recKeys = @{}; foreach ($e in $rec) { $recKeys["$($e.ModId)/$($e.FileId)"] = $e }
    $pubLeft = @($pub | Where-Object { -not $recKeys.ContainsKey("$($_.ModId)/$($_.FileId)") })
    $recLeft = @($rec | Where-Object { -not $pubKeys.ContainsKey("$($_.ModId)/$($_.FileId)") })
    $mods = @(@($pubLeft | ForEach-Object { $_.ModId }) + @($recLeft | ForEach-Object { $_.ModId }) | Sort-Object -Unique)
    $add = New-Object Collections.Generic.List[object]
    $remove = New-Object Collections.Generic.List[long]
    $move = New-Object Collections.Generic.List[object]
    $addedPlugins = @{}
    $pluginBy = @{}
    foreach ($p in @($R.plugins)) { $pluginBy[([string]$p.name).ToLowerInvariant()] = $p }
    foreach ($mid in $mods) {
        $there = @($pubLeft | Where-Object { $_.ModId -eq $mid })
        $here = @($recLeft | Where-Object { $_.ModId -eq $mid })
        $pAll = @($pub | Where-Object { $_.ModId -eq $mid })
        if ($there.Count -and -not $here.Count) {
            if ($there.Count -eq $pAll.Count) { $remove.Add($mid) }
            else { $problems.Add("the record takes file $(@($there | ForEach-Object { $_.FileId }) -join ', ') of mod $mid out and keeps its others; New-NexusRevision takes a mod out whole") }
            continue
        }
        if ($here.Count -and -not $there.Count) {
            foreach ($e in $here) {
                $pl = @()
                foreach ($n in @($e.Entry.plugins)) {
                    $pp = $pluginBy[([string]$n).ToLowerInvariant()]
                    $addedPlugins[([string]$n).ToLowerInvariant()] = $true
                    $pl += [pscustomobject][ordered]@{ name = [string]$n; after = [string[]]@($pp.after) }
                }
                $ad = [ordered]@{ modId = $mid; fileId = $e.FileId; plugins = $pl }
                if ((Get-CollectionKeys $e.Entry) -contains 'choices') { $ad.choices = $e.Entry.choices }
                $add.Add([pscustomobject]$ad)
            }
            continue
        }
        if ($there.Count -eq 1 -and $here.Count -eq 1 -and $pAll.Count -eq 1) {
            if ((Get-CollectionKeys $here[0].Entry) -contains 'choices') { $problems.Add("mod $mid moves to file $($here[0].FileId) with choices; New-NexusRevision moves a file and keeps no installer answers for the new one") }
            $mv = [ordered]@{ modId = $mid; fileId = $here[0].FileId; dropPatch = @() }
            if ((Get-CollectionKeys $here[0].Entry) -contains 'dropPatch') { $mv.dropPatch = [string[]]@($here[0].Entry.dropPatch) }
            $move.Add([pscustomobject]$mv)
            continue
        }
        $problems.Add("mod $mid has files $(@($pAll | ForEach-Object { $_.FileId }) -join ', ') in the published revision and $(@(@($R.mods) | Where-Object { [long]$_.modId -eq $mid } | ForEach-Object { $_.fileId }) -join ', ') in the record; New-NexusRevision moves a mod with one file to one new file, so which file becomes which is not known")
    }
    # A file both keep: its answers are the published entry's, which the next
    # revision carries as they are, so the record may only say them again.
    foreach ($m in @($R.mods)) {
        if ((Get-CollectionKeys $m) -notcontains 'choices' -or -not $pubKeys.ContainsKey("$([long]$m.modId)/$([long]$m.fileId)")) { continue }
        $e = @(@($Collection.mods) | Where-Object { $_.source -and $_.source.type -eq 'nexus' -and [long]$_.source.fileId -eq [long]$m.fileId }) | Select-Object -First 1
        $had = if ($e -and $e.PSObject.Properties['choices'] -and $e.choices) { ConvertTo-CollectionChoicesText $e.choices } else { '' }
        if ((ConvertTo-CollectionChoicesText $m.choices) -cne $had) { $problems.Add("mod $($m.modId) file $($m.fileId) gives choices that are not the published revision's; New-NexusRevision does not change a kept file's installer answers") }
    }
    foreach ($m in @($R.mods)) {
        if ((Get-CollectionKeys $m) -contains 'dropPatch' -and -not @($move | Where-Object { $_.modId -eq [long]$m.modId }).Count) {
            $problems.Add("mod $($m.modId) file $($m.fileId) names dropPatch and its file does not move: a patch is dropped only when the file it was made for goes")
        }
    }
    # Rules, as the published revision gives them (lower case, as Vortex
    # keeps them), for every plugin the record keeps.
    $pubRules = @{}
    $prs = @()
    if ($Collection.pluginRules -and $Collection.pluginRules.plugins) { $prs = @($Collection.pluginRules.plugins) }
    foreach ($x in $prs) { $pubRules[([string]$x.name).ToLowerInvariant()] = @(@($x.after) | ForEach-Object { ([string]$_).ToLowerInvariant() } | Sort-Object) -join '|' }
    $rule = New-Object Collections.Generic.List[object]
    foreach ($p in @($R.plugins)) {
        $k = ([string]$p.name).ToLowerInvariant()
        if ($addedPlugins.ContainsKey($k)) { continue }
        $want = @(@($p.after) | ForEach-Object { ([string]$_).ToLowerInvariant() } | Sort-Object) -join '|'
        $had = if ($pubRules.ContainsKey($k)) { $pubRules[$k] } else { '' }
        if ($want -ne $had) {
            if (-not @($p.after).Count) { $problems.Add("the record takes $($p.name)'s rule away; New-NexusRevision -Rule replaces a rule and cannot leave a plugin with none, which would float") ; continue }
            $rule.Add([pscustomobject][ordered]@{ name = [string]$p.name; after = [string[]]@($p.after) })
        }
    }
    return [pscustomobject]@{
        Add      = $add.ToArray()
        Remove   = [long[]]$remove.ToArray()
        Move     = $move.ToArray()
        Rule     = $rule.ToArray()
        Problems = $problems.ToArray()
        Empty    = (-not $add.Count -and -not $remove.Count -and -not $move.Count -and -not $rule.Count)
    }
}

# The change, a line each, as a pull request or the merge says it.
function Format-CollectionChangeSet($C) {
    $out = New-Object Collections.Generic.List[string]
    foreach ($a in @($C.Add)) { $out.Add("add mod $($a.modId) file $($a.fileId)" + $(if (@($a.plugins).Count) { ': ' + ((@($a.plugins) | ForEach-Object { $_.name + $(if (@($_.after).Count) { ' after ' + (@($_.after) -join ', ') } else { '' }) }) -join '; ') } else { '' })) }
    foreach ($m in @($C.Move)) { $out.Add("move mod $($m.modId) to file $($m.fileId)" + $(if (@($m.dropPatch).Count) { ', dropping its patch of ' + (@($m.dropPatch) -join ', ') } else { '' })) }
    foreach ($r in @($C.Remove)) { $out.Add("take mod $r out") }
    foreach ($r in @($C.Rule)) { $out.Add("$($r.name) loads after $(@($r.after) -join ', ')") }
    return $out.ToArray()
}
