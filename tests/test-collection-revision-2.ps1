<#
  test-collection-revision-2.ps1

      pwsh -NoProfile -File .\tests\test-collection-revision-2.ps1
      pwsh -NoProfile -File .\tests\test-collection-revision-2.ps1 -Offline

  docs\COLLECTION-REVISION-2.md, the checklist for the Vortex pass that cuts
  collection revision 2, and scripts\mods\Check-CleanInstall.ps1, the check a
  person runs after a clean install of it. Issue #476.

  WHY. The checklist writes down the exact plugin order a clean install must
  land in, and the order that decides whether anybody gets in is the one the
  server hands out. A written order drifts the day a plugin is added and
  nobody edits the page. So this reads the page's table against the truth,
  every source it can reach:
    - both servers' manifests, over plain HTTP (live on 3000, dev on 7788, the
      address from scripts\vps\vps.json). THIS PART TALKS TO THE VPS: it only
      reads the manifest a launcher reads. -Offline leaves it out.
    - the built server settings on the shipping machine
      (Where.ps1 ServerSettings), which Deploy-DevGamemode.ps1 sends, by
      their full plugins: the table counts no light plugin (#2577).
  A source that is not there says SKIP. One that is there and disagrees with
  the table is a FAIL naming the first position where they part.

  It also checks the page against itself (every rule it adds ties a plugin to
  the one right before it in the table, every rule it removes contradicts the
  table) and runs Check-CleanInstall.ps1 as a child process against its own
  plugin files, lists and manifests, for each kind of difference it must name,
  and proves it wrote nothing.
#>
[CmdletBinding()]
param(
    [string]$DocPath,
    [string]$CheckPath,
    [switch]$Offline,
    # Where the fixtures are built. Default: the system temp folder.
    [string]$Scratch
)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
$Repo = $Here
if (-not $DocPath) { $DocPath = Join-Path $Repo 'docs\COLLECTION-REVISION-2.md' }
if (-not $CheckPath) { $CheckPath = Join-Path $Repo 'scripts\mods\Check-CleanInstall.ps1' }
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Skip([string]$what) { Write-Host "SKIP  $what" }
function Finish {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function Same([string]$a, [string]$b) { return [string]::Equals($a, $b, [StringComparison]::OrdinalIgnoreCase) }

# ------------------------------------------------------------------ the page --
Yes 'docs\COLLECTION-REVISION-2.md exists' (Test-Path -LiteralPath $DocPath)
Yes 'scripts\mods\Check-CleanInstall.ps1 exists' (Test-Path -LiteralPath $CheckPath)
if (-not (Test-Path -LiteralPath $DocPath) -or -not (Test-Path -LiteralPath $CheckPath)) { Finish }

$doc = [IO.File]::ReadAllText($DocPath, [Text.Encoding]::UTF8)
$docLines = $doc -split "`r`n|`n"

# The order table sits between two markers, one row per position.
$start = [Array]::IndexOf($docLines, '<!-- order:start -->')
$end = [Array]::IndexOf($docLines, '<!-- order:end -->')
Yes 'the page marks where its order table starts and ends' ($start -ge 0 -and $end -gt $start)
$order = New-Object Collections.Generic.List[string]
# A row whose server side is still to move says "The servers had <plugin>
# here until the deploy" (#690: Elysium Estate). A server that still has that
# plugin at that position is waiting for its deploy, not wrong.
$until = @{}
$positionsRight = $true
if ($start -ge 0 -and $end -gt $start) {
    foreach ($l in $docLines[($start + 1)..($end - 1)]) {
        $m = [regex]::Match($l, '^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|')
        if (-not $m.Success) { continue }
        if ([int]$m.Groups[1].Value -ne $order.Count + 1) { $positionsRight = $false }
        $had = [regex]::Match($l, 'servers had (\S[^|]*?\.es[mpl]) here until the deploy')
        if ($had.Success) { $until[$order.Count] = $had.Groups[1].Value }
        [void]$order.Add($m.Groups[2].Value)
    }
}
Yes ("the table has rows ({0})" -f $order.Count) ($order.Count -gt 5)
Yes 'the table numbers its positions 1, 2, 3 and on with no gap' $positionsRight
$dupes = @($order | Group-Object { $_.ToLowerInvariant() } | Where-Object Count -gt 1 | ForEach-Object Name)
Yes ('no plugin is in the table twice' + $(if ($dupes) { ' (' + ($dupes -join ', ') + ')' })) ($dupes.Count -eq 0)
$masters = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm')
$mastersFirst = $order.Count -ge 5
for ($i = 0; $i -lt 5 -and $mastersFirst; $i++) { if (-not (Same $order[$i] $masters[$i])) { $mastersFirst = $false } }
Yes 'the table starts with the five base masters in the game''s order' $mastersFirst

function PositionOf([string]$name) {
    for ($i = 0; $i -lt $order.Count; $i++) { if (Same $order[$i] $name) { return $i + 1 } }
    return 0
}

# The rule table: | Plugin | Rule to remove | Rule to add |, each rule written
# "load after <plugin>" or "none".
$ruleRows = 0
foreach ($l in $docLines) {
    $m = [regex]::Match($l, '^\|\s*([^|]+?\.es[mpl])\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$')
    if (-not $m.Success) { continue }
    $p = $m.Groups[1].Value
    $remove = $m.Groups[2].Value
    $add = $m.Groups[3].Value
    if (-not ($remove -match '^(none|load after .+)$' -and $add -match '^(none|load after .+)$')) { continue }
    $ruleRows++
    $at = PositionOf $p
    Yes "the rule table's $p is in the order table" ($at -gt 0)
    if ($add -match '^load after (.+)$') {
        $prev = $Matches[1].Trim()
        $pa = PositionOf $prev
        Yes "$p gets 'load after $prev', the plugin right before it in the table ($pa then $at)" ($pa -gt 0 -and $pa + 1 -eq $at)
    }
    if ($remove -match '^load after (.+)$') {
        $wrong = $Matches[1].Trim()
        $pw = PositionOf $wrong
        # A rule onto a plugin the collection no longer has (ElysiumEstateSSE.esp)
        # ties the plugin to nothing, which is why it goes; the table says so by
        # not having that plugin at all.
        if ($pw -eq 0) { Yes "$p loses 'load after $wrong', a plugin the table does not have" $true }
        else { Yes "$p loses 'load after $wrong', which the table contradicts ($wrong is at $pw, after $at)" ($pw -gt $at) }
    }
}
Yes ("the page has a rule table ({0} rows)" -f $ruleRows) ($ruleRows -gt 0)

Yes 'the page tells the person to run Check-CleanInstall.ps1' ($doc -match 'scripts\\mods\\Check-CleanInstall\.ps1')
Yes 'the page names this harness as what keeps it true' ($doc -match 'tests\\test-collection-revision-2\.ps1')
Yes 'the page tells the person to leave "Skip plugin rules" off' ($doc -match 'Skip\s+plugin rules')
Yes 'the page has no em dash' (-not $doc.Contains([string][char]0x2014))
Yes 'the page never says player' (-not ($doc -match '\bplayers?\b'))

# What wins where the collection and the servers differ (Patrick, 29 September,
# #690): the collection, except CBBE and what we changed later. So the table is
# the collection's order with CBBE.esp left out, and Elysium Estate is the
# plugin the collection installs.
Yes 'position 22 is ElysiumEstate.esp, the plugin the collection installs (#690)' ($order.Count -ge 22 -and (Same $order[21] 'ElysiumEstate.esp'))
Yes 'ElysiumEstateSSE.esp is not in the order: the servers adapt to the collection' ((PositionOf 'ElysiumEstateSSE.esp') -eq 0)
Yes 'CBBE.esp is not in the order: on CBBE our change wins' ((PositionOf 'CBBE.esp') -eq 0)
Yes 'the page says who wins, row by row' ($doc -match '(?m)^\|\s*What\s*\|.*\|\s*Wins\s*\|\s*Why\s*\|')
Yes 'the page says how the servers move, dev first' ($doc -match 'Deploy-DevGamemode\.ps1 -LoadOrder' -and $doc -match 'Deploy-Gamemode\.ps1 -Vortex -NewOrder')

# ------------------------------------------- other people's loose files (#1178) --
# The mods revision 2 adds are the ones Ship-Rules holds loose files for, no
# more and no fewer, and at this page's revision: a mod added here and not
# held there would leave its files out before the collection has them, and one
# held there and not added here would keep other people's files in the packs
# for ever.
function Get-Marked([string]$name) {
    $a = [Array]::IndexOf($docLines, "<!-- ${name}:start -->")
    $b = [Array]::IndexOf($docLines, "<!-- ${name}:end -->")
    if ($a -lt 0 -or $b -le $a) { return $null }
    return @($docLines[($a + 1)..($b - 1)] | Where-Object { $_ -match '^\|' -and $_ -notmatch '^\|\s*(---|Mod|Files)\s*\|' })
}
$adds = Get-Marked 'adds'
$loose = Get-Marked 'loose'
Yes 'the page has the table of mods revision 2 adds' ($null -ne $adds -and $adds.Count -gt 0)
Yes 'and the table of the loose files it takes over' ($null -ne $loose -and $loose.Count -gt 0)
. (Join-Path $Repo 'scripts\release\Ship-Rules.ps1')
$heldIds = @($ShipHeldForCollection | ForEach-Object { [regex]::Match([string]$_.Mod, '\((\d+)\)$') } | Where-Object { $_.Success } |
             ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
$addIds = @($adds | ForEach-Object { ($_ -split '\|')[2].Trim() } | Sort-Object -Unique)
Yes ('every mod Ship-Rules holds files for is added here ({0})' -f ($heldIds -join ', ')) (
    $heldIds.Count -gt 0 -and @($heldIds | Where-Object { $addIds -notcontains $_ -and $_ -ne '154063' }).Count -eq 0)
Yes 'the published additions include the two generator packages and the three mesh mods' (($addIds -join ',') -eq '109194,133232,175362,19532,32117')
Yes 'Styles is explicitly excluded, so its legacy held files expire rather than becoming an addition' ($addIds -notcontains '154063' -and $doc -match 'Styles of Skyrim Mashups \(154063\) is excluded')
Yes 'everything held for a revision waits for revision 2, this page''s' (@($ShipHeldForCollection | Where-Object { -not [string]$_.ContentModel -and [int]$_.Revision -ne 2 }).Count -eq 0)
$byPlugin = @($ShipHeldForCollection | Where-Object { [string]$_.ContentModel })
# The board was the one no revision carries, held while the content plugin
# named it (#2298). The plugin names Thornswood's own board since, so that line
# held nothing and came out on 16 October (#400): nothing waits on the plugin.
Yes '  and nothing waits on the content plugin, now that its board is Thornswood''s own mesh (#2298, #400)' ($byPlugin.Count -eq 0)
$heldRows = @($loose | Where-Object { $_ -match '\*\*Held\*\*' })
Yes 'every held folder or file is named on a Held row of the loose files table' (@($ShipHeldForCollection | Where-Object {
    $leaf = ([string]$_.Path).TrimEnd('\') -replace '^Data\\meshes\\', ''
    $leaf = $leaf.Substring($leaf.LastIndexOf('\') + 1)
    -not @($heldRows | Where-Object { $_.Contains($leaf) }).Count }).Count -eq 0)
$builtRows = 0
foreach ($r in @($loose | Where-Object { $_ -match '\*\*Ours for now \(#1259\)\*\*' })) { $c = ($r -split '\|')[2].Trim(); if ($c -match '^\d+$') { $builtRows += [int]$c } }
Yes ('the rows kept as ours until #1259 count the BodySlide builds Ship-Rules lists ({0} and {1})' -f $builtRows, $ShipBuiltUntil1259.Count) (
    $builtRows -gt 0 -and $builtRows -eq $ShipBuiltUntil1259.Count)
$counted = 0
foreach ($r in $loose) { $c = ($r -split '\|')[2].Trim(); if ($c -match '^\d+$') { $counted += [int]$c } }
Yes ('the loose files table counts the 424 files measured on 29 September ({0})' -f $counted) ($counted -eq 424)

# The original Cowork authoring checklist is now the published revision's
# installation and release checklist. Verify the actual decisions, including
# the exclusions that changed after the draft was written.
$steps = @([regex]::Matches($doc, '(?m)^## (\d+)\. ') | ForEach-Object { [int]$_.Groups[1].Value })
Yes 'the installation and release checklist has fifteen ordered steps' (($steps -join ',') -eq '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15')
$unchecked = @([regex]::Split($doc, '(?m)^## ') | Where-Object { $_ -match '^\d+\. ' -and $_ -notmatch '(?m)^Check:' })
Yes 'every step specifies its verification' ($unchecked.Count -eq 0)
Yes 'the page points to the already published revision 2' ($doc -match '7essxf/revisions/2' -and $doc -match 'Patrick published' -and $doc -match '115 mod packages')
Yes 'the published Pandora and bridge versions are exact' ($doc -match '5\.0\.0-beta' -and $doc -match '3\.1\.1' -and $doc -notmatch '4\.4\.0')
Yes 'Runtime stays at the published 1.0.0' ($doc -match 'Runtime stays 1\.0\.0' -and $doc -match '809366')
Yes 'both unwanted body plugins are named as off' ($doc -match 'CBBE\.esp and RaceMenuMorphsCBBE\.esp stay off')
Yes 'the published rebuilt Content base and later completed recipes are both retained' ($doc -match '141,023 bytes' -and $doc -match '4b004dce782573445381ef013be7e6984c4df09c31a3af7234242f6f2acc7f58' -and $doc -match 'fishing and the collapsed')
Yes 'generation uses separate own folders and checks all three body projects' ($doc -match 'Never generate directly' -and $doc -match 'Body - Astrid' -and $doc -match 'generated record is current')
Yes 'the page requires a separate Dev feed after Main ships' ($doc -match 'must not reset Dev' -and $doc -match 'compare it afterwards')

# -------------------------------------------------------- against the truth --
# Where a server's order parts from the page's: At is the first position that
# differs (-1 for none), Waiting the positions where the server still has the
# plugin the page says it had until the deploy.
function Get-Parting([string[]]$truth) {
    $n = [Math]::Max($truth.Count, $order.Count)
    $at = -1
    $waiting = @()
    for ($i = 0; $i -lt $n; $i++) {
        if ($i -lt $truth.Count -and $i -lt $order.Count -and $until.ContainsKey($i) -and (Same $truth[$i] $until[$i])) {
            $waiting += ("{0} at {1}" -f $truth[$i], ($i + 1))
            continue
        }
        if ($i -ge $truth.Count -or $i -ge $order.Count -or -not (Same $truth[$i] $order[$i])) { $at = $i; break }
    }
    return [pscustomobject]@{ At = $at; Waiting = $waiting }
}

# The wait itself, on made up orders, so it can never turn into a pass for
# anything but the one plugin the page names.
$pageOrder = [string[]]$order.ToArray()
Yes 'the page names what the servers had at position 22 until the deploy' ($until.ContainsKey(21) -and (Same $until[21] 'ElysiumEstateSSE.esp'))
$old = [string[]]$pageOrder.Clone(); $old[21] = 'ElysiumEstateSSE.esp'
$p = Get-Parting $old
Yes 'a server still on ElysiumEstateSSE.esp at 22 is waiting for its deploy, not wrong' ($p.At -lt 0 -and $p.Waiting.Count -eq 1)
$other = [string[]]$pageOrder.Clone(); $other[21] = 'CBBE.esp'
Yes '...and any other plugin there is still a difference' ((Get-Parting $other).At -eq 21)
$moved = [string[]]$pageOrder.Clone(); $moved[21] = $pageOrder[22]; $moved[22] = 'ElysiumEstateSSE.esp'
Yes '...and so is the old plugin anywhere but 22' ((Get-Parting $moved).At -eq 21)
Yes 'the page''s own order parts from nothing' ((Get-Parting $pageOrder).At -lt 0)

function Compare-Order([string]$label, [string[]]$truth) {
    $p = Get-Parting $truth
    $at = $p.At
    if ($p.Waiting.Count) { Write-Host ("WAIT  $label still has {0}, which the page says it had until the deploy" -f ($p.Waiting -join ', ')) }
    $why = ''
    if ($at -ge 0) {
        $t = if ($at -lt $truth.Count) { $truth[$at] } else { '(nothing)' }
        $o = if ($at -lt $order.Count) { $order[$at] } else { '(nothing)' }
        $why = " (they part at position $($at + 1): $label has $t, the page has $o)"
    }
    Yes ("the page's order is $label's order, {0} plugins{1}" -f $truth.Count, $why) ($at -lt 0 -and $p.Waiting.Count -eq 0)
}

$sources = 0
if ($Offline) {
    Skip 'the servers: -Offline'
} else {
    $vpsPath = Join-Path $Repo 'scripts\vps\vps.json'
    $cfg = Get-Content -LiteralPath $vpsPath -Raw | ConvertFrom-Json
    foreach ($w in @('live', 'dev')) {
        $gamePort = if ($w -eq 'live') { [int]$cfg.livePort } else { [int]$cfg.devPort }
        $rp = if ($gamePort -eq 7777) { 3000 } else { $gamePort + 1 }
        $url = "http://$($cfg.address):$rp/api/servers/thornswood/manifest.json"
        $json = $null
        try {
            $req = [Net.WebRequest]::Create($url)
            $req.Timeout = 8000
            $req.ReadWriteTimeout = 8000
            $res = $req.GetResponse()
            try { $sr = New-Object IO.StreamReader($res.GetResponseStream()); $json = $sr.ReadToEnd(); $sr.Close() } finally { $res.Close() }
        } catch { $json = $null }
        $names = @()
        if ($json) { try { $names = @((($json | ConvertFrom-Json).mods) | ForEach-Object { [string]$_.filename } | Where-Object { $_ }) } catch { $names = @() } }
        if ($names.Count -eq 0) { Skip "the $w server's manifest ($url) did not answer"; continue }
        $sources++
        Compare-Order "the $w server" ([string[]]$names)
    }
}
# The page's table is the full plugins (step 6: light plugins are not counted,
# step 10: 48 full plugins), the same list as a manifest's mods; the manifest
# keeps the light ones apart, under light. A server settings loadOrder lists
# every plugin the game loads, full and light, in the game's order, once the
# engine its record names loads light plugins (#1715, ServerOrder.ps1). So the
# settings are compared by their full plugins, which plugin is light read from
# each listed file's header the way Publish-Server reads it (#2577: until this
# the whole loadOrder was compared, and it parted at _ResourcePack.esl, the
# Skyrim.ccc plugin the game loads straight after the masters).
. (Join-Path $Repo 'scripts\deploy\ServerOrder.ps1')
$serverRecord = Join-Path $Repo 'records\server-build.json'
function Get-FullPlugins([string[]]$loadOrder, [string]$record) {
    $isLight = Get-ThornswoodLightTest $loadOrder $record
    return ,[string[]]@($loadOrder | ForEach-Object { @(([string]$_) -split '[\\/]')[-1] } |
                        Where-Object { $_ -and -not (($null -ne $isLight) -and (& $isLight $_)) })
}

$settings = ''
try { $settings = & (Join-Path $Repo 'scripts\release\Where.ps1') ServerSettings } catch { $settings = '' }
if ($settings -and (Test-Path -LiteralPath $settings)) {
    $lo = [string[]]@(((Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json).loadOrder) | Where-Object { $_ })
    if ($lo.Count) {
        # A listed plugin whose header cannot be read here (the game folder the
        # settings were built from is gone) leaves nothing to compare, and the
        # reason is printed.
        $full = $null
        try { $full = Get-FullPlugins $lo $serverRecord } catch { Skip "the built server settings at ${settings}: $($_.Exception.Message)" }
        if ($null -ne $full) {
            Write-Host ("NOTE  the built server settings list {0} plugins, {1} of them full; the page is the full ones" -f $lo.Count, $full.Count)
            $sources++; Compare-Order 'the built server settings' $full
        }
    }
    else { Skip "the built server settings at $settings name no load order" }
} else {
    Skip 'the built server settings: not on this machine'
}

# The full plugins of a settings loadOrder, on made up plugin files, so the
# comparison above can never pass a full plugin out of place.
$fx = Join-Path $Scratch ('thornswood-rev2-order-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $null = New-Item -ItemType Directory -Force -Path $fx
    function FxPlugin([string]$name, [uint32]$flags) {
        $b = New-Object byte[] 24
        [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($b, 0)
        [BitConverter]::GetBytes($flags).CopyTo($b, 8)
        [IO.File]::WriteAllBytes((Join-Path $fx $name), $b)
        return ((Join-Path $fx $name).Replace('\', '/'))
    }
    $yes = Join-Path $fx 'loads-light.json'; [IO.File]::WriteAllText($yes, '{"lightPlugins": true}')
    $no = Join-Path $fx 'loads-none.json'; [IO.File]::WriteAllText($no, '{"binary": "scam_native.node"}')
    $fxOrder = [string[]]@(
        (FxPlugin 'Skyrim.esm' 0x1), (FxPlugin 'Update.esm' 0x1), (FxPlugin 'Dawnguard.esm' 0x1),
        (FxPlugin 'HearthFires.esm' 0x1), (FxPlugin 'Dragonborn.esm' 0x1),
        (FxPlugin '_ResourcePack.esl' 0), (FxPlugin 'Water for ENB.esm' 0x1), (FxPlugin 'TrueHUD.esl' 0x200),
        (FxPlugin 'SkyUI_SE.esp' 0x200), (FxPlugin 'Embers XD.esm' 0x1))
    $f = Get-FullPlugins $fxOrder $yes
    Yes 'a settings loadOrder with light plugins: its full plugins are the masters, then Water for ENB.esm and Embers XD.esm' (
        ($f -join '|') -eq 'Skyrim.esm|Update.esm|Dawnguard.esm|HearthFires.esm|Dragonborn.esm|Water for ENB.esm|Embers XD.esm')
    Yes '...an .esl is light by its name and an .esp by its 0x200 flag' ($f -notcontains '_ResourcePack.esl' -and $f -notcontains 'SkyUI_SE.esp')
    Yes '...which agree with the page until the made up list ends, at position 8' ((Get-Parting $f).At -eq 7)
    $swap = [string[]]$f.Clone(); $swap[5] = 'Embers XD.esm'; $swap[6] = 'Water for ENB.esm'
    Yes '...and two full plugins out of place part at position 6' ((Get-Parting $swap).At -eq 5)
    Yes 'for an engine that loads no light plugin every listed entry is full' ((Get-FullPlugins $fxOrder $no).Count -eq $fxOrder.Count)
    $threw = $false
    try { [void](Get-FullPlugins ([string[]]@($fxOrder + ($fx.Replace('\', '/') + '/Gone.esp'))) $yes) } catch { $threw = $true }
    Yes 'a listed plugin that is not on this machine cannot be told, so nothing is compared' $threw
}
finally {
    Remove-Item -LiteralPath $fx -Recurse -Force -EA SilentlyContinue
}
if ($sources -eq 0) { Skip 'nothing to compare the page''s order with here; the nightly run on the VPS reads the servers' }

# ------------------------------------ the server side follows the collection --
# #690: nothing the repository ships or deploys names Elysium Estate's old
# plugin as something to load, and the old file is on its way out everywhere.
function RepoText([string]$rel) { return [IO.File]::ReadAllText((Join-Path $Repo $rel), [Text.Encoding]::UTF8) }
# The gamemode is gamemode.js and the tables it reads from game\gamemode-tables (#5191).
$gmText = (@(RepoText 'game\gamemode.js') + @(Get-ChildItem -LiteralPath (Join-Path $Repo 'game\gamemode-tables') -Filter *.json -File |
            Sort-Object Name | ForEach-Object { [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8) })) -join "`n"
Yes 'no gamemode table keys a record to ElysiumEstateSSE.esp' (-not ($gmText -match '[0-9a-fA-F]+:ElysiumEstateSSE\.esp'))
$dataHits = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'game\data') -Filter *.json -File |
              Where-Object { [IO.File]::ReadAllText($_.FullName) -match '[0-9a-fA-F]+:ElysiumEstateSSE\.esp' } | ForEach-Object Name)
Yes ('no game\data table keys a record to ElysiumEstateSSE.esp' + $(if ($dataHits) { ' (' + ($dataHits -join ', ') + ')' })) ($dataHits.Count -eq 0)
Yes 'the gamemode still knows Elysium Estate, by the collection''s plugin' ($gmText -match '[0-9a-fA-F]+:ElysiumEstate\.esp')
$required = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'game\required-data') -File | ForEach-Object Name)
Yes 'game\required-data no longer carries ElysiumEstateSSE.esp' ($required -notcontains 'ElysiumEstateSSE.esp')
$rulesText = RepoText 'scripts\release\Ship-Rules.ps1'
Yes 'every pack deletes Data\ElysiumEstateSSE.esp' ($rulesText -match "(?s)\`$ShipDeleteAlways = @\(.*'Data\\ElysiumEstateSSE\.esp'")
Yes '...and no pack carries it' ($rulesText -match "\`$rel -ieq 'Data\\ElysiumEstateSSE\.esp'")
Yes '...and a refresh of the launcher''s game folder leaves it out' ((RepoText 'launcher\app\OwnGame.cs') -match 'rel\.Equals\("Data\\\\ElysiumEstateSSE\.esp"')
# The mod links went with the launcher's mod list (#3146); only the refresh's
# delete rule above may still name the old plugin.
$oldNamed = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'launcher\app') -Filter *.cs -File |
              Where-Object { $_.Name -ne 'OwnGame.cs' -and [IO.File]::ReadAllText($_.FullName) -match 'ElysiumEstateSSE' } | ForEach-Object Name)
Yes ('no other launcher source names ElysiumEstateSSE' + $(if ($oldNamed) { ' (' + ($oldNamed -join ', ') + ')' })) ($oldNamed.Count -eq 0)

# ------------------------------------------------ Check-CleanInstall itself --
$root = Join-Path $Scratch ('thornswood-cleaninstall-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$shell = (Get-Process -Id $PID).Path

# A plugin file with a TES4 header: flags 0x1 a master, 0x200 the ESL flag
# that makes it light. $pad makes two files of one size with other bytes.
function Plugin([string]$dir, [string]$name, [uint32]$flags, [byte]$pad = 0) {
    $b = New-Object byte[] 32
    [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($b, 0)
    [BitConverter]::GetBytes([uint32]8).CopyTo($b, 4)
    [BitConverter]::GetBytes($flags).CopyTo($b, 8)
    for ($i = 24; $i -lt 32; $i++) { $b[$i] = $pad }
    [IO.File]::WriteAllBytes((Join-Path $dir $name), $b)
}
# The zlib crc32, in 64 bit arithmetic: PowerShell reads 0xFFFFFFFF as the
# 32 bit -1, so the constants are spelled as positive 64 bit numbers.
function Crc([byte[]]$bytes) {
    [int64]$all = 4294967295
    [int64]$poly = 3988292384
    [int64]$c = $all
    foreach ($x in $bytes) {
        $c = $c -bxor [int64]$x
        for ($k = 0; $k -lt 8; $k++) { if ($c -band 1) { $c = $poly -bxor ($c -shr 1) } else { $c = $c -shr 1 } }
    }
    return [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32](($c -bxor $all) -band $all)), 0)
}
# A manifest the way the server writes it: every plugin in order, with size
# and crc32 (signed), the base masters with made up numbers the check skips.
function Manifest([string]$path, [string]$data, [string[]]$names) {
    $mods = foreach ($n in $names) {
        $p = Join-Path $data $n
        if ([IO.File]::Exists($p)) { $b = [IO.File]::ReadAllBytes($p); [ordered]@{ crc32 = (Crc $b); filename = $n; size = $b.Length } }
        else { [ordered]@{ crc32 = 1; filename = $n; size = 1 } }
    }
    $doc = [ordered]@{ versionMajor = 1; mods = @($mods); loadOrder = @($names) }
    [IO.File]::WriteAllText($path, ($doc | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
}
function PluginList([string]$path, [string[]]$lines) {
    $text = (@('# This file is used by Skyrim to keep track of your downloaded content.') + $lines) -join "`r`n"
    [IO.File]::WriteAllText($path, $text + "`r`n", (New-Object Text.UTF8Encoding($false)))
}
function Run([string[]]$argList) {
    $ErrorActionPreference = 'Continue'
    $all = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $CheckPath) + $argList
    $out = & $shell @all 2>&1 | Out-String
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}
function Has([string]$text, [string]$part) { return ($text.IndexOf($part, [StringComparison]::Ordinal) -ge 0) }
function Snapshot([string]$dir) {
    return ((Get-ChildItem -LiteralPath $dir -Recurse -File | Sort-Object FullName | ForEach-Object {
        $_.FullName + '|' + $_.Length + '|' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }) -join "`n")
}

try {
    $data = Join-Path $root 'Data'
    $null = New-Item -ItemType Directory -Force -Path $data
    # Real names from the table, a slice of it.
    Plugin $data 'Water for ENB.esm' 0x1
    Plugin $data 'RaceCompatibility.esm' 0x1
    Plugin $data 'LSFX-SSE-Audiosettings.esp' 0x200
    Plugin $data 'aaaGraniteHill.esp' 0
    Plugin $data 'ElysiumEstateSSE.esp' 0
    Plugin $data 'ElysiumEstate.esp' 0
    Plugin $data 'Triumvirate - Mage Archetypes.esp' 0
    Plugin $data 'RaceMenu.esp' 0x200
    Plugin $data 'CBBE.esp' 0
    Plugin $data 'Thornswood-Content.esp' 0
    Plugin $data 'Immersive Patrols II.esp' 0
    Plugin $data 'AHZmoreHUD.esp' 0
    Plugin $data 'Playable Rieklings.esp' 0
    Plugin $data 'Expressive Facegen Morphs.esl' 0
    # What an Anniversary Edition copy of Skyrim has in Data (#479): two full
    # Creation Club masters and a light one.
    Plugin $data 'ccBGSSSE001-Fish.esm' 0x1
    Plugin $data 'ccBGSSSE025-AdvDSGS.esm' 0x1
    Plugin $data 'ccQDRSSE001-SurvivalMode.esl' 0x200

    $server = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm',
                'Water for ENB.esm', 'RaceCompatibility.esm', 'aaaGraniteHill.esp', 'ElysiumEstate.esp',
                'Triumvirate - Mage Archetypes.esp', 'Thornswood-Content.esp', 'Immersive Patrols II.esp',
                'AHZmoreHUD.esp', 'Playable Rieklings.esp')
    $manifest = Join-Path $root 'manifest.json'
    Manifest $manifest $data $server

    # The list a clean install should write: light plugins wherever LOOT put
    # them, a switched off plugin, the server's full plugins in its order.
    $good = @('*Water for ENB.esm', '*Expressive Facegen Morphs.esl', '*RaceCompatibility.esm', '*LSFX-SSE-Audiosettings.esp',
              '*aaaGraniteHill.esp', '*ElysiumEstate.esp', '*Triumvirate - Mage Archetypes.esp', '*RaceMenu.esp', 'CBBE.esp',
              '*Thornswood-Content.esp', '*Immersive Patrols II.esp', '*AHZmoreHUD.esp', '*Playable Rieklings.esp')
    $list = Join-Path $root 'plugins.txt'
    PluginList $list $good
    $before = Snapshot $root

    $r = Run @('-List', $list, '-Data', $data, '-Manifest', $manifest)
    Yes 'the server''s order with light plugins anywhere and a plugin switched off: PASS, exit 0' ($r.Code -eq 0 -and (Has $r.Out 'PASS  all 14 positions'))

    # CBBE.esp switched on: a full plugin the server does not load.
    PluginList $list ($good | ForEach-Object { if ($_ -eq 'CBBE.esp') { '*CBBE.esp' } else { $_ } })
    $r = Run @('-List', $list, '-Data', $data, '-Manifest', $manifest)
    Yes 'CBBE.esp switched on: exit 1, named as extra at its position' ($r.Code -eq 1 -and (Has $r.Out 'extra         CBBE.esp (position 11 here)'))
    Yes '...and nothing else is called out of place for it' (-not (Has $r.Out 'out of place'))

    # Somebody who owns the Anniversary upgrade (#479): its Creation Club
    # plugins switched on, full and light, in Data and not, before and among
    # the server's. Thornswood's own game folder leaves them out, so the check
    # does not count them and it is still a PASS.
    PluginList $list (@('*ccBGSSSE001-Fish.esm', '*ccQDRSSE001-SurvivalMode.esl', '*ccASVSSE001-ALMSIVI.esm') + $good[0..3] +
                      @('*ccBGSSSE025-AdvDSGS.esm') + $good[4..($good.Count - 1)])
    $r = Run @('-List', $list, '-Data', $data, '-Manifest', $manifest)
    Yes 'Anniversary Creation Club plugins switched on as well: still PASS, exit 0' ($r.Code -eq 0 -and (Has $r.Out 'PASS  all 14 positions'))
    Yes '...and it says how many it left out and why' (Has $r.Out '4 of them Creation Club plugins, not counted')
    Yes '...and none is called extra' (-not (Has $r.Out 'extra         '))

    # The old Elysium Estate plugin, the one the servers had until #690: the
    # other plugin name.
    PluginList $list ($good | ForEach-Object { if ($_ -eq '*ElysiumEstate.esp') { '*ElysiumEstateSSE.esp' } else { $_ } })
    $r = Run @('-List', $list, '-Data', $data, '-Manifest', $manifest)
    Yes 'ElysiumEstateSSE.esp in place of ElysiumEstate.esp: the server''s is missing, not in the list' ($r.Code -eq 1 -and (Has $r.Out 'missing       ElysiumEstate.esp (server position 9): it is not in the list at all'))
    Yes '...and ElysiumEstateSSE.esp is extra' (Has $r.Out 'extra         ElysiumEstateSSE.esp')

    # Switched off.
    PluginList $list ($good | ForEach-Object { if ($_ -eq '*AHZmoreHUD.esp') { 'AHZmoreHUD.esp' } else { $_ } })
    $r = Run @('-List', $list, '-Data', $data, '-Manifest', $manifest)
    Yes 'AHZmoreHUD.esp switched off: missing, and it says to switch it on' ($r.Code -eq 1 -and (Has $r.Out 'missing       AHZmoreHUD.esp (server position 13): it is in the list but switched off'))

    # The gap revision 1 left: AHZmoreHUD above Immersive Patrols II.
    $swapped = @($good | Where-Object { $_ -ne '*AHZmoreHUD.esp' })
    $at = [Array]::IndexOf($swapped, '*Immersive Patrols II.esp')
    $swapped = @($swapped[0..($at - 1)]) + '*AHZmoreHUD.esp' + @($swapped[$at..($swapped.Count - 1)])
    PluginList $list $swapped
    $r = Run @('-List', $list, '-Data', $data, '-Manifest', $manifest)
    $oop = ([regex]::Matches($r.Out, 'out of place')).Count
    Yes 'AHZmoreHUD.esp above Immersive Patrols II.esp: exit 1, one plugin out of place' ($r.Code -eq 1 -and $oop -eq 1)
    Yes '...naming where the server has it and what it loads after' ((Has $r.Out 'on the server, where it loads right after') -and ((Has $r.Out 'AHZmoreHUD.esp is at position') -or (Has $r.Out 'Immersive Patrols II.esp is at position')))
    Yes '...and nothing missing or extra' (-not (Has $r.Out 'missing       ') -and -not (Has $r.Out 'extra         '))

    # Enabled twice.
    PluginList $list ($good + '*aaaGraniteHill.esp')
    $r = Run @('-List', $list, '-Data', $data, '-Manifest', $manifest)
    Yes 'a plugin switched on on two lines: named as twice' ($r.Code -eq 1 -and (Has $r.Out 'twice         aaaGraniteHill.esp'))

    PluginList $list $good

    # The wrong bytes: another size, then the same size with other bytes.
    $wrongData = Join-Path $root 'WrongData'
    $null = New-Item -ItemType Directory -Force -Path $wrongData
    Get-ChildItem -LiteralPath $data -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $wrongData }
    [IO.File]::WriteAllBytes((Join-Path $wrongData 'Thornswood-Content.esp'), [byte[]](([IO.File]::ReadAllBytes((Join-Path $data 'Thornswood-Content.esp'))) + [byte]7))
    Plugin $wrongData 'Playable Rieklings.esp' 0 9
    $r = Run @('-List', $list, '-Data', $wrongData, '-Manifest', $manifest)
    Yes 'Thornswood-Content.esp one byte longer: a wrong file, with both sizes' ($r.Code -eq 1 -and (Has $r.Out 'wrong file    Thornswood-Content.esp is 33 bytes here and 32 on the server'))
    Yes 'Playable Rieklings.esp the same size with other bytes: a wrong file by its bytes' (Has $r.Out 'wrong file    Playable Rieklings.esp is the server''s size, but not its bytes')
    Yes '...and the order is not blamed for it' (-not (Has $r.Out 'out of place'))

    # A plugin the server loads as full that is light here.
    Plugin $wrongData 'Thornswood-Content.esp' 0x200
    $r = Run @('-List', $list, '-Data', $wrongData, '-Manifest', $manifest)
    Yes 'Thornswood-Content.esp light here: missing, because the file is light and the server''s is not' ($r.Code -eq 1 -and (Has $r.Out 'missing       Thornswood-Content.esp (server position 11): the file in Data is light'))

    # Switched on and not deployed.
    $thin = Join-Path $root 'ThinData'
    $null = New-Item -ItemType Directory -Force -Path $thin
    Get-ChildItem -LiteralPath $data -File | Where-Object Name -ne 'Immersive Patrols II.esp' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $thin }
    $r = Run @('-List', $list, '-Data', $thin, '-Manifest', $manifest)
    Yes 'Immersive Patrols II.esp switched on and not in Data: missing, deploy in Vortex' ($r.Code -eq 1 -and (Has $r.Out 'missing       Immersive Patrols II.esp (server position 12): it is switched on, but the file is not in Data'))

    # Could not check: exit 2, never a PASS.
    $r = Run @('-List', (Join-Path $root 'nope.txt'), '-Data', $data, '-Manifest', $manifest)
    Yes 'no plugin list: STOP, exit 2' ($r.Code -eq 2 -and (Has $r.Out 'STOP') -and -not (Has $r.Out 'PASS'))
    $r = Run @('-List', $list, '-Data', (Join-Path $root 'NoData'), '-Manifest', $manifest)
    Yes 'no Data folder: STOP, exit 2' ($r.Code -eq 2 -and (Has $r.Out 'STOP'))
    $notManifest = Join-Path $root 'not-a-manifest.json'
    [IO.File]::WriteAllText($notManifest, '{"hello":1}')
    $r = Run @('-List', $list, '-Data', $data, '-Manifest', $notManifest)
    Yes 'a file that is not a manifest: nothing compared, exit 2, no PASS' ($r.Code -eq 2 -and -not (Has $r.Out 'PASS'))
    Remove-Item -LiteralPath $notManifest -Force

    # It only reads. Everything the harness itself changed since the snapshot
    # is under WrongData and ThinData, so those are left out of the second look.
    Remove-Item -LiteralPath $wrongData, $thin -Recurse -Force
    Yes 'Check-CleanInstall.ps1 wrote nothing: every fixture file is as it was' ((Snapshot $root) -eq $before)
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force -EA SilentlyContinue
}

# The script is plain ASCII, like the rest of scripts\, so Windows PowerShell
# 5.1 reads it the same as PowerShell 7.
$bytes = [IO.File]::ReadAllBytes($CheckPath)
Yes 'Check-CleanInstall.ps1 is plain ASCII' (@($bytes | Where-Object { $_ -gt 127 }).Count -eq 0)

Finish
