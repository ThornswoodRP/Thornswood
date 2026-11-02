<#
  Go.ps1 - installs the front, the overlays and the plugins, then reports what
  the server is doing.

  What changed and why, so none of this looks arbitrary later:

  1. There is one browser and three things wanted it. The emote wheel called
     loadUrl on a page of its own, which replaced the chat and the names above
     heads. Last caller wins, and the wheel always called last. So one plugin,
     thornswood-front.js, loads one page, and the wheel and voice mount into it
     as overlays. Nothing else calls loadUrl.

  2. SkyrimPlatform's default page address is the bare string
     file:///Data/Platform/UI/index.html, which CEF reads from the filesystem
     root: C:\Data\Platform\UI, which exists on nobody's machine. The front has
     therefore never once loaded. It is loaded by absolute path now.

  3. Plugins share one global scope. A top level `function log()` becomes a
     property of that shared object, so the last plugin loaded silently replaced
     every other plugin's log: chargen's lines were being written into the
     probe's file under the probe's prefix. Every plugin is wrapped now.

  4. Voice runs in the launcher now, in its own code with no web view
     (launcher\app\Voice.cs and the Voice*.cs files beside it, #4823, which
     launcher\app\ARCHITECTURE.md walks through). It first ran inside the
     game, because the game's browser, served from http on a remote address,
     never exposed a microphone, and it moved out for the same reason.
#>

[CmdletBinding()]
param(
  # Under the launcher install, which Where.ps1 Install finds (C:\Thornswood
  # on most machines, another drive's when the launcher is there, #3003).
  # -Game and -Vortex still win.
  [string] $Game   = ((& (Join-Path $PSScriptRoot 'Where.ps1') Install) + '\Game'),
  [string] $Vps    = '',
  [string] $User   = '',
  [switch] $SkipServer,
  # Install into the Skyrim that Steam owns and Vortex deploys the collection
  # into, rather than into the launcher's own copy. Found the same way the
  # launcher finds it, so there is no path to type and no path to get wrong.
  [switch] $Vortex
)

