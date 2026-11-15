<#
  test-4069-main-move.ps1

      pwsh -NoProfile -File .\scripts\tests\test-4069-main-move.ps1

  The live server moves to the recorded collection revision with nothing of
  One's (#4069): Deploy-Server.ps1 -FromStore -FromRecord. This holds:
    1. ServerSettings.ps1's $settingsStoreBlock, run here against a stand-in
       root: without $OrderWire it copies the running server's settings as
       they are; with it the load order becomes the recorded one at the
       server's own plugin paths, the start point moves to Skyrim
       Unbound.esp's full index in the new order, every other key is the
       server's, and CARRIED names the file's sha256. A plugin whose light
       flag cannot be read, with an engine that loads light plugins, refuses
       the carry and clears the stage.
    2. Deploy-Server.ps1: -FromRecord goes with -FromStore alone; the order
       is last-plugin.json's with the Last plugin on the end; the plugins come
       from the box's store and are held to the collection's record; what
       the move may drop is records\collection-dropped.json's; the swap lets
       loadOrder and startPoints move and nothing else; and the deploy gate
       lets Deploy-Server take -FromRecord.
  Nothing connects anywhere, and everything it writes is in its own temp folder.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $Here)
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
$utf8 = New-Object Text.UTF8Encoding($false)

