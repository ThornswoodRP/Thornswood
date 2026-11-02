<#
  test-dev-deploy-refuse.ps1

  Deploy-DevGamemode.ps1 -LoadOrderRefuse on|off sets thornswoodLoadOrderRefuse
  in the dev server's settings, and leaving the switch off keeps what the box
  has (#402). The dev box's settings are only ever edited by that script, so
  this is the one way the load order refusal is switched on for dev.

  HOW. The settings block is the here-string sent to the VPS after 'Pointing
  the dev server at the dev voice service'. This lifts it out of the script,
  expands it here with the values the script would have, and runs it in
  PowerShell 7 (what the box runs it in since #5356) against a server-settings.json
  in a temp folder. Nothing connects to anything.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$script = Join-Path (Split-Path -Parent $here) 'scripts\deploy\Deploy-DevGamemode.ps1'
# The counting function Deploy-DevGamemode sends up with the block (#2011).
. (Join-Path (Split-Path -Parent $here) 'scripts\deploy\ServerOrder.ps1')
$script:fullIndexDef = 'function Get-ThornswoodFullIndex {' + "`n" + (Get-Command Get-ThornswoodFullIndex).Definition + "`n}"

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$text = [IO.File]::ReadAllText($script)

# The parameter, as the call would bind it.
$ast = [Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$null)
$param = $ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'LoadOrderRefuse' }
Yes 'Deploy-DevGamemode.ps1 takes -LoadOrderRefuse' ($null -ne $param)
$set = @()
if ($param) {
    $vs = $param.Attributes | Where-Object { $_.TypeName.Name -eq 'ValidateSet' }
    if ($vs) { $set = @($vs.PositionalArguments | ForEach-Object { $_.Value }) }
}
Yes 'and it takes on, off, or nothing at all' ((($set | Sort-Object) -join ',') -eq ',off,on')

# The settings block.
$start = $text.IndexOf("Write-Host 'Pointing the dev server at the dev voice service...'")
$open = $text.IndexOf('Remote @"', $start)
$close = $text.IndexOf('"@ | ForEach-Object', $open)
Yes 'the settings block is where it was' ($start -ge 0 -and $open -gt $start -and $close -gt $open)
$body = $text.Substring($open + 'Remote @"'.Length, $close - $open - 'Remote @"'.Length).Trim("`r", "`n")

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-dev-refuse-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

function Run-Block([string]$value, $settings, [string]$npcValue = '') {
    $p = Join-Path $tmp 'server-settings.json'
    [IO.File]::WriteAllText($p, ($settings | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
    # The values the deploy would have put in; these names are what the block reads.
    $rootWin = $tmp
    $orderWire = ''
    $remotePlugins = 'C:/nowhere'
    $fullIndexDef = $script:fullIndexDef
    $lightDef = ''
    $devRecordLight = $false
    $VoicePort = 7789
    $maxOnline = 0
    $seats = 0
    $LoadOrderRefuse = $value
    $RequirePass = ''
    $Npcs = $npcValue
    $expanded = $ExecutionContext.InvokeCommand.ExpandString($body)
    $file = Join-Path $tmp 'block.ps1'
    [IO.File]::WriteAllText($file, $expanded, (New-Object Text.UTF8Encoding $true))
    $said = & $boxPs -NoProfile -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { "$_" }
    $after = Get-Content $p -Raw | ConvertFrom-Json
    return @{ said = ($said -join "`n"); after = $after }
}

$base = [ordered]@{
    port = 7787; thornswoodVoicePort = 7789; thornswoodServer = 'dev'
    equipmentSlotCheckEnabled = $false; equipmentSpellCheckEnabled = $false; equipmentInventoryCheckEnabled = $false; equipItemAttemptEnabled = $true
    npcAllowCrimeFaction = $true; npcAllowEssential = $true
    loadOrder = @('C:/p/Skyrim.esm'); maxPlayers = 10
}

try {
    $r = Run-Block 'on' $base
    Yes '-LoadOrderRefuse on sets thornswoodLoadOrderRefuse true' ($r.after.thornswoodLoadOrderRefuse -eq $true)
    Yes 'and says so, and reads it back' ($r.said -match 'thornswoodLoadOrderRefuse moves from  to True' -and $r.said -match 'load order refusal True')
    Yes 'and leaves the rest of the settings as they were' ($r.after.port -eq 7787 -and $r.after.maxPlayers -eq 10)

    $on = [ordered]@{}; foreach ($k in $base.Keys) { $on[$k] = $base[$k] }; $on.thornswoodLoadOrderRefuse = $true
    $r = Run-Block '' $on
    Yes 'no switch keeps it on' ($r.after.thornswoodLoadOrderRefuse -eq $true)
    Yes 'and writes nothing' ($r.said -match 'already' -and @(Get-ChildItem $tmp -Filter 'server-settings.json.before-*').Count -eq 1)

    $r = Run-Block 'on' $on
    Yes 'on when it is already on writes nothing either' (@(Get-ChildItem $tmp -Filter 'server-settings.json.before-*').Count -eq 1)

    $r = Run-Block 'off' $on
    Yes '-LoadOrderRefuse off sets it false' ($r.after.thornswoodLoadOrderRefuse -eq $false)

    $r = Run-Block '' $base
    Yes 'no switch on a box without it adds nothing' (-not ($r.after.PSObject.Properties.Name -contains 'thornswoodLoadOrderRefuse'))

    # #2711: the block read the byte order mark in a try with an empty catch,
    # after a read of the settings whose failure went on to write. Stage
    # settings that do not read now stop it before it writes, with an exit
    # code, and the deploy throws on that code before the stage is hashed.
    $p = Join-Path $tmp 'server-settings.json'
    foreach ($bad in @('{ "port": 77', '')) {
        Get-ChildItem $tmp -Filter 'server-settings.json.before-*' | Remove-Item -Force
        [IO.File]::WriteAllText($p, $bad)
        $rootWin = $tmp; $orderWire = ''; $remotePlugins = 'C:/nowhere'; $fullIndexDef = $script:fullIndexDef
        $lightDef = ''; $devRecordLight = $false; $VoicePort = 7789; $maxOnline = 0; $seats = 0
        $LoadOrderRefuse = 'on'; $RequirePass = ''; $Npcs = ''
        $file = Join-Path $tmp 'block.ps1'
        [IO.File]::WriteAllText($file, $ExecutionContext.InvokeCommand.ExpandString($body), (New-Object Text.UTF8Encoding $true))
        $said = (& $boxPs -NoProfile -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { "$_" }) -join "`n"
        $code = $LASTEXITCODE
        Yes ('stage settings that are ' + $(if ($bad) { 'not JSON' } else { 'empty' }) + ' stop the block with exit 1, writing nothing') (
            $code -eq 1 -and $said -match 'SETTINGS UNREADABLE on the stage' -and [IO.File]::ReadAllText($p) -eq $bad -and
            -not @(Get-ChildItem $tmp -Filter 'server-settings.json.before-*').Count)
    }
    $after = $text.IndexOf('"@ | ForEach-Object { "  $_" }', $open)
    $stop = $text.IndexOf('if ($LASTEXITCODE -ne 0) { throw "the staged settings could not be edited on the dev box', $after)
    $hash = $text.IndexOf('Get-FileHash -LiteralPath', $after)
    Yes '  and the deploy throws on that exit code before the stage is hashed or checked' ($after -gt 0 -and $stop -gt $after -and $hash -gt $stop)
    Get-ChildItem $tmp -Filter 'server-settings.json.before-*' | Remove-Item -Force

    # -Npcs on|off, the before and after for #385.
    $npcParam = $ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Npcs' }
    $npcSet = @()
    if ($npcParam) {
        $vs = $npcParam.Attributes | Where-Object { $_.TypeName.Name -eq 'ValidateSet' }
        if ($vs) { $npcSet = @($vs.PositionalArguments | ForEach-Object { $_.Value }) }
    }
    Yes 'Deploy-DevGamemode.ps1 takes -Npcs on, off, or nothing' ((($npcSet | Sort-Object) -join ',') -eq ',off,on')

    $withNpcs = [ordered]@{}; foreach ($k in $base.Keys) { $withNpcs[$k] = $base[$k] }
    $withNpcs.npcEnabled = $true; $withNpcs.npcSettings = @{}
    $r = Run-Block '' $withNpcs 'off'
    Yes '-Npcs off sets npcEnabled false' ($r.after.npcEnabled -eq $false)
    Yes 'and says so, and reads it back' ($r.said -match 'npcEnabled moves from True to False' -and $r.said -match 'NPCs False')
    Yes 'and leaves npcSettings and the rest alone' (@($r.after.npcSettings.PSObject.Properties).Count -eq 0 -and $r.after.port -eq 7787)
    $before = @(Get-ChildItem $tmp -Filter 'server-settings.json.before-*').Count
    $r = Run-Block '' $r.after 'off'
    Yes 'off when it is already off writes nothing' (@(Get-ChildItem $tmp -Filter 'server-settings.json.before-*').Count -eq $before)
    $r = Run-Block '' $r.after 'on'
    Yes '-Npcs on puts it back' ($r.after.npcEnabled -eq $true)
    $r = Run-Block '' $r.after ''
    Yes 'no switch keeps it as the box has it' ($r.after.npcEnabled -eq $true)

    $bytes = [IO.File]::ReadAllBytes((Join-Path $tmp 'server-settings.json'))
    Yes 'the file is written without a byte order mark' ($bytes[0] -ne 0xEF)
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
