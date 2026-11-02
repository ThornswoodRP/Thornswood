<#
  test-light-order.ps1

      pwsh -NoProfile -File .\tests\test-light-order.ps1

  #1715. Once the engine loads light plugins, the server's load order holds
  them, and each takes a light index: its place among the light plugins the
  game loads, in the form id 0xFE000000 | (light index << 12) | local id.
  That index has to be the server's on every machine, or a stored light form
  id names another plugin's form.

  WHY. Measured on 5 Oct over the 133 session logs on the VPS since 24 Sep:
  the clients reported ten different light orders, KhisartinBeards.esp
  anywhere from light index 0x1E to 0x29. A beard stored on dev on 25 Sep
  under light index 0x20 names another plugin under the dev order of 5 Oct
  (docs\LIGHT-ORDER-DRIFT.md). Nothing fixed the light order: the server left
  every light plugin out, and every machine's Vortex and LOOT gave its own.

  WHAT THIS HOLDS:
    1. scripts\deploy\ServerOrder.ps1: the game's sequence (the five
       masters, the Skyrim.ccc plugins in Data, then the list with what the
       game loads as a master first, an .esl always), the server's order kept
       for each kind apart, a new plugin on the end of its kind, a new one
       the game would load ahead of its kind refused, and a full index that
       counts full plugins only.
    2. Which engine a record describes, and a plugin's lightness from its
       header, the same rule as the engine's IsLightPlugin.
    3. Deploy-Gamemode.ps1, a copy run in a scratch tree laid out like the
       repository, three times: against a record of an engine that loads no
       light plugin, where the light ones are left out and anything mastering
       one is pruned as before; against one that does, where every plugin the
       game loads is listed in its order, the light order is the game's and
       the start point and Thornswood-Content.esp are counted among the full
       plugins only; and again over that order with a new light plugin and a
       new light master, the first put on the end of the light order and the
       second refused.
       Then -OrderOnly (#4068): over a list a collection revision moved, a
       deploy stops on a Thornswood-Last.esp built against the old order,
       and -OrderOnly writes the new order alone, Thornswood-Content.esp at
       its file in game\content, Thornswood-Last.esp (made from its recipe)
       last, and nothing into the build.
    4. The places full and light plugins hold among each other (#2468): a
       re-sorted list keeps each kind's order and still moves those places,
       and the same list in Thornswood-Last.esp's recorded order
       (Get-ThornswoodRecordedSequence) gives the recorded whole order.

  -Repo points it at another checkout, which is how it was shown to fail on
  main before the change.

  Nothing leaves this machine. Scratch files go under the temp folder.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent $Here }

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Same([string]$what, $got, $want) {
    $g = (@($got) | ForEach-Object { [string]$_ }) -join '|'
    $w = (@($want) | ForEach-Object { [string]$_ }) -join '|'
    Yes $what ([string]::Equals($g, $w, [StringComparison]::Ordinal))
    if ($g -ne $w) {
        Write-Host "      wanted $w" -ForegroundColor Red
        Write-Host "      got    $g" -ForegroundColor Red
    }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$utf8 = New-Object Text.UTF8Encoding($false)
$shell = (Get-Process -Id $PID).Path
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-light-order-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null

function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}

# A plugin file: the TES4 record with the flags we choose (0x1 master, 0x200
# light) and a MAST subrecord for each master, which is what
# Read-PluginHeader looks for.
function New-Plugin([string]$dir, [string]$name, [uint32]$flags, [string[]]$masters = @()) {
    $body = New-Object Collections.Generic.List[byte]
    foreach ($m in $masters) {
        $z = [Text.Encoding]::ASCII.GetBytes($m + [char]0)
        $body.AddRange([Text.Encoding]::ASCII.GetBytes('MAST'))
        $body.AddRange([BitConverter]::GetBytes([uint16]$z.Length))
        $body.AddRange($z)
        $body.AddRange([Text.Encoding]::ASCII.GetBytes('DATA'))
        $body.AddRange([BitConverter]::GetBytes([uint16]8))
        $body.AddRange((New-Object byte[] 8))
    }
    $b = New-Object Collections.Generic.List[byte]
    $b.AddRange([Text.Encoding]::ASCII.GetBytes('TES4'))
    $b.AddRange([BitConverter]::GetBytes([uint32]$body.Count))
    $b.AddRange([BitConverter]::GetBytes($flags))
    $b.AddRange((New-Object byte[] 12))
    $b.AddRange($body)
    $b.AddRange((New-Object byte[] 64))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $dir $name), $b.ToArray())
}

