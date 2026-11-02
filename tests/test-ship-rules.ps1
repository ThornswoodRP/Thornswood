<#
  test-ship-rules.ps1

  Every file that has ever leaked in a pack or the old installer stays out, and the
  rules that decide what leaves this machine still say what they mean.

  WHY THIS EXISTS. Ship-Rules.ps1 is the one list of what never leaves a
  machine, and nearly every line in it is there because something already got
  out: the SkyMP sign in token inside the installer, one machine's
  Thornswood.ini with Fov=120 in the three packs of 16 and 17 September,
  a 6 MB vortex.deployment.json in pack-20260916-1217, the voice join token in
  nine packs from 18 to 20 September, a report and a script from the Claude
  desktop app in packs 20260916-0130 to 0937, and the front's own 147 fonts
  and sounds wrongly left out by the dev Ship of 20 September at 13:02. Entry
  197 on the To Do List: "Ship-Rules is the highest-yield unit test in the
  repo, seven incidents have already happened inside it".

  So each incident case below is the exact relative path its own comment in
  Ship-Rules.ps1 names, asked of the real functions, dot-sourced. A rule that
  is edited away, or a rewrite that turns one list into another, turns a line
  here red before a pack carries the file again.

  MARKETPLACETEXTURES.BSA. Bethesda's archive for the in-game Creations menu,
  2.8 MB, which every pack and the installer carried because it was in
  neither vanilla list and Vortex does not provide it. Both pack baselines on
  Patrick's machine list it, so the fix has to leave it out WITHOUT the next
  pack listing it as removed, or every launcher deletes a Bethesda file off
  every tester. This drives the diff and the removal filter lifted by text out
  of the shipped Publish-Update.ps1, the same way test-master-flag.ps1 lifts
  its functions out of Deploy-Gamemode.ps1, so it tests the real code.

  THE LOOSE ART REPORT, Get-ShipLooseArt, named the loose textures and meshes
  the old installer was about to carry that were neither ours nor the
  collection's (547 MB on 22 September). It went with that installer and its
  own scan of Ship-Rules (#4824); packs keep such files out by
  Test-ShipNotOurs, which test-not-ours.ps1 holds.

  Where this machine has a pack baseline and a Profile\OwnGame\files.txt, it
  measures against them too, and says SKIP where it cannot.

  -RulesPath runs it against another copy of Ship-Rules.ps1, so a scratch copy
  with a rule taken out can be shown to turn it red.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param(
    [string]$Root = (& (Join-Path $PSScriptRoot '..\scripts\release\Where.ps1') Install),
    [string]$RulesPath
)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $RulesPath) { $RulesPath = Join-Path $Here 'scripts\release\Ship-Rules.ps1' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

. $RulesPath

# The record of our own client build sits beside the rules, and the rules read
# it from there. Read here too, so the six files are asked about by name.
# In records\ since phase 8 of issue #440, two folders up from scripts\release.
$record = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $RulesPath))) (Join-Path 'records' 'client-build.json')
$clientFiles = @()
if (Test-Path -LiteralPath $record) {
    $clientFiles = @((Get-Content -LiteralPath $record -Raw | ConvertFrom-Json).files.PSObject.Properties.Name)
}

# ---- somebody's sign in, which the installer carried -------------------------
#
# The night Ship-Rules became one file: Package-Thornswood kept its own
# shorter list and the SkyMP client's saved sign in token from the build
# machine rode inside the installer.
$token = 'Data\Platform\PluginsNoLoad\auth-data-no-load.js'
Yes "$token is never shipped" (Test-ShipOtherServer $token)
Yes '  and never removed from anybody either' (Test-ShipMachine $token)
Yes '  and never swept as a runtime file' (-not (Test-ShipRuntime $token))
Yes 'anything else in PluginsNoLoad is kept out the same way' (Test-ShipOtherServer 'Data\Platform\PluginsNoLoad\other.js')

# ---- one machine's settings, which three packs carried -----------------------
#
# 16 and 17 September: the publishing machine's Thornswood.ini went out and put
# its Fov=120 and its key binds on everyone.
foreach ($rel in @(
    'Data\SKSE\Plugins\Thornswood.ini',
    # SSE Display Tweaks holds the screen resolution; publishing it stamped
    # one person's monitor onto everyone.
    'Data\SKSE\Plugins\SSEDisplayTweaks.ini',
    # One person's character slot.
    'Data\Platform\Plugins\skymp5-client-settings.txt',
    'Data\SKSE\Plugins\OpenAnimationReplacer.ini',
    'Data\SKSE\Plugins\SkyrimPlatform.ini',
    'Data\SKSE\Plugins\po3_Tweaks.ini',
    'Data\SKSE\Plugins\CrashLogger.ini',
    # The launcher and the voice plugin talk through these.
    'Data\Platform\voice-port.txt',
    'Data\Platform\voice-status.txt',
    'Data\Platform\voice-ptt.txt',
    # Who this person has muted in voice, by profile id (entry 151).
    'Data\Platform\voice-muted.txt',
    # The game asking the launcher for a join token (#1322).
    'Data\Platform\voice-token-ask.txt',
    # Every profile id the install owns.
    'Data\Platform\thornswood-characters.json',
    'Data\Platform\thornswood-choice.txt',
    'Data\Platform\thornswood-forget.txt',
    'Data\Platform\UI\thornswood-characters.js',
    'Data\Platform\thornswood-loadorder.txt',
    'Data\Platform\thornswood-plugins-light.txt',
    'Data\Platform\thornswood-session.txt',
    'Data\Platform\menu-music-duck.txt',
    'Data\Platform\overlay-boot.count',
    'Data\Platform\thornswood-voice.log'
)) {
    Yes "$rel is one machine's own" (Test-ShipMachine $rel)
    # A runtime path is listed as removed and taken off every install, which
    # for somebody's own settings would be worse than shipping them.
    Yes '  and is never swept off anybody as a runtime file' (-not (Test-ShipRuntime $rel))
}
# Matched exactly, so a file of ours that merely sits beside one is not caught.
Yes 'a different ini in the same folder still ships' (-not (Test-ShipMachine 'Data\SKSE\Plugins\ThornswoodExtra.ini'))

# ---- the voice join token, which nine packs carried --------------------------
#
# 18 to 20 September, packs 20260918-1615 to 20260920-1124. Kept out of new
# packs, and deleted from the installs that took one of those nine.
$voice = 'Data\Platform\voice-token.txt'
Yes "$voice is never shipped" (Test-ShipMachine $voice)
$always = @(Get-ShipDeleteAlways)
Yes '  and every pack deletes it from every install' ($always -contains $voice)