if ($Vortex) {
  $roots = @()
  # Either key may be missing (Steam writes one or the other), so each is
  # tested for, and a key without SteamPath names nothing.
  foreach ($k in @('HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\Wow6432Node\Valve\Steam')) {
    if (-not (Test-Path -LiteralPath $k)) { continue }
    $kp = Get-ItemProperty -LiteralPath $k
    if ($kp.PSObject.Properties['SteamPath'] -and $kp.SteamPath) { $roots += ([string]$kp.SteamPath -replace '/', '\') }
  }
  foreach ($r in @($roots)) {
    $vdf = Join-Path $r 'config\libraryfolders.vdf'
    if (Test-Path -LiteralPath $vdf) {
      foreach ($line in Get-Content -LiteralPath $vdf) {
        if ($line -match '^\s*"path"\s+"(.+)"\s*$') { $roots += ($Matches[1] -replace '\\\\', '\') }
      }
    }
  }
  $found = ''
  foreach ($r in $roots) {
    $g = Join-Path $r 'steamapps\common\Skyrim Special Edition'
    if (Test-Path -LiteralPath (Join-Path $g 'SkyrimSE.exe')) { $found = $g; break }
  }
  if (-not $found) { throw 'Could not find the Steam copy of Skyrim. Pass -Game with its folder instead.' }
  $Game = $found
  Write-Host ''
  Write-Host "  installing into the Steam copy: $Game" -ForegroundColor Cyan
}

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
$ProgressPreference    = 'SilentlyContinue'

$Here    = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Here '..\vps\Vps.ps1')
# The hold the voice restart writes while voice is stopped (#5155).
. (Join-Path $Here '..\vps\ServerHold.ps1')
# Text from the repo goes in with CRLF line endings on every machine, as every
# release has carried it (ShippedBytes.ps1, #2903).
. (Join-Path $Here 'ShippedBytes.ps1')
. (Join-Path $Here 'Front.ps1')   # the front zip against records\front-build.json, asked below
$ErrorActionPreference = 'Continue'
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ui      = Join-Path $Game 'Data\Platform\UI'
$plugins = Join-Path $Game 'Data\Platform\Plugins'

function Head($t) { Write-Host ''; Write-Host $t -ForegroundColor Cyan }
function Note($t) { Write-Host "  $t" }
function Bad($t)  { Write-Host "  $t" -ForegroundColor Yellow }
# A file this repository tracks that is not where this script looks for it.
# That is a path gone wrong, not a missing extra, so it fails the run: Go.ps1
# exits 1 and Ship stops (issue #440, phase 0). Before, it was a yellow line
# and a release without the file.
$script:gone = New-Object System.Collections.Generic.List[string]
function Gone($t) { Write-Host "  $t" -ForegroundColor Red; $script:gone.Add($t) }

<#
  THE LAUNCHER'S KEPT COPIES FOLLOW WHAT THIS PUTS IN.

  The launcher keeps a copy of every file of ours under Data\Platform, in
  Profile\Keep beside the game folder, and puts it back at every Play over
  whatever else is there (Keep.cs), which is how a tester's install survives
  another server's launcher writing over ours. A pack refreshes that copy when
  it writes the file (Updater.cs, Keep.Remember). What this script installs
  never comes in a pack on the machine that runs it, so without the same step
  the next Play put the previous copy back over what was just installed.

  Until 25 September Profile\developer.flag did that job on the machine that
  ships, by letting any game file newer than its kept copy win. It also meant
  that machine never saw the repair a tester's launcher makes, which is why it
  went (Patrick: "it will make testing easier"). So every file this run puts
  under Data\Platform becomes the kept copy, and every file it takes out loses
  its kept copy, the way a pack does. Nothing else in the game folder is
  adopted: a file another launcher wrote is still put back at Play.
#>
$script:installed = New-Object System.Collections.Generic.List[string]
$script:removed   = New-Object System.Collections.Generic.List[string]

# Keep.cs UnderPlatform: any file under Data\Platform\UI, and a script under
# Data\Platform\Plugins. Nothing else has a kept copy.
function Test-KeptPath([string]$rel) {
  if (-not $rel -or $rel.Contains('..')) { return $false }
  $ui = 'Data\Platform\UI\'
  if ($rel.StartsWith($ui, [StringComparison]::OrdinalIgnoreCase)) { return $rel.Length -gt $ui.Length }
  if ($rel.StartsWith('Data\Platform\Plugins\', [StringComparison]::OrdinalIgnoreCase)) {
    return $rel.EndsWith('.js', [StringComparison]::OrdinalIgnoreCase)
  }
  return $false
}

# Copies each installed file under Data\Platform into Profile\Keep and drops
# the kept copy of each removed one. Returns how many were copied, or -1 when
# there is no Profile beside the game folder, which is the Steam copy (-Vortex)
# or a folder no launcher looks after.
function Update-KeptCopies([string]$GameDir, [string[]]$Installed, [string[]]$Removed) {
  $g = ($GameDir -replace '/', '\').TrimEnd('\')
  $prof = Join-Path (Split-Path -Parent $g) 'Profile'
  if (-not (Test-Path -LiteralPath $prof)) { return -1 }
  $keepDir = Join-Path $prof 'Keep'
  $g = $g + '\'
  $n = 0
  foreach ($p in @($Installed)) {
    if (-not $p) { continue }
    $q = $p -replace '/', '\'
    if (-not $q.StartsWith($g, [StringComparison]::OrdinalIgnoreCase)) { continue }
    $rel = $q.Substring($g.Length)
    if (-not (Test-KeptPath $rel)) { continue }
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { continue }
    $dst = Join-Path $keepDir $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -LiteralPath $p -Destination $dst -Force
    $n++
  }
  foreach ($p in @($Removed)) {
    if (-not $p) { continue }
    $q = $p -replace '/', '\'
    if (-not $q.StartsWith($g, [StringComparison]::OrdinalIgnoreCase)) { continue }
    $rel = $q.Substring($g.Length)
    if (-not (Test-KeptPath $rel)) { continue }
    $kept = Join-Path $keepDir $rel
    if (Test-Path -LiteralPath $kept -PathType Leaf) { Remove-Item -LiteralPath $kept -Force }
  }
  return $n
}

# Takes out of Data\Platform\UI every overlay of ours the repo no longer has,
# and returns the paths it took out. The overlays loop below copies each of
# game\ui's scripts in and never took one out, so an overlay that left the
# repo stayed in the game folder Ship packs from, and every release kept it on
# every install: thornswood-loadscreen.js, the #3130 test pulled on 22 Oct,
# was still there, and the dry run that should have deleted it said "0
# removed". The plugins folder has had the same rule since the retired
# dresser (removing stray file from the plugins folder, below).
#
# Only thornswood-*.js in that one folder: the front's own files, the page,
# the pictures and the music are not overlays. thornswood-characters.js is
# the launcher's, one machine's character list (Chars.WriteCharacters,
# Ship-Rules' one-machine list), so it is never taken out here.
function Remove-RetiredOverlays([string]$UiDir, [string]$UiSrc) {
  $out = New-Object System.Collections.Generic.List[string]
  if (-not (Test-Path -LiteralPath $UiDir -PathType Container)) { return @($out) }
  $have = @(Get-ChildItem -LiteralPath $UiSrc -File -Filter *.js | ForEach-Object { $_.Name })
  $have += 'thornswood-characters.js'
  # Written below from the site's lines.md (Write-ThornswoodHints), not
  # copied from game\ui, and shipped.
  $have += 'thornswood-hints.js'
  foreach ($s in @(Get-ChildItem -LiteralPath $UiDir -File -Filter 'thornswood-*.js' -EA SilentlyContinue)) {
    if ($have -contains $s.Name) { continue }
    Remove-Item -LiteralPath $s.FullName -Force
    $out.Add($s.FullName)
  }
  return @($out)
}

# Writes the loading screen's hints (#3130) from site\data\site\lines.md, the
# one copy of Thornswood's hints and lore lines (#3147), into
# Data\Platform\UI\thornswood-hints.js as window.THORNSWOOD_HINTS, and
# returns how many it wrote. The page reads a script, not the .md, because a
# page opened from a file may not fetch another file.
#
# Read the way site\server.js's parseLines reads it: comments out, the
# "## Hints" list, one "- " line each. The bytes are the same from every
# machine and every PowerShell: ASCII, anything else and every quote and
# backslash escaped by hand (ConvertTo-Json escapes differently in 5.1 and 7),
# CRLF like every other text file the release carries (ShippedBytes.ps1).
function Write-ThornswoodHints([string]$LinesMd, [string]$Out) {
  $md = [IO.File]::ReadAllText($LinesMd)
  $md = [regex]::Replace($md, '<!--[\s\S]*?-->', '')
  $hints = New-Object System.Collections.Generic.List[string]
  $list = $false
  foreach ($l in ($md -split "\r?\n")) {
    $head = [regex]::Match($l, '^##\s+(.*?)\s*$')
    if ($head.Success) { $list = ($head.Groups[1].Value -match '^hints$'); continue }
    if (-not $list) { continue }
    $item = [regex]::Match($l, '^- (.*?)\s*$')
    if ($item.Success) { $hints.Add($item.Groups[1].Value) }
  }
  $quoted = foreach ($h in $hints) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($c in $h.ToCharArray()) {
      $n = [int]$c
      if ($c -eq '"' -or $c -eq '\') { [void]$sb.Append('\').Append($c) }
      elseif ($n -lt 0x20 -or $n -gt 0x7E) { [void]$sb.Append(('\u{0:x4}' -f $n)) }
      else { [void]$sb.Append($c) }
    }
    [void]$sb.Append('"')
    $sb.ToString()
  }
  $text = "'use strict';`r`n" +
    "// Written by scripts\release\Go.ps1 from site\data\site\lines.md (#3130, #3147). Not edited here.`r`n" +
    "window.THORNSWOOD_HINTS = [`r`n" +
    (($quoted | ForEach-Object { '  ' + $_ }) -join ",`r`n") +
    "`r`n];`r`n"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
  if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Force }
  [IO.File]::WriteAllBytes($Out, [Text.Encoding]::ASCII.GetBytes($text))
  return $hints.Count
}

# ------------------------------------------------------------------- front --
Head 'Front'
# The front build, skymp5-front from the pinned fork commit, which
# Build-Front.ps1 makes into local\, which git ignores, and records\front-build.json
# records (#2754). Until 20 October the zip was made on One from nobody knew
# which commit and nothing checked it, and every release still shipped four
# fonts nobody may hand out, a month after the fork had taken them out
# (#1317). So a zip that is not the recorded build is not unpacked: that fails
# the run, as a missing file of ours does, and Ship stops.
$zip = Join-Path $Here '..\..\local\thornswood-front.zip'
$frontWhy = @()
if (-not (Test-Path -LiteralPath $zip)) {
  $frontWhy = @('local\thornswood-front.zip is not there')
} else {
  try { $frontWhy = @(Get-ThornswoodFrontProblems (Get-ThornswoodZipFiles $zip) (Read-ThornswoodFrontRecord)) }
  catch { $frontWhy = @('it could not be read against records\front-build.json: ' + $_.Exception.Message) }
}
if ($frontWhy.Count) {
  foreach ($w in @($frontWhy | Select-Object -First 5)) { Bad $w }
  Gone 'the front is not the recorded build; .\scripts\release\Build-Front.ps1 builds it from the pinned fork commit'
} else {
  New-Item -ItemType Directory -Force -Path $ui | Out-Null
  Expand-Archive -LiteralPath $zip -DestinationPath $ui -Force
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try { foreach ($e in $z.Entries) { if ($e.Name) { $script:installed.Add((Join-Path $ui ($e.FullName -replace '/', '\'))) } } }
    finally { $z.Dispose() }
  } catch { Bad ('could not read what the front zip holds, so its kept copies were not refreshed: ' + $_.Exception.Message) }
  if (Test-Path -LiteralPath (Join-Path $ui 'index.html')) {
    Note 'the recorded front build: index.html and build.js are in place'
  } else {
    Bad 'index.html did not land'
  }
}

# The wheel is an overlay script now, not a page. Leaving the old page behind
# only invites something to load it again.
$oldWheel = Join-Path $ui 'thornswood-emotes.html'
if (Test-Path -LiteralPath $oldWheel) {
  Remove-Item -LiteralPath $oldWheel -Force
  $script:removed.Add($oldWheel)
  Note 'removed the old wheel page'
}

# ---------------------------------------------------------------- overlays --
Head 'Overlays'
$uiSrc = Join-Path $Here '..\..\game\ui'
if (Test-Path -LiteralPath $uiSrc) {
  foreach ($f in Get-ChildItem -LiteralPath $uiSrc -Filter *.js) {
    Copy-ThornswoodShippedFile $f.FullName (Join-Path $ui $f.Name)
    $script:installed.Add((Join-Path $ui $f.Name))
    Note $f.Name
  }
  foreach ($r in @(Remove-RetiredOverlays $ui $uiSrc)) {
    Bad ('removing an overlay the repo no longer has: ' + (Split-Path -Leaf $r))
    $script:removed.Add($r)
  }
  # The page itself. The front's zip above carries the plain one; ours is
  # the same page plus the two lines that draw the character choice before
  # any plugin runs, and it has to land after the zip or the zip's copy wins.
  # Until 20 September it never landed at all: the overlays loop took *.js
  # and the page sat in the repo with nothing carrying it.
  $page = Join-Path $uiSrc 'index.html'
  if (Test-Path -LiteralPath $page) {
    Copy-ThornswoodShippedFile $page (Join-Path $ui 'index.html')
    $script:installed.Add((Join-Path $ui 'index.html'))
    Note 'index.html (ours, over the front''s)'
  } else {
    Gone 'game\ui\index.html is missing, so the menu choice cannot draw before the plugin runs'
  }
  # The dev test track lives beside the overlays. It goes into the game
  # folder like them; whether it leaves the machine is Ship-Rules' call, and
  # a main pack never carries it.
  foreach ($f in Get-ChildItem -LiteralPath $uiSrc -Filter *.mp3) {
    Copy-ThornswoodShippedFile $f.FullName (Join-Path $ui $f.Name)
    $script:installed.Add((Join-Path $ui $f.Name))
    Note $f.Name
  }
  # The two pictures of the scroll in front of the character choice.
  foreach ($f in Get-ChildItem -LiteralPath $uiSrc -Filter *.webp) {
    Copy-ThornswoodShippedFile $f.FullName (Join-Path $ui $f.Name)
    $script:installed.Add((Join-Path $ui $f.Name))
    Note $f.Name
  }
  # The painting behind the main menu's character choice: the site's own
  # banner, the loop and its first frame, copied under the page's names so
  # the one file in the repo is the site's. Ours, flat under UI, so it ships.
  $siteArt = Join-Path $Here '..\..\site\public'
  foreach ($pair in @(@('banner.webm', 'thornswood-menu.webm'), @('banner.mp4', 'thornswood-menu.mp4'), @('banner.jpg', 'thornswood-menu.jpg'))) {
    $src = Join-Path $siteArt $pair[0]
    if (Test-Path -LiteralPath $src) {
      Copy-ThornswoodShippedFile $src (Join-Path $ui $pair[1])
      $script:installed.Add((Join-Path $ui $pair[1]))
      Note ($pair[1] + ' (from the site''s ' + $pair[0] + ')')
    } else {
      Gone ('the site''s ' + $pair[0] + ' is not in site\public, so the menu has no painting')
    }
  }
  # The loading screen's hints (#3130), from the site's one copy (#3147).
  $linesMd = Join-Path $Here '..\..\site\data\site\lines.md'
  $hintsJs = Join-Path $ui 'thornswood-hints.js'
  if (Test-Path -LiteralPath $linesMd) {
    $hintCount = Write-ThornswoodHints $linesMd $hintsJs
    if ($hintCount -gt 0) {
      $script:installed.Add($hintsJs)
      Note ('thornswood-hints.js (' + $hintCount + ' hints from the site''s lines.md)')
    } else {
      Gone 'site\data\site\lines.md has no hints under "## Hints", so the loading screen would have none'
    }
  } else {
    Gone 'site\data\site\lines.md is not there, so the loading screen has no hints'
  }
} else {
  Gone 'game\ui is not beside tools'
}

# ------------------------------------------------------ the menu backdrop --
# The two logo meshes and the wallpaper texture behind Skyrim's main menu,
# from game\menu (entry 83: the second mesh used to be a copy of the
# first, so the menu drew the backdrop twice, and the texture had one mip
# level of the old art). The destination is removed before the copy: in an
# own game folder these can be hard links into the Steam copy, and writing
# through a link would change the Steam copy too.
Head 'Menu backdrop'
$menuSrc = Join-Path $Here '..\..\game\menu'
$menuPairs = @(
  @('logo.nif',               'Data\meshes\interface\logo\logo.nif'),
  @('logo01ae.nif',           'Data\meshes\interface\logo\logo01ae.nif'),
  @('Mainmenuwallpaper.dds',  'Data\textures\interface\objects\Mainmenuwallpaper.dds')
)
foreach ($pair in $menuPairs) {
  $src = Join-Path $menuSrc $pair[0]
  $dst = Join-Path $Game $pair[1]
  if (-not (Test-Path -LiteralPath $src)) { Gone ($pair[0] + ' is not in game\menu'); continue }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  Copy-ThornswoodShippedFile $src $dst
  Note $pair[1]
}

# ------------------------------------------------ our own menu files --
# The empty loading spinner, the silent stand-in for the game's theme,
# SkyHUD's settings as Thornswood set them, QuickLoot IE's with no gold
# value column (#3113), the crafting menu's groups, item type first with
# material groups inside, and their English names (#3133), and the Barlow
# SemiBold sprite font the voice mark draws its dot in, with its licence
# (#1317). From game\ours, beside
# game\menu. Each path is
# the path in the game folder, so the destination is the name itself
# (Ship-Rules $ShipOursFiles; change the two together). The destination
# is removed before the copy: in an own game folder these can be hard
# links into the Steam copy, and writing through a link would change
# the Steam copy too.
Head 'Our menu files'
$oursSrc = Join-Path $Here '..\..\game\ours'
$oursMenuFiles = @(
  'Data\Interface\loadwaitspinner.swf',
  'Data\music\special\mus_maintheme.xwm',
  'Data\Interface\skyhud\skyhud.txt',
  'Data\SKSE\Plugins\QuickLootIE.json',
  'Data\SKSE\Plugins\CraftingCategories\Thornswood-Content.json',
  'Data\Interface\Translations\Thornswood-Content_ENGLISH.txt',
  'Data\Platform\Fonts\Barlow-SemiBold.spritefont',
  'Data\Platform\Fonts\Barlow-SemiBold-OFL.txt'
)
foreach ($rel in $oursMenuFiles) {
  $src = Join-Path $oursSrc $rel
  $dst = Join-Path $Game $rel
  if (-not (Test-Path -LiteralPath $src)) { Gone ($rel + ' is not in game\ours'); continue }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  Copy-ThornswoodShippedFile $src $dst
  Note $rel
}

# ------------------------------------------------ made from the game --
# The main menu with no Bethesda logo and no button list, and the notice
# board's and drop box's meshes. Each is Bethesda's own file edited or put
# together, so none of them ships (#2827, Ship-Rules $ShipMadeFromGame): they
# are made here from this game's own archives by the launcher's own code,
# launcher\app\FromGame*.cs with the recipes beside it, so this writes the
# very bytes the launcher makes before every Play. Each is checked against
# the sha256 it must have, and one that comes out different is not written;
# the line says which of the game's files differs. Not a failed run: nothing
# here ships, and the launcher says the same thing at Play. The destination is
# removed first, for the hard link reason above.
# The collection's item menus and HUD with no gold values are made the same
# way from the mods' own archives in this game (#3113, Ship-Rules
# $ShipMadeFromMods): SkyUI's config.txt and itemcard.swf, SkyHUD's
# hudmenu.swf and moreHUD's AHZHudInfo.swf, two copies. And SkyUI's
# quest_journal.swf with no saving, loading, help or Creation Club (#3127).
Head 'Made from the game'
if (-not ('Thornswood.FromGame' -as [type])) {
  $fromGameCs = @(Get-ChildItem -LiteralPath (Join-Path $Here '..\..\launcher\app') -Filter 'FromGame*.cs' -File |
    ForEach-Object { $_.FullName })
  Add-Type -Path $fromGameCs
}
foreach ($made in [Thornswood.FromGame]::Build((Join-Path $Game 'Data'))) {
  if ($made.Problem) { Bad ($made.Rel + ' was not made: ' + $made.Problem); continue }
  $dst = Join-Path $Game $made.Rel
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Force }
  [System.IO.File]::WriteAllBytes($dst, $made.Bytes)
  Note $made.Rel
}

# ---------------------------------------------------------- required data --
# Plugins the load order names that Vortex does not yet deploy under that
# exact filename. Ship packs and the installer also place these (Ship-Rules
# Ensure-ShipRequiredData). Take a file out of game\required-data when the
# collection deploys the same Data\ path.
Head 'Required data'
$reqSrc = Join-Path $Here '..\..\game\required-data'
if (Test-Path -LiteralPath $reqSrc) {
  foreach ($f in @(Get-ChildItem -LiteralPath $reqSrc -File -EA SilentlyContinue)) {
    if ($f.Name -eq 'README.md') { continue }
    $dst = Join-Path $Game ('Data\' + $f.Name)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-ThornswoodShippedFile $f.FullName $dst
    Note ('Data\' + $f.Name)
  }
} else {
  Gone 'game\required-data is not in the repo'
}

# ----------------------------------------------------------------- plugins --
Head 'Plugins'
$plSrc = Join-Path $Here '..\..\game\plugins'
New-Item -ItemType Directory -Force -Path $plugins | Out-Null
if (Test-Path -LiteralPath $plSrc) {
  foreach ($f in Get-ChildItem -LiteralPath $plSrc -Filter *.js) {
    Copy-ThornswoodShippedFile $f.FullName (Join-Path $plugins $f.Name)
    $script:installed.Add((Join-Path $plugins $f.Name))
    Note $f.Name
  }
} else {
  Gone 'game\plugins is not beside tools'
}

# ------------------------------------------------------------------ client --
# The SkyMP client runtime, built from the fork and recorded in
# client-build.json: the bundle, MpClientPlugin.dll, both SkyrimPlatform DLLs,
# the CEF host and TESModPlatform.pex. Sync-Client.ps1 copies the six from the
# fork's build output and refuses any file that is not the recorded one. This
# is the same job as the two sections above, for the part of the client that
# is compiled rather than written here. Until 20 September none of it came
# from here: the Steam copy held another server's launcher's builds and the
# folder build copied them across.
Head 'Client'
$sync = Join-Path $Here 'Sync-Client.ps1'
if (Test-Path -LiteralPath $sync) {
  & $sync -Game $Game -NoPause
  if ($LASTEXITCODE -ne 0) { Bad 'the client runtime is not the recorded build; see the lines above' }
  # The bundle is the one client file under Data\Platform\Plugins, so it is
  # the one with a kept copy. Only the recorded build becomes it.
  else { $script:installed.Add((Join-Path $plugins 'skymp5-client.js')) }
} else {
  Gone 'Sync-Client.ps1 is not next to this script'
}

# The probe's job is done: the voice client reports the same facts, in its own
# log, and unlike the probe it does not fight the front for the browser.
$probe = Join-Path $plugins 'thornswood-probe.js'
if (Test-Path -LiteralPath $probe) {
  Remove-Item -LiteralPath $probe -Force
  $script:removed.Add($probe)
  Note 'removed the probe, voice reports the same things now'
}

# Anything in the plugins folder that is not a plugin makes SkyrimPlatform
# reload every plugin, repeatedly, which presents as a black screen with a dead
# keyboard rather than as an error.
#
# And anything that IS a plugin but is not ours runs on every machine that
# installs the collection. A Steam copy that had another roleplay server
# installed on it first still had that server's overlay sitting in here, which
# is how somebody ends up with two fronts fighting over the browser. So the
# list is what belongs, not what looks wrong.
# The recorded bundle and the per machine settings file. An activity plugin
# used to be kept here as well; it exists in no build of ours and in no game
# folder, so its name is gone.
$keep = @('skymp5-client.js', 'skymp5-client-settings.txt')
foreach ($f in (Get-ChildItem -LiteralPath $plSrc -File -Filter *.js -EA SilentlyContinue)) { $keep += $f.Name }

foreach ($s in (Get-ChildItem -LiteralPath $plugins -File)) {
  if ($keep -contains $s.Name) { continue }
  Bad "removing stray file from the plugins folder: $($s.Name)"
  Remove-Item -LiteralPath $s.FullName -Force
  # Guarded: test-chargen-gone.ps1 lifts this loop and runs it on its own.
  if ($null -ne $script:removed) { $script:removed.Add($s.FullName) }
}

Head 'The launcher''s kept copies'
$kept = Update-KeptCopies $Game $script:installed.ToArray() $script:removed.ToArray()
if ($kept -lt 0) { Note 'no Profile folder beside this game folder, so no launcher keeps copies here' }
else { Note "$kept file(s) the launcher keeps a copy of now match what was just installed, so Play will not put an older copy back" }

# -------------------------------------------------------------- load order --
Head 'Load order'

# MCMHelper.esp is a hundred byte stub whose only job is to exist so MCM Helper
# has a plugin to hang its menus off. It is sitting in the list disabled, which
# is what breaks QuickLoot's settings quest and every other MCM Helper menu in
# the build. Turning it on cannot break anything: it has no masters and no
# records worth the name.
#
# Nothing else here gets touched. The other disabled lines are patches for mods
# that are genuinely not installed (Wyrmstooth, Mysticism, a couple of SunHelm
# patches), and enabling a plugin whose masters are missing is how you get a
# crash on load rather than a fixed menu.
# Derived from the game folder's install root, not a fixed C:\Thornswood, so
# the MCMHelper enable lands in the same Profile the launcher on this machine
# reads when the install is on another drive.
$installRoot = Split-Path -Parent $Game
$orderFiles = @(
  (Join-Path $installRoot 'Profile\LocalAppData\Plugins.txt'),
  (Join-Path $installRoot 'Profile\Default\plugins.txt')
)
foreach ($f in $orderFiles) {
  if (-not (Test-Path -LiteralPath $f)) { continue }
  $lines = [IO.File]::ReadAllLines($f)
  $hit = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim() -eq 'MCMHelper.esp') { $lines[$i] = '*MCMHelper.esp'; $hit = $true }
  }
  if ($hit) {
    [IO.File]::WriteAllLines($f, $lines, (New-Object Text.UTF8Encoding($false)))
    Note "enabled MCMHelper.esp in $(Split-Path -Leaf $f)"
  } else {
    Note "MCMHelper.esp already enabled in $(Split-Path -Leaf $f)"
  }
}

# ------------------------------------------------------------------ server --
if (-not $SkipServer) {
  Head 'Server'

  function Port($h, $p, $ms) {
    $c = New-Object Net.Sockets.TcpClient
    try {
      $iar = $c.BeginConnect($h, $p, $null, $null)
      if ($iar.AsyncWaitHandle.WaitOne($ms, $false) -and $c.Connected) { return $true }
      return $false
    } catch { return $false } finally { $c.Close() }
  }

  if (Port $Vps 3000 2500) { Note 'game server: answering on 3000' }
  else { Bad 'game server: NOTHING on 3000' }

  # Voice is asked through Caddy on the public name, never on the raw port.
  #
  # This used to open a TCP socket to 7778 on the VPS address and call it dead
  # when nothing answered. Nothing ever answers: the voice service binds
  # 127.0.0.1 and Caddy carries /voice/ to it, exactly as the docs site binds
  # 3001 behind the certificate. So this printed "voice service: NOTHING on
  # 7778" in red on every single run while voice was up and working, and on
  # 22 September that red line was read as an outage and chased.
  #
  # It is the same mistake as asking whether a process is running and calling
  # that the site being up, pointing the other way: a port being shut from
  # outside says nothing about a service that was never meant to be reachable
  # there. The health endpoint through the public name is the only question
  # that has the same answer a customer would get.
  #
  # The game server IS asked on its raw port above, and that is right: 3000
  # binds every interface because the game client connects to it directly.
  function VoiceUp($url) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 8
      if ($r.StatusCode -ne 200) { return $null }
      return $r.Content
    } catch { return $null }
  }
  $voiceUrl = 'https://thornswood.net/voice/health'
  $vh = VoiceUp $voiceUrl
  # voice-server.js answers /health through the site with {"ok":true} and
  # nothing more (#3806); the counts go only to a caller on the box, and the
  # restart below prints that answer. Anything else answering 200 there is
  # not the voice service (Caddy handing the path to the site, say), so it is
  # said as such rather than counted as up.
  $vhDoc = $null; $vhWhy = ''
  if ($vh) {
    try { $vhDoc = $vh | ConvertFrom-Json } catch { $vhWhy = $_.Exception.Message }
    if (-not $vhWhy -and -not ($vhDoc -and $vhDoc.PSObject.Properties['ok'] -and $vhDoc.ok -eq $true)) { $vhWhy = 'it does not say ok' }
  }
  if ($vh -and $vhWhy) {
    Bad "voice service: something answered at $voiceUrl, but not voice's health ($vhWhy)"
  } elseif ($vh) {
    Note 'voice service: answering at /voice/'
  } else {
    Bad "voice service: NOTHING at $voiceUrl"
    Bad '  that is Caddy or the service itself; the raw port is shut on purpose and proves nothing'
  }

  <#
    The voice service carries text chat now as well as audio, so it has to be
    the current copy. Two things were wrong with how this did that.

    It read voice-server.js from the tools folder. The real one moved into
    voice months ago and the copy left behind at the top went stale, so
    running this pushed an old build over a good one.

    And the restart below had three literal vertical tab bytes in it, where a
    backslash-v had been eaten by whatever wrote the file: the path it handed
    node was C:\Thornswood-Voice<VT>oice-server.js, which cannot exist. Since
    it killed the running service first, this did not fail to restart voice.
    It stopped voice and left it stopped.

    It now restarts the scheduled task rather than launching node loose. A
    loose node and the task's own restart timer both want port 7778, and the
    loser dies quietly while the winner keeps serving whatever it was already
    running, which is the exact failure that hid days of changes.
  #>
  $vsrc = Join-Path $Here '..\..\voice\voice-server.js'
  if (Test-Path -LiteralPath $vsrc) {
    Invoke-ThornswoodNative { & scp -o BatchMode=yes -o StrictHostKeyChecking=yes $vsrc "$User@${Vps}:C:/Thornswood-Voice/voice-server.js" } 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $restart = (Get-ThornswoodHoldScript -Script 'Go.ps1') + @'
$ProgressPreference = 'SilentlyContinue'
# Held from the stop until it is started again (#5155, ServerHold.ps1).
Set-ThornswoodHold -Target 'Thornswood Voice' -Why 'restarting voice on the new voice-server.js' -By $HoldBy
Stop-ScheduledTask -TaskName 'Thornswood Voice' -EA SilentlyContinue
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*voice-server*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
for ($i = 0; $i -lt 20; $i++) {
  # Asked of the port list rather than by connecting: a connect that throws
  # read as free here, with nothing said. Every listener is listed and
  # filtered, because -LocalPort with nothing on it is an error, not an
  # empty answer. A list that cannot be read stops this run, said, before
  # the task is started into a port that may still be taken.
  try { $busy = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq 7778 }).Count -gt 0 }
  catch { Clear-ThornswoodHold -Target 'Thornswood Voice'; 'could not list the ports in use, so the voice task was not started again: ' + $_.Exception.Message; exit 1 }
  if (-not $busy) { break }
  Start-Sleep -Milliseconds 500
}
Start-ScheduledTask -TaskName 'Thornswood Voice' -EA SilentlyContinue
Start-Sleep -Seconds 2
Clear-ThornswoodHold -Target 'Thornswood Voice'
try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:7778/health' -TimeoutSec 5).Content }
catch { 'voice did not answer its own health check' }
'@
      $e = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($restart))
      $r = Invoke-ThornswoodNative { & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$User@$Vps" "pwsh -NoProfile -EncodedCommand $e" } 2>&1
      Note ("voice: " + (($r | Where-Object { $_ }) -join ' '))
    } else {
      Bad 'could not copy the voice service to the VPS over ssh'
    }
  }

  $remote = @'
$ProgressPreference = 'SilentlyContinue'
$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*skymp5-server*' }
if ($p) { "server process up, pid " + $p.ProcessId } else { "server process is NOT running" }
if (Test-Path 'C:\Thornswood-Server\server.log') {
  "--- server.log, last 12 ---"
  Get-Content 'C:\Thornswood-Server\server.log' -Tail 12
}
'@
  $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remote))
  $out = Invoke-ThornswoodNative { & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$User@$Vps" "pwsh -NoProfile -EncodedCommand $enc" } 2>&1
  $out | ForEach-Object { Note $_ }
}

Head 'Next'
Note 'Start the game from the launcher, play for a minute, quit, then paste:'
Note ("  Get-Content $(Join-Path $Game 'Data\Platform\thornswood-voice.log')")
Note ("  Get-Content $(Join-Path $Game 'Data\Platform\thornswood-front.log')")

if ($script:gone.Count) {
  Write-Host ''
  Write-Host ('  ' + $script:gone.Count + ' file(s) this repository has did not reach the game folder; see the red lines above.') -ForegroundColor Red
  exit 1
}
exit 0
