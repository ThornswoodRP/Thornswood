<#
  test-dev-start-point-light.ps1

  Deploy-DevGamemode.ps1 puts the start point's file index at Skyrim
  Unbound.esp's place among the FULL plugins, not its place in the list
  (#2011).

  WHY. With an engine that loads light plugins (#1715) the dev loadOrder holds
  48 full and 54 light plugins, and a form id's top byte counts full plugins
  only. The block counted the list, so the dev deploy of 5 Oct 10:01 PM moved
  the start point to 0x5E19BAD4 (Unbound 94th in the list, 45th among full
  plugins), and at 11:00 PM a new character died at login with
    Error: FromFormId failed due to invalid file index 94 (5e19bad4)

  HOW. The same as test-dev-deploy-pass.ps1: the settings block is lifted out
  of the script, expanded here with the values the script would have (its
  counting function and light rule from ServerOrder.ps1, and whether the record says the engine loads light plugins),
  over plugin files written here with the TES4 header flags each case names,
  since the block reads them where the dev server loads them (#2947),
  and run in PowerShell 7, what the box runs it in since #5356, against a
  server-settings.json in a temp folder. Nothing connects to anything.

  The last case is the measured one: the dev server's own order and which of
  its plugins are light, read off the box on 20 Oct (#2924) into
  tests\fixtures\dev-load-order-2924.json, 103 plugins, 55 of them light,
  Skyrim Unbound.esp 94th in the list and 45th among the full plugins, the
  same places as on 5 Oct. It runs on every machine. Until #2924 it read a
  server-settings.json in a fork worktree (claude-1005-skymp) and the headers
  in C:\Thornswood\Game\Data, and once that worktree was removed it said
  SKIP everywhere: the order is the box's and the plugins it loads are on the
  box, so neither belongs to a checkout or a game folder. The record is what
  was measured and is not kept in step with the box; whether the dev server's
  start point is right now is Check-Chargen.ps1 -From dev's question.
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
. (Join-Path $repo 'scripts\deploy\ServerOrder.ps1')
$script:fullIndexDef = 'function Get-ThornswoodFullIndex {' + "`n" + (Get-Command Get-ThornswoodFullIndex).Definition + "`n}"
$script:lightDef = 'function Test-ThornswoodPluginLight {' + "`n" + (Get-Command Test-ThornswoodPluginLight).Definition + "`n}"

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$text = [IO.File]::ReadAllText($script)
$start = $text.IndexOf("Write-Host 'Pointing the dev server at the dev voice service...'")
$open = $text.IndexOf('Remote @"', $start)
$close = $text.IndexOf('"@ | ForEach-Object', $open)
Yes 'the settings block is where it was' ($start -ge 0 -and $open -gt $start -and $close -gt $open)
$body = $text.Substring($open + 'Remote @"'.Length, $close - $open - 'Remote @"'.Length).Trim("`r", "`n")
Yes 'the block counts with Get-ThornswoodFullIndex, sent up with it' ($body.Contains('$fullIndexDef') -and $body.Contains("Get-ThornswoodFullIndex ([string[]]``"))
Yes 'and reads which plugins are light on the box with Test-ThornswoodPluginLight, the shared rule, sent up with it' ($body.Contains('$lightDef') -and $body.Contains('Test-ThornswoodPluginLight `$f'))
Yes '  and no light table is built from a game folder here' (-not $text.Contains('$lightTable') -and -not $text.Contains('Test-ThornswoodPluginLight $f.FullName'))

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-dev-start-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

# Plugin files with only a TES4 header, light when its flags hold 0x200: what
# Test-ThornswoodPluginLight reads on the box.
function Write-Plugins([string]$dir, [hashtable]$light) {
    if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
    New-Item -ItemType Directory -Path $dir | Out-Null
    foreach ($n in @($light.Keys)) {
        $b = New-Object byte[] 24
        [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($b, 0)
        $flags = [uint32]0
        if ($light[$n]) { $flags = [uint32]0x200 }
        [BitConverter]::GetBytes($flags).CopyTo($b, 8)
        [IO.File]::WriteAllBytes((Join-Path $dir $n), $b)
    }
}

# $light maps a plugin name to whether it is light, written as the plugins
# the dev server loads; $stage, when given, as plugins this run sends, which
# sit in the stage until the swap. $loads is whether the engine loads light
# plugins, which the block takes from the record this commit holds (the
# check before anything is sent holds the box's to it).
function Run-Block($settings, [hashtable]$light, $loads, [hashtable]$stage = @{}) {
    $p = Join-Path $tmp 'server-settings.json'
    [IO.File]::WriteAllText($p, ($settings | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
    $rootWin = $tmp
    $orderWire = ''
    $remotePlugins = (Join-Path $tmp 'server-plugins').Replace('\', '/')
    Write-Plugins (Join-Path $tmp 'server-plugins') $light
    Write-Plugins (Join-Path $tmp 'plugins') $stage
    $fullIndexDef = $script:fullIndexDef
    $lightDef = $script:lightDef
    $devRecordLight = [bool]$loads
    $VoicePort = 7789
    $maxOnline = 0
    $seats = 0
    $LoadOrderRefuse = ''
    $RequirePass = ''
    $Npcs = ''
    $expanded = $ExecutionContext.InvokeCommand.ExpandString($body)
    $file = Join-Path $tmp 'block.ps1'
    [IO.File]::WriteAllText($file, $expanded, (New-Object Text.UTF8Encoding $true))
    $said = & $boxPs -NoProfile -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { "$_" }
    $after = Get-Content $p -Raw | ConvertFrom-Json
    return @{ said = ($said -join "`n"); start = [string]@($after.startPoints)[0].worldOrCell }
}
function Settings([string[]]$names, [string]$startAt) {
    return [ordered]@{
        port = 7787; thornswoodVoicePort = 7789; thornswoodServer = 'dev'; thornswoodRequirePass = $true
        equipmentSlotCheckEnabled = $false; equipmentSpellCheckEnabled = $false; equipmentInventoryCheckEnabled = $false; equipItemAttemptEnabled = $true
        npcAllowCrimeFaction = $true; npcAllowEssential = $true
        loadOrder = @($names | ForEach-Object { 'C:/Thornswood-Server-Dev/plugins/' + $_ })
        startPoints = @([ordered]@{ pos = @(1.0, 2.0, 3.0); worldOrCell = $startAt; angleZ = 90 })
    }
}

$order = @('Skyrim.esm', '_ResourcePack.esl', 'Full One.esp', 'Light One.esp', 'Skyrim Unbound.esp', 'Full Two.esp')
$light = @{ 'Skyrim.esm' = $false; 'Full One.esp' = $false; 'Light One.esp' = $true; 'Skyrim Unbound.esp' = $false; 'Full Two.esp' = $false }

try {
    # Unbound is fifth in the list (index 4), third among the full plugins (index 2).
    $r = Run-Block (Settings $order '0x0419BAD4') $light $true
    Yes 'with light plugins, a start point at the list position moves to the full index: 0x0219BAD4' ($r.start -eq '0x0219BAD4')
    Yes '  and says Unbound is full plugin 2' ($r.said -match 'Skyrim Unbound\.esp is full plugin 2' -and $r.said -match 'start point moved to 0x0219BAD4, index 2')

    # A plugin this run sends is in the stage until the swap, and that copy is
    # the one the server will load: here the server's own Light One.esp is
    # full and the one going up is light.
    $serverHas = $light.Clone(); $serverHas['Light One.esp'] = $false
    $r = Run-Block (Settings $order '0x0419BAD4') $serverHas $true @{ 'Light One.esp' = $true }
    Yes 'a plugin in the stage is read there, not in the server''s folder: 0x0219BAD4' ($r.start -eq '0x0219BAD4')
    $r = Run-Block (Settings $order '0x0219BAD4') $serverHas $true
    Yes '  and with nothing in the stage the server''s own copy counts: 0x0319BAD4' ($r.start -eq '0x0319BAD4')

    $before = @(Get-ChildItem $tmp -Filter 'server-settings.json.before-*').Count
    $r = Run-Block (Settings $order '0x0219BAD4') $light $true
    Yes 'a start point already at the full index is left as it is' ($r.start -eq '0x0219BAD4' -and $r.said -notmatch 'start point moved')

    $r = Run-Block (Settings $order '0x0219BAD4') $light $false
    Yes 'on a box whose engine does not load light plugins every entry counts: 0x0419BAD4' ($r.start -eq '0x0419BAD4')
    # #2711: the block read the box's record itself, in a try with an empty
    # catch, so a record that did not read counted as no light plugins.
    Yes '  and the block reads no record on the box, so there is none to misread' ($body -notmatch 'server-build\.json' -and $body.Contains('$loadsLight = `$$devRecordLight'))

    $odd = @('Skyrim.esm', 'Mystery.esp', 'Skyrim Unbound.esp')
    $r = Run-Block (Settings $odd '0x0919BAD4') $light $true
    Yes 'a plugin the box does not have leaves the start point alone' ($r.start -eq '0x0919BAD4')
    Yes '  and says which' ($r.said -match 'cannot tell whether mystery\.esp is light, so the start point is left alone')

    # The measured case: the order the dev server runs and its light plugins,
    # as read off the box (the header says where and when).
    $measured = Get-Content -LiteralPath (Join-Path $here 'fixtures\dev-load-order-2924.json') -Raw | ConvertFrom-Json
    $names = [string[]]@($measured.plugins | ForEach-Object { [string]$_.name })
    $real = @{}
    foreach ($m in @($measured.plugins)) { $real[[string]$m.name] = [bool]$m.light }
    $listAt = [Array]::IndexOf($names, 'Skyrim Unbound.esp')
    Yes ('the record holds the dev order: {0} plugins, {1} light, Skyrim Unbound.esp {2} in the list' -f $names.Count, @($real.Values | Where-Object { $_ }).Count, $listAt) (
        $names.Count -eq 103 -and @($real.Values | Where-Object { $_ }).Count -eq 55 -and $listAt -eq 94 -and $real.Count -eq $names.Count)
    $r = Run-Block (Settings $names ('0x{0:X2}19BAD4' -f $listAt)) $real $true
    Yes ('the dev server''s own order: 0x5E19BAD4, as the 10:01 PM deploy wrote it, moves to 0x2D19BAD4, the start point the box had (' + $r.start + ')') (
        $r.start -eq '0x2D19BAD4' -and $r.start -eq [string]$measured.startPoint)
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