# ---- Vortex's own bookkeeping, which pack-20260916-1217 carried --------------
foreach ($rel in @(
    'Data\vortex.deployment.json',
    'Data\vortex.deployment.dinput.json',
    'Data\meshes\__folder_managed_by_vortex',
    'Data\textures\armor\iron.dds.vortex_backup'
)) {
    Yes "$rel is Vortex's own and never shipped" (Test-ShipMachine $rel)
}

# ---- what the Claude desktop app dropped into the game folder ----------------
#
# A report, a script and a png rode along in packs 20260916-0130 to 0937, and
# Data\Platform\Claude outputs held three scripts on 16 September.
foreach ($rel in @(
    'Claude outputs\report.md',
    'Data\Platform\Claude outputs\fix.ps1',
    '_to_delete\old.dll',
    'Data\SKSE\Plugins\CharGen\Exported\face.jslot',
    '.sentry-native\last_crash'
)) {
    Yes "$rel is written at runtime and never shipped" (Test-ShipRuntime $rel)
}
Yes 'a folder whose name only ends the same way is not taken for it' (-not (Test-ShipRuntime 'Data\NotClaude outputs\x.txt'))

# ---- another server's folders ------------------------------------------------
Yes 'NirnLab UI Platform is kept out' (Test-ShipOtherServer 'Data\NirnLabUIPlatform\CEFSubprocess.exe')
Yes '  and its plugin' (Test-ShipOtherServer 'Data\SKSE\Plugins\NirnLabUIPlugin.dll')
Yes "another server's parked Creation Club archives are kept out" (Test-ShipOtherServer 'Data\_disabledByOtherServer\ccBGSSSE001-Fish.bsa')
Yes '  by their shape, whatever the server''s short name is' ((Test-ShipOtherServer 'Data\_disabledByXyz\ccBGSSSE001-Fish.bsa') -and (Test-ShipOtherServer 'Data\_disabledByAnyName'))
Yes "  and another server's backup beside the game" (Test-ShipOtherServer 'otherserver-backup-1.7.104.0\Data\Dawnguard.esm')
Yes "  and its plugin list, switched off beside the game" (Test-ShipOtherServer '_otherserver-plugins-off\plugins.txt')
Yes '  by their shape, whatever the server is called' ((Test-ShipOtherServer 'anyname-backup-1.6.1170\SkyrimSE.exe') -and (Test-ShipOtherServer '_anyname-plugins-off'))
Yes '  but not a backup folder under Data, which is the other rules''' (-not (Test-ShipOtherServer 'Data\x-backup-1\y.esp'))
Yes '  and the Daedric launcher''s folder' (Test-ShipOtherServer 'DaedricData\skymp-disabled\files\Data\x.bsa')
Yes '  but not a parking folder deeper than Data, nor one with no name after it' (
    -not (Test-ShipOtherServer 'Data\textures\_disabledByOtherServer\x.dds') -and -not (Test-ShipOtherServer 'Data\_disabledBy\x.esp'))
Yes '  nor a Data folder that only starts with an underscore' (-not (Test-ShipOtherServer 'Data\_disabled\x.esp'))

# ---- the loose map.swf and SkyUI's ERROR CODE 5 --------------------------------
#
# 22 September: excluded from packs, but the machines that already had it kept
# it, so every pack deletes it as well.
$map = 'Data\Interface\map.swf'
Yes "$map is never shipped" (Test-ShipOtherServer $map)
Yes '  whatever case it is written in' (Test-ShipOtherServer 'Data\Interface\MAP.SWF')
Yes '  and every pack deletes it from every install' ($always -contains $map)
Yes 'the other Interface files still ship' (-not (Test-ShipOtherServer 'Data\Interface\quest_journal.swf'))

# ---- SkyUI 5.2's loose scripts and SkyUI's ERROR CODE 6, issue #960 ------------
#
# Dev packs carried them, so every pack deletes them as well as leaving them out.
foreach ($s in @('Data\Scripts\ski_main.pex', 'Data\Scripts\ski_widgetmanager.pex', 'Data\Scripts\ski_configmenu.pex')) {
    Yes "$s is never shipped" (Test-ShipOtherServer $s)
    Yes '  and every pack deletes it from every install' ($always -contains $s)
}
Yes 'SkyUI 5.2''s scripts match in any case' (Test-ShipOtherServer 'Data\Scripts\SKI_Main.pex')
Yes 'MCM Recorder''s SKI_ConfigBase.pex still ships as the collection''s' (-not (Test-ShipOtherServer 'Data\Scripts\SKI_ConfigBase.pex') -and $always -notcontains 'Data\Scripts\SKI_ConfigBase.pex')
Yes '  and so does its SKI_ConfigManager.pex' (-not (Test-ShipOtherServer 'Data\Scripts\SKI_ConfigManager.pex'))

# ---- Data\Platform: ours is what we name --------------------------------------
Yes 'our overlays in Plugins ship' (-not (Test-ShipOtherServer 'Data\Platform\Plugins\thornswood-chat.js'))
Yes 'anybody else''s plugin script in Plugins does not' (Test-ShipOtherServer 'Data\Platform\Plugins\other-server-chat.js')
Yes 'a backup file in Data\Platform does not' (Test-ShipOtherServer 'Data\Platform\Plugins\thornswood-chat.js.bak')
# Somebody else's menu is a Vite build: an assets folder, app.js, vite.svg.
Yes 'another menu''s assets folder does not ship' (Test-ShipOtherServer 'Data\Platform\UI\assets\index-4f2a.js')
Yes '  nor its app.js' (Test-ShipOtherServer 'Data\Platform\UI\app.js')
Yes '  nor its vite.svg' (Test-ShipOtherServer 'Data\Platform\UI\vite.svg')

# ---- Data\Platform\UI: only what build.js names, #1318 --------------------------
#
# Font names come from the real shipped build.js fixture, not a hand-kept pair.
. (Join-Path $Here 'tests\fixtures\ui-front.ps1')
function Get-UiNameSet($items) {
    $s = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($x in @($items)) {
        $n = ([string]$x).Trim()
        if ($n.Length -eq 0 -or $n[0] -eq '#') { continue }
        [void]$s.Add($n)
    }
    return $s
}
function Test-UiNameSetsEqual($a, $b) {
    $sa = Get-UiNameSet $a
    $sb = Get-UiNameSet $b
    if ($sa.Count -ne $sb.Count) { return $false }
    foreach ($x in $sa) { if (-not $sb.Contains($x)) { return $false } }
    return $true
}
function Test-UiParseRefuses([string]$js, [string]$named) {
    $threw = $false
    $namedIt = $false
    try { $null = Read-ShipUiHashedAssetsFromText $js }
    catch {
        $threw = $true
        $namedIt = $_.Exception.Message -match [regex]::Escape($named)
    }
    return ($threw -and $namedIt)
}

