<#
  test-load-order.ps1

      pwsh -NoProfile -File .\tests\test-load-order.ps1

  The rule the pack's plugin list is put through before it ships, driven with
  stubs so it needs no game folder, no Data and no server.

  WHY. Publish-Update.ps1 puts the reference plugin list into the server's
  order before zipping it (Get-ReferenceInServerOrder), so the pack's list is
  in the server's order by construction rather than by comparison. The To Do
  List entry on the seven copies of the list (275 when this was written) says
  what that leaves: "the reordering makes position true rather than proving
  it". Nothing tested it. Get-LoadOrderReordered and
  Get-LoadOrderFirstMismatch appeared in LoadOrder.ps1, Publish-Update.ps1
  and Check-Manifest.ps1 and in no test. CI runs every tests\test-*.ps1, but
  there was none for these, so a change that broke the rule would have gone
  out green and been found at the door as LOAD ORDER ERROR.

  MEASURED 24 September on Patrick's machine, read only. Profile\OwnGame has
  Thornswood-Content.esp on line 31 of 95. Profile\Default, the reference list
  a pack is built from, was rewritten at 22:39 on 23 September and has it on
  line 95 of 95: Install-ThornswoodContent.ps1 anchors on a plugin that is no
  longer in the order and appends. Against the built server's own order
  (server-settings.json in the skymp build, 57 plugins) that list first
  differs at index 23, where it has Populated Cities Towns Villages
  Legendary.esp and the server has Thornswood-Content.esp. Put through
  Get-LoadOrderReordered it moves 34 lines, the first of them
  Thornswood-Content.esp, and then the two agree at every position. The first
  case below is that list in miniature, and it is checked to disagree before
  it is checked to agree, because a test that never saw a stale copy fail
  proves nothing by passing.

  THE LAUNCHER. LoadOrder.ps1 says it and launcher\app\LoadOrder.cs "are held to
  identical output by a test". No such test was in the repo: the commit that
  added both on 20 September measured it once, by hand. The last part of this
  file compiles LoadOrder.cs, with the compiler the build runs
  (Add-LauncherType, tests\Launcher-Csc.ps1, #2821; off Windows it says SKIP,
  that compiler is only there), and runs both sides over the same cases, so
  that sentence is true from now on.

  -LoadOrderPath and -LauncherPath point it at other copies, which is how it
  was shown to fail on a broken rule before it was trusted to pass.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$LoadOrderPath, [string]$LauncherPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $LoadOrderPath) { $LoadOrderPath = Join-Path $Here 'scripts\mods\LoadOrder.ps1' }
if (-not $LauncherPath) { $LauncherPath = Join-Path $Here 'launcher\app\LoadOrder.cs' }
. $LoadOrderPath
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's compiler and C# version (#2821)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

# Lists compared as text, so a $null, an empty list and a list of one are
# three different answers and a failure can say what it got.
function Show($v) {
    if ($null -eq $v) { return '<null>' }
    if ($v -is [string]) { return 's:' + $v }
    if ($v -is [int]) { return 'i:' + $v }
    if ($v -is [Collections.IEnumerable]) {
        $parts = New-Object Collections.Generic.List[string]
        foreach ($x in $v) { [void]$parts.Add([string]$x) }
        return ('n' + $parts.Count + ':' + ($parts -join '|'))
    }
    return 'o:' + [string]$v
}

function Same([string]$what, $got, $want) {
    $g = Show $got
    $w = Show $want
    Yes $what ([string]::Equals($g, $w, [StringComparison]::Ordinal))
    if ($g -ne $w) {
        Write-Host "      wanted $w" -ForegroundColor Red
        Write-Host "      got    $g" -ForegroundColor Red
    }
}

# ---- the stubs --------------------------------------------------------------
#
# What is in Data and which of it is light. The script blocks are the same
# shape Publish-Update.ps1 hands the functions (a name in, a bool out), and
# they read these sets instead of plugin headers on a disk.
$script:inData = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$script:light = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($n in @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm',
                 'Water for ENB.esm', 'Embers XD.esm', 'Cutting Room Floor.esp', 'Thornswood-Content.esp',
                 'Populated Cities Towns Villages Legendary.esp', 'Immersive Armors.esp', 'SkyUI_SE.esp',
                 'New Thing.esp', 'ccBGSSSE025-AdvDSGS.esm', 'ccBGSSSE001-Fish.esm')) { [void]$script:inData.Add($n) }
foreach ($n in @('Light Patch.esp', 'ccQDRSSE001-SurvivalMode.esl')) { [void]$script:inData.Add($n); [void]$script:light.Add($n) }

$isLight          = { param($n) $script:light.Contains("$n".Trim()) }
$exists           = { param($n) $script:inData.Contains("$n".Trim()) }
$isLightOrMissing = { param($n) (-not $script:inData.Contains("$n".Trim())) -or $script:light.Contains("$n".Trim()) }

# The server's manifest: the five masters, then its full plugins in its order.
$server = [string[]]@('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm',
    'Water for ENB.esm', 'Embers XD.esm', 'Cutting Room Floor.esp', 'Thornswood-Content.esp',
    'Populated Cities Towns Villages Legendary.esp', 'Immersive Armors.esp', 'SkyUI_SE.esp')

# The game order of a plugin list, read the way Publish-Update.ps1 reads the
# reference list when it checks the server: the enabled names, no Skyrim.ccc,
# light and missing plugins taking no place.
function GameOf([string[]]$lines) {
    $en = New-Object Collections.Generic.List[string]
    foreach ($l in $lines) { $n = Get-LoadOrderEnabledName $l; if ($n) { [void]$en.Add($n) } }
    $g = Get-LoadOrderGame ([string[]]$en.ToArray()) $isLightOrMissing @() $exists
    return ,$g
}

# The reference list as the 23 September rewrite left it, in miniature: every
# plugin in the server's order except Thornswood-Content.esp, which an install
# step took out and put back on the end. Two comment lines, a light plugin the
# server does not name and a disabled line sit among them, because those are
# the lines the rule must leave where they are.
$drift = [string[]]@(
    '# This file is used by Skyrim to keep track of your downloaded content.',
    '# Please do not modify this file.',
    '*Water for ENB.esm',
    '*Embers XD.esm',
    '*Light Patch.esp',
    '*Cutting Room Floor.esp',
    'Disabled Thing.esp',
    '*Populated Cities Towns Villages Legendary.esp',
    '*Immersive Armors.esp',
    '*SkyUI_SE.esp',
    '*Thornswood-Content.esp')