. (Join-Path $repo 'scripts\deploy\ServerSettings.ps1')
. (Join-Path $repo 'scripts\deploy\ServerOrder.ps1')

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4069-main-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
try {
    # ---- 1. the carry on the box ---------------------------------------------
    $far = ($T -replace '\\', '/') + '/plugins/'
    $live = [ordered]@{
        port = 7777
        thornswoodRequirePass = $true
        name = 'Thornswood'
        loadOrder = @('Skyrim.esm', 'Atlas Map Markers.esp', 'Old.esp', 'Skyrim Unbound.esp', 'Thornswood-Last.esp' | ForEach-Object { $far + $_ })
        startPoints = @([ordered]@{ pos = @(1, 2, 3); worldOrCell = '0x0319BAD4'; angleZ = 90 })
        npcSettings = [ordered]@{ a = 1 }
    }
    function New-Root([string]$name) {
        $r = Join-Path $T $name
        New-Item -ItemType Directory -Force -Path (Join-Path $r 'plugins'), (Join-Path $r '.stage-1/plugins') | Out-Null
        [IO.File]::WriteAllText((Join-Path $r 'server-settings.json'), ($live | ConvertTo-Json -Depth 10), $utf8)
        return $r
    }
    function Run-Block([string]$root, [string]$pre) {
        $text = "`$Root = '$root'`r`n`$Stage = '.stage-1'`r`n`$WasRecord = 'none'`r`n" + $pre + $settingsStoreBlock
        return @(& ([scriptblock]::Create($text)) | ForEach-Object { "$_" })
    }

    $r0 = New-Root 'keep'
    $out = Run-Block $r0 ''
    $sp0 = Join-Path $r0 '.stage-1/server-settings.json'
    Yes 'without an order the settings go into the stage as the server has them' ((Test-Path $sp0) -and ([IO.File]::ReadAllText($sp0) -eq [IO.File]::ReadAllText((Join-Path $r0 'server-settings.json'))))
    Yes '  and CARRIED names their sha256' (@($out | Where-Object { $_ -eq ('CARRIED ' + (Get-FileHash $sp0 -Algorithm SHA256).Hash.ToLowerInvariant()) }).Count -eq 1)

    $r1 = New-Root 'move'
    $names = @('Skyrim.esm', 'cheddars_mashups.esl', 'Old.esp', 'Skyrim Unbound.esp', 'Thornswood-Last.esp')
    $wire = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($names -join "`n"))
    $out = Run-Block $r1 ("`$OrderWire = '$wire'`r`n`$LoadsLight = `$false`r`n")
    $sp1 = Join-Path $r1 '.stage-1/server-settings.json'
    $got = [IO.File]::ReadAllText($sp1) | ConvertFrom-Json
    Yes 'with the recorded order, the stage''s load order is it, at the server''s own plugin paths' ((@($got.loadOrder) -join '|') -eq (@($names | ForEach-Object { ($r1 -replace '\\', '/') + '/plugins/' + $_ }) -join '|'))
    Yes '  the start point stays when Skyrim Unbound.esp keeps its index (an engine with no light plugins)' ($got.startPoints[0].worldOrCell -eq '0x0319BAD4' -and ($out -join ' ') -match 'stays 0x0319BAD4')
    Yes '  every other key is the server''s' ($got.port -eq 7777 -and $got.thornswoodRequirePass -eq $true -and $got.name -eq 'Thornswood' -and $got.npcSettings.a -eq 1 -and $got.startPoints[0].angleZ -eq 90)
    Yes '  and CARRIED names the file written' (@($out | Where-Object { $_ -eq ('CARRIED ' + (Get-FileHash $sp1 -Algorithm SHA256).Hash.ToLowerInvariant()) }).Count -eq 1)

    # An engine that loads light plugins: the .esl takes no full index, so
    # Skyrim Unbound.esp goes from 3 to 2 once Atlas is gone.
    $r2 = New-Root 'light'
    foreach ($n in 'Skyrim.esm', 'Old.esp', 'Skyrim Unbound.esp') {
        $b = New-Object byte[] 24; [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($b, 0)
        [IO.File]::WriteAllBytes((Join-Path $r2 ('plugins/' + $n)), $b)
    }
    $b = New-Object byte[] 24; [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($b, 0)
    [IO.File]::WriteAllBytes((Join-Path $r2 '.stage-1/plugins/Thornswood-Last.esp'), $b)
    $out = Run-Block $r2 ("`$OrderWire = '$wire'`r`n`$LoadsLight = `$true`r`n")
    $got = [IO.File]::ReadAllText((Join-Path $r2 '.stage-1/server-settings.json')) | ConvertFrom-Json
    Yes 'the start point moves to Skyrim Unbound.esp''s full index in the new order' ($got.startPoints[0].worldOrCell -eq '0x0219BAD4' -and ($out -join ' ') -match 'moves from 0x0319BAD4 to 0x0219BAD4')
    Yes '  keeping the rest of the start point' ($got.startPoints[0].angleZ -eq 90 -and (@($got.startPoints[0].pos) -join ',') -eq '1,2,3')

    $r3 = New-Root 'unread'
    $out = Run-Block $r3 ("`$OrderWire = '$wire'`r`n`$LoadsLight = `$true`r`n")
    Yes 'a plugin whose light flag cannot be read refuses the carry' (($out -contains 'CARRY REFUSED') -and ($out -join ' ') -match 'cannot be read')
    Yes '  and clears the stage' (-not (Test-Path (Join-Path $r3 '.stage-1')))

    # ---- 2. Deploy-Server.ps1 ------------------------------------------------
    $ds = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Deploy-Server.ps1'))
    $err = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($ds, [ref]$null, [ref]$err)
    Yes 'Deploy-Server.ps1 parses and takes -FromRecord' (@($err).Count -eq 0 -and @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) -contains 'FromRecord')
    Yes '-FromRecord goes with -FromStore' ($ds.Contains("if (`$FromRecord -and -not `$FromStore) {"))
    Yes 'the order is last-plugin.json''s with the Last plugin on the end' ($ds.Contains("game\data\last-plugin.json") -and $ds.Contains('Where-Object { $_ -and $_ -ine $ThornswoodLastPlugin }) + $ThornswoodLastPlugin)'))
    Yes 'the plugins come from the box''s store and are held to the collection''s record' ($ds.Contains('Get-ThornswoodCollectionStore -RecordPath') -and $ds.Contains('$inStore = Join-Path $store.Dir $n') -and
        ([regex]::Matches($ds, 'Assert-ThornswoodCollectionPlugins')).Count -ge 2)
    Yes 'what the move may drop is records\collection-dropped.json''s, for the store''s revision' ($ds.Contains("records\collection-dropped.json") -and $ds.Contains('[string]$dd.revision -eq [string]$store.Revision') -and
        $ds.Contains('Test-ThornswoodLoadOrderDrop ([pscustomobject]@{ loadOrder = @($boxContent.Order) }) ([pscustomobject]@{ loadOrder = $recordOrder }) $mayDrop'))
    Yes 'the live order need not end with the Last plugin already when the order moves' ($ds.Contains('if ($lastWant -and -not $FromRecord) {'))
    Yes 'the swap lets loadOrder and startPoints move, and nothing else' ($ds.Contains("`$liveKeys = @('loadOrder', 'startPoints')") -and $ds.Contains('$orderLines + $settingsStoreBlock'))
    $gv = ([IO.File]::ReadAllText((Join-Path $repo 'scripts\vps\gate\verbs.json'))) | ConvertFrom-Json
    Yes 'the deploy gate lets Deploy-Server take -FromRecord' ($gv.verbs.'Deploy-Server'.params.FromRecord -eq 'switch' -and [int]$gv.verbs.'Deploy-Server'.timeoutMinutes -le 45)
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