$uiFixtureJs = Get-UiFrontFixtureBuildJs
# The Daedric set and unused fork assets live in one record. Ship-Rules and
# OwnGame both load it; neither file may keep a second hand-copied list.
$uiGoneRecord = Join-Path $Here 'records\ui-gone.json'
Yes 'records\ui-gone.json is the one list of the Daedric set and unused fork assets' (Test-Path -LiteralPath $uiGoneRecord)
$uiGoneDoc = Get-Content -LiteralPath $uiGoneRecord -Raw -Encoding UTF8 | ConvertFrom-Json
$fromRecordDaedric = @($uiGoneDoc.daedric.PSObject.Properties | ForEach-Object { $_.Name })
$fromRecordHashes = @($uiGoneDoc.daedric.PSObject.Properties | ForEach-Object { ([string]$_.Value).ToLowerInvariant() })
$fromRecordUnused = @($uiGoneDoc.unused | ForEach-Object { [string]$_ })
Yes 'Ship-Rules loaded every Daedric name from that record' (Test-UiNameSetsEqual @($ShipDaedricMenu.Keys) $fromRecordDaedric)
Yes '  and every Daedric sha256' (Test-UiNameSetsEqual @($ShipDaedricMenu.Values) $fromRecordHashes)
Yes '  and every unused fork name' (Test-UiNameSetsEqual $ShipUnusedFrontAssets $fromRecordUnused)
$rulesText = [IO.File]::ReadAllText($RulesPath)
$ogText = [IO.File]::ReadAllText((Join-Path $Here 'launcher\app\OwnGame.cs'))
$sampleGone = [string](@($fromRecordDaedric)[0])
Yes 'Ship-Rules.ps1 has no second hand-copied Daedric list' (
    $rulesText.Contains('ui-gone.json') -and ($rulesText.IndexOf($sampleGone, [StringComparison]::OrdinalIgnoreCase) -lt 0))
Yes 'OwnGame.cs has no second hand-copied Daedric list' (
    $ogText.Contains('ui-gone.json') -and ($ogText.IndexOf($sampleGone, [StringComparison]::OrdinalIgnoreCase) -lt 0))
Yes 'Build-Launcher.ps1 embeds that record' (
    ([IO.File]::ReadAllText((Join-Path $Here 'scripts\release\Build-Launcher.ps1'))).Contains('ui-gone.json'))

Yes 'the real shipped build.js''s asset modules are committed as a test fixture' (Test-Path -LiteralPath $uiFixtureJs)
$uiExpected = Get-UiFrontFixtureExpectedNames
$uiRealParsed = $null
$uiRealThrew = $false
try { $uiRealParsed = Read-ShipUiHashedAssetsFromText ([IO.File]::ReadAllText($uiFixtureJs)) }
catch { $uiRealThrew = $true; Write-Host ('      ' + $_.Exception.Message) }
Yes 'the real shipped build.js parses without throwing' (-not $uiRealThrew -and $null -ne $uiRealParsed)
Yes '  and the parsed names are exactly the emitted hashed set from that file' (
    -not $uiRealThrew -and (Test-UiNameSetsEqual $uiRealParsed $uiExpected))