# The same list in the server's order: what the pack must carry.
$fixed = [string[]]@(
    '# This file is used by Skyrim to keep track of your downloaded content.',
    '# Please do not modify this file.',
    '*Water for ENB.esm',
    '*Embers XD.esm',
    '*Light Patch.esp',
    '*Cutting Room Floor.esp',
    'Disabled Thing.esp',
    '*Thornswood-Content.esp',
    '*Populated Cities Towns Villages Legendary.esp',
    '*Immersive Armors.esp',
    '*SkyUI_SE.esp')

# LOOT's kind of re-sort, the 20 September one: every full plugin somewhere
# else, with a light .esl, a light .esp, a disabled line and a comment among
# them.
$loot = [string[]]@(
    '# This file is used by Skyrim to keep track of your downloaded content.',
    '*SkyUI_SE.esp',
    '*Thornswood-Content.esp',
    '*Light Patch.esp',
    '*Immersive Armors.esp',
    'Disabled Thing.esp',
    '*Embers XD.esm',
    '*Populated Cities Towns Villages Legendary.esp',
    '*ccQDRSSE001-SurvivalMode.esl',
    '*Cutting Room Floor.esp',
    '*Water for ENB.esm')

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-loadorder-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    # ---- the small pieces ---------------------------------------------------
    Yes 'a master is known whatever its case or spacing' ((Test-LoadOrderMaster ' skyrim.ESM ') -and (Test-LoadOrderMaster 'DRAGONBORN.esm'))
    Yes 'a plugin that is not one of the five is not a master' (-not (Test-LoadOrderMaster 'Water for ENB.esm') -and -not (Test-LoadOrderMaster 'Skyrim.esp'))

    Same 'an enabled line gives its plugin' (Get-LoadOrderEnabledName '*SkyUI_SE.esp') 'SkyUI_SE.esp'
    Same 'spaces round the star and the name are dropped' (Get-LoadOrderEnabledName '  * SkyUI_SE.esp  ') 'SkyUI_SE.esp'
    Yes 'a disabled line, a comment, a bare star and a blank enable nothing' (
        $null -eq (Get-LoadOrderEnabledName 'SkyUI_SE.esp') -and
        $null -eq (Get-LoadOrderEnabledName '# Please do not modify this file.') -and
        $null -eq (Get-LoadOrderEnabledName '*') -and
        $null -eq (Get-LoadOrderEnabledName ''))

    # ---- load-order copies that must agree (Ship gate) -----------------------
    #
    # Get-LoadOrderCopyDiffs used to return , [string[]]... so an empty
    # result was one nested empty array. Ship wraps with @() and treats
    # Count -gt 0 as diverge: identical copies looked like a difference.
    $emptyCopies = @(Get-LoadOrderCopyDiffs @{})
    Yes 'fewer than two copies is no difference (Count 0, not a nested empty)' ($emptyCopies.Count -eq 0)
    $oneCopy = @(Get-LoadOrderCopyDiffs @{ 'only' = (Join-Path $tmp 'missing-plugins.txt') })
    Yes 'one copy, not there, is said, never taken as agreeing (#4387)' ($oneCopy.Count -ge 1 -and @($oneCopy | Where-Object { $_ -match '^only is not there' }).Count -eq 1)

    $copyA = Join-Path $tmp 'copy-a-plugins.txt'
    $copyB = Join-Path $tmp 'copy-b-plugins.txt'
    [IO.File]::WriteAllText($copyA, "*SkyUI_SE.esp`r`n*Immersive Armors.esp`r`n")
    [IO.File]::WriteAllText($copyB, "*SkyUI_SE.esp`r`n*Immersive Armors.esp`r`n")
    $agree = @(Get-LoadOrderCopyDiffs @{ 'A\plugins.txt' = $copyA; 'B\plugins.txt' = $copyB })
    Yes 'matching copies agree with Count 0, not a nested empty array' ($agree.Count -eq 0)

    [IO.File]::WriteAllText($copyB, "*Immersive Armors.esp`r`n*SkyUI_SE.esp`r`n")
    $disagree = @(Get-LoadOrderCopyDiffs @{ 'A\plugins.txt' = $copyA; 'B\plugins.txt' = $copyB })
    Yes 'swapped plugins are one difference line' ($disagree.Count -eq 1)
    Yes 'the difference line names both copies' ($disagree[0] -match 'A\\plugins\.txt vs B\\plugins\.txt')

    # ---- the order the game counts -------------------------------------------
    $g = GameOf $fixed
    Yes 'the game order comes back as one list, not nested' ($g -is [string[]])
    Same 'the game order is the masters then the enabled full plugins, light and disabled left out' $g $server

    $none = Get-LoadOrderGame @() $isLightOrMissing @() $exists
    Same 'an empty list still counts the five masters' $none ([string[]]@('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'))

    $withGone = [string[]]($fixed + '*Gone.esp')
    Same 'a plugin the list enables that is not in Data takes no place' (GameOf $withGone) $server
    $gone = Get-LoadOrderGame ([string[]]@('Gone.esp', 'Water for ENB.esm')) $isLight ([string[]]@('ccNotInstalled.esm')) $exists
    Same 'and it is the Data check that drops it, when the light check does not know it is missing' $gone ([string[]]@('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'Water for ENB.esm'))

    $twice = Get-LoadOrderGame ([string[]]@('Water for ENB.esm', 'water for enb.ESM', 'Update.esm')) $isLightOrMissing @() $exists
    Same 'a plugin named twice, or a master named again, is counted once' $twice ([string[]]@('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'Water for ENB.esm'))

    # Skyrim.ccc. On 19 September two Creation Club masters the list never
    # mentions put every plugin after Dragonborn.esm two places off. The
    # reference list is read with an empty ccc on purpose (the shipping
    # machine's Creation Club files are not what testers have), and this shows
    # what the ccc half does on a machine that has them.
    $ccc = [string[]]@('ccBGSSSE025-AdvDSGS.esm', 'ccQDRSSE001-SurvivalMode.esl', 'ccNotInstalled.esm', 'ccBGSSSE001-Fish.esm')
    $en = [string[]]@('Water for ENB.esm', 'ccBGSSSE025-AdvDSGS.esm', 'Embers XD.esm')
    $cg = Get-LoadOrderGame $en $isLightOrMissing $ccc $exists
    Same 'Skyrim.ccc plugins in Data come straight after the masters, light and missing ones left out, and an enabled one is not counted again' $cg ([string[]]@(
        'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm',
        'ccBGSSSE025-AdvDSGS.esm', 'ccBGSSSE001-Fish.esm', 'Water for ENB.esm', 'Embers XD.esm'))
    $plain = [string[]]@('Water for ENB.esm', 'Embers XD.esm')
    $twoCc = Get-LoadOrderGame $plain $isLightOrMissing ([string[]]@('ccBGSSSE025-AdvDSGS.esm', 'ccBGSSSE001-Fish.esm')) $exists
    $noCc = Get-LoadOrderGame $plain $isLightOrMissing @() $exists
    Same 'two Creation Club masters the list never names put it off from index 5' (Get-LoadOrderFirstMismatch $twoCc $noCc) 5
    Same 'and everything after Dragonborn.esm sits two places later' ("{0} {1}" -f [Array]::IndexOf($twoCc, 'Water for ENB.esm'), [Array]::IndexOf($noCc, 'Water for ENB.esm')) '7 5'

    # #479, Patrick, 28 September: "Yes base only". Special Edition is all
    # Thornswood needs, and somebody who owns the Anniversary upgrade still
    # plays. Their list can switch on every Creation Club plugin they own. One
    # the game gives no place (light, or not in Data, which is every one of them
    # in Thornswood's own folder) moves nothing: the order is still the
    # server's, and the launcher does not call it "not part of this build",
    # which would stop Play. A full one that is in Data does take a place, and
    # still counts.
    foreach ($n in @('ccBGSSSE001-Fish.esm', 'ccQDRSSE001-SurvivalMode.esl', 'CCASVSSE001-ALMSIVI.ESM', 'ccKRTSSE001_Altar.esl', ' ccEEJSSE001-Hstead.esm ')) {
        Yes "[$n] is a Creation Club plugin by its name" (Test-LoadOrderCreation $n)
    }
    foreach ($n in @('_ResourcePack.esl', 'Skyrim.esm', 'ccCustomMod.esp', 'CC Hunting.esp', 'Cutting Room Floor.esp', 'ccBGSSSE001-Fish.bsa', '')) {
        Yes "[$n] is not" (-not (Test-LoadOrderCreation $n))
    }
    $refList = [string[]]$server[5..($server.Count - 1)]
    $aeList = [string[]](@('ccASVSSE001-ALMSIVI.esm', 'ccQDRSSE001-SurvivalMode.esl') + $server[5..8] +
                         @('ccBGSSSE002-ExoticArrows.esl', 'ccEEJSSE001-Hstead.esm') + $server[9..($server.Count - 1)])
    Same 'an Anniversary owner''s list with Creation Club plugins switched on among the server''s still matches it position by position' (Get-LoadOrderFirstMismatch (Get-LoadOrderGame $aeList $isLightOrMissing @() $exists) $server) (-1)
    Same '...and none of them is "not part of this build"' (Get-LoadOrderNotInBuild $aeList $refList $isLightOrMissing) ([string[]]@())
    $withFull = [string[]]($aeList + @('ccBGSSSE025-AdvDSGS.esm'))
    Same 'a full Creation Club master that is in Data still counts, because it takes a place' (Get-LoadOrderNotInBuild $withFull $refList $isLightOrMissing) ([string[]]@('ccBGSSSE025-AdvDSGS.esm'))
    Yes '...and it does move the order' ((Get-LoadOrderFirstMismatch (Get-LoadOrderGame $withFull $isLightOrMissing @() $exists) $server) -ge 0)
    $others = [string[]]@('Light Patch.esp', 'New Thing.esp', 'Gone.esp')
    Same 'a plugin that is not Creation Club still counts, light, full or missing' (Get-LoadOrderNotInBuild $others $refList $isLightOrMissing) $others
    Same 'each once, in list order, the reference read without case' (Get-LoadOrderNotInBuild ([string[]]@('New Thing.esp', 'WATER FOR ENB.ESM', 'new thing.esp')) $refList $isLightOrMissing) ([string[]]@('New Thing.esp'))

    $all = Get-LoadOrderGame ([string[]]@('Light Patch.esp', 'Gone.esp')) $null @() $null
    Same 'with no stubs every name is taken as it comes' $all ([string[]]@('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'Light Patch.esp', 'Gone.esp'))

    # ---- position by position -------------------------------------------------
    Same 'the same list is -1' (Get-LoadOrderFirstMismatch $server $server) (-1)
    $shouty = [string[]]@($server | ForEach-Object { ' ' + $_.ToUpperInvariant() + ' ' })
    Same 'case and spacing are not a difference' (Get-LoadOrderFirstMismatch $server $shouty) (-1)
    $swap = [string[]]$server.Clone(); $swap[8] = $server[9]; $swap[9] = $server[8]
    Same 'two plugins swapped are found at the first of them' (Get-LoadOrderFirstMismatch $swap $server) 8
    $short = [string[]]$server[0..9]
    Same 'a list that runs out is found where it ends, either way round' ("{0},{1}" -f (Get-LoadOrderFirstMismatch $short $server), (Get-LoadOrderFirstMismatch $server $short)) '10,10'
    Same 'an empty list against the server is off at 0' (Get-LoadOrderFirstMismatch @() $server) 0
    Same 'no list against the server is off at 0' (Get-LoadOrderFirstMismatch $null $server) 0
    Same 'two empty lists are the same' (Get-LoadOrderFirstMismatch @() @()) (-1)

    # ---- the measured drift: stale first, then put right -----------------------
    $before = Get-LoadOrderFirstMismatch (GameOf $drift) $server
    Same 'the stale list disagrees with the server at index 8, before anything is put right' $before 8
    Same 'and it is Populated Cities where the server has Thornswood-Content.esp, as measured' ("{0} / {1}" -f (GameOf $drift)[$before], $server[$before]) 'Populated Cities Towns Villages Legendary.esp / Thornswood-Content.esp'

    $r = Get-LoadOrderReordered $drift $server $isLight
    Yes 'the stale list comes back as one list, not nested' ($r -is [string[]])
    Same 'put into the server order, Thornswood-Content.esp goes back to its place and nothing else changes' $r $fixed
    Same 'and the game order it gives agrees with the server at every position' (Get-LoadOrderFirstMismatch (GameOf $r) $server) (-1)
    $mv = Get-LoadOrderMoved $drift $r
    Same 'four lines moved, and the first of them is Thornswood-Content.esp' ("{0} {1}" -f $mv.Count, $mv.First) '4 Thornswood-Content.esp'
    Same 'a list already in the server order is left exactly as it is' (Get-LoadOrderReordered $fixed $server $isLight) $fixed
    Same 'and nothing is counted as moved' (Get-LoadOrderMoved $fixed (Get-LoadOrderReordered $fixed $server $isLight)).Count 0

    # ---- LOOT's re-sort ---------------------------------------------------------
    Same 'the re-sorted list disagrees at the first plugin after the masters' (Get-LoadOrderFirstMismatch (GameOf $loot) $server) 5
    $rl = Get-LoadOrderReordered $loot $server $isLight
    Same 'put into the server order, the game order agrees at every position' (Get-LoadOrderFirstMismatch (GameOf $rl) $server) (-1)
    $keptAll = $true
    foreach ($i in 0, 3, 5, 8) { if (-not [string]::Equals($loot[$i], $rl[$i], [StringComparison]::Ordinal)) { $keptAll = $false } }
    Yes 'the comment, the light .esp, the disabled line and the light .esl keep their lines' $keptAll
    Same 'the lines are the same lines, only moved' (@($rl | Sort-Object) -join '|') (@($loot | Sort-Object) -join '|')
    Same 'put through again, nothing moves' (Get-LoadOrderMoved $rl (Get-LoadOrderReordered $rl $server $isLight)).Count 0

    # ---- an extra full plugin: found by position, not only by name --------------
    $extra = New-Object Collections.Generic.List[string]
    $extra.AddRange($fixed)
    $extra.Insert(6, '*New Thing.esp')
    $extra = [string[]]$extra.ToArray()
    $re = Get-LoadOrderReordered $extra $server $isLight
    Same 'a full plugin the server does not name is not the rule''s to move' $re $extra
    Same 'nothing the server names is missing from that list' (Get-LoadOrderNotEnabled $extra $server) ([string[]]@())
    $ge = GameOf $re
    $at = Get-LoadOrderFirstMismatch $ge $server
    Same 'so the game order is off from the extra plugin onwards, at index 8' $at 8
    Same 'and index 8 is New Thing.esp where the server has Thornswood-Content.esp' ("{0} / {1}" -f $ge[$at], $server[$at]) 'New Thing.esp / Thornswood-Content.esp'
    $tail = [string[]]($fixed + '*New Thing.esp')
    Same 'an extra plugin on the end is found where the server list runs out' (Get-LoadOrderFirstMismatch (GameOf $tail) $server) $server.Count

    # ---- what the rule refuses to guess at --------------------------------------
    $dup = [string[]]($drift + '*skyui_se.esp')
    Same 'a list that enables a plugin twice, in any case, gives no order' (Get-LoadOrderReordered $dup $server $isLight) $null
    Same 'and nothing is named as not enabled, so the publish says it is enabled twice' (Get-LoadOrderNotEnabled $dup $server) ([string[]]@())

    $lacks = [string[]]@($drift | Where-Object { $_ -ne '*Immersive Armors.esp' })
    Same 'a list that lacks a plugin the server names gives no order' (Get-LoadOrderReordered $lacks $server $isLight) $null
    Same 'and that plugin is the one named' (Get-LoadOrderNotEnabled $lacks $server) ([string[]]@('Immersive Armors.esp'))

    $off = [string[]]@($drift | ForEach-Object { if ($_ -eq '*Immersive Armors.esp') { 'Immersive Armors.esp' } else { $_ } })
    Same 'a plugin that is listed but switched off counts as not enabled' (Get-LoadOrderReordered $off $server $isLight) $null
    Same 'and it is named too' (Get-LoadOrderNotEnabled $off $server) ([string[]]@('Immersive Armors.esp'))

    Same 'no list gives no order' (Get-LoadOrderReordered $null $server $isLight) $null
    Same 'no manifest gives no order' (Get-LoadOrderReordered $drift $null $isLight) $null
    Same 'no list or no manifest names nothing' ("{0} {1}" -f (Get-LoadOrderNotEnabled $null $server).Count, (Get-LoadOrderNotEnabled $drift $null).Count) '0 0'

    # ---- what the manifest can look like ----------------------------------------
    # Named first, straight after the masters, where the list does not have
    # it: a light plugin that moved would land on the list's first slot.
    $withLight = New-Object Collections.Generic.List[string]
    $withLight.AddRange($server)
    $withLight.Insert(5, 'Light Patch.esp')
    Same 'a light plugin the server names holds its line' (Get-LoadOrderReordered $drift ([string[]]$withLight.ToArray()) $isLight) $fixed

    $odd = [string[]]$server.Clone()
    $odd[8] = 'thornswood-content.ESP'
    $odd[11] = ' SkyUI_SE.esp '
    $ro = Get-LoadOrderReordered $drift $odd $isLight
    Same 'the manifest''s case and spacing do not matter, and the list keeps its own spelling' $ro $fixed
    Same 'and the result agrees with that manifest at every position' (Get-LoadOrderFirstMismatch (GameOf $ro) $odd) (-1)

    $again = [string[]]($server + 'Embers XD.esm')
    Same 'a plugin the manifest names twice is placed once' (Get-LoadOrderReordered $drift $again $isLight) $fixed

    $mast = New-Object Collections.Generic.List[string]
    $mast.AddRange($drift)
    $mast.Insert(2, '*Update.esm')
    $mast = [string[]]$mast.ToArray()
    $rm = Get-LoadOrderReordered $mast $server $isLight
    Yes 'a list that carries a master line is still put in order, and the master line stays where it is' ($null -ne $rm -and $rm[2] -eq '*Update.esm')
    Same 'and the master is counted once, in its own place' (Get-LoadOrderFirstMismatch (GameOf $rm) $server) (-1)

    # ---- the manifest as the server writes it -----------------------------------
    $json = '{"versionMajor":1,"mods":[' + (($server | ForEach-Object { '{"filename":"' + $_ + '","size":10,"crc32":20}' }) -join ',') + '],"loadOrder":[]}'
    $parsed = ConvertFrom-LoadOrderManifest $json
    Same 'the manifest gives its plugin names in its own order' $parsed $server
    $one = ConvertFrom-LoadOrderManifest '{"mods":[{"filename":"Skyrim.esm"}]}'
    Yes 'a manifest of one plugin is still a list of one' ($one -is [string[]] -and $one.Count -eq 1 -and $one[0] -eq 'Skyrim.esm')
    Same 'an entry with no filename is passed over' (ConvertFrom-LoadOrderManifest '{"mods":[{"size":1},{"filename":"Skyrim.esm"},{"filename":""}]}') ([string[]]@('Skyrim.esm'))
    Yes 'text that is not a manifest gives nothing' (
        $null -eq (ConvertFrom-LoadOrderManifest 'not json') -and
        $null -eq (ConvertFrom-LoadOrderManifest '{"loadOrder":[]}') -and
        $null -eq (ConvertFrom-LoadOrderManifest '{"mods":[]}') -and
        $null -eq (ConvertFrom-LoadOrderManifest '{"mods":null}'))

    # Nothing listens on port 1 of this machine, so the fetch fails. $null is
    # the answer that makes Publish-Update die rather than ship a list it could
    # not put in order.
    Same 'a server that does not answer gives no manifest' (Get-LoadOrderManifest 'http://127.0.0.1:1/api/servers/thornswood/manifest.json' 1500) $null
    Same 'nor a whole one' (Get-LoadOrderManifestDoc 'http://127.0.0.1:1/api/servers/thornswood/manifest.json' 1500) $null

    # ---- the light order (#1715) ------------------------------------------------
    #
    # A light index is a plugin's place among the light plugins the game
    # loads. Measured on 5 Oct over the 133 session logs on the VPS since
    # 24 Sep: ten different light orders, KhisartinBeards.esp anywhere from
    # light index 0x1E to 0x29. So a server that loads light plugins publishes
    # their order ("light" beside "mods", and its whole order in "loadOrder"),
    # and the list is put into that whole order, light plugins included.
    foreach ($n in @('_ResourcePack.esl', 'Beards.esp', 'Hair.esp', 'Spare Light.esp')) { [void]$script:inData.Add($n); [void]$script:light.Add($n) }
    $lccc = [string[]]@('_ResourcePack.esl', 'ccNotInstalled.esl', 'ccBGSSSE025-AdvDSGS.esm')
    $lightEnabled = [string[]]@('Water for ENB.esm', 'Hair.esp', 'Light Patch.esp', 'Gone Light.esl', 'Cutting Room Floor.esp', 'Beards.esp', 'hair.ESP')
    Same 'the light order is Skyrim.ccc''s light plugins in Data, then the list''s, each once, full and missing ones left out' (
        Get-LoadOrderLight $lightEnabled $isLight $lccc $exists) ([string[]]@('_ResourcePack.esl', 'Hair.esp', 'Light Patch.esp', 'Beards.esp'))
    Same 'an empty list still has the Skyrim.ccc light plugin at light index 0' (Get-LoadOrderLight @() $isLight $lccc $exists) ([string[]]@('_ResourcePack.esl'))
    Same 'and with no Skyrim.ccc the list''s first light plugin is light index 0' (Get-LoadOrderLight $lightEnabled $isLight @() $exists) ([string[]]@('Hair.esp', 'Light Patch.esp', 'Beards.esp'))

    # The server's whole order, as Deploy-Gamemode writes it for an engine
    # that loads light plugins, and its light plugins in their order.
    $wholeOrder = [string[]]@('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', '_ResourcePack.esl',
        'Water for ENB.esm', 'Embers XD.esm', 'Beards.esp', 'Cutting Room Floor.esp', 'Thornswood-Content.esp', 'Hair.esp',
        'Populated Cities Towns Villages Legendary.esp', 'Immersive Armors.esp', 'Light Patch.esp', 'SkyUI_SE.esp')
    $serverLight = [string[]]@('_ResourcePack.esl', 'Beards.esp', 'Hair.esp', 'Light Patch.esp')
    # A machine's list with the full plugins in the server's order and the
    # light ones in Vortex's: what every machine had until now.
    $lightDrift = [string[]]@(
        '# This file is used by Skyrim to keep track of your downloaded content.',
        '*Water for ENB.esm',
        '*Embers XD.esm',
        '*Light Patch.esp',
        '*Cutting Room Floor.esp',
        '*Hair.esp',
        'Disabled Thing.esp',
        '*Thornswood-Content.esp',
        '*Beards.esp',
        '*Populated Cities Towns Villages Legendary.esp',
        '*Immersive Armors.esp',
        '*SkyUI_SE.esp')
    function LightOf([string[]]$lines) {
        $en = New-Object Collections.Generic.List[string]
        foreach ($l in $lines) { $n = Get-LoadOrderEnabledName $l; if ($n) { [void]$en.Add($n) } }
        return ,(Get-LoadOrderLight ([string[]]$en.ToArray()) $isLight $lccc $exists)
    }
    Same 'the full order already agrees with the server''s' (Get-LoadOrderFirstMismatch (GameOf $lightDrift) $server) (-1)
    Same 'and the light order is off from light index 1, Light Patch.esp where the server has Beards.esp' (
        "{0} {1}" -f (Get-LoadOrderFirstMismatch (LightOf $lightDrift) $serverLight), (LightOf $lightDrift)[1]) '1 Light Patch.esp'
    Same 'the full-only rule leaves the light lines where they are, so it stays off' (
        Get-LoadOrderFirstMismatch (LightOf (Get-LoadOrderReordered $lightDrift $server $isLight)) $serverLight) 1
    $lw = Get-LoadOrderReordered $lightDrift $wholeOrder $null $lccc
    Yes 'put into the whole order it comes back as one list' ($lw -is [string[]])
    Same 'and its light plugins are in the server''s light order' (Get-LoadOrderFirstMismatch (LightOf $lw) $serverLight) (-1)
    Same 'its full plugins still in the server''s order' (Get-LoadOrderFirstMismatch (GameOf $lw) $server) (-1)
    Same 'the comment and the disabled line keep their lines' ("{0}|{1}" -f $lw[0], $lw[6]) ('# This file is used by Skyrim to keep track of your downloaded content.|Disabled Thing.esp')
    Same 'the lines are the same lines, only moved' (@($lw | Sort-Object) -join '|') (@($lightDrift | Sort-Object) -join '|')
    Same 'put through again, nothing moves' (Get-LoadOrderMoved $lw (Get-LoadOrderReordered $lw $wholeOrder $null $lccc)).Count 0
    Same 'without Skyrim.ccc''s names the server''s _ResourcePack.esl is one no line enables, so there is no order' (Get-LoadOrderReordered $lightDrift $wholeOrder $null @()) $null
    Same 'and that is the name said' (Get-LoadOrderNotEnabled $lightDrift $wholeOrder @()) ([string[]]@('_ResourcePack.esl'))
    Same 'with them, nothing is not enabled' (Get-LoadOrderNotEnabled $lightDrift $wholeOrder $lccc) ([string[]]@())
    $noBeards = [string[]]@($lightDrift | Where-Object { $_ -ne '*Beards.esp' })
    Same 'a list that lacks a light plugin the server loads gives no order, and names it' (
        "{0} {1}" -f (Show (Get-LoadOrderReordered $noBeards $wholeOrder $null $lccc)), ((Get-LoadOrderNotEnabled $noBeards $wholeOrder $lccc) -join ',')) '<null> Beards.esp'
    $spare = New-Object Collections.Generic.List[string]; $spare.AddRange($lw); $spare.Insert(2, '*Spare Light.esp')
    $spare = [string[]]$spare.ToArray()
    Same 'a light plugin the server does not load is not the rule''s to move, and the light order is off from it' (
        Get-LoadOrderFirstMismatch (LightOf (Get-LoadOrderReordered $spare $wholeOrder $null $lccc)) $serverLight) 1

    $mj = '{"versionMajor":1,"mods":[' + (($server | ForEach-Object { '{"filename":"' + $_ + '","size":10,"crc32":20}' }) -join ',') + '],' +
          '"light":[' + (($serverLight | ForEach-Object { '{"filename":"' + $_ + '","size":1,"crc32":2}' }) -join ',') + '],' +
          '"loadOrder":[' + (($wholeOrder | ForEach-Object { '"C:/s/Data/' + $_ + '"' }) -join ',') + ']}'
    $md = ConvertFrom-LoadOrderManifestDoc $mj
    Same 'a manifest with a light list: the full plugins from mods' $md.Full $server
    Same '  the light plugins in light index order' $md.Light $serverLight
    Same '  and the whole order from loadOrder, by file name' $md.All $wholeOrder
    $od = ConvertFrom-LoadOrderManifestDoc $json
    Same 'a manifest with no light list: no light plugins, and the whole order is the full one' ("{0}|{1}" -f $od.Light.Count, ($od.All -join ',')) ("0|" + ($server -join ','))
    Same 'text that is not a manifest gives nothing' (ConvertFrom-LoadOrderManifestDoc 'not json') $null

    # ---- where the manifest is read from ----------------------------------------
    function Cfg([string]$text, [bool]$bom) {
        $p = Join-Path $tmp 'cfg'
        New-Item -ItemType Directory -Force -Path $p | Out-Null
        $bytes = New-Object Collections.Generic.List[byte]
        if ($bom) { $bytes.AddRange([byte[]](0xEF, 0xBB, 0xBF)) }
        $bytes.AddRange([Text.Encoding]::UTF8.GetBytes($text))
        [IO.File]::WriteAllBytes((Join-Path $p 'config.json'), $bytes.ToArray())
        return $p
    }
    Same 'the main server on 7777 serves its manifest on 3000' (Get-LoadOrderManifestUrl (Cfg '{"ServerAddress":"thornswood.test","ServerPort":7777}' $false)) 'http://thornswood.test:3000/api/servers/thornswood/manifest.json'
    Same 'any other port serves it on the port plus one, the dev server''s 7787 on 7788' (Get-LoadOrderManifestUrl (Cfg '{"ServerAddress":"thornswood.test","ServerPort":"7787"}' $true)) 'http://thornswood.test:7788/api/servers/thornswood/manifest.json'
    Same 'no port is taken as 7777' (Get-LoadOrderManifestUrl (Cfg '{"ServerAddress":"thornswood.test"}' $false)) 'http://thornswood.test:3000/api/servers/thornswood/manifest.json'
    $threw = $false
    try { [void](Get-LoadOrderManifestUrl (Cfg '{"ServerPort":7777}' $false)) } catch { $threw = $true }
    Yes 'a config with no address stops rather than guessing one' $threw
    $threw = $false
    try { [void](Get-LoadOrderManifestUrl (Join-Path $tmp 'nowhere')) } catch { $threw = $true }
    Yes 'no config at all stops too' $threw

    # ---- light, from the header ---------------------------------------------------
    function Plugin([string]$name, [byte[]]$head) {
        $p = Join-Path $tmp $name
        [IO.File]::WriteAllBytes($p, $head)
        return $p
    }
    function Tes4([uint32]$flags) {
        $b = New-Object byte[] 24
        [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($b, 0)
        [BitConverter]::GetBytes([uint32]0).CopyTo($b, 4)
        [BitConverter]::GetBytes($flags).CopyTo($b, 8)
        return ,$b
    }
    Yes 'an .esl is light by its name, with or without a file' ((Test-LoadOrderLight (Join-Path $tmp 'NotThere.esl')) -and (Test-LoadOrderLight (Join-Path $tmp 'NotThere.ESL')))
    Yes 'a plugin that is not there is not light, so the missing check owns it' (-not (Test-LoadOrderLight (Join-Path $tmp 'NotThere.esp')))
    Yes 'the ESL flag in the header makes an .esp light' (Test-LoadOrderLight (Plugin 'Flagged.esp' (Tes4 0x200)))
    Yes 'the master flag alone does not' (-not (Test-LoadOrderLight (Plugin 'Master.esp' (Tes4 0x1))))
    Yes 'a plain .esp is not light' (-not (Test-LoadOrderLight (Plugin 'Plain.esp' (Tes4 0x0))))
    Yes 'a header too short to read is taken as light, as the launcher takes it' (Test-LoadOrderLight (Plugin 'Short.esp' ([byte[]](0x54, 0x45, 0x53, 0x34))))
    Yes 'a file that is not a TES4 plugin is taken as light' (Test-LoadOrderLight (Plugin 'Other.esp' ([byte[]](0x54, 0x45, 0x53, 0x33, 0, 0, 0, 0, 0, 0, 0, 0))))

    # ---- the file, the way Publish-Update writes the pack's copy ------------------
    #
    # Read, put in order and written out, as Publish-Update does under _dist,
    # then read back the way the publish's own server check reads it. The
    # game stops on a byte order mark, and a changed newline is a changed file
    # to everything that hashes it, so the file must come back written the way
    # it came in.
    $src = Join-Path $tmp 'plugins.txt'
    [IO.File]::WriteAllBytes($src, [Text.Encoding]::ASCII.GetBytes(($drift -join "`r`n") + "`r`n"))
    $file = Read-LoadOrderFile $src
    Same 'the list is read line by line with no empty line off the end' $file.Lines $drift
    Yes 'and it is known to be CRLF, no mark, ending in a newline' ($file.NewLine -eq "`r`n" -and -not $file.Bom -and $file.Trailing)
    $ordered = Get-LoadOrderReordered $file.Lines $server $isLight
    $out = Join-Path $tmp 'reference-plugins.txt'
    Write-LoadOrderFile $out $ordered $file
    $wrote = [IO.File]::ReadAllBytes($out)
    Same 'the copy that goes in the pack is the server order, written the same way' ([Text.Encoding]::ASCII.GetString($wrote)) (($fixed -join "`r`n") + "`r`n")
    $readBack = New-Object Collections.Generic.List[string]
    foreach ($line in (Get-Content -LiteralPath $out)) { $n = Get-LoadOrderEnabledName $line; if ($n) { [void]$readBack.Add($n) } }
    $gb = Get-LoadOrderGame ([string[]]$readBack.ToArray()) $isLightOrMissing @() $exists
    Same 'read back as the publish reads it, it agrees with the server at every position' (Get-LoadOrderFirstMismatch $gb $server) (-1)

    $bomLf = Join-Path $tmp 'bom-lf.txt'
    $bytes = New-Object Collections.Generic.List[byte]
    $bytes.AddRange([byte[]](0xEF, 0xBB, 0xBF))
    $bytes.AddRange([Text.Encoding]::UTF8.GetBytes(($drift -join "`n")))
    [IO.File]::WriteAllBytes($bomLf, $bytes.ToArray())
    $f2 = Read-LoadOrderFile $bomLf
    Yes 'a marked LF file with no last newline is known as that' ($f2.Bom -and $f2.NewLine -eq "`n" -and -not $f2.Trailing -and $f2.Lines.Count -eq $drift.Count -and $f2.Lines[0] -eq $drift[0])
    $same = Join-Path $tmp 'bom-lf-again.txt'
    Write-LoadOrderFile $same $f2.Lines $f2
    Yes 'and written back it is the same bytes' ([Convert]::ToBase64String([IO.File]::ReadAllBytes($same)) -eq [Convert]::ToBase64String($bytes.ToArray()))
    $noMark = Join-Path $tmp 'no-mark.txt'
    Write-LoadOrderFile $noMark $f2.Lines $file
    $nm = [IO.File]::ReadAllBytes($noMark)
    Yes 'a list written like an unmarked one gets no mark' (-not ($nm.Length -ge 3 -and $nm[0] -eq 0xEF -and $nm[1] -eq 0xBB -and $nm[2] -eq 0xBF))

    # ---- the launcher applies the same rule -----------------------------------------
    #
    # LoadOrder.cs reads no path, setting or window, so it compiles on its own.
    # Its class is internal, so its methods are called by reflection, and the
    # stubs above are handed to it as the same Func<string, bool> the launcher
    # passes.
    $cs = $null
    if (-not $OnWindows) {
        Write-Host 'SKIP  the launcher applies the same rule: LoadOrder.cs is compiled with the compiler the build runs, the Roslyn csc that comes with Visual Studio''s Build Tools, which only Windows has'
    }
    else {
        try { $cs = (Add-LauncherType -Source ([IO.File]::ReadAllText($LauncherPath))).GetType('Thornswood.LoadOrder') }
        catch { Write-Host ('      ' + $_.Exception.Message) -ForegroundColor Red }
        Yes 'launcher\app\LoadOrder.cs compiles on its own, with the compiler the build runs' ($null -ne $cs)
    }

    if ($null -ne $cs) {
        function Cs([string]$name, [object[]]$argv) { return (Show ($cs.GetMethod($name).Invoke($null, $argv))) }
        function Both([string]$what, [string]$csText, $psValue) {
            $p = Show $psValue
            Yes ("launcher and publisher agree: " + $what) ([string]::Equals($csText, $p, [StringComparison]::Ordinal))
            if ($csText -ne $p) {
                Write-Host "      launcher  $csText" -ForegroundColor Red
                Write-Host "      publisher $p" -ForegroundColor Red
            }
        }
        $fLight = [Func[string, bool]]$isLight
        $fLom = [Func[string, bool]]$isLightOrMissing
        $fExists = [Func[string, bool]]$exists

        Both 'the five masters' (Show $cs.GetField('Masters').GetValue($null)) $script:LoadOrderMasters

        foreach ($line in @('*SkyUI_SE.esp', '  * SkyUI_SE.esp  ', 'SkyUI_SE.esp', '# comment', '*', '')) {
            Both ("the plugin on the line [" + $line + "]") (Cs 'EnabledName' @(, $line)) (Get-LoadOrderEnabledName $line)
        }
        foreach ($name in @(' skyrim.ESM ', 'Skyrim.esp', 'Water for ENB.esm')) {
            Both ("whether [" + $name + "] is a master") (Cs 'IsMaster' @(, $name)) (Test-LoadOrderMaster $name)
        }

        $gameCases = [ordered]@{
            'the reference list, no ccc'    = @([string[]]@('Water for ENB.esm', 'Light Patch.esp', 'Gone.esp', 'Embers XD.esm', 'water for enb.esm', 'Update.esm'), [string[]]@())
            'a machine with Creation Club'  = @($en, $ccc)
            'an empty list'                 = @([string[]]@(), [string[]]@())
        }
        foreach ($k in $gameCases.Keys) {
            $e = $gameCases[$k][0]; $c = $gameCases[$k][1]
            $argv = New-Object object[] 4
            $argv[0] = $e; $argv[1] = $fLom; $argv[2] = $c; $argv[3] = $fExists
            Both ("the game order, " + $k) (Cs 'GameOrder' $argv) (Get-LoadOrderGame $e $isLightOrMissing $c $exists)
        }
        $argv = New-Object object[] 4
        $argv[0] = [string[]]@('Gone.esp', 'Water for ENB.esm'); $argv[1] = $fLight; $argv[2] = [string[]]@('ccNotInstalled.esm'); $argv[3] = $fExists
        Both 'the game order, the Data check on its own' (Cs 'GameOrder' $argv) $gone

        $pairs = [ordered]@{
            'the same list'          = @($server, $server)
            'case and spacing'       = @($server, $shouty)
            'two swapped'            = @($swap, $server)
            'one runs out'           = @($short, $server)
            'the other runs out'     = @($server, $short)
            'the stale list'         = @((GameOf $drift), $server)
            'the extra plugin'       = @($ge, $server)
        }
        foreach ($k in $pairs.Keys) {
            $argv = New-Object object[] 2
            $argv[0] = $pairs[$k][0]; $argv[1] = $pairs[$k][1]
            Both ("the first mismatch, " + $k) (Cs 'FirstMismatch' $argv) (Get-LoadOrderFirstMismatch $pairs[$k][0] $pairs[$k][1])
        }
        $argv = New-Object object[] 2
        $argv[0] = $null; $argv[1] = $server
        Both 'the first mismatch, no list' (Cs 'FirstMismatch' $argv) (Get-LoadOrderFirstMismatch $null $server)

        $reorders = [ordered]@{
            'the measured drift'           = @($drift, $server)
            'LOOT''s re-sort'              = @($loot, $server)
            'already in order'             = @($fixed, $server)
            'an extra full plugin'         = @($extra, $server)
            'a plugin enabled twice'       = @($dup, $server)
            'a plugin the list lacks'      = @($lacks, $server)
            'a plugin switched off'        = @($off, $server)
            'a light plugin named'         = @($drift, [string[]]$withLight.ToArray())
            'the manifest''s own spelling' = @($drift, $odd)
            'a name the manifest repeats'  = @($drift, $again)
            'a master line in the list'    = @($mast, $server)
        }
        foreach ($k in $reorders.Keys) {
            $l = $reorders[$k][0]; $m = $reorders[$k][1]
            $argv = New-Object object[] 3
            $argv[0] = $l; $argv[1] = $m; $argv[2] = $fLight
            Both ("the reordered list, " + $k) (Cs 'Reorder' $argv) (Get-LoadOrderReordered $l $m $isLight)
            $argv = New-Object object[] 2
            $argv[0] = $l; $argv[1] = $m
            Both ("the plugins not enabled, " + $k) (Cs 'NotEnabled' $argv) (Get-LoadOrderNotEnabled $l $m)
        }

        foreach ($n in @('ccBGSSSE001-Fish.esm', 'CCASVSSE001-ALMSIVI.ESM', ' ccKRTSSE001_Altar.esl ', '_ResourcePack.esl', 'ccCustomMod.esp', 'CC Hunting.esp', '')) {
            Both ("whether [" + $n + "] is a Creation Club plugin") (Cs 'IsCreation' @(, $n)) (Test-LoadOrderCreation $n)
        }
        $nib = [ordered]@{
            'an Anniversary owner''s list'          = $aeList
            'a full Creation Club master in Data'   = $withFull
            'plugins that are not Creation Club'    = $others
            'one named twice and one of the build'  = [string[]]@('New Thing.esp', 'WATER FOR ENB.ESM', 'new thing.esp')
            'an empty list'                         = [string[]]@()
        }
        foreach ($k in $nib.Keys) {
            $argv = New-Object object[] 3
            $argv[0] = $nib[$k]; $argv[1] = $refList; $argv[2] = $fLom
            Both ("what is not part of this build, " + $k) (Cs 'NotInBuild' $argv) (Get-LoadOrderNotInBuild $nib[$k] $refList $isLightOrMissing)
        }

        # The light order (#1715), the launcher against the publisher.
        $lightCases = [ordered]@{
            'a list with Skyrim.ccc'    = @($lightEnabled, $lccc)
            'a list with no Skyrim.ccc' = @($lightEnabled, [string[]]@())
            'an empty list'             = @([string[]]@(), $lccc)
        }
        foreach ($k in $lightCases.Keys) {
            $argv = New-Object object[] 4
            $argv[0] = $lightCases[$k][0]; $argv[1] = $fLight; $argv[2] = $lightCases[$k][1]; $argv[3] = $fExists
            Both ("the light order, " + $k) (Cs 'LightOrder' $argv) (Get-LoadOrderLight $lightCases[$k][0] $isLight $lightCases[$k][1] $exists)
        }
        $wholeCases = [ordered]@{
            'the light drift'                 = @($lightDrift, $lccc)
            'already in the whole order'      = @($lw, $lccc)
            'no Skyrim.ccc names'             = @($lightDrift, [string[]]@())
            'a light plugin the list lacks'   = @($noBeards, $lccc)
            'a light plugin the server lacks' = @($spare, $lccc)
            'a plugin enabled twice'          = @([string[]]($lightDrift + '*beards.ESP'), $lccc)
        }
        foreach ($k in $wholeCases.Keys) {
            $l = $wholeCases[$k][0]; $c = $wholeCases[$k][1]
            $argv = New-Object object[] 3
            $argv[0] = $l; $argv[1] = $wholeOrder; $argv[2] = $c
            Both ("the whole order, " + $k) (Cs 'ReorderWhole' $argv) (Get-LoadOrderReordered $l $wholeOrder $null $c)
            Both ("the plugins not enabled for the whole order, " + $k) (Cs 'NotEnabledWhole' $argv) (Get-LoadOrderNotEnabled $l $wholeOrder $c)
        }

        foreach ($k in @('the measured drift', 'LOOT''s re-sort', 'already in order')) {
            $l = $reorders[$k][0]
            $after = Get-LoadOrderReordered $l $server $isLight
            $argv = New-Object object[] 3
            $argv[0] = $l; $argv[1] = $after; $argv[2] = $null
            $count = $cs.GetMethod('Moved').Invoke($null, $argv)
            $pm = Get-LoadOrderMoved $l $after
            Both ("what moved, " + $k) (Show ("{0} {1}" -f $count, $argv[2])) ("{0} {1}" -f $pm.Count, $pm.First)
        }
    }
}
catch {
    Yes ("the harness ran to the end without an error: " + $_.Exception.Message) $false
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