$masters5 = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm')

try {
    # ---- 1. ServerOrder.ps1 -----------------------------------------------------
    Write-Host 'ServerOrder.ps1'
    $lib = Join-Path $Repo 'scripts\deploy\ServerOrder.ps1'
    Yes 'scripts\deploy\ServerOrder.ps1 is there' (Test-Path -LiteralPath $lib)
    . $lib

    # Headers as Read-PluginHeader gives them.
    function Hdr([bool]$light, [bool]$master) { return [pscustomobject]@{ Light = $light; Master = $master; Masters = @() } }
    $info = @{}
    foreach ($m in $masters5) { $info[$m] = Hdr $false $true }
    $info['_ResourcePack.esl'] = Hdr $true $true
    $info['ccBGSSSE001-Fish.esm'] = Hdr $false $true
    $info['Water for ENB.esm'] = Hdr $false $true
    $info['Expressive Facegen Morphs.esl'] = Hdr $true $false     # an .esl with no master bit
    $info['Light Beards.esp'] = Hdr $true $false
    $info['Thornswood-Content.esp'] = Hdr $false $false
    $info['Menu Glue.esp'] = Hdr $false $false
    $info['Skyrim Unbound.esp'] = Hdr $false $false
    $info['Late Light.esp'] = Hdr $true $false
    $ccc = [string[]]@('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', '_ResourcePack.esl', 'ccNotInstalled.esl')
    $wanted = [string[]]($masters5 + @('Water for ENB.esm', 'Light Beards.esp', 'Expressive Facegen Morphs.esl', 'Thornswood-Content.esp',
                                        'Menu Glue.esp', 'Skyrim Unbound.esp', 'Late Light.esp', 'Not In Data.esp'))

    $game = Get-ThornswoodGameSequence $wanted $ccc $info
    Same 'the game sequence: the masters, the Skyrim.ccc plugins in Data, then the list with what loads as a master first, an .esl among them' $game (
        $masters5 + @('_ResourcePack.esl', 'Water for ENB.esm', 'Expressive Facegen Morphs.esl', 'Light Beards.esp', 'Thornswood-Content.esp',
                      'Menu Glue.esp', 'Skyrim Unbound.esp', 'Late Light.esp'))
    Yes 'an .esl loads as a master whatever its header says' ((Test-ThornswoodLoadsAsMaster 'X.esl' (Hdr $true $false)) -and -not (Test-ThornswoodLoadsAsMaster 'X.esp' (Hdr $true $false)))

    # The first deploy that lists light plugins: the server's list has the
    # full plugins only, Menu Glue.esp pruned because it masters a light one.
    $prior = [string[]]($masters5 + @('Water for ENB.esm', 'Thornswood-Content.esp', 'Skyrim Unbound.esp'))
    $so = Get-ThornswoodServerOrder $wanted $ccc $info $prior
    Same 'the full order is kept and the plugin that was pruned goes on the end' $so.Full ($masters5 + @('Water for ENB.esm', 'Thornswood-Content.esp', 'Skyrim Unbound.esp', 'Menu Glue.esp'))
    Same 'with no light order to keep, the light order is the game''s: _ResourcePack.esl is light index 0' $so.Light @('_ResourcePack.esl', 'Expressive Facegen Morphs.esl', 'Light Beards.esp', 'Late Light.esp')
    Yes 'and it says the light order was not kept' (-not $so.LightKept)
    Same 'the whole order puts each kind in its own order into the places the game gives that kind' $so.Order (
        $masters5 + @('_ResourcePack.esl', 'Water for ENB.esm', 'Expressive Facegen Morphs.esl', 'Light Beards.esp', 'Thornswood-Content.esp',
                      'Skyrim Unbound.esp', 'Menu Glue.esp', 'Late Light.esp'))
    Same 'one new full plugin, nothing new to the light order, nothing gone, nothing refused' (
        @($so.AddedFull.Count, $so.AddedLight.Count, $so.Removed.Count, $so.NewFullMasters.Count, $so.LightOutOfPlace.Count)) @(1, 0, 0, 0, 0)

    $isLightName = { param($n) [bool]($info[$n] -and $info[$n].Light) }
    Same 'a full index counts the full plugins only: Skyrim Unbound.esp is 7, Menu Glue.esp 8' (
        @((Get-ThornswoodFullIndex $so.Order $isLightName 'Skyrim Unbound.esp'), (Get-ThornswoodFullIndex $so.Order $isLightName 'Menu Glue.esp'))) @(7, 8)
    Same 'and its place in the list would have said 10 and 11' (@([Array]::IndexOf($so.Order, 'Skyrim Unbound.esp'), [Array]::IndexOf($so.Order, 'Menu Glue.esp'))) @(10, 11)
    Same 'a light plugin has no full index, and a name not in the order none either' (
        @((Get-ThornswoodFullIndex $so.Order $isLightName 'Light Beards.esp'), (Get-ThornswoodFullIndex $so.Order $isLightName 'Nowhere.esp'))) @(-1, -1)
    Same 'paths count by their file name, any case' (Get-ThornswoodFullIndex ([string[]]@('C:/d/Skyrim.esm', 'C:/d/_ResourcePack.esl', 'C:\d\skyrim unbound.ESP')) $isLightName 'Skyrim Unbound.esp') 1
    Same 'with no light test every entry counts, as before #1715' (Get-ThornswoodFullIndex $so.Order $null 'Skyrim Unbound.esp') 10

    # The next deploy keeps that order. The list has been re-sorted, so the
    # game's own sequence is different, and there is one new light plugin.
    $info['New Light.esp'] = Hdr $true $false
    $resorted = [string[]]($masters5 + @('Late Light.esp', 'Skyrim Unbound.esp', 'Expressive Facegen Morphs.esl', 'Light Beards.esp', 'Menu Glue.esp',
                                          'Thornswood-Content.esp', 'Water for ENB.esm', 'New Light.esp'))
    $so2 = Get-ThornswoodServerOrder $resorted $ccc $info $so.Order
    Same 'a re-sorted list moves nothing: the full order is the server''s' $so2.Full $so.Full
    Same 'the light order is the server''s, the new light plugin on its end' $so2.Light ($so.Light + @('New Light.esp'))
    Yes 'and it says the light order was kept, one light plugin new' ($so2.LightKept -and $so2.AddedLight.Count -eq 1 -and $so2.AddedLight[0] -eq 'New Light.esp')
    Same 'nothing refused' (@($so2.NewFullMasters.Count, $so2.LightOutOfPlace.Count)) @(0, 0)

    # A new light master (an .esl) and a new Skyrim.ccc light plugin: the game
    # loads both ahead of the rest of the light plugins, so neither can go on
    # the end of a light order the world is keyed to.
    $info['New Master.esl'] = Hdr $true $false
    $info['ccNew.esl'] = Hdr $true $true
    $so3 = Get-ThornswoodServerOrder ([string[]]($resorted + @('New Master.esl'))) ([string[]]($ccc + @('ccNew.esl'))) $info $so.Order
    Same 'a new .esl and a new Skyrim.ccc light plugin are refused, by name' (@($so3.LightOutOfPlace | Sort-Object)) @('ccNew.esl', 'New Master.esl')
    $info['New Master.esm'] = Hdr $false $true
    $so4 = Get-ThornswoodServerOrder ([string[]]($resorted + @('New Master.esm'))) $ccc $info $so.Order
    Same 'a new full master is refused as before' $so4.NewFullMasters @('New Master.esm')

    $gone = [string[]]@($resorted | Where-Object { $_ -ne 'Light Beards.esp' })
    $so5 = Get-ThornswoodServerOrder $gone $ccc $info $so.Order
    Same 'a light plugin that is gone is said, and every light plugin after it moves up one' (@($so5.Removed) + @('|') + @($so5.Light)) (
        @('Light Beards.esp', '|', '_ResourcePack.esl', 'Expressive Facegen Morphs.esl', 'Late Light.esp', 'New Light.esp'))

    # The places full and light plugins hold among each other (#2468). A
    # re-sorted list keeps each kind's order, but the places come from the
    # list, so the whole order moves: what Vortex did on One on 17 Oct.
    # Given in the order the last plugin's record has, it does not.
    $sameSet = [string[]]@($resorted | Where-Object { $_ -ne 'New Light.esp' })
    $drift = Get-ThornswoodServerOrder $sameSet $ccc $info $so.Order
    Same 'a re-sorted list keeps the full and light orders' (@($drift.Full) + @('|') + @($drift.Light)) (@($so.Full) + @('|') + @($so.Light))
    Yes 'and still moves the places between them, so the whole order is not the one kept' ((@($drift.Order) -join '|') -ne (@($so.Order) -join '|'))
    $rs = Get-ThornswoodRecordedSequence $sameSet $so.Order
    Same 'the list in the recorded order: the names it enables, where the record has them' $rs.Wanted @($so.Order | Where-Object { $sameSet -contains $_ })
    Same 'nothing it enables is missing from the record' $rs.NotRecorded @()
    $kept = Get-ThornswoodServerOrder $rs.Wanted $ccc $info $so.Order
    Same 'given in the recorded order, the whole order is the recorded one' $kept.Order $so.Order
    $rs2 = Get-ThornswoodRecordedSequence ([string[]]($sameSet + @('New Light.esp', 'menu glue.ESP'))) $so.Order
    Same 'a name the record does not have goes on the end and is said; one it has, any case, takes its place once' (@($rs2.Wanted[-1]) + @('|') + @($rs2.NotRecorded) + @('|') + @(@($rs2.Wanted | Where-Object { $_ -ieq 'Menu Glue.esp' }).Count)) @('New Light.esp', '|', 'New Light.esp', '|', 1)

    # ---- 2. the record, and a plugin's header ------------------------------------
    Write-Host ''
    Write-Host 'the record and the header'
    $rec = Join-Path $T 'records'
    Put (Join-Path $rec 'yes.json') '{"binary":"scam_native.node","lightPlugins":true}'
    Put (Join-Path $rec 'no.json') '{"binary":"scam_native.node"}'
    Put (Join-Path $rec 'false.json') '{"binary":"scam_native.node","lightPlugins":false}'
    Put (Join-Path $rec 'broken.json') '{"binary":'
    Yes 'a record with lightPlugins true is an engine that loads them' (Test-ThornswoodEngineLoadsLight (Join-Path $rec 'yes.json'))
    Yes 'one that does not say, or says false, is not' (-not (Test-ThornswoodEngineLoadsLight (Join-Path $rec 'no.json')) -and -not (Test-ThornswoodEngineLoadsLight (Join-Path $rec 'false.json')))
    foreach ($bad in 'broken.json', 'missing.json') {
        $threw = $false
        try { [void](Test-ThornswoodEngineLoadsLight (Join-Path $rec $bad)) } catch { $threw = $true }
        Yes "a record that is $(if ($bad -eq 'broken.json') { 'there and does not read' } else { 'not there' }) stops rather than guessing" $threw
    }
    $pd = Join-Path $T 'headers'
    New-Plugin $pd 'Flag.esp' 0x200
    New-Plugin $pd 'Both.esm' 0x201
    New-Plugin $pd 'Plain.esp' 0x0
    New-Plugin $pd 'Master.esp' 0x1
    Put (Join-Path $pd 'NotAPlugin.esp') 'hello'
    Yes 'the light flag makes a plugin light, with or without the master flag' ((Test-ThornswoodPluginLight (Join-Path $pd 'Flag.esp')) -and (Test-ThornswoodPluginLight (Join-Path $pd 'Both.esm')))
    Yes 'an .esl is light by its name' (Test-ThornswoodPluginLight (Join-Path $pd 'Absent.esl'))
    Yes 'no flag, or the master flag alone, is full' (-not (Test-ThornswoodPluginLight (Join-Path $pd 'Plain.esp')) -and -not (Test-ThornswoodPluginLight (Join-Path $pd 'Master.esp')))
    foreach ($bad in 'Absent.esp', 'NotAPlugin.esp') {
        $threw = $false
        try { [void](Test-ThornswoodPluginLight (Join-Path $pd $bad)) } catch { $threw = $true }
        Yes "$bad cannot be told and stops the caller" $threw
    }
    $paths = [string[]]@(($masters5 | ForEach-Object { (Join-Path $pd $_) }) + @((Join-Path $pd 'Flag.esp'), (Join-Path $pd 'Plain.esp')))
    foreach ($m in $masters5) { New-Plugin $pd $m 0x1 }
    Yes 'against a record of an engine that loads no light plugin there is no light test' ($null -eq (Get-ThornswoodLightTest $paths (Join-Path $rec 'no.json')))
    $lt = Get-ThornswoodLightTest $paths (Join-Path $rec 'yes.json')
    Same 'against one that does, Plain.esp after the light Flag.esp is full index 5' (Get-ThornswoodFullIndex $paths $lt 'Plain.esp') 5

    # ---- 3. Deploy-Gamemode.ps1 --------------------------------------------------
    Write-Host ''
    Write-Host 'Deploy-Gamemode.ps1'
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Yes 'node is on this machine, which Deploy-Gamemode.ps1 needs to check gamemode.js' $false
        Done
    }
    # A scratch tree laid out like the repository: the deploy script and what
    # it dot-sources, a LoadOrder.ps1 whose collection is current, a game
    # folder with Skyrim.ccc and plugins, a plugin list and a build folder.
    # A whole server-build record, as RecordShape.ps1 holds Deploy-Gamemode's
    # to (#2180), with lightPlugins as given, or none for $null. Until #3006
    # the tree had no RecordShape.ps1, the check was "not recognized", and a
    # record of two keys went through.
    function ServerRecord($light) {
        $h = 'ab' * 32
        $r = [ordered]@{ binary = 'scam_native.node'; sha256 = $h; bytes = 1; source = [ordered]@{ commit = ('cd' * 20) }
                         files = [ordered]@{ 'scam_native.node' = [ordered]@{ sha256 = $h; bytes = 1 } } }
        if ($null -ne $light) { $r.lightPlugins = [bool]$light }
        return ($r | ConvertTo-Json -Depth 5)
    }
    function New-Tree([string]$name, [string]$record) {
        $t = Join-Path $T $name
        foreach ($rel in 'scripts\deploy\Deploy-Gamemode.ps1', 'scripts\deploy\MaxOnline.ps1', 'scripts\deploy\ServerOrder.ps1', 'scripts\deploy\LastPluginRecipe.ps1',
                         'scripts\release\BuildStamp.ps1', 'scripts\release\Read-JsonFile.ps1', 'scripts\release\RecordShape.ps1',
                         'records\most-online.json') {
            $from = Join-Path $Repo $rel
            if (-not (Test-Path -LiteralPath $from)) { continue }
            $to = Join-Path $t $rel
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
            Copy-Item -LiteralPath $from -Destination $to
        }
        Put (Join-Path $t 'records\server-build.json') $record
        Put (Join-Path $t 'scripts\mods\LoadOrder.ps1') @'
function Get-CollectionState([string]$Url) { [pscustomobject]@{ Slug = 'tslight'; Have = 4; Newest = 4; Behind = $false; Known = $true } }
'@
        Put (Join-Path $t 'game\gamemode.js') "var thornswoodLight = 1;`n"
        # And its tables (#5191), which Deploy-Gamemode.ps1 copies in beside it.
        Put (Join-Path $t 'game\gamemode-tables\WAY_OUT.json') "{}`n"
        Put (Join-Path $t 'dist\server-settings.json') ('{"port":7777,"name":"Thornswood","loadOrder":[' +
            (($masters5 + @('Water for ENB.esm', 'Thornswood-Content.esp', 'Skyrim Unbound.esp') | ForEach-Object { '"' + ((Join-Path $t 'Game\Data') -replace '\\', '/') + '/' + $_ + '"' }) -join ',') + ']}')
        $data = Join-Path $t 'Game\Data'
        foreach ($m in $masters5) { New-Plugin $data $m 0x1 }
        New-Plugin $data '_ResourcePack.esl' 0x201
        New-Plugin $data 'Water for ENB.esm' 0x1
        New-Plugin $data 'Expressive Facegen Morphs.esl' 0x200
        New-Plugin $data 'Light Beards.esp' 0x200
        New-Plugin $data 'Thornswood-Content.esp' 0x0
        New-Plugin $data 'Menu Glue.esp' 0x0 @('Skyrim.esm', 'Light Beards.esp')
        New-Plugin $data 'Skyrim Unbound.esp' 0x0
        New-Plugin $data 'Late Light.esp' 0x200
        New-Plugin $data 'New Light.esp' 0x200
        New-Plugin $data 'New Master.esl' 0x200
        Put (Join-Path $t 'Game\Skyrim.ccc') (($ccc -join "`r`n") + "`r`n")
        Put (Join-Path $t 'Game\config.json') '{"CollectionUrl":"https://next.nexusmods.com/skyrimspecialedition/collections/tslight"}'
        Put (Join-Path $t 'plugins.txt') ("# a list`r`n*Water for ENB.esm`r`n*Light Beards.esp`r`n*Expressive Facegen Morphs.esl`r`n*Thornswood-Content.esp`r`n" +
                                          "*Menu Glue.esp`r`n*Skyrim Unbound.esp`r`n*Late Light.esp`r`n")
        New-Item -ItemType Directory -Force -Path (Join-Path $t 'appdata'), (Join-Path $t 'localappdata') | Out-Null
        return $t
    }
    function Invoke-Copy([string]$t, [string[]]$More = @()) {
        $saved = @{ APPDATA = $env:APPDATA; LOCALAPPDATA = $env:LOCALAPPDATA }
        $env:APPDATA = Join-Path $t 'appdata'
        $env:LOCALAPPDATA = Join-Path $t 'localappdata'
        $eap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $out = @(& $shell -NoProfile -File (Join-Path $t 'scripts\deploy\Deploy-Gamemode.ps1') `
                       -Gamemode (Join-Path $t 'game\gamemode.js') -Dist (Join-Path $t 'dist') `
                       -Data (Join-Path $t 'Game\Data') -Plugins (Join-Path $t 'plugins.txt') @More 2>&1 | ForEach-Object { [string]$_ })
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $eap
            $env:APPDATA = $saved.APPDATA
            $env:LOCALAPPDATA = $saved.LOCALAPPDATA
        }
        return [pscustomobject]@{ Code = $code; Text = ($out -join "`n") }
    }
    function Settings([string]$t) { return ([IO.File]::ReadAllText((Join-Path $t 'dist\server-settings.json')) | ConvertFrom-Json) }
    # A load order entry names the plugin by a path written for the box; its
    # file name is the part after the last separator of either kind, since
    # GetFileName off Windows does not split on \ (#2989).
    function Leaves($s) { return [string[]]@($s.loadOrder | ForEach-Object { @(([string]$_) -split '[\\/]')[-1] }) }

    # An engine that loads no light plugin: what the live server is today.
    $t = New-Tree 'no-light' (ServerRecord $null)
    $r = Invoke-Copy $t
    Yes 'an engine that loads no light plugin: the deploy runs' ($r.Code -eq 0)
    if ($r.Code -ne 0) { Write-Host $r.Text }
    $s = Settings $t
    Same '  the light plugins are left out and Menu Glue.esp, which masters one, is pruned, as before' (Leaves $s) ($masters5 + @('Water for ENB.esm', 'Thornswood-Content.esp', 'Skyrim Unbound.esp'))
    Same '  the start point is Skyrim Unbound.esp at its place in the list, 7' ([string]$s.startPoints[0].worldOrCell) '0x0719BAD4'

    # An engine that loads them.
    $t = New-Tree 'light' (ServerRecord $true)
    $r = Invoke-Copy $t
    Yes 'an engine that loads light plugins: the deploy runs' ($r.Code -eq 0)
    if ($r.Code -ne 0) { Write-Host $r.Text }
    $s = Settings $t
    Same '  every plugin the game loads is listed, the Skyrim.ccc one included, each kind in its order' (Leaves $s) $so.Order
    Same '  the start point is Skyrim Unbound.esp at its full index, 7, not its place in the list, 10' ([string]$s.startPoints[0].worldOrCell) '0x0719BAD4'
    Yes '  and Thornswood-Content.esp is said at its full index, 6' ($r.Text -match 'Thornswood-Content\.esp at index 6 \(0x06\)')
    Yes '  and it says how many light plugins it listed' ($r.Text -match '4 light plugin\(s\) listed, light index 0 to 3')

    # Again over that order: a new light plugin goes on the end of the light
    # order; a new .esl, which the game loads ahead of the others, is refused.
    Put (Join-Path $t 'plugins.txt') ("*New Light.esp`r`n*Water for ENB.esm`r`n*Light Beards.esp`r`n*Expressive Facegen Morphs.esl`r`n*Thornswood-Content.esp`r`n" +
                                      "*Menu Glue.esp`r`n*Skyrim Unbound.esp`r`n*Late Light.esp`r`n")
    $r = Invoke-Copy $t
    Yes 'a new light plugin: the deploy runs' ($r.Code -eq 0)
    $s = Settings $t
    $lightNow = [string[]]@(Leaves $s | Where-Object { $_ -match '\.esl$' -or @('Light Beards.esp', 'Late Light.esp', 'New Light.esp') -contains $_ })
    Same '  and it goes on the end of the light order, which is kept' $lightNow @('_ResourcePack.esl', 'Expressive Facegen Morphs.esl', 'Light Beards.esp', 'Late Light.esp', 'New Light.esp')
    $before = [IO.File]::ReadAllText((Join-Path $t 'dist\server-settings.json'))
    Put (Join-Path $t 'plugins.txt') ("*New Master.esl`r`n*New Light.esp`r`n*Water for ENB.esm`r`n*Light Beards.esp`r`n*Expressive Facegen Morphs.esl`r`n*Thornswood-Content.esp`r`n" +
                                      "*Menu Glue.esp`r`n*Skyrim Unbound.esp`r`n*Late Light.esp`r`n")
    $r = Invoke-Copy $t
    Yes 'a new .esl the game loads ahead of the light plugins: the deploy stops, naming it' ($r.Code -ne 0 -and $r.Text -match 'New Master\.esl \(light\)')
    Yes '  and the server''s settings are as they were' ([IO.File]::ReadAllText((Join-Path $t 'dist\server-settings.json')) -eq $before)

    # ---- the order alone (-OrderOnly, #4068) ----------------------------------------
    # A collection revision added New Light.esp, and Thornswood-Last.esp was
    # built against the order before it: a deploy stops on that, and the
    # order the plugin is to be built against again is written alone, with
    # Thornswood-Content.esp at its file in game\content and nothing in the
    # build.
    # No checkout holds Thornswood-Last.esp, only its recipe, whose first step
    # writes the plugin's own header (#2791, LastPluginRecipe.ps1): TSLR,
    # version 1, the plugin's size and sha256, no inputs, then that step.
    $t = New-Tree 'order-only' (ServerRecord $true)
    $own = Join-Path $t 'game\content'
    New-Plugin $own 'Thornswood-Content.esp' 0x0
    New-Plugin (Join-Path $t 'temp\head') 'Thornswood-Last.esp' 0x200
    $head = [IO.File]::ReadAllBytes((Join-Path $t 'temp\head\Thornswood-Last.esp'))
    $recipe = New-Object Collections.Generic.List[byte]
    $recipe.AddRange([Text.Encoding]::ASCII.GetBytes('TSLR')); $recipe.Add(1)
    $recipe.AddRange([BitConverter]::GetBytes([uint32]$head.Length))
    $recipe.AddRange((New-Object byte[] 32))
    $recipe.Add(0)
    $recipe.Add(0)
    for ($n = $head.Length; $n -ge 0x80; $n = $n -shr 7) { $recipe.Add([byte](($n -band 0x7F) -bor 0x80)) }
    $recipe.Add([byte]$n)
    $recipe.AddRange($head)
    New-Item -ItemType Directory -Force -Path (Join-Path $t 'game\data') | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $t 'game\data\last-plugin.recipe'), $recipe.ToArray())
    Put (Join-Path $t 'plugins.txt') ("*Water for ENB.esm`r`n*Light Beards.esp`r`n*Expressive Facegen Morphs.esl`r`n*Thornswood-Content.esp`r`n" +
                                      "*Menu Glue.esp`r`n*Skyrim Unbound.esp`r`n*Late Light.esp`r`n*New Light.esp`r`n")
    $stale = @($masters5 + @('_ResourcePack.esl', 'Water for ENB.esm', 'Expressive Facegen Morphs.esl', 'Light Beards.esp', 'Thornswood-Content.esp', 'Menu Glue.esp', 'Skyrim Unbound.esp', 'Late Light.esp'))
    Put (Join-Path $t 'game\data\last-plugin.json') ([ordered]@{ version = 1; loadOrder = $stale } | ConvertTo-Json -Depth 3)
    $r = Invoke-Copy $t @('-NewOrder')
    Yes 'a deploy over an order Thornswood-Last.esp was not built against stops' ($r.Code -ne 0 -and $r.Text -match 'Thornswood-Last\.esp was built against another load order')
    # That run put gamemode.js and its stamp in the build before it stopped.
    Remove-Item -LiteralPath (Join-Path $t 'dist\gamemode.js'), (Join-Path $t 'dist\thornswood-build.json') -Force -ErrorAction SilentlyContinue
    $before = [IO.File]::ReadAllText((Join-Path $t 'dist\server-settings.json'))
    $orderFile = Join-Path $t 'temp\order\server-settings.json'
    $r = Invoke-Copy $t @('-NewOrder', '-OrderOnly', $orderFile)
    Yes '-OrderOnly over it runs' ($r.Code -eq 0)
    if ($r.Code -ne 0) { Write-Host $r.Text }
    $o = [IO.File]::ReadAllText($orderFile) | ConvertFrom-Json
    $oLeaves = Leaves $o
    Same '  and writes the order the game loads for this list, with the plugin last' $oLeaves ($masters5 + @('_ResourcePack.esl', 'Water for ENB.esm', 'Expressive Facegen Morphs.esl', 'Light Beards.esp', 'Thornswood-Content.esp', 'Menu Glue.esp', 'Skyrim Unbound.esp', 'Late Light.esp', 'New Light.esp', 'Thornswood-Last.esp'))
    Yes '  naming Thornswood-Content.esp at its file in game\content' (@($o.loadOrder | Where-Object { ([string]$_) -match '/game/content/Thornswood-Content\.esp$' }).Count -eq 1)
    Yes '  and Thornswood-Last.esp, which the box makes from its recipe, last in the Data folder' (([string]@($o.loadOrder)[-1]) -match '/Game/Data/Thornswood-Last\.esp$')
    Yes '  and the rest in the Data folder it read' (@($o.loadOrder | Where-Object { ([string]$_) -match '/Game/Data/Water for ENB\.esm$' }).Count -eq 1)
    Yes '  and nothing in the build: the settings as they were, no gamemode.js put there' ([IO.File]::ReadAllText((Join-Path $t 'dist\server-settings.json')) -eq $before -and -not (Test-Path -LiteralPath (Join-Path $t 'dist\gamemode.js')))
}
catch {
    Yes ('the harness ran to the end without an error: ' + $_.Exception.Message) $false
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