$uiFonts = @(Get-UiFrontFixtureFontNames)
$uiFontA = [string]$uiFonts[0]
$uiFontB = [string]$uiFonts[1]
Yes '  and that set names the Big Shoulders font the fixture emits' ($uiExpected.Contains($uiFontA))
Yes '  and names the Barlow SemiBold font' ($uiExpected.Contains($uiFontB))
# The four Futura PT and DIN Pro faces of main's older build.js (#1317) and
# the Bankir-Retro and icomoon faces fork #41 took out are on
# records\ui-gone.json: the fork's build names none of them, and a copy left
# in an install is never ours.
foreach ($face in '6f802bf60c545304b09e.ttf', '00e4a2200c3e5ae71d67.ttf', '268a0df3f0e2c23d1ea6.ttf', 'fdf086661e1600f95a34.ttf', '855bfaf67c57745958d3.ttf', 'd213051bb6f28a25fb26.ttf') {
    Yes "  the fork's build does not name the retired face $face" (-not $uiExpected.Contains($face))
    Yes "  and it is not ours all the same" (Test-ShipOtherServer ('Data\Platform\UI\' + $face))
}

$uiWork = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-ui-front-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$uiDir = Join-Path $uiWork 'Data\Platform\UI'
New-Item -ItemType Directory -Force -Path $uiDir | Out-Null
# Webpack file-loader form: __webpack_require__.p + "hash.ext" / n.p+"hash.ext"
$uiExcerpt = @"
!function(e){var t={};function n(r){if(t[r])return t[r].exports;var o=t[r]={i:r,l:!1,exports:{}};return e[r].call(o.exports,o,o.exports,n),o.l=!0,o.exports}n.p="";n(0)}([
function(e,t,n){e.exports=n.p+"$uiFontA";},
function(e,t,n){e.exports=n.p+"$uiFontB";}
]);
"@
[IO.File]::WriteAllText((Join-Path $uiDir 'build.js'), $uiExcerpt)
[IO.File]::WriteAllText((Join-Path $uiDir $uiFontA), 'font-a')
[IO.File]::WriteAllText((Join-Path $uiDir $uiFontB), 'font-b')
[IO.File]::WriteAllText((Join-Path $uiDir 'index.html'), '<html></html>')
[IO.File]::WriteAllText((Join-Path $uiDir 'thornswood-bridge.js'), 'overlay')
[IO.File]::WriteAllText((Join-Path $uiDir 'thornswood-menu.jpg'), 'menu')
[IO.File]::WriteAllText((Join-Path $uiDir 'thornswood-theme.mp3'), 'theme')
$GameDir = $uiWork
$script:ShipUiHashedCacheKey = ''
$script:ShipUiHashedCache = $null
$parsed = @(Get-ShipUiHashedAssets)
Yes 'a webpack excerpt parses hashed names derived from the real file' (
    $parsed.Count -gt 0 -and ($parsed -icontains $uiFontA) -and ($parsed -icontains $uiFontB))

foreach ($rel in @(
    'Data\Platform\UI\index.html',
    'Data\Platform\UI\build.js',
    'Data\Platform\UI\thornswood-bridge.js',
    ('Data\Platform\UI\' + $uiFontA),
    ('Data\Platform\UI\' + $uiFontB),
    'Data\Platform\UI\thornswood-menu.jpg',
    'Data\Platform\UI\thornswood-theme.mp3'
)) {
    Yes "$rel is the front's own and ships" (-not (Test-ShipOtherServer $rel) -and -not (Test-ShipMachine $rel) -and -not (Test-ShipRuntime $rel))
}
Yes 'an unnamed flat UI file does not ship' (Test-ShipOtherServer 'Data\Platform\UI\0123456789abcdef0123456789abcdef.png')
Yes 'a non-hash bare name like logo.png is not counted as ours' (
    -not ((Read-ShipUiHashedAssetsFromText 'e.exports=n.p+"logo.png";') -icontains 'logo.png') -and
    (Test-ShipOtherServer 'Data\Platform\UI\logo.png'))

# A renamed hashed asset in build.js is picked up with no list edit.
$renamedExcerpt = $uiExcerpt.Replace($uiFontB, 'cafebabeface0123.png')
[IO.File]::WriteAllText((Join-Path $uiDir 'build.js'), $renamedExcerpt)
[IO.File]::WriteAllText((Join-Path $uiDir 'cafebabeface0123.png'), 'renamed-asset')
$script:ShipUiHashedCacheKey = ''
$script:ShipUiHashedCache = $null
Yes 'a renamed hashed asset build.js names ships with no list edit' (
    ((Get-ShipUiHashedAssets) -icontains 'cafebabeface0123.png') -and
    -not (Test-ShipOtherServer 'Data\Platform\UI\cafebabeface0123.png'))
# Put the excerpt back so later Save-ShipUiHashedAssets still finds both fonts.
[IO.File]::WriteAllText((Join-Path $uiDir 'build.js'), $uiExcerpt)
Remove-Item -LiteralPath (Join-Path $uiDir 'cafebabeface0123.png') -Force
$script:ShipUiHashedCacheKey = ''
$script:ShipUiHashedCache = $null

# The 37 Daedric files never ship and every pack deletes them.
foreach ($n in @($ShipDaedricMenu.Keys)) {
    $rel = 'Data\Platform\UI\' + $n
    Yes "$rel is never shipped" (Test-ShipOtherServer $rel)
    Yes '  and every pack deletes it from every install' ($always -contains $rel)
}
# The unused fork svgs and bg.png, same treatment.
foreach ($n in $ShipUnusedFrontAssets) {
    $rel = 'Data\Platform\UI\' + $n
    Yes "$rel is never shipped" (Test-ShipOtherServer $rel)
    Yes '  and every pack deletes it from every install' ($always -contains $rel)
}

# A renamed copy of a Daedric file still counts, by sha256.
$daedricName = @($ShipDaedricMenu.Keys)[0]
$daedricHash = $ShipDaedricMenu[$daedricName]
$renamedGone = Join-Path $uiDir 'not-the-original-name.jpg'
[IO.File]::WriteAllText($renamedGone, 'daedric-renamed-copy')
$renamedSha = Get-ShipFileSha256 $renamedGone
[void]$ShipDaedricMenuHashes.Add($renamedSha)
Yes 'a renamed copy whose sha256 is a Daedric hash does not ship' (Test-ShipOtherServer 'Data\Platform\UI\not-the-original-name.jpg')
$goneAlways = @(Get-ShipDeleteAlways)
Yes '  and every pack deletes that renamed copy too' ($goneAlways -contains 'Data\Platform\UI\not-the-original-name.jpg')
[void]$ShipDaedricMenuHashes.Remove($renamedSha)
Remove-Item -LiteralPath $renamedGone -Force

# Guards: zero names, a missing named file, emitted non-bare URLs.
$zeroJs = Join-Path $uiDir 'build.js'
$savedJs = [IO.File]::ReadAllText($zeroJs)
[IO.File]::WriteAllText($zeroJs, 'var k="./src/img/button_middle.svg"; function(){ return "no assets here"; }')
$script:ShipUiHashedCacheKey = ''
$script:ShipUiHashedCache = $null
$srcIgnored = @(Read-ShipUiHashedAssetsFromText ([IO.File]::ReadAllText($zeroJs)))
Yes 'source module ids with slashes are ignored, not a refuse' ($srcIgnored.Count -eq 0)
$zeroThrew = $false
try { $null = Save-ShipUiHashedAssets $uiWork } catch { $zeroThrew = $_.Exception.Message -match 'named no hashed assets' }
Yes 'zero names parsed refuses to ship' $zeroThrew

[IO.File]::WriteAllText($zeroJs, $uiExcerpt.Replace($uiFontB, 'abcdef0123456789.ttf'))
$script:ShipUiHashedCacheKey = ''
$script:ShipUiHashedCache = $null
$missThrew = $false
try { $null = Save-ShipUiHashedAssets $uiWork } catch { $missThrew = ($_.Exception.Message -like '*abcdef0123456789.ttf*' -and $_.Exception.Message -like '*not in Data\Platform\UI*') }
Yes 'build.js naming a missing file refuses to ship' $missThrew

Yes "an emitted 'img/x.png' refuses, naming the entry" (Test-UiParseRefuses 'e.exports=n.p+"img/x.png";' 'img/x.png')
Yes "an emitted 'C:\x.png' refuses, naming the entry" (Test-UiParseRefuses 'e.exports=n.p+"C:\x.png";' 'C:\x.png')
Yes "an emitted '/x.png' refuses, naming the entry" (Test-UiParseRefuses 'e.exports=n.p+"/x.png";' '/x.png')
Yes "an emitted '../x.png' refuses, naming the entry" (Test-UiParseRefuses 'e.exports=n.p+"../x.png";' '../x.png')

[IO.File]::WriteAllText($zeroJs, $savedJs)
$script:ShipUiHashedCacheKey = ''
$script:ShipUiHashedCache = $null
$savedNames = @(Save-ShipUiHashedAssets $uiWork)
$gameList = Get-Content -LiteralPath (Join-Path $uiWork $ShipUiAssetsRel)
Yes 'Ship writes the parsed names into thornswood-ui-assets.txt' (
    (Test-Path -LiteralPath (Join-Path $uiWork $ShipUiAssetsRel)) -and
    (Test-UiNameSetsEqual $savedNames $parsed) -and
    (Test-UiNameSetsEqual $gameList $parsed))

# Pack ui-assets.txt must carry the same names by content, not just a count.
# Publish-Update writes the zip entry from $script:ShipUiHashedWritten; this
# reads that entry back from a zip built the same way. The release record in
# version.json stopped carrying the names (#1050): the game file
# thornswood-ui-assets.txt is a file of the release, so its record holds it.
function Read-PackUiAssetsFromZip([string]$zipPath, [string[]]$names) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    $z = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
    try {
        $ue = $z.CreateEntry('ui-assets.txt')
        $uw = New-Object IO.StreamWriter ($ue.Open())
        $uw.WriteLine('# hashed assets build.js named, #1318')
        foreach ($n in $names) { $uw.WriteLine($n) }
        $uw.Flush(); $uw.Dispose()
    } finally { $z.Dispose() }
    $z = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $e = $z.GetEntry('ui-assets.txt')
        if (-not $e) { return @() }
        $sr = New-Object IO.StreamReader ($e.Open())
        try { return @($sr.ReadToEnd() -split '\r?\n') }
        finally { $sr.Dispose() }
    } finally { $z.Dispose() }
}
. (Join-Path $Here 'scripts\release\Release-Name.ps1')
$packUiLines = Read-PackUiAssetsFromZip (Join-Path $uiWork 'pack.zip') @($script:ShipUiHashedWritten)
$uiRelease = New-ReleaseRecord 't' 'dev' '0' @('t') 't' '' '' 0
Yes 'pack zip ui-assets.txt names match the parse of build.js by content' (Test-UiNameSetsEqual $packUiLines $parsed)
Yes 'the release record in version.json carries no uiAssets (#1050)' (-not $uiRelease.PSObject.Properties['uiAssets'])

# Same content check against the real shipped file, not the two-font excerpt.
$uiRealWork = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-ui-real-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$uiRealDir = Join-Path $uiRealWork 'Data\Platform\UI'
New-Item -ItemType Directory -Force -Path $uiRealDir | Out-Null
Copy-Item -LiteralPath $uiFixtureJs -Destination (Join-Path $uiRealDir 'build.js')
[IO.File]::WriteAllText((Join-Path $uiRealDir 'index.html'), '<html></html>')
foreach ($n in $uiExpected) {
    [IO.File]::WriteAllText((Join-Path $uiRealDir $n), 'asset')
}
$script:ShipUiHashedCacheKey = ''
$script:ShipUiHashedCache = $null
$realSaved = @(Save-ShipUiHashedAssets $uiRealWork)
$realGameList = Get-Content -LiteralPath (Join-Path $uiRealWork $ShipUiAssetsRel)
$realPack = Read-PackUiAssetsFromZip (Join-Path $uiRealWork 'pack.zip') @($script:ShipUiHashedWritten)
Yes 'the ship record of the real build.js matches that parse by content' (Test-UiNameSetsEqual $realSaved $uiRealParsed)
Yes '  and so does pack zip ui-assets.txt' (Test-UiNameSetsEqual $realPack $uiRealParsed)
Yes '  and so does the game file thornswood-ui-assets.txt' (Test-UiNameSetsEqual $realGameList $uiRealParsed)
Remove-Item -LiteralPath $uiRealWork -Recurse -Force -ErrorAction SilentlyContinue

Remove-Item -LiteralPath $uiWork -Recurse -Force -ErrorAction SilentlyContinue
Remove-Variable -Name GameDir -ErrorAction SilentlyContinue
$script:ShipUiHashedCacheKey = ''
$script:ShipUiHashedCache = $null

# Held on dev until 22 September, then given to main by Patrick.
Yes 'the theme is not held back from main any more' (-not (Test-ShipDevOnly 'Data\Platform\UI\thornswood-theme.mp3'))

# ---- our own client, by record -------------------------------------------------
#
# Until 20 September the copies in every game folder were another launcher's
# builds. The six files in client-build.json are ours by hash, and
# skymp5-client.js in particular would read as somebody else's plugin script
# by the name rule above.
#
# And by the file's bytes, since #306 (entry 128) on 24 September: one of the
# six is ours only when the file under $GameDir is the recorded build, and
# when it is missing or anything else it is not ours, so it is neither shipped
# nor listed as removed. This check was written the day before that, when the
# path alone made a file ours, and the two landed an hour apart and turned
# main red. So each file is asked twice here: with bytes the record is told to
# expect, under a made up $GameDir, and with nothing there.
# launcher\tests\test-client-by-hash.ps1 asks the same of this machine's real bundle.
Yes 'client-build.json names the six client files' ($clientFiles.Count -eq 6)
$fakeGame = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-ship-rules-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    foreach ($rel in $clientFiles) {
        $recorded = $ShipClientHashes[$rel]
        $full = [IO.Path]::Combine($fakeGame, $rel.Replace('\', [IO.Path]::DirectorySeparatorChar))
        $null = New-Item -ItemType Directory -Force -Path (Split-Path $full -Parent)
        [IO.File]::WriteAllText($full, 'the recorded build of ' + $rel)
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $ShipClientHashes[$rel] = -join ($sha.ComputeHash([IO.File]::ReadAllBytes($full)) | ForEach-Object { $_.ToString('x2') }) }
        finally { $sha.Dispose() }
        $GameDir = $fakeGame
        Yes "$rel is ours by record and ships when it is the recorded build" (-not (Test-ShipOtherServer $rel) -and -not (Test-ShipMachine $rel) -and -not (Test-ShipRuntime $rel))
        [IO.File]::WriteAllText($full, 'somebody else''s build of ' + $rel)
        Yes "$rel with other bytes is not ours, so it neither ships nor is removed" ((Test-ShipOtherServer $rel) -eq $true)
        Remove-Item -LiteralPath $full -Force
        Yes "$rel with nothing there is not ours either" ((Test-ShipOtherServer $rel) -eq $true)
        $ShipClientHashes[$rel] = $recorded
        Remove-Variable -Name GameDir -ErrorAction SilentlyContinue
    }
}
finally {
    Remove-Item -LiteralPath $fakeGame -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- nothing is both shipped and deleted ---------------------------------------
#
# A path on the delete-always list that a pack could also carry would arrive
# and be deleted in the same update.
foreach ($rel in $always) {
    Yes "$rel, deleted by every pack, is never carried by one" ((Test-ShipOtherServer $rel) -or (Test-ShipMachine $rel))
}

# ---- the record that keeps the collection out ---------------------------------
#
# 17 September: Profile went, Profile\OwnGame\files.txt with it, and a release
# counted 29,063 files and 11,368.1 MB of the collection as ours. Only lines
# whose origin is V are the collection's.
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-ship-rules-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $work 'Profile\OwnGame') -Force | Out-Null
try {
    $profileDir = Join-Path $work 'Profile'
    Yes 'no record answers nothing, so the publisher can refuse' ($null -eq (Get-ShipOwnGameCollection $profileDir))

    $lines = @(
        'F|V|1024|638000000000000000|Data\SkyUI_SE.esp',
        'F|V|2048|638000000000000000|Data\textures\sky\clouds.dds',
        'F|O|4096|638000000000000000|Data\Platform\Plugins\thornswood-chat.js',
        'not a record line'
    )
    [IO.File]::WriteAllLines((Join-Path $profileDir 'OwnGame\files.txt'), $lines)
    $set = Get-ShipOwnGameCollection $profileDir
    Yes 'the record reads back as a set' ($null -ne $set)
    Yes '  holding the two lines Vortex deployed' ($null -ne $set -and $set.Count -eq 2)
    Yes '  matched without regard to case' ($null -ne $set -and $set.Contains('data\skyui_se.esp'))
    Yes '  and not the file of ours beside them' ($null -ne $set -and -not $set.Contains('Data\Platform\Plugins\thornswood-chat.js'))

    # Where the reference plugin list comes from, which shipped the ordinary
    # Skyrim's list once when it was read from AppData with the game closed.
    $scratchRoot = Join-Path $work 'Root'
    New-Item -ItemType Directory -Path $scratchRoot -Force | Out-Null
    $oldLocal = $env:LOCALAPPDATA
    try {
        $env:LOCALAPPDATA = Join-Path $work 'AppLocal'
        Yes 'no Game folder reads the list Vortex writes into AppData' (
            (Get-ShipLoadOrderDir $scratchRoot $profileDir) -eq (Join-Path $env:LOCALAPPDATA 'Skyrim Special Edition'))
        $env:LOCALAPPDATA = $null
        Yes '  and with no LOCALAPPDATA, as off Windows, the platform''s own folder' (
            (Get-ShipLoadOrderDir $scratchRoot $profileDir) -eq (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Skyrim Special Edition'))
    } finally { $env:LOCALAPPDATA = $oldLocal }
    New-Item -ItemType Directory -Path (Join-Path $scratchRoot 'Game') -Force | Out-Null
    Yes 'an older Game folder reads Profile\Default' ((Get-ShipLoadOrderDir $scratchRoot $profileDir) -eq (Join-Path $profileDir 'Default'))
    [IO.File]::WriteAllText((Join-Path $profileDir 'OwnGame\plugins.txt'), "*SkyUI_SE.esp`r`n")
    Yes 'a folder made from Vortex reads Profile\OwnGame' ((Get-ShipLoadOrderDir $scratchRoot $profileDir) -eq (Join-Path $profileDir 'OwnGame'))
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- MarketplaceTextures.bsa: the rule itself -----------------------------------
$bsa = 'Data\MarketplaceTextures.bsa'
Yes 'MarketplaceTextures.bsa is one machine''s own: never shipped, never removed' (Test-ShipMachine $bsa)
Yes 'whatever the case of the path' (Test-ShipMachine 'data\marketplacetextures.bsa')
Yes 'only at the Data root, not a file of that name in a mod folder' (-not (Test-ShipMachine 'Data\textures\MarketplaceTextures.bsa'))
Yes 'and not a name that merely starts the same way' (-not (Test-ShipMachine 'Data\MarketplaceTextures.bsa2'))
Yes 'it is not a runtime path, which would list it as removed' (-not (Test-ShipRuntime $bsa))
Yes 'it is not on the list every pack deletes' (@(Get-ShipDeleteAlways) -notcontains $bsa)
Yes 'a mod''s own archive beside it still ships' (-not (Test-ShipMachine 'Data\SkyUI_SE.bsa'))
Yes 'and so does our own plugin' (-not (Test-ShipMachine 'Data\Thornswood-Content.esp'))

# ---- Bethesda's Creation Kit and a copy of the game, issue #1152 ----------------
#
# The dev record of 29 September listed all of these as files of ours, and main
# pack 20260926-1603 carried the Creation Kit and the copy of SkyrimSE.exe.
# Never shipped, never in a record, never listed as removed (a pack's delete
# list reaches a Steam copy, where a Creation Kit is the person's own); the
# launcher takes them out of its own game folder. tests\test-no-bethesda-files.ps1
# holds the rest.
$ck = @(
    'CreationKit.exe', 'CreationKit.ini', 'CreationKitPrefs.ini',
    'SkyrimSE.exe.bak-1160-for-369',
    'Tools\AssetWatcher\AssetWatcher.exe', 'Tools\HavokBehaviorPostProcess\HavokBehaviorPostProcess.exe',
    'Tools\RoboVoicer.exe', 'Tools\Archive\Archive.exe', 'Tools\redist\VC_redist.x64.exe',
    'Papyrus Compiler\PapyrusCompiler.exe', 'lex\ssceam.tlx',
    'Data\DialogueViews\0001A2A8.xml', 'Data\Scripts.zip',
    'flowchartx64.dll', 'flowchartx32.dll', 'p4com64.dll',
    'EditorWarnings.txt', 'DataFiles.txt', 'SkyrimReservedAddOnIndexes.txt',
    # #1227: the Creation Kit's script sources, both folders. The five dev
    # records the feed lists on 29 September name IED.psc; three main packs of
    # 15 September carried
    # SKSE.psc and 61 more.
    'Data\Source\Scripts\Actor.psc', 'Data\Scripts\Source\IED.psc', 'Data\Scripts\Source\SKSE.psc'
)
foreach ($rel in $ck) {
    Yes "$rel is Bethesda's: never shipped, never removed" ((Test-ShipBethesdaTool $rel) -and (Test-ShipMachine $rel) -and -not (Test-ShipRuntime $rel))
}
foreach ($rel in @('VERSION.bak', 'Data\SKSE\Plugins\SkyrimPlatform.ini.bak', 'Data\SKSE\Plugins\SkyrimPlatform.ini.2026-09-19T20-17-00-253Z.bak')) {
    Yes "$rel, a backup the same record carried, is never shipped or removed" ((Test-ShipBackup $rel) -and (Test-ShipMachine $rel))
}
Yes 'one person''s face tint the same record carried is runtime' (Test-ShipRuntime 'Data\textures\CharGen\Exported\Adventurer3424.dds')

# ---- the shipped diff, lifted out of Publish-Update.ps1 ------------------------
#
# From the line that starts the two lists to the line that filters removals by
# Test-Machine, plus Test-Machine itself. If either is renamed this fails
# rather than quietly testing nothing.
$pubPath = Join-Path $Here 'scripts\release\Publish-Update.ps1'
$pub = Get-Content -LiteralPath $pubPath -Raw
$tm = [regex]::Match($pub, '(?m)^function Test-Machine\(.*$')
$diff = [regex]::Match($pub, '(?ms)^\$changed = @\(\); \$removed = @\(\)\r?$.*?^\$removed\s+= @\(\$removed \| Where-Object \{[^\r\n]*Test-Machine[^\r\n]*\r?$')
Yes 'Publish-Update.ps1 still defines Test-Machine on one line' $tm.Success
Yes 'Publish-Update.ps1 still builds the removals and filters them by Test-Machine' $diff.Success
Yes 'and its scan still leaves out what Test-Machine claims' ($pub -match 'if \(Test-Machine \$rel\) \{ continue \}')
if (-not $tm.Success -or -not $diff.Success) { Done }
. ([scriptblock]::Create($tm.Value))

# The last pack carried the archive, a mesh that has since gone, and one of our
# overlays. The game folder now has the archive and the overlay. The scan
# leaves out what Test-Machine claims, as Publish-Update's does.
$prev = @{}
$prev[$bsa] = '2938167:639246568900000000'
$prev['Data\meshes\gone\old.nif'] = '100:1'
# #1178: and one of our own pages that has since gone.
$prev['Data\Platform\UI\thornswood-old.js'] = '100:1'
$prev['Data\Platform\Plugins\thornswood-hud.js'] = '10:1'
# #1152: the last record listed the Creation Kit and the copy of the game.
$prev['CreationKit.exe'] = '48685408:1'
$prev['SkyrimSE.exe.bak-1160-for-369'] = '37157144:1'
# #1227: and a script source, while the folder holds the Creation Kit's others.
$prev['Data\Scripts\Source\IED.psc'] = '16174:1'
$onDisk = @($bsa, 'Data\Platform\Plugins\thornswood-hud.js', 'CreationKit.exe', 'Data\Source\Scripts\Actor.psc')
$now = @{}
foreach ($rel in $onDisk) {
    if (Test-Machine $rel) { continue }
    $now[$rel] = $prev[$rel]
}
. ([scriptblock]::Create($diff.Value))

Yes 'the next pack does not carry MarketplaceTextures.bsa' (-not $now.ContainsKey($bsa))
Yes 'and does not list it as changed' ($changed -notcontains $bsa)
Yes 'and does not list it as removed, so no tester loses it' ($removed -notcontains $bsa)
Yes 'the lifted diff is live: a page of ours that really went is still removed' ($removed -contains 'Data\Platform\UI\thornswood-old.js')
Yes 'while another author''s mesh that went is not listed as removed (#1178)' ($removed -notcontains 'Data\meshes\gone\old.nif')
Yes 'the next pack does not carry the Creation Kit, nor list it as removed' (-not $now.ContainsKey('CreationKit.exe') -and $removed -notcontains 'CreationKit.exe')
Yes 'nor list the copy of SkyrimSE.exe as removed, which could reach a Steam copy' ($removed -notcontains 'SkyrimSE.exe.bak-1160-for-369')
Yes 'the next pack carries no script source and lists none as removed (#1227)' (
    -not $now.ContainsKey('Data\Source\Scripts\Actor.psc') -and $changed -notcontains 'Data\Source\Scripts\Actor.psc' -and $removed -notcontains 'Data\Scripts\Source\IED.psc')
Yes 'and our overlay is neither changed nor removed' (($changed -notcontains 'Data\Platform\Plugins\thornswood-hud.js') -and ($removed -notcontains 'Data\Platform\Plugins\thornswood-hud.js'))

# ---- the menu backdrop ------------------------------------------------------------
Yes 'the three files Go.ps1 writes are the three called ours' ((@($ShipOwnArt) | Where-Object { (Get-Content -LiteralPath (Join-Path $Here 'scripts\release\Go.ps1') -Raw).Contains("'" + $_ + "'") }).Count -eq 3)
Yes 'and they are ours outside Data\Platform' (@($ShipOwnArt | Where-Object { -not (Test-ShipOurs $_) }).Count -eq 0)
Yes 'no Get-ShipLooseArt is left: the old installer that read it went (#4824)' (-not (Get-Command Get-ShipLooseArt -ErrorAction SilentlyContinue))

# ---- our menu files ---------------------------------------------------------------
# The three paths in $ShipOursFiles that are not the plugins or the client
# script live in game\ours, and Go.ps1 writes those paths ($oursMenuFiles).
# The main menu and the board's meshes are not among them since #2827: they
# are made from each game ($ShipMadeFromGame, tests\test-2827-from-game.ps1).
# The files on disk, the paths Go.ps1 quotes, and the same paths in
# $ShipOursFiles are one list. One side gaining or losing a path fails.
$goText = Get-Content -LiteralPath (Join-Path $Here 'scripts\release\Go.ps1') -Raw
$oursBlock = [regex]::Match($goText, '(?s)\$oursMenuFiles = @\((.*?)\)')
$written = @()
if ($oursBlock.Success) {
    $written = @([regex]::Matches($oursBlock.Groups[1].Value, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
}
$diskRoot = Join-Path $Here 'game\ours'
$onDisk = @()
if (Test-Path -LiteralPath $diskRoot) {
    # Named with \ on any machine, as Go.ps1 and the rules write them.
    $prefix = $diskRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $onDisk = @(Get-ChildItem -LiteralPath $diskRoot -Recurse -File | ForEach-Object {
        $_.FullName.Substring($prefix.Length).Replace([IO.Path]::DirectorySeparatorChar, '\')
    })
}
$inRules = @($ShipOursFiles | Where-Object {
    $path = $_
    (@($written | Where-Object { $_ -ceq $path }).Count -gt 0) -or (@($onDisk | Where-Object { $_ -ceq $path }).Count -gt 0)
})
function Same-List($left, $right) {
    $x = @($left | Sort-Object)
    $y = @($right | Sort-Object)
    if ($x.Count -ne $y.Count -or $x.Count -eq 0) { return $false }
    for ($i = 0; $i -lt $x.Count; $i++) { if ($x[$i] -cne $y[$i]) { return $false } }
    return $true
}
Yes 'Go.ps1 writes each file kept in game\ours' (Same-List $written $onDisk)
Yes 'and those paths are the ShipOursFiles entries, no more and no less' (Same-List $written $inRules)

# ---- measured on this machine, where it can be ------------------------------------
$baseline = $null
foreach ($cand in @(
    (Join-Path (Split-Path -Parent ($Here)) 'Thornswood-Releases\published.json'),
    (Join-Path (& (Join-Path $Here 'scripts\release\Where.ps1') MachineData) 'published.json')
)) {
    if ($cand -and (Test-Path -LiteralPath $cand)) { $baseline = $cand; break }
}
if ($baseline) {
    $keys = @(((Get-Content -LiteralPath $baseline -Raw) -replace '^\uFEFF', '' | ConvertFrom-Json).PSObject.Properties.Name)
    if ($keys -contains $bsa) {
        Write-Host "      this machine's last pack carried $bsa, so a vanilla rule would have deleted it"
    }
    Yes 'whatever the last pack carried, the archive is not removed by the next' (@($keys | Where-Object { $_ -ieq $bsa -and -not (Test-Machine $_) }).Count -eq 0)
} else {
    Write-Host 'SKIP  no pack baseline on this machine'
}

# Join-Path stops on a drive this machine does not have (C: off Windows),
# so whether the folder is here at all is asked first.
$filesRecord = $(if (Test-Path -LiteralPath $Root) { Join-Path $Root 'Profile\OwnGame\files.txt' } else { '' })
if ($filesRecord -and (Test-Path -LiteralPath $filesRecord)) {
    # What the record does not mark as the collection's (V).
    $rows = @()
    foreach ($line in [IO.File]::ReadLines($filesRecord)) {
        $p = $line.Split([char[]]'|', 5)
        if ($p.Count -ne 5 -or $p[1] -eq 'V') { continue }
        $rows += [pscustomobject]@{ Rel = $p[4]; Len = [long]$p[2] }
    }
    $oursThere = @($rows | Where-Object { @($ShipOwnArt) -contains $_.Rel })
    Yes ("the record's {0} file(s) of our menu backdrop are ours" -f $oursThere.Count) (@($oursThere | Where-Object { -not (Test-ShipOurs $_.Rel) }).Count -eq 0)
    $inRecord = @($rows | Where-Object { $_.Rel -ieq $bsa })
    if ($inRecord.Count) {
        Yes 'the record''s MarketplaceTextures.bsa is left out' (Test-ShipMachine $inRecord[0].Rel)
    }
} else {
    Write-Host "SKIP  no $Root\Profile\OwnGame\files.txt on this machine"
}

# ---- what the rules read that does not read (#2711) -----------------------------------
# The client record, the required-data list and the 1259 list were each read
# in a try with an empty catch, and the collection's config.json too. One that
# did not read left its list empty: the client runtime then fell under
# Data\Platform as ours and shipped unchecked. Now each list stops whatever
# loaded the rules, before anything is packed or sent; one that is not there
# is still none. A config.json that does not read stops the revision read too
# (Patrick, 19 Oct, #2711 decision 2 B), as test-ship-revision-gate holds. A copy of the rules in a
# scratch tree, loaded in a child.
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-rules-reads-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $relDir = Join-Path $scratch 'scripts\release'
    New-Item -ItemType Directory -Force -Path $relDir, (Join-Path $scratch 'records') | Out-Null
    foreach ($f in @(Get-ChildItem -LiteralPath (Split-Path -Parent $RulesPath) -File)) { Copy-Item -LiteralPath $f.FullName -Destination $relDir }
    # The one other record the rules refuse to load without.
    Copy-Item -LiteralPath (Join-Path $Here 'records\ui-gone.json') -Destination (Join-Path $scratch 'records')
    $me = (Get-Process -Id $PID).Path
    function Load-Rules([string]$then) {
        $driver = Join-Path $scratch 'load.ps1'
        # NormalView: pwsh's default error view wraps a message at the console's
        # width, and the scratch path in it is longer on some runners (#2933).
        [IO.File]::WriteAllText($driver, ("`$global:ErrorView = 'NormalView'`r`n`$ErrorActionPreference = 'Stop'`r`n. '" + (Join-Path $relDir 'Ship-Rules.ps1').Replace("'", "''") + "'`r`n'LOADED'`r`n" + $then), (New-Object Text.UTF8Encoding($true)))
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $o = @(& $me -NoProfile -ExecutionPolicy Bypass -File $driver 2>&1 | ForEach-Object { "$_" }); $c = $LASTEXITCODE }
        finally { $ErrorActionPreference = $old }
        return @{ Out = ($o -join ' '); Code = $c }
    }
    $r = Load-Rules ''
    Yes 'the rules load with no client record beside them, as before' ($r.Code -eq 0 -and $r.Out -match 'LOADED')
    [IO.File]::WriteAllText((Join-Path $scratch 'records\client-build.json'), '{ "files": { "Data\\Platform', (New-Object Text.UTF8Encoding($false)))
    $r = Load-Rules ''
    Yes 'a client record that does not read stops them loading, saying so' ($r.Code -ne 0 -and $r.Out -notmatch 'LOADED' -and $r.Out -match 'client-build\.json does not read' -and $r.Out -match 'Nothing was packed or sent')
    Remove-Item -LiteralPath (Join-Path $scratch 'records\client-build.json')
    $cfgRoot = Join-Path $scratch 'root'
    New-Item -ItemType Directory -Force -Path $cfgRoot | Out-Null
    $ask = "function Get-CollectionRevision([string]`$s) { return 7 }`r`nfunction Get-CollectionSlug([string]`$u) { return `$u }`r`n'REV ' + (Get-ShipCollectionRevision '" + $cfgRoot.Replace("'", "''") + "')`r`n"
    $r = Load-Rules $ask
    Yes 'no config.json: the launcher''s own collection is asked' ($r.Code -eq 0 -and $r.Out -match 'REV 7')
    [IO.File]::WriteAllText((Join-Path $cfgRoot 'config.json'), '{ "CollectionUrl": ', (New-Object Text.UTF8Encoding($false)))
    $r = Load-Rules $ask
    Yes 'a config.json that does not read stops the revision read, and says why (test-ship-revision-gate)' ($r.Code -ne 0 -and $r.Out -notmatch 'REV 7' -and $r.Out -match 'config\.json does not read' -and $r.Out -match 'collection revision it names is not known')
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Done
