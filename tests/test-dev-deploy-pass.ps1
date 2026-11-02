<#
  test-dev-deploy-pass.ps1

  Deploy-DevGamemode.ps1 -RequirePass on|off sets thornswoodRequirePass in the
  dev server's settings, leaving the switch off keeps what the box has, and
  every run leaves thornswoodServer at dev, so a join pass the site issued for
  the live server is refused on the dev one (#937). Deploy-Gamemode.ps1 writes
  thornswoodServer main for live; since #1223 it writes no join pass switch
  into the build, and Deploy-Server.ps1 takes the same -RequirePass and sets
  live's on the box.

  HOW. The same as test-dev-deploy-refuse.ps1: the settings block is lifted out
  of the script, expanded here with the values the script would have, and run
  in PowerShell 7 (what the box runs it in since #5356) against a
  server-settings.json in a temp folder. Nothing connects to anything.
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
$repo = Split-Path -Parent $here
$script = Join-Path $repo 'scripts\deploy\Deploy-DevGamemode.ps1'
# The counting function Deploy-DevGamemode sends up with the block (#2011).
. (Join-Path $repo 'scripts\deploy\ServerOrder.ps1')
$script:fullIndexDef = 'function Get-ThornswoodFullIndex {' + "`n" + (Get-Command Get-ThornswoodFullIndex).Definition + "`n}"
$live = Join-Path $repo 'scripts\deploy\Deploy-Gamemode.ps1'
$liveServer = Join-Path $repo 'scripts\deploy\Deploy-Server.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

function SetOf([string]$path, [string]$name) {
    $ast = [Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($path), [ref]$null, [ref]$null)
    $param = $ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq $name }
    if (-not $param) { return $null }
    $vs = $param.Attributes | Where-Object { $_.TypeName.Name -eq 'ValidateSet' }
    if (-not $vs) { return '' }
    return ((@($vs.PositionalArguments | ForEach-Object { $_.Value }) | Sort-Object) -join ',')
}
Yes 'Deploy-DevGamemode.ps1 takes -RequirePass on, off, or nothing' ((SetOf $script 'RequirePass') -eq ',off,on')
Yes 'Deploy-Server.ps1 takes -RequirePass on, off, or nothing (#1223)' ((SetOf $liveServer 'RequirePass') -eq ',off,on')
Yes 'Deploy-Gamemode.ps1 takes no -RequirePass, so a build never carries one (#1223)' ($null -eq (SetOf $live 'RequirePass'))

$liveText = [IO.File]::ReadAllText($live)
Yes 'the live deploy always writes thornswoodServer main' ($liveText -match "NotePropertyName thornswoodServer -NotePropertyValue 'main' -Force")
Yes 'and writes no thornswoodRequirePass into the build, taking an old one out' (
    $liveText -notmatch 'NotePropertyName thornswoodRequirePass' -and $liveText -match "'thornswoodRequirePass', 'thornswoodDevs', 'thornswoodPlaytesters'")

$text = [IO.File]::ReadAllText($script)
$start = $text.IndexOf("Write-Host 'Pointing the dev server at the dev voice service...'")
$open = $text.IndexOf('Remote @"', $start)
$close = $text.IndexOf('"@ | ForEach-Object', $open)
Yes 'the settings block is where it was' ($start -ge 0 -and $open -gt $start -and $close -gt $open)
$body = $text.Substring($open + 'Remote @"'.Length, $close - $open - 'Remote @"'.Length).Trim("`r", "`n")

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-dev-pass-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

function Run-Block([string]$value, $settings) {
    $p = Join-Path $tmp 'server-settings.json'
    [IO.File]::WriteAllText($p, ($settings | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
    $rootWin = $tmp
    $orderWire = ''
    $remotePlugins = 'C:/nowhere'
    $fullIndexDef = $script:fullIndexDef
    $lightDef = ''
    $devRecordLight = $false
    $VoicePort = 7789
    $maxOnline = 0
    $seats = 0
    $LoadOrderRefuse = ''
    $RequirePass = $value
    $Npcs = ''
    $expanded = $ExecutionContext.InvokeCommand.ExpandString($body)
    $file = Join-Path $tmp 'block.ps1'
    [IO.File]::WriteAllText($file, $expanded, (New-Object Text.UTF8Encoding $true))
    $said = & $boxPs -NoProfile -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { "$_" }
    $after = Get-Content $p -Raw | ConvertFrom-Json
    return @{ said = ($said -join "`n"); after = $after }
}
function Backups { return @(Get-ChildItem $tmp -Filter 'server-settings.json.before-*').Count }
function Copy-With($from, [string]$k, $v) {
    $o = [ordered]@{}; foreach ($key in $from.Keys) { $o[$key] = $from[$key] }; $o[$k] = $v; return $o
}

$base = [ordered]@{
    port = 7787; thornswoodVoicePort = 7789
    equipmentSlotCheckEnabled = $false; equipmentSpellCheckEnabled = $false; equipmentInventoryCheckEnabled = $false; equipItemAttemptEnabled = $true
    npcAllowCrimeFaction = $true; npcAllowEssential = $true
    loadOrder = @('C:/p/Skyrim.esm'); maxPlayers = 10
}

try {
    $r = Run-Block '' $base
    Yes 'a box with no thornswoodServer is set to dev with no switch at all' ($r.after.thornswoodServer -eq 'dev')
    Yes 'and no switch adds no thornswoodRequirePass' (-not ($r.after.PSObject.Properties.Name -contains 'thornswoodRequirePass'))

    $mainBox = Copy-With $base 'thornswoodServer' 'main'
    $r = Run-Block '' $mainBox
    Yes 'a box that says main (a live settings file copied over) is put back to dev' ($r.after.thornswoodServer -eq 'dev')

    $dev = Copy-With $base 'thornswoodServer' 'dev'
    Get-ChildItem $tmp -Filter 'server-settings.json.before-*' | Remove-Item -Force
    $r = Run-Block 'on' $dev
    Yes '-RequirePass on sets thornswoodRequirePass true' ($r.after.thornswoodRequirePass -eq $true)
    Yes 'and says so, and reads it back' ($r.said -match 'thornswoodRequirePass moves from  to True' -and $r.said -match 'join pass required True on dev')
    Yes 'and leaves the rest of the settings as they were' ($r.after.port -eq 7787 -and $r.after.maxPlayers -eq 10 -and $r.after.thornswoodServer -eq 'dev')
    Yes 'and keeps the old file' ((Backups) -eq 1)

    $on = Copy-With $dev 'thornswoodRequirePass' $true
    $n = Backups
    $r = Run-Block '' $on
    Yes 'no switch keeps it on and writes nothing' ($r.after.thornswoodRequirePass -eq $true -and (Backups) -eq $n)
    $r = Run-Block 'on' $on
    Yes 'on when it is already on writes nothing' ((Backups) -eq $n)

    $r = Run-Block 'off' $on
    Yes '-RequirePass off sets it false' ($r.after.thornswoodRequirePass -eq $false)
    Yes 'the load order refusal is left alone by it' (-not ($r.after.PSObject.Properties.Name -contains 'thornswoodLoadOrderRefuse'))

    $bytes = [IO.File]::ReadAllBytes((Join-Path $tmp 'server-settings.json'))
    Yes 'the file is written without a byte order mark' ($bytes[0] -ne 0xEF)
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
