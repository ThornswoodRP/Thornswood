<#
.SYNOPSIS
  Lays out one revision of the Thornswood collection on Nexus Mods (slug 7essxf) into a game folder, the way Vortex installs and deploys it, without Vortex (#2754).

.DESCRIPTION
  Lays out one revision of the Thornswood collection on Nexus Mods (slug
  7essxf) into a game folder, the way Vortex installs and deploys it, without
  Vortex (#2754).

      .\scripts\release\Install-NexusRevision.ps1 -Revision 3 -Game <folder> -WhatIf
      .\scripts\release\Install-NexusRevision.ps1 -Revision 3 -Game <folder>
      .\scripts\release\Install-NexusRevision.ps1 -CollectionArchive <collection_3.7z> -Revision 3 -Game <folder>
      pwsh scripts/release/Install-NexusRevision.ps1 -Revision 3 -Record <folder>
      pwsh scripts/release/Install-NexusRevision.ps1 -Revision 6 -Record <folder> -KeepPlugins

  WHY. Until 20 October One's Vortex deployment in the Steam copy was the only
  thing that turned a revision into files, and every release step read it:
  the ship roots, the server's load order, the feed's collectionRevision.
  So a revision made through the API (New-NexusRevision.ps1) could not go out
  until Vortex had installed it. Patrick decided on 20 October that Vortex is
  no longer the install step. This is the step in its place.

  WHAT IT DOES, in this order, and nothing in -Game changes before step 6:
    1. reads the revision's collection.json: from Nexus (the GraphQL
       collectionRevision's downloadLink, a published revision or a draft the
       key's account curates), or from -CollectionArchive;
    2. refuses, naming every entry and why, anything it would not lay out
       exactly as Vortex does (NexusLayout.cs, Unsupported, says each kind);
    3. downloads every mod's archive the revision lists, through the API's
       download-link (GET /v3/games/<game>/mod-file-versions/<file id>/download-link)
       into the cache, %LOCALAPPDATA%\Thornswood\nexus-cache\<file id>\<name>,
       kept between runs. A cached archive is used only when its size and md5
       are the revision's; any other file there is replaced. One that passed
       its md5 is not read again while its size and write time stay what they
       were (the cache's md5-passed.tsv, #4388). Every archive is
       checked against the revision before it is used. A failed download
       stops the run and says which file; nothing is tried again. Once the
       cache holds every archive the revision lists, the folder of any file
       id the revision does not list is taken out (#4324), so the cache holds
       one revision's archives and no more; anything in it that is not a file
       id's folder is left;
    4. unpacks each archive (7-Zip, as Vortex does) and works out its files
       with the installer Vortex would pick, the FOMOD choices the revision
       gives, and its patches (NexusLayout.cs says how each is read from
       Vortex). Any entry that cannot be done that way stops the run here;
    5. orders the mods by the collection's mod rules, so where two mods have
       a file the one Vortex deploys last wins, and stops where no rule
       orders two mods that share a file;
    6. lays the files into -Game (Data, or the game folder for the dinput
       type), linked from the unpacked copies when they are on one drive,
       and writes, in -Game\Thornswood Layout:
         layout.json   the revision, each mod's file id, md5, size, installer
                       and how many files it placed
         files.txt     every file placed: sha256, size, file id, path
         plugins.txt   the plugin order, in the shape LoadOrder.ps1 reads
         loadorder.txt the same names without stars
         slidersets.json  each BodySlide slider set file placed under
                       Data\CalienteTools\BodySlide\SliderSets: its path,
                       sha256, size and file id, and each set's name,
                       OutputPath, OutputFile and GenWeights. Metadata
                       only; no .osp is kept (SliderSets.ps1, #5888)
       A folder that already holds a layout has its old files checked (each
       is still what files.txt says) and taken out first; one whose size and
       write time are still what placed.tsv recorded when it was placed is
       not read again (#4388). A file in -Game that
       no layout put there is never written over: the run stops and names it.

  THE PLUGIN ORDER is the collection's plugins list, which Vortex writes from
  the curator's load order. A plugin the layout has that the list does not
  name goes in disabled, after the rest: Vortex leaves the curator's disabled
  plugins out of the list, and on One they are off. The collection's plugin
  rules are checked against the order, and a broken one stops the run.
  layout.json carries the rules too (pluginRules), because a Vortex install
  does not take the list's order: it sorts the plugins itself under those
  rules, so two installs agree on the rules and may differ elsewhere.

  -Game is required, and it is never the Steam copy (any folder under a
  steamapps\common), a folder Vortex deploys into (vortex.deployment*.json),
  or anything under %APPDATA%\Vortex.

  -WhatIf does steps 1 to 5: it downloads into the cache and works the whole
  layout out in the scratch folder, prints it, and changes nothing in -Game.

  -Record <folder>, in place of -Game, does steps 1 to 5 and writes the four
  records of step 6 into that folder, placing no file anywhere. Each mod's
  unpacked copy is hashed and deleted as soon as it is worked out, so the
  scratch folder never holds more than one mod. This is how a revision is
  laid out without One (#2969). Since #2841 a cloud session holds no Nexus
  key, so it asks for it with
      pwsh scripts/release/Nexus-Run.ps1 -Line 'Install-NexusRevision -Revision 3'
  which runs this on a box runner with the key and sends the four records
  back. Off Windows, 7-Zip is the build Get-SevenZip.ps1 fetches and the
  cache is $XDG_CACHE_HOME/thornswood/nexus-cache (~/.cache when that is not
  set); every path in the records is the Windows path the layout has on One.
  Laying files into a game folder is for Windows only, where the game runs.

  -KeepPlugins, with -Record, also keeps the plugins the layout places, the
  copy Vortex would deploy of each, in the record's plugins folder, each
  checked against the sha256 files.txt names (#4069). A game server loads
  those plugins and nothing else of the collection, and until 31 Oct 2026
  One's Vortex game was the only place they came from, so no server could
  move to a new revision without One. The box takes them this way, sealed
  to itself, through Nexus-Run (scripts\deploy\CollectionStore.ps1).
  It keeps what SkyUI's menu check reads as well, in the record's menus
  folder at each file's path in the game folder: a loose
  Data\Scripts\ski_main.pex, every loose menu (Data\Interface\...\*.swf),
  and every archive that holds either (Check-SkyUIMenus.js --holding, so node
  has to be there), so a release that moves the revision can run that check
  with nothing of One's.

  -Modlist, with -Record, also writes the revision as a Wabbajack modlist,
  thornswood.wabbajack in the record's folder (#6244): every mod's files in
  a portable Mod Organizer 2 instance, each named by the archive it comes from
  and its path in it, MO2 itself from its GitHub release (records\mo2.json
  pins the version, the address and the sha256), and the MO2 profile with the
  plugin order the record holds. WabbajackModlist.cs says the format. The
  mods go in MO2's priority by the collection's mod rules, so a file two mods
  share is the one the rules deploy last, as in files.txt; a dinput mod's
  Data files are its own like any mod's, and what goes beside the game
  (skse64_loader.exe) goes under Root in its folder, as Root Builder lays it
  out. The same record writes the same bytes,
  and the modlist's sha256 is printed. This is how the launcher installs
  without Vortex: each Release carries the modlist and its hash.

  Needs PowerShell 7 (NexusLayout.cs reads JSON with System.Text.Json), 7-Zip
  (off Windows, 7-Zip's own build, which Get-SevenZip.ps1 fetches, because
  Ubuntu's cannot unpack the collection's RAR archives),
  and records\skyrim-files.json, which answers a FOMOD's questions about the
  game's own plugins and version. The Nexus API key is read as Nexus.ps1 says.

.PARAMETER Revision
  The revision number. Without -CollectionArchive it is read from Nexus.

.PARAMETER CollectionArchive
  The revision's collection archive (collection_<n>.7z), or a folder holding
  it unpacked, in place of reading it from Nexus.

.PARAMETER Game
  The folder to lay the revision out in. Windows only.

.PARAMETER Record
  A folder for the layout's record (layout.json, files.txt, plugins.txt,
  loadorder.txt), with no file laid out. In place of -Game.

.PARAMETER KeepPlugins
  With -Record: keeps the plugins the layout places in <Record>\plugins,
  and what SkyUI's menu check reads in <Record>\menus.

.PARAMETER Modlist
  With -Record: writes thornswood.wabbajack beside the record, the revision
  as a Wabbajack modlist that installs a portable Mod Organizer 2 (#6244).

.PARAMETER Mo2Record
  The record that pins Mod Organizer 2 for -Modlist. records\mo2.json unless
  said otherwise.

.PARAMETER Slug
  The collection. 7essxf unless said otherwise.

.PARAMETER GameDomain
  The game's domain on Nexus. skyrimspecialedition unless said otherwise.

.PARAMETER Cache
  Where downloaded archives are kept. %LOCALAPPDATA%\Thornswood\nexus-cache
  unless said otherwise. A run that has every archive of its revision takes
  the folders of other file ids out of it, so give a folder of its own.

.PARAMETER WhatIf
  Downloads and works everything out, and changes nothing in -Game.

.PARAMETER NoPause
  Does not wait for Enter at the end or on a stop.
#>
[CmdletBinding()]
param(
  [int]$Revision = 0,
  [string]$CollectionArchive,
  [string]$Game,
  [string]$Record,
  [switch]$KeepPlugins,
  [switch]$Modlist,
  [string]$Mo2Record,
  [string]$Slug = '7essxf',
  [string]$GameDomain = 'skyrimspecialedition',
  [string]$Cache,
  [switch]$WhatIf,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)

$script:Changed = ''
$script:Work = ''
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if ($script:Changed) { Write-Host $script:Changed -ForegroundColor Yellow }
  elseif ($Game) { Write-Host ('Nothing in ' + $Game + ' was changed.') -ForegroundColor Yellow }
  elseif ($Record) { Write-Host ('Nothing was written to ' + $Record + '.') -ForegroundColor Yellow }
  if ($script:Work -and (Test-Path -LiteralPath $script:Work)) { Write-Host ('This run''s scratch folder, ' + $script:Work + ', is left for a look; the next run empties it first.') -ForegroundColor Yellow }
  if ($Cache -and (Test-Path -LiteralPath $Cache)) { Write-Host ('Archives already downloaded stay in ' + $Cache + ' and are used again.') -ForegroundColor Yellow }
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}
function Step([scriptblock]$b) { try { return (& $b) } catch { Die $_.Exception.Message } }

if ($PSVersionTable.PSVersion.Major -lt 7) { Die 'This needs PowerShell 7 (pwsh): NexusLayout.cs reads collection.json with System.Text.Json, which Windows PowerShell 5.1 does not have.' }
. (Join-Path $Here 'Nexus.ps1')
. (Join-Path $Here '..\mods\PluginRuleLoops.ps1')

# A program run with its output kept apart from its errors.
function Invoke-Tool([string]$exe, [string[]]$arguments) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  foreach ($a in $arguments) { [void]$psi.ArgumentList.Add($a) }
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $p = [Diagnostics.Process]::Start($psi)
  $err = $p.StandardError.ReadToEndAsync()
  $out = $p.StandardOutput.ReadToEnd()
  $p.WaitForExit()
  return [pscustomobject]@{ Code = $p.ExitCode; Out = $out; Err = $err.Result }
}
# 7-Zip is looked for when the first archive is unpacked, so a revision given
# as an unpacked folder is read, and refused, without it.
$script:SevenZip = ''
function Use-SevenZip {
  if (-not $script:SevenZip) { $script:SevenZip = Find-SevenZip }
  if (-not $script:SevenZip) { throw ('7-Zip is not on this machine (it looked for ' + (Get-SevenZipLooked) + '), and Vortex unpacks every archive with it.') }
}
# A scratch folder and everything under it. 7-Zip keeps an archive's
# read-only attribute on the files it unpacks, and on Windows
# Directory.Delete refuses a read-only file ("Access to the path ... is
# denied", the dialogue views in revision 2, #2969), so the attribute comes
# off first. Off Windows a file's attributes do not stop its folder going.
function Remove-Tree([string]$dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return }
  foreach ($f in [IO.Directory]::EnumerateFiles($dir, '*', [IO.SearchOption]::AllDirectories)) {
    $a = [IO.File]::GetAttributes($f)
    if ($a -band [IO.FileAttributes]::ReadOnly) { [IO.File]::SetAttributes($f, $a -band -bnot [IO.FileAttributes]::ReadOnly) }
  }
  [IO.Directory]::Delete($dir, $true)
}
# Vortex unpacks with 7-Zip's x, case-insensitive (-ssc-).
function Expand-Archive7([string]$archive, [string]$to, [string]$what) {
  Use-SevenZip
  Remove-Tree $to
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  $r = Invoke-Tool $script:SevenZip @('x', '-y', '-ssc-', ('-o' + $to), $archive)
  if ($r.Code -ne 0) { throw ('7-Zip (' + $script:SevenZip + ') could not unpack ' + $what + ' (' + $archive + '), exit ' + $r.Code + ': ' + ($r.Err.Trim() -replace '\s+', ' ')) }
}
# Every path in an archive, in the order 7-Zip lists and unpacks them. Off
# Windows the walk names a folder the archive spells two ways as the first
# entry spells it, as 7-Zip does on Windows (FileList, #2969).
function Get-ArchiveOrder([string]$archive) {
  if ($IsWindows) { return $null }
  Use-SevenZip
  $r = Invoke-Tool $script:SevenZip @('l', '-slt', $archive)
  if ($r.Code -ne 0) { throw ('7-Zip (' + $script:SevenZip + ') could not list ' + $archive + ', exit ' + $r.Code + ': ' + ($r.Err.Trim() -replace '\s+', ' ')) }
  $after = $false
  $paths = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($r.Out -split "`r?`n")) {
    if ($line -eq '----------') { $after = $true; continue }
    if ($after -and $line.StartsWith('Path = ')) { $paths.Add($line.Substring(7)) }
  }
  return ,$paths.ToArray()
}
function Test-Under([string]$path, [string]$folder) {
  if (-not $folder) { return $false }
  $sep = [IO.Path]::DirectorySeparatorChar
  $f = [IO.Path]::GetFullPath($folder).TrimEnd($sep) + $sep
  return ($path.TrimEnd($sep) + $sep).StartsWith($f, [StringComparison]::OrdinalIgnoreCase)
}
# A path the layout keeps the Windows way (Data\Textures\x.dds), under a
# folder on this machine.
function Join-Rel([string]$root, [string]$rel) { return (Join-Path $root ($rel.Replace('\', [IO.Path]::DirectorySeparatorChar))) }

Write-Host ''
Write-Host '  THORNSWOOD  -  a collection revision laid out without Vortex' -ForegroundColor White
if ($WhatIf) { Say '  -WhatIf: downloads and works it all out, and changes nothing in -Game.' 'Yellow' }

# ------------------------------------------------------------ refused up front ---
if ($Game -and $Record) { Die 'Give -Game to lay the revision out, or -Record to write only its record, not both.' }
if ($KeepPlugins -and -not $Record) { Die '-KeepPlugins keeps the plugins beside a record, so it goes with -Record. With -Game every file is laid out already.' }
if ($Modlist -and -not $Record) { Die '-Modlist writes the modlist beside a record, so it goes with -Record.' }
if ($KeepPlugins -and -not (Get-Command node -ErrorAction SilentlyContinue)) { Die '-KeepPlugins keeps the archives SkyUI''s menu check reads, and node says which those are (scripts\mods\Check-SkyUIMenus.js). node is not on this machine.' }
if ($Record) {
  $Record = [IO.Path]::GetFullPath($Record).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if ($WhatIf) { Die '-Record already changes nothing but its own folder; leave -WhatIf off.' }
  if ((Test-Path -LiteralPath $Record) -and @(Get-ChildItem -LiteralPath $Record -Force | Where-Object { @('layout.json', 'files.txt', 'plugins.txt', 'loadorder.txt', 'slidersets.json', 'plugins', 'menus', 'thornswood.wabbajack') -notcontains $_.Name }).Count) { Die ('-Record ' + $Record + ' holds more than a layout''s record. Give it a folder of its own.') }
  if (Test-Path -LiteralPath (Join-Path $Record 'plugins')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Record 'plugins') -PathType Container) -or @(Get-ChildItem -LiteralPath (Join-Path $Record 'plugins') -Force | Where-Object { $_.PSIsContainer -or $_.Name -notmatch '\.(esp|esm|esl)$' }).Count) { Die ('-Record ' + $Record + ' has a plugins entry that holds more than plugins. Give it a folder of its own.') }
  }
}
elseif (-not $Game) { Die 'Say which folder to lay the revision out in with -Game, or where to write only its record with -Record. There is no default: it is never the Steam copy or a folder Vortex deploys into.' }
elseif (-not $IsWindows) { Die 'Laying files into a game folder is done on Windows, where the game runs. Here, write the layout''s record with -Record <folder> instead of -Game.' }
else {
  $Game = [IO.Path]::GetFullPath($Game).TrimEnd('\')
  if ($Game -match '^[A-Za-z]:$') { Die ('-Game ' + $Game + ' is a whole drive.') }
  if ($Game -match '\\steamapps\\common(\\|$)') { Die ('-Game ' + $Game + ' is in a Steam library. The Steam copy stays the person''s own; lay the revision out in a folder of its own.') }
  foreach ($rec in @((Join-Path $Game 'Data\vortex.deployment.json'), (Join-Path $Game 'vortex.deployment.json'))) {
    if (Test-Path -LiteralPath $rec) { Die ('-Game ' + $Game + ' is a folder Vortex deploys into (' + $rec + '). Lay the revision out in a folder of its own.') }
  }
  if ((Test-Path -LiteralPath $Game) -and @(Get-ChildItem -LiteralPath $Game -Filter 'vortex.deployment*.json' -File -ErrorAction SilentlyContinue).Count) { Die ('-Game ' + $Game + ' has a Vortex deployment record in it. Lay the revision out in a folder of its own.') }
  if ($env:APPDATA -and (Test-Under $Game (Join-Path $env:APPDATA 'Vortex'))) { Die ('-Game ' + $Game + ' is inside Vortex''s own folder.') }
}
if ($Slug -notmatch '^[a-z0-9]+$') { Die ('-Slug ' + $Slug + ' is not a collection slug.') }
if ($GameDomain -notmatch '^[a-z0-9]+$') { Die ('-GameDomain ' + $GameDomain + ' is not a game domain.') }
if (-not $CollectionArchive -and $Revision -le 0) { Die 'Say which revision with -Revision, or give its archive with -CollectionArchive.' }
if (-not $Cache) {
  if ($IsWindows) {
    if (-not $env:LOCALAPPDATA) { Die 'There is no %LOCALAPPDATA% here for the download cache; give one with -Cache.' }
    $Cache = Join-Path (Join-Path $env:LOCALAPPDATA 'Thornswood') 'nexus-cache'
  }
  else {
    $xdg = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } elseif ($HOME) { Join-Path $HOME '.cache' } else { '' }
    if (-not $xdg) { Die 'There is no XDG_CACHE_HOME or HOME here for the download cache; give one with -Cache.' }
    $Cache = Join-Path (Join-Path $xdg 'thornswood') 'nexus-cache'
  }
}
$Cache = [IO.Path]::GetFullPath($Cache)
if (Test-Under $Cache $Game) { Die ('The cache ' + $Cache + ' is inside -Game.') }
if (Test-Under $Cache $Record) { Die ('The cache ' + $Cache + ' is inside -Record.') }
$skyrimRecord = Join-Path (Join-Path $Repo 'records') 'skyrim-files.json'
if (-not (Test-Path -LiteralPath $skyrimRecord)) { Die ('records\skyrim-files.json is not in this checkout (' + $skyrimRecord + '), and it is what a FOMOD''s questions about the game are answered from.') }
Step { Add-Type -LiteralPath @((Join-Path $Here 'NexusLayout.cs'), (Join-Path $Here 'WabbajackModlist.cs'), (Join-Path $Repo 'launcher\app\XxHash64.cs')) } | Out-Null
. (Join-Path $Here 'HashStamps.ps1')
. (Join-Path $Here 'SliderSets.ps1')
if ($Modlist) {
  if (-not $Mo2Record) { $Mo2Record = Join-Path (Join-Path $Repo 'records') 'mo2.json' }
  $mo2 = Step { Get-Content -Raw -LiteralPath $Mo2Record | ConvertFrom-Json }
  foreach ($k in 'version', 'url', 'name', 'size', 'sha256') { if (-not $mo2.$k) { Die ($Mo2Record + ' has no ' + $k + ', so Mod Organizer 2 is not pinned.') } }
  if ([string]$mo2.url -notmatch '^https://github\.com/ModOrganizer2/modorganizer/releases/download/') { Die ($Mo2Record + ' gives ' + $mo2.url + ', which is not a Mod Organizer 2 release on GitHub.') }
}

$world = New-Object Thornswood.Layout.Fomod+World
$sky = Step { Get-Content -Raw -LiteralPath $skyrimRecord | ConvertFrom-Json }
foreach ($p in $sky.files.PSObject.Properties.Name) {
  if ($p -match '^Data\\([^\\]+\.(esm|esp|esl))$') { [void]$world.Present.Add($Matches[1]); [void]$world.Active.Add($Matches[1]) }
}
$world.GameVersion = [string]$sky.build
if (([string]$sky.build).Split('.').Count -eq 3) { $world.GameVersion = [string]$sky.build + '.0' }
if ($Record) { Say ('  record only, into ' + $Record) } else { Say ('  game: ' + $Game) }
Say ('  the game''s own plugins and version for FOMOD questions: ' + $world.Present.Count + ' plugins, ' + $world.GameVersion + ' (records\skyrim-files.json)') 'DarkGray'
Say ('  cache: ' + $Cache) 'DarkGray'

$label = if ($Revision -gt 0) { [string]$Revision } else { 'archive' }
$script:Work = & (Join-Path $Here 'Get-ScratchDir.ps1') ('revision-layout-' + $Slug + '-' + $label)
Step { Remove-Tree $script:Work; New-Item -ItemType Directory -Force -Path $script:Work | Out-Null } | Out-Null

# ------------------------------------------------------------- the revision ---
Head ('Collection ' + $Slug)
$revInfo = [ordered]@{ slug = $Slug; revision = $Revision; revisionId = ''; status = ''; archive = ''; archiveMd5 = ''; archiveSize = 0 }
$colDir = Join-Path $script:Work 'collection'
if ($CollectionArchive) {
  $CollectionArchive = [IO.Path]::GetFullPath($CollectionArchive)
  if (-not (Test-Path -LiteralPath $CollectionArchive)) { Die ('There is nothing at ' + $CollectionArchive + '.') }
  if ($Revision -le 0) {
    $bm = [regex]::Match((Split-Path -Leaf $CollectionArchive), '^collection(?:_' + $Slug + ')?_(\d+)[_.]')
    if (-not $bm.Success) { Die ((Split-Path -Leaf $CollectionArchive) + ' does not say which revision it is; say it with -Revision.') }
    $Revision = [int]$bm.Groups[1].Value; $revInfo.revision = $Revision
  }
  if (Test-Path -LiteralPath $CollectionArchive -PathType Leaf) {
    $facts = Step { Get-NexusArchiveFacts $CollectionArchive }
    $revInfo.archive = $facts.Name; $revInfo.archiveMd5 = $facts.Md5Hex; $revInfo.archiveSize = $facts.Size
    Step { Expand-Archive7 $CollectionArchive $colDir 'the collection archive' }
  }
  else {
    New-Item -ItemType Directory -Force -Path $colDir | Out-Null
    Copy-Item -Path (Join-Path $CollectionArchive '*') -Destination $colDir -Recurse -Force
    $revInfo.archive = (Split-Path -Leaf $CollectionArchive) + '\'
  }
  $revInfo.status = 'from an archive'
  Say ('  revision ' + $Revision + ' from ' + $CollectionArchive)
}
else {
  [void](Step { Read-NexusKey })
  Say ('  key from ' + $script:NexusKeyFrom) 'DarkGray'
  $q = '{ collectionRevision(slug: "' + $Slug + '", revision: ' + $Revision + ', domainName: "' + $GameDomain + '") { id revisionNumber status downloadLink } }'
  $rev = Get-NexusField (Step { Invoke-NexusGraph $q $null ('Reading revision ' + $Revision + ' of ' + $Slug) }) 'collectionRevision'
  $link = [string](Get-NexusField $rev 'downloadLink')
  if (-not (Get-NexusField $rev 'id') -or -not $link) { Die ('Nexus has no revision ' + $Revision + ' of ' + $Slug + ' that this key can download.') }
  if ($link -notmatch '^/v2/collections/\d+/revisions/\d+/download_link$') { Die ('Nexus gave the revision''s download link as ' + $link + ', which is not the API path it gives for a collection.') }
  $revInfo.revisionId = [string](Get-NexusField $rev 'id'); $revInfo.status = [string](Get-NexusField $rev 'status')
  Say ('  revision ' + $Revision + ', ' + $revInfo.status + ', id ' + $revInfo.revisionId)
  $links = @(Get-NexusField (Step { Invoke-NexusApi 'GET' $link '' ('Asking for revision ' + $Revision + '''s download') }) 'download_links')
  $uri = [string](Get-NexusField ($links | Select-Object -First 1) 'URI')
  if (-not $uri) { Die ('Nexus gave no download address for revision ' + $Revision + '.') }
  $got = Step { Receive-NexusPresigned $uri (Join-Path $script:Work 'collection-archive') ('Downloading revision ' + $Revision) ('collection_' + $Revision + '.7z') }
  $revInfo.archive = $got.Name; $revInfo.archiveMd5 = $got.Md5Hex; $revInfo.archiveSize = $got.Size
  Say ('  ' + $got.Name + ', ' + $got.Size.ToString('N0') + ' bytes, md5 ' + $got.Md5Hex) 'DarkGray'
  Step { Expand-Archive7 $got.Path $colDir 'the collection archive' }
}
$cj = Join-Path $colDir 'collection.json'
if (-not (Test-Path -LiteralPath $cj)) { Die 'The revision has no collection.json at its top, so it is not a collection Vortex made.' }
$tops = @(Get-ChildItem -LiteralPath $colDir -Force | Where-Object { @('collection.json', 'bundled', 'patches') -notcontains $_.Name })
if ($tops.Count) { Die ('The collection archive holds ' + (($tops | ForEach-Object { $_.Name }) -join ', ') + ' beside collection.json, bundled and patches (an INI Tweaks folder, say), and those are not laid out here.') }
$bundled = Join-Path $colDir 'bundled'
if ((Test-Path -LiteralPath $bundled) -and @(Get-ChildItem -LiteralPath $bundled -Recurse -File -Force).Count) { Die 'The collection bundles files of its own (bundled), and bundled mods are not laid out here.' }
$col = Step { [Thornswood.Layout.NexusLayout]::ReadCollection($cj) }
Say ('  "' + $col.Name + '" by ' + $col.Author + ', ' + $col.Entries.Count + ' mods, ' + $col.Rules.Count + ' mod rules, ' + $col.Plugins.Count + ' plugins listed')

$no = [Thornswood.Layout.NexusLayout]::Unsupported($col, $GameDomain)
if ($no.Count) { Die ("This revision has what is not laid out here the way Vortex would, so nothing was downloaded:`n  " + ($no -join "`n  ")) }
foreach ($e in $col.Entries) {
  foreach ($p in $e.Patches) {
    $diff = Join-Rel (Join-Path (Join-Path $colDir 'patches') $e.Name) ($p.Key + '.diff')
    if (-not (Test-Path -LiteralPath $diff)) { Die ($e.Say() + ' has a patch for ' + $p.Key + ', and the collection has no ' + $diff.Substring($colDir.Length + 1) + ' for it.') }
  }
}

# --------------------------------------------------------------- the archives ---
Head 'The archives'
$total = ($col.Entries | Measure-Object -Property Size -Sum).Sum
Say ('  ' + $col.Entries.Count + ' archives, ' + ([double]$total / 1GB).ToString('N2') + ' GB')
$archives = @{}
$fetched = 0; $reused = 0
# An archive that passed its md5 is stamped with its size and write time
# (HashStamps.ps1), so the next run reads it again only when either changed
# (#4388). A changed one is read and held to the md5 as before.
$cacheStamps = Read-HashStamps (Join-Path $Cache 'md5-passed.tsv')
$md5Of = { param([string]$p) (Get-FileHash -LiteralPath $p -Algorithm MD5).Hash.ToLowerInvariant() }
foreach ($e in $col.Entries) {
  $dir = Join-Path $Cache ([string]$e.FileId)
  $hit = $null
  if (Test-Path -LiteralPath $dir) {
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -File -Force)) {
      if ($f.Name.EndsWith('.part')) { [IO.File]::Delete($f.FullName); continue }
      if (-not $hit -and (Test-HashAsRecorded $cacheStamps ([string]$e.FileId + '\' + $f.Name) $f.FullName $e.Size $e.Md5 $md5Of)) { $hit = $f.FullName; continue }
      Say ('  ' + $f.FullName + ' is not the archive the revision lists for file ' + $e.FileId + ', so it is replaced') 'Yellow'
      [IO.File]::Delete($f.FullName)
    }
  }
  if ($hit) { $archives[$e.Index] = $hit; $reused++; continue }
  $what = 'Downloading ' + $e.Say()
  $dl = Get-NexusField (Step { Invoke-NexusApi 'GET' ('/v3/games/' + $GameDomain + '/mod-file-versions/' + $e.FileId + '/download-link') '' ('Asking for the download of ' + $e.Say()) }) 'data'
  $url = [string](Get-NexusField (@(Get-NexusField $dl 'links') | Select-Object -First 1) 'url')
  if (-not $url) { Die ('Nexus gave no download address for ' + $e.Say() + '.') }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $got = Step { Receive-NexusPresigned $url $dir $what ([string]$e.FileId + '.archive') }
  if ($got.Size -ne $e.Size -or $got.Md5Hex -ne $e.Md5) {
    [IO.File]::Delete($got.Path)
    Die ('The download of ' + $e.Say() + ' is not the archive the revision lists: it is ' + $got.Size + ' bytes, md5 ' + $got.Md5Hex + ', and the revision says ' + $e.Size + ' bytes, md5 ' + $e.Md5 + '. It was deleted from the cache; ' + $fetched + ' archives were downloaded before it and stay there. Run it again to tell which: if the second download is the same ' + $got.Size + ' bytes, md5 ' + $got.Md5Hex + ', Nexus now serves other bytes as file ' + $e.FileId + ' and the revision is made again in Vortex on One; if it is the revision''s, the first broke on the way and the run carries on.')
  }
  # Measured on 20 Oct: the CDN sends no Content-Disposition for some files
  # (Crafting Categories for SkyUI, file 493920). Then the archive is named
  # for its entry, with the extension its first bytes say.
  if ($got.Name -eq ([string]$e.FileId + '.archive')) {
    $sig = New-Object byte[] 6
    $fs = [IO.File]::OpenRead($got.Path); try { [void]$fs.Read($sig, 0, 6) } finally { $fs.Dispose() }
    $hex = (($sig | ForEach-Object { $_.ToString('x2') }) -join '')
    $ext = if ($hex -eq '377abcaf271c') { '.7z' } elseif ($hex.StartsWith('504b0304')) { '.zip' } elseif ($hex.StartsWith('52617221')) { '.rar' } else { '' }
    if (-not $ext) { [IO.File]::Delete($got.Path); Die ('The download of ' + $e.Say() + ' came with no name, and its first bytes are not a 7z, zip or rar archive. It was deleted from the cache.') }
    $base = (($e.LogicalFilename -replace '[^A-Za-z0-9 _().,+\-]', '_').Trim()) + ' ' + $e.FileId
    $named = Join-Path $dir ($base + $ext)
    [IO.File]::Move($got.Path, $named)
    $got = [pscustomobject]@{ Path = $named; Name = $base + $ext; Size = $got.Size; Md5Hex = $got.Md5Hex }
  }
  $archives[$e.Index] = $got.Path; $fetched++
  # Held to the revision's size and md5 above, so stamped with no read.
  Set-HashStamp $cacheStamps ([string]$e.FileId + '\' + $got.Name) $got.Path $e.Md5
  Say ('  ' + $got.Name + ', ' + ([double]$got.Size / 1MB).ToString('N1') + ' MB in ' + [Math]::Round($sw.Elapsed.TotalSeconds) + ' s') 'DarkGray'
}
# Only the archives this revision uses keep a stamp; the cache holds no
# other (the folders of other file ids go just below).
$keep = @{}
foreach ($e in $col.Entries) {
  $k = ([string]$e.FileId + '\' + [IO.Path]::GetFileName($archives[$e.Index])).ToLowerInvariant()
  if ($cacheStamps.ContainsKey($k)) { $keep[$k] = $cacheStamps[$k] }
}
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
Save-HashStamps (Join-Path $Cache 'md5-passed.tsv') $keep
Say ('  ' + $reused + ' from the cache, ' + $fetched + ' downloaded, every one the revision''s size and md5') 'Green'
# The cache keeps one folder per file id, and until #4324 only the folders of
# the file ids a run's revision lists were ever read, so an archive no
# revision lists any more stayed for good. Now that this run holds every
# archive its revision lists, the folder of any other file id is an older
# revision's, and it goes. What in the cache is not a file id's folder is not
# this script's, and stays.
$listed = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($e in $col.Entries) { [void]$listed.Add([string]$e.FileId) }
$gone = New-Object System.Collections.Generic.List[string]
if (Test-Path -LiteralPath $Cache -PathType Container) {
  foreach ($d in @(Get-ChildItem -LiteralPath $Cache -Directory -Force)) {
    if ($d.Name -notmatch '^\d+$' -or $listed.Contains($d.Name) -or ($d.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
    Step { Remove-Tree $d.FullName }
    $gone.Add($d.Name)
  }
}
if ($gone.Count) { Say ('  taken out of the cache, as no file of this revision: file id ' + ($gone -join ', file id ')) 'DarkGray' }
# -Modlist names every archive by its xxHash64, as Wabbajack does.
$script:ArchXx = @{}
if ($Modlist) { foreach ($e in $col.Entries) { $script:ArchXx[$e.Index] = [Thornswood.XxHash64]::OfFile($archives[$e.Index]) } }
# A RAR archive needs a 7-Zip that unpacks RAR. Ubuntu's does not: measured
# 21 Oct (#2969), its 7zip package has no RAR codec ("Unsupported Method" on
# Skyrim Sewers) and its 7zip-rar codec crashes on every RAR (exit 139). So
# one RAR archive is tested with this 7-Zip before any archive is unpacked.
$rars = @($col.Entries | Where-Object {
    $sig = New-Object byte[] 4
    $fs = [IO.File]::OpenRead($archives[$_.Index]); try { [void]$fs.Read($sig, 0, 4) } finally { $fs.Dispose() }
    [Text.Encoding]::ASCII.GetString($sig) -eq 'Rar!'
  })
if ($rars.Count) {
  Step { Use-SevenZip }
  $t = Invoke-Tool $script:SevenZip @('t', $archives[$rars[0].Index])
  if ($t.Code -ne 0) { Die ([string]$rars.Count + ' of the archives are RAR (' + (($rars | Select-Object -First 3 | ForEach-Object { $_.Name }) -join ', ') + $(if ($rars.Count -gt 3) { ', ...' } else { '' }) + '), and ' + $script:SevenZip + ' could not test the first of them (exit ' + $t.Code + '), so it cannot unpack them.' + $(if (-not $IsWindows) { ' 7-Zip''s own Linux build unpacks RAR: pwsh scripts/release/Get-SevenZip.ps1 puts it where this script looks first.' } else { '' })) }
}

# ---------------------------------------------------------------- the install ---
Head 'Installing, as Vortex would'
# Size and sha256 of each file, by its unpacked path, taken before -Record
# deletes the unpacked copy.
$script:Facts = @{}
# And each plugin's TES4 header, by its unpacked path, for the plugin rules
# check after the deploy (PluginRuleLoops.ps1), which -Record would
# otherwise find gone.
$script:PluginHeads = @{}
# And with -KeepPlugins a copy of each plugin, by its unpacked path, kept in
# the scratch folder until the deployment says which copy wins.
$script:Kept = @{}
# And what SkyUI's menu check reads, the same way (#4069).
$script:KeptMenus = @{}
# And with -Modlist what the modlist names each file by (#6244).
$script:WjFiles = @{}
# And the slider sets each BodySlide .osp holds, by its unpacked path, as
# metadata only for slidersets.json (#5888). No .osp is kept.
$script:SliderSetsRead = @{}
$script:MenuCheck = Join-Path $PSScriptRoot '..\mods\Check-SkyUIMenus.js'
function Test-MenuInputRel([string]$Rel) {
  return ($Rel -match '^(?i)Scripts\\ski_main\.pex$' -or $Rel -match '^(?i)Interface\\.+\.swf$' -or $Rel -match '^(?i)[^\\]+\.bsa$')
}
function Remove-Unpacked($e, [string]$u) {
  [Thornswood.Layout.NexusLayout]::Forget($u)
  Remove-Tree $u
  $pd = Join-Path (Join-Path $script:Work 'patch') ([string]$e.Index)
  Remove-Tree $pd
}
$plans = New-Object 'System.Collections.Generic.List[Thornswood.Layout.ModPlan]'
$stops = New-Object System.Collections.Generic.List[string]
foreach ($e in $col.Entries) {
  $u = Join-Path (Join-Path $script:Work 'mods') ([string]$e.Index)
  Step { Expand-Archive7 $archives[$e.Index] $u $e.Say() }
  $files = $null
  try { [void][Thornswood.Layout.NexusLayout]::SplitBackslashNames($u); $files = [Thornswood.Layout.NexusLayout]::FileList($u, (Get-ArchiveOrder $archives[$e.Index])) }
  catch { $ex = $_.Exception; while ($ex.InnerException) { $ex = $ex.InnerException }; $stops.Add($e.Say() + ': ' + $ex.Message); continue }
  $plan = Step { [Thornswood.Layout.NexusLayout]::PlanMod($e, $u, $files, $world) }
  if ($plan.Stop) { $stops.Add($e.Say() + ': ' + $plan.Stop); $plans.Add($plan); if ($Record) { Remove-Unpacked $e $u }; continue }
  if ($plan.SetModType -and $plan.SetModType -ne $e.Type) { $stops.Add($e.Say() + ': its installer makes it mod type ' + $plan.SetModType + ' and the collection says "' + $e.Type + '"') }
  # Patches: collections/util/binaryPatching.ts applyPatches.
  foreach ($p in $e.Patches) {
    $key = ([Thornswood.Layout.NexusLayout]::JoinRel($p.Key)).ToLowerInvariant()
    if (-not $plan.Files.ContainsKey($key)) { $stops.Add($e.Say() + ': the collection patches ' + $p.Key + ', which its installer does not put in the mod'); continue }
    $staged = $plan.Files[$key]
    $crc = [Thornswood.Layout.NexusLayout]::Crc32Of($staged.Full)
    if ($crc -ne $p.Value.ToUpperInvariant()) { $stops.Add($e.Say() + ': the patch for ' + $p.Key + ' is for a file with CRC-32 ' + $p.Value + ', and the archive''s is ' + $crc + '. Vortex would skip the patch and say nothing'); continue }
    $diff = Join-Rel (Join-Path (Join-Path $colDir 'patches') $e.Name) ($p.Key + '.diff')
    $pd = Join-Path (Join-Path (Join-Path $script:Work 'patch') ([string]$e.Index)) ([Thornswood.Layout.WinPath]::FileName($p.Key))
    New-Item -ItemType Directory -Force -Path $pd | Out-Null
    $head = Step { [Thornswood.Layout.NexusLayout]::BsdiffHeader($diff) }
    $bytes = [IO.File]::ReadAllBytes($diff)
    $blocks = @()
    $at = 32
    foreach ($len in @($head[0], $head[1], ($bytes.Length - 32 - $head[0] - $head[1]))) {
      if ($len -lt 0 -or $at + $len -gt $bytes.Length) { Die ($diff + ' is not a whole BSDIFF40 patch.') }
      $bz = Join-Path $pd ('block' + $blocks.Count + '.bz2')
      $block = New-Object byte[] $len
      [Array]::Copy($bytes, $at, $block, 0, $len)
      [IO.File]::WriteAllBytes($bz, $block)
      $r = Invoke-Tool $script:SevenZip @('e', '-y', ('-o' + $pd), $bz)
      if ($r.Code -ne 0) { Die ('7-Zip could not unpack block ' + $blocks.Count + ' of ' + $diff + ': ' + $r.Err.Trim()) }
      $blocks += , [IO.File]::ReadAllBytes((Join-Path $pd ('block' + $blocks.Count)))
      $at += $len
    }
    $out = Join-Path $pd ([Thornswood.Layout.WinPath]::FileName($p.Key))
    Step { [Thornswood.Layout.NexusLayout]::BsdiffApply($staged.Full, $blocks[0], $blocks[1], $blocks[2], $head[2], $out) }
    $staged.Origin = $staged.Full; $staged.Full = $out; $staged.Patched = $p.Key
    Say ('  ' + $e.Name + ': patched ' + $p.Key + ' (CRC-32 ' + $crc + ' -> ' + [Thornswood.Layout.NexusLayout]::Crc32Of($out) + ')') 'DarkGray'
  }
  foreach ($w in $plan.Warnings) { Say ('  ' + $e.Name + ': the installer says ' + $w) 'Yellow' }
  # BodySlide's slider set files, read here in every mode: -Record takes the
  # unpacked copy just below, and a patched .osp is read as it is placed.
  if ($e.Type -ne 'dinput') {
    foreach ($s in $plan.Files.Values) {
      if (-not (Test-SliderSetRel $s.Rel)) { continue }
      $script:SliderSetsRead[$s.Full] = Step { Read-SliderSetFile $s.Full $s.Rel }
    }
  }
  # -Record places nothing, so each file is measured now and the mod's
  # unpacked copy goes before the next is unpacked.
  if ($Record) {
    foreach ($s in $plan.Files.Values) { $script:Facts[$s.Full] = [pscustomobject]@{ Size = (Get-Item -LiteralPath $s.Full).Length; Sha256 = [Thornswood.Layout.NexusLayout]::Sha256Of($s.Full) } }
    foreach ($s in $plan.Files.Values) { if ($s.Full -match '\.(esp|esm|esl)$') { $script:PluginHeads[$s.Full] = [pscustomobject]@{ Header = (Read-PluginRuleHeader $s.Full) } } }
    # -Modlist: each file by its xxHash64 and its path in the archive, and a
    # patched one's delta from the archive's copy, before the copy goes.
    if ($Modlist) {
      $wj = New-Object System.Collections.Generic.List[object]
      foreach ($s in $plan.Files.Values) {
        if ([Thornswood.Layout.NexusLayout]::Blacklist.IsMatch($s.Rel)) { continue }
        $one = [pscustomobject]@{ Rel = $s.Rel; Source = $s.Source; Size = $script:Facts[$s.Full].Size; Xx = [Thornswood.XxHash64]::OfFile($s.Full); FromXx = [uint64]0; Delta = $null }
        if ($s.Patched) { $one.FromXx = [Thornswood.XxHash64]::OfFile($s.Origin); $one.Delta = [Thornswood.Layout.OctoDelta]::Make($s.Origin, $s.Full) }
        $wj.Add($one)
      }
      $script:WjFiles[$e.Index] = $wj
    }
    if ($KeepPlugins -and $e.Type -ne 'dinput') {
      foreach ($s in $plan.Files.Values) {
        if ($s.Rel -notmatch '^[^\\]+\.(esp|esm|esl)$') { continue }
        $kd = Join-Path (Join-Path $script:Work 'keep') ([string]$e.Index)
        New-Item -ItemType Directory -Force -Path $kd | Out-Null
        $kf = Join-Path $kd $s.Rel
        [IO.File]::Copy($s.Full, $kf, $true)
        $script:Kept[$s.Full] = $kf
      }
      $menuIn = @($plan.Files.Values | Where-Object { Test-MenuInputRel $_.Rel })
      $bsas = @($menuIn | Where-Object { $_.Rel -match '\.bsa$' } | ForEach-Object { $_.Full })
      $holding = @()
      if ($bsas.Count) {
        $global:LASTEXITCODE = 0
        $holding = @(& node $script:MenuCheck --holding @bsas)
        if ($LASTEXITCODE -ne 0) { Die ($e.Say() + ': Check-SkyUIMenus.js --holding ended ' + $LASTEXITCODE + ', so which of its archives SkyUI''s menu check reads is not known.') }
      }
      foreach ($s in $menuIn) {
        if ($s.Rel -match '\.bsa$' -and $holding -notcontains $s.Full) { continue }
        $kf = Join-Path (Join-Path (Join-Path $script:Work 'keep-menus') ([string]$e.Index)) $s.Rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $kf) | Out-Null
        [IO.File]::Copy($s.Full, $kf, $true)
        $script:KeptMenus[$s.Full] = $kf
      }
    }
    Remove-Unpacked $e $u
  }
  $plans.Add($plan)
}
if ($stops.Count) { Die ("These are not laid out the way Vortex would:`n  " + ($stops -join "`n  ")) }
$byInstaller = $plans | Group-Object Installer | ForEach-Object { $_.Name + ' ' + $_.Count }
Say ('  ' + $plans.Count + ' mods: ' + ($byInstaller -join ', '))

# ------------------------------------------------------------- the deployment ---
Head 'Deploying, as Vortex would'
$edges = [Thornswood.Layout.NexusLayout]::Edges($col)
$cycle = $null
$before = [Thornswood.Layout.NexusLayout]::Before($edges, [ref]$cycle)
if ($null -ne $cycle) { Die ('The collection''s mod rules go round in a circle (entries ' + $cycle + '), which Vortex refuses to deploy. Take one of those rules out in Vortex on One, and lay out the revision that publishes.') }
$claims = @{}
foreach ($plan in $plans) {
  $e = $plan.Entry
  foreach ($k in $plan.Files.Keys) {
    $s = $plan.Files[$k]
    if ([Thornswood.Layout.NexusLayout]::Blacklist.IsMatch($s.Rel)) { continue }
    $rel = if ($e.Type -eq 'dinput') { $s.Rel } else { 'Data\' + $s.Rel }
    $key = $rel.ToLowerInvariant()
    if (-not $claims.ContainsKey($key)) { $claims[$key] = New-Object System.Collections.Generic.List[object] }
    $claims[$key].Add([pscustomobject]@{ Rel = $rel; Staged = $s; Entry = $e.Index })
  }
}
$placed = New-Object System.Collections.Generic.List[object]
$unordered = @{}
$won = 0
foreach ($key in $claims.Keys) {
  $c = $claims[$key]
  $win = $c[0]
  if ($c.Count -gt 1) {
    $win = $null
    foreach ($x in $c) { if (@($c | Where-Object { $_.Entry -ne $x.Entry -and -not $before[$x.Entry].Contains($_.Entry) }).Count -eq 0) { $win = $x; break } }
    if (-not $win) {
      $pair = (@($c | ForEach-Object { $col.Entries[$_.Entry].Name } | Sort-Object -Unique) -join ' and ')
      if (-not $unordered.ContainsKey($pair)) { $unordered[$pair] = 0 }
      $unordered[$pair]++
      continue
    }
    $won += $c.Count - 1
  }
  $placed.Add([pscustomobject]@{ Rel = $win.Rel; Full = $win.Staged.Full; Entry = $win.Entry; Over = @($c | Where-Object { $_ -ne $win } | ForEach-Object { $_.Entry }); Size = 0; Sha256 = '' })
}
if ($unordered.Count) { Die ("No mod rule says which of these Vortex deploys last, and they share files, so which copy Vortex keeps depends on its own state:`n  " + (($unordered.Keys | Sort-Object | ForEach-Object { $_ + ' (' + $unordered[$_] + ' files)' }) -join "`n  ") + "`nGive each pair a mod rule in Vortex on One, one of the two loading after the other, and lay out the revision that publishes.") }
Say ('  ' + $placed.Count + ' files; ' + $won + ' copies lost to a mod the rules deploy later')

# Plugins: the collection's list first, in its order (gamebryo.tsx, the
# curator's load order), then any plugin the layout has that it does not
# name, disabled.
$present = @{}
foreach ($x in $placed) { if ($x.Rel -match '^Data\\([^\\]+\.(esp|esm|esl))$') { $present[$Matches[1].ToLowerInvariant()] = $Matches[1] } }
$order = New-Object System.Collections.Generic.List[object]
$seen = @{}
$missingPlugins = @()
foreach ($p in $col.Plugins) {
  $k = $p.Name.ToLowerInvariant()
  if ($seen.ContainsKey($k)) { continue }
  $seen[$k] = $true
  if (-not $present.ContainsKey($k)) { $missingPlugins += $p.Name; continue }
  $order.Add([pscustomobject]@{ Name = $p.Name; Enabled = $p.Enabled })
}
if ($missingPlugins.Count) { Die ('The collection lists plugins no mod in it has: ' + ($missingPlugins -join ', ') + '. Put in the mod that has them, or take them off the plugin list, in Vortex on One, and lay out the revision that publishes.') }
$unlisted = @($present.Keys | Where-Object { -not $seen.ContainsKey($_) } | Sort-Object | ForEach-Object { $present[$_] })
foreach ($n in $unlisted) { $order.Add([pscustomobject]@{ Name = $n; Enabled = $false }) }
# The rules are held over the plugins the game loads, the enabled ones. A
# rule naming a disabled plugin orders nothing the game loads: revision 3
# has CommonClothes.esp after RaceMenuMorphsCBBE.esp, which the curator left
# off (measured 21 Oct, #2969).
$pos = @{}
for ($i = 0; $i -lt $order.Count; $i++) { if ($order[$i].Enabled) { $pos[$order[$i].Name.ToLowerInvariant()] = $i } }
$broken = @()
foreach ($r in $col.PluginRules) {
  $k = $r.Name.ToLowerInvariant()
  if (-not $pos.ContainsKey($k)) { continue }
  foreach ($a in $r.After) { $ak = ([string]$a).ToLowerInvariant(); if ($pos.ContainsKey($ak) -and $pos[$ak] -gt $pos[$k]) { $broken += ($r.Name + ' is to load after ' + $a) } }
}
if ($broken.Count) { Die ('The collection''s plugin order breaks its own plugin rules: ' + ($broken -join '; ') + '.') }
# The list is not the game's order: the game puts every master first, and
# LOOT holds that as hard as a rule. Revision 5's list had
# cheddars_mashups.esl at the end, after the three plugins its rule named,
# and the rule held to the list; on a clean install LOOT found it going round
# with the game's own order (27 Oct). So the rules are read against the
# plugins' headers too (PluginRuleLoops.ps1).
# A file with no TES4 header is placed by its name alone: the game loads an
# .esm or .esl as a master whatever is in it. A file that is not there to
# read stops the run: -Record took the unpacked copies away mod by mod, and
# the header read then ($script:PluginHeads) is the one used.
$ruleHeads = @{}
$byName = @()
foreach ($x in $placed) {
  if ($x.Rel -notmatch '^Data\\([^\\]+\.(esp|esm|esl))$') { continue }
  $nm = $Matches[1]
  if (-not $pos.ContainsKey($nm.ToLowerInvariant())) { continue }
  if ($script:PluginHeads.ContainsKey($x.Full)) { $h = $script:PluginHeads[$x.Full].Header }
  elseif (Test-Path -LiteralPath $x.Full -PathType Leaf) { $h = Read-PluginRuleHeader $x.Full }
  else { Die ($x.Rel + ' was not read before its unpacked copy went, so where the game loads it is not known.') }
  if ($null -eq $h) {
    $byName += $nm
    $h = [pscustomobject]@{ Master = ($nm -match '\.(esm|esl)$'); Light = ($nm -match '\.esl$'); Masters = [string[]]@() }
  }
  $ruleHeads[$nm] = $h
}
if ($byName.Count) { Say ('  no TES4 header, so placed by name alone: ' + (@($byName | Sort-Object) -join ', ')) 'Yellow' }
$loops = @(Get-PluginRuleLoops $col.PluginRules $ruleHeads)
if ($loops.Count) { Die ('The collection''s plugin rules go round in a circle with the order the game sets, which LOOT reports as a cyclic interaction on every install: ' + (($loops | ForEach-Object { $_.Loop + ' (' + ($_.Why -join '; ') + ')' }) -join '; ') + '.') }
Say ('  ' + $order.Count + ' plugins: ' + @($order | Where-Object { $_.Enabled }).Count + ' enabled in the collection''s order' + $(if ($unlisted.Count) { ', ' + $unlisted.Count + ' it does not list, disabled: ' + ($unlisted -join ', ') } else { '' }))

Say '  working out every file''s sha256' 'DarkGray'
foreach ($x in $placed) {
  $f = $script:Facts[$x.Full]
  if ($f) { $x.Size = $f.Size; $x.Sha256 = $f.Sha256 }
  else { $x.Size = (Get-Item -LiteralPath $x.Full).Length; $x.Sha256 = [Thornswood.Layout.NexusLayout]::Sha256Of($x.Full) }
}
$bytesAll = ($placed | Measure-Object -Property Size -Sum).Sum
Say ('  ' + ([double]$bytesAll / 1GB).ToString('N2') + ' GB in all')

# The record, the same whether it goes beside a layout or alone (-Record).
# Paths sort by ordinal ignoring case and every line ends in CRLF, so One and
# a cloud session write the same bytes for the same layout, and files.txt's
# sha256 alone says whether two runs laid out the same files.
$utf8 = New-Object Text.UTF8Encoding($false)
function Write-Crlf([string]$path, $list) { [IO.File]::WriteAllText($path, ((@($list) -join "`r`n") + "`r`n"), $utf8) }
$sorted = New-Object 'System.Collections.Generic.List[object]'
foreach ($x in $placed) { $sorted.Add($x) }
$sorted.Sort([Comparison[object]] { param($a, $b) [StringComparer]::OrdinalIgnoreCase.Compare($a.Rel, $b.Rel) })
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('# Install-NexusRevision.ps1: collection ' + $Slug + ' revision ' + $Revision + '. sha256, size, Nexus file id, path in the game folder.')
foreach ($x in $sorted) { $lines.Add($x.Sha256 + "`t" + $x.Size + "`t" + $col.Entries[$x.Entry].FileId + "`t" + $x.Rel) }
$pl = New-Object System.Collections.Generic.List[string]
$lo = New-Object System.Collections.Generic.List[string]
$pl.Add('# Install-NexusRevision.ps1: collection ' + $Slug + ' revision ' + $Revision)
$lo.Add('# Install-NexusRevision.ps1: collection ' + $Slug + ' revision ' + $Revision)
foreach ($p in $order) { $pl.Add($(if ($p.Enabled) { '*' } else { '' }) + $p.Name); $lo.Add($p.Name) }
$counts = @{}
foreach ($x in $placed) { $counts[$x.Entry] = 1 + [int]$counts[$x.Entry] }
$layoutRecord = [ordered]@{
  schema     = 1
  made       = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
  tool       = 'scripts\release\Install-NexusRevision.ps1'
  collection = [ordered]@{ slug = $Slug; domain = $GameDomain; name = $col.Name; revision = $Revision; revisionId = $revInfo.revisionId; status = $revInfo.status; archive = $revInfo.archive; archiveMd5 = $revInfo.archiveMd5; archiveSize = $revInfo.archiveSize }
  gameVersion = $world.GameVersion
  files      = $placed.Count
  bytes      = $bytesAll
  mods       = @($plans | ForEach-Object {
      $e = $_.Entry
      [ordered]@{ name = $e.Name; version = $e.Version; modId = $e.ModId; fileId = $e.FileId; md5 = $e.Md5; size = $e.Size; archive = [IO.Path]::GetFileName($archives[$e.Index]); installer = $_.Installer; type = $e.Type; files = [int]$counts[$e.Index]; patched = @($e.Patches | ForEach-Object { $_.Key }); warnings = @($_.Warnings) }
    })
  plugins    = @($order | ForEach-Object { [ordered]@{ name = $_.Name; enabled = [bool]$_.Enabled } })
  # The collection's plugin rules, as it gives them. Vortex sorts each
  # install's load order itself under these rules, so they, and not the
  # list's order, are what a deployment is held to (Compare-NexusLayout.ps1).
  pluginRules = @($col.PluginRules | ForEach-Object { [ordered]@{ name = $_.Name; after = @($_.After | ForEach-Object { [string]$_ }) } })
}
# slidersets.json: each placed BodySlide slider set file, with files.txt's
# sha256, and the sets it holds, metadata only (#5888, SliderSets.ps1).
$sliderSetRecord = Step { New-SliderSetRecord $Slug $Revision $placed $script:SliderSetsRead $col.Entries }
function Write-LayoutRecord([string]$dir, [bool]$withFiles) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  if ($withFiles) { Write-Crlf (Join-Path $dir 'files.txt') $lines }
  Write-Crlf (Join-Path $dir 'plugins.txt') $pl
  Write-Crlf (Join-Path $dir 'loadorder.txt') $lo
  [IO.File]::WriteAllText((Join-Path $dir 'layout.json'), ($layoutRecord | ConvertTo-Json -Depth 6), $utf8)
  [IO.File]::WriteAllText((Join-Path $dir 'slidersets.json'), ($sliderSetRecord | ConvertTo-Json -Depth 6), $utf8)
}

if ($Record) {
  Write-LayoutRecord $Record $true
  if ($KeepPlugins) {
    # The copy that wins each plugin's place, as the deployment worked it
    # out, held to the sha256 files.txt names for it.
    $pd = Join-Path $Record 'plugins'
    Remove-Tree $pd
    New-Item -ItemType Directory -Force -Path $pd | Out-Null
    $keptCount = 0
    foreach ($x in $placed) {
      if ($x.Rel -notmatch '^Data\\([^\\]+\.(esp|esm|esl))$') { continue }
      $nm = $Matches[1]
      $src = $script:Kept[$x.Full]
      if (-not $src -or -not (Test-Path -LiteralPath $src -PathType Leaf)) { Die ($x.Rel + ' was not kept before its unpacked copy went, so the plugins are not all here. The record is in ' + $Record + '; its plugins folder is not whole.') }
      $to = Join-Path $pd $nm
      [IO.File]::Copy($src, $to, $true)
      $got = [Thornswood.Layout.NexusLayout]::Sha256Of($to)
      if ($got -ne $x.Sha256) { Die ($nm + ' kept in ' + $pd + ' has sha256 ' + $got + ', and files.txt names ' + $x.Sha256 + ' for it.') }
      $keptCount++
    }
    # What SkyUI's menu check reads, at its path in the game folder, the
    # copy the deployment places, held to files.txt the same way.
    $md = Join-Path $Record 'menus'
    Remove-Tree $md
    New-Item -ItemType Directory -Force -Path $md | Out-Null
    $menuCount = 0
    foreach ($x in $placed) {
      if ($x.Rel -notmatch '^Data\\(.+)$' -or -not (Test-MenuInputRel $Matches[1])) { continue }
      $src = $script:KeptMenus[$x.Full]
      if (-not $src) {
        # An archive that holds nothing the check reads was never kept.
        if ($x.Rel -match '\.bsa$') { continue }
        Die ($x.Rel + ' was not kept before its unpacked copy went, so what SkyUI''s menu check reads is not all here.')
      }
      $to = Join-Path $md $x.Rel
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
      [IO.File]::Copy($src, $to, $true)
      $got = [Thornswood.Layout.NexusLayout]::Sha256Of($to)
      if ($got -ne $x.Sha256) { Die ($x.Rel + ' kept in ' + $md + ' has sha256 ' + $got + ', and files.txt names ' + $x.Sha256 + ' for it.') }
      $menuCount++
    }
  }
  if ($Modlist) {
    Head 'The modlist'
    $wjPath = Join-Path $Record 'thornswood.wabbajack'
    $ml = New-Object Thornswood.Layout.Modlist
    $ml.Name = 'Thornswood'; $ml.Author = 'Thornswood'; $ml.Website = 'https://thornswood.net'
    $ml.Description = 'The mods the Thornswood servers run: collection ' + $Slug + ', revision ' + $Revision + ', in a portable Mod Organizer 2.'
    $ml.Version = [string]$Revision + '.0.0.0'
    # Mod Organizer 2 itself, from its own release on GitHub, held to the pin.
    $mo2Dir = Join-Path $Cache 'mo2'
    New-Item -ItemType Directory -Force -Path $mo2Dir | Out-Null
    $mo2File = Join-Path $mo2Dir ([string]$mo2.name)
    $mo2Ok = { param($f) (Test-Path -LiteralPath $f -PathType Leaf) -and (Get-Item -LiteralPath $f).Length -eq [long]$mo2.size -and [Thornswood.Layout.NexusLayout]::Sha256Of($f) -eq ([string]$mo2.sha256).ToLowerInvariant() }
    if (-not (& $mo2Ok $mo2File)) {
      if (Test-Path -LiteralPath $mo2File) { Say ('  ' + $mo2File + ' is not the pinned Mod Organizer 2, so it is replaced') 'Yellow'; [IO.File]::Delete($mo2File) }
      Say ('  downloading Mod Organizer ' + $mo2.version + ' from ' + $mo2.url) 'DarkGray'
      $part = $mo2File + '.part'
      $http = New-Object Net.Http.HttpClient
      try {
        $resp = $http.GetAsync([string]$mo2.url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        if (-not $resp.IsSuccessStatusCode) { Die ('GitHub answered ' + [int]$resp.StatusCode + ' for ' + $mo2.url + '.') }
        $in = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult(); $outF = [IO.File]::Create($part)
        try { $in.CopyTo($outF) } finally { $outF.Dispose(); $in.Dispose() }
      } finally { $http.Dispose() }
      [IO.File]::Move($part, $mo2File, $true)
      if (-not (& $mo2Ok $mo2File)) { [IO.File]::Delete($mo2File); Die ('The download of ' + $mo2.url + ' is not the Mod Organizer 2 ' + $Mo2Record + ' pins (' + $mo2.size + ' bytes, sha256 ' + $mo2.sha256 + '). It was deleted.') }
    }
    $mo2Xx = [Thornswood.XxHash64]::OfFile($mo2File)
    $ml.AddHttpArchive([string]$mo2.name, [long]$mo2.size, $mo2Xx, [string]$mo2.url)
    $mo2Un = Join-Path $script:Work 'mo2'
    Step { Expand-Archive7 $mo2File $mo2Un 'Mod Organizer 2' }
    $mo2Count = 0
    foreach ($f in [IO.Directory]::EnumerateFiles($mo2Un, '*', [IO.SearchOption]::AllDirectories)) {
      $rel = [IO.Path]::GetRelativePath($mo2Un, $f).Replace([IO.Path]::DirectorySeparatorChar, '\')
      $ml.FromArchive($mo2Xx, $rel, [Thornswood.XxHash64]::OfFile($f), (Get-Item -LiteralPath $f).Length, $rel)
      $mo2Count++
    }
    Remove-Tree $mo2Un
    Say ('  Mod Organizer ' + $mo2.version + ': ' + $mo2Count + ' files')
    # Each mod's folder, named for the mod as MO2 allows, once.
    $folders = @{}; $taken = @{}
    foreach ($plan in $plans) {
      $e = $plan.Entry
      $nm = (($e.Name -replace '[<>:"/\\|?*\x00-\x1f]', '') -replace '[. ]+$', '').Trim()
      if (-not $nm) { $nm = 'Mod ' + $e.FileId }
      if ($taken.ContainsKey($nm.ToLowerInvariant())) { $nm = $nm + ' (' + $e.FileId + ')' }
      $taken[$nm.ToLowerInvariant()] = $true
      $folders[$e.Index] = $nm
    }
    # MO2's priority: a mod comes after every mod the rules deploy before it,
    # otherwise in the collection's order, so the one the rules deploy last
    # wins a shared file, as files.txt has it.
    $prio = New-Object System.Collections.Generic.List[int]
    $done = New-Object 'System.Collections.Generic.HashSet[int]'
    while ($prio.Count -lt $plans.Count) {
      $next = -1
      foreach ($plan in $plans) {
        $i = $plan.Entry.Index
        if ($done.Contains($i)) { continue }
        $ready = $true
        foreach ($b in $before[$i]) { if (-not $done.Contains($b)) { $ready = $false; break } }
        if ($ready) { $next = $i; break }
      }
      if ($next -lt 0) { Die 'The mod rules give no order for the modlist, though the deployment found one.' }
      [void]$done.Add($next); $prio.Add($next)
    }
    $byIndex = @{}; foreach ($plan in $plans) { $byIndex[$plan.Entry.Index] = $plan }
    $fileCount = 0; $patchCount = 0
    foreach ($i in $prio) {
      $e = $byIndex[$i].Entry
      $ax = $script:ArchXx[$i]
      $ml.AddNexusArchive([IO.Path]::GetFileName($archives[$i]), $e.Size, $ax, $GameDomain, $e.ModId, $e.FileId, $e.Name, $e.Version)
      $base = 'mods\' + $folders[$i] + '\'
      foreach ($w in $script:WjFiles[$i]) {
        # A dinput mod's Rel is from the game folder: its Data files are the
        # mod's own, as for any mod, and the rest goes under Root.
        $to = if ($e.Type -ne 'dinput') { $base + $w.Rel } elseif ($w.Rel -match '^(?i)Data\\(.+)$') { $base + $Matches[1] } else { $base + 'Root\' + $w.Rel }
        if ($w.Delta) { $ml.PatchedFromArchive($ax, $w.Source, $w.FromXx, $w.Delta, $w.Xx, $w.Size, $to); $patchCount++ }
        else { $ml.FromArchive($ax, $w.Source, $w.Xx, $w.Size, $to) }
        $fileCount++
      }
      $meta = "[General]`r`ngameName=SkyrimSE`r`nmodid=" + $e.ModId + "`r`nversion=" + $e.Version + "`r`ninstallationFile=" + [IO.Path]::GetFileName($archives[$i]) + "`r`nrepository=Nexus`r`n`r`n[installedFiles]`r`n1\modid=" + $e.ModId + "`r`n1\fileid=" + $e.FileId + "`r`nsize=1`r`n"
      $ml.Inline($utf8.GetBytes($meta), 'mods\' + $folders[$i] + '\meta.ini', $false)
    }
    # The profile: MO2 lists the highest priority first.
    $prof = 'profiles\Thornswood\'
    $mlTxt = @('# This file was automatically generated by Mod Organizer.') + @(for ($k = $prio.Count - 1; $k -ge 0; $k--) { '+' + $folders[$prio[$k]] })
    $ml.Inline($utf8.GetBytes(($mlTxt -join "`r`n") + "`r`n"), $prof + 'modlist.txt', $false)
    $plTxt = @('# This file was automatically generated by Mod Organizer.') + @($order | ForEach-Object { $(if ($_.Enabled) { '*' } else { '' }) + $_.Name })
    $ml.Inline($utf8.GetBytes(($plTxt -join "`r`n") + "`r`n"), $prof + 'plugins.txt', $false)
    $loTxt = @('# This file was automatically generated by Mod Organizer.') + @($order | ForEach-Object { $_.Name })
    $ml.Inline($utf8.GetBytes(($loTxt -join "`r`n") + "`r`n"), $prof + 'loadorder.txt', $false)
    $ml.Inline($utf8.GetBytes("[General]`r`nLocalSaves=false`r`nLocalSettings=false`r`nAutomaticArchiveInvalidation=false`r`n"), $prof + 'settings.ini', $false)
    # The instance, with the game and MO2's own folder put in at install.
    $ini = "[General]`r`ngameName=Skyrim Special Edition`r`nselected_profile=@ByteArray(Thornswood)`r`ngamePath=@ByteArray({--||GAME_PATH_MAGIC_DOUBLE_BACK||--})`r`nversion=" + $mo2.version + "`r`nfirst_start=false`r`n`r`n[Settings]`r`ndownload_directory={--||MO2_PATH_MAGIC_FORWARD||--}/downloads`r`nmod_directory={--||MO2_PATH_MAGIC_FORWARD||--}/mods`r`nprofiles_directory={--||MO2_PATH_MAGIC_FORWARD||--}/profiles`r`noverwrite_directory={--||MO2_PATH_MAGIC_FORWARD||--}/overwrite`r`n"
    $ml.Inline($utf8.GetBytes($ini), 'ModOrganizer.ini', $true)
    $ml.Inline($utf8.GetBytes(''), 'portable.txt', $false)
    Step { $ml.Save($wjPath) }
    $wjSha = [Thornswood.Layout.NexusLayout]::Sha256Of($wjPath)
    Say ('  ' + $ml.ArchiveCount + ' archives, ' + $ml.DirectiveCount + ' files (' + $fileCount + ' from the mods, ' + $patchCount + ' patched, ' + $mo2Count + ' of MO2)') 'Green'
    Say ('  ' + $wjPath + ', ' + (Get-Item -LiteralPath $wjPath).Length + ' bytes, sha256 ' + $wjSha)
  }
  Remove-Tree $script:Work; $script:Work = ''
  Head 'Done'
  Say ('  revision ' + $Revision + ' of ' + $Slug + ': ' + $placed.Count + ' files, ' + $order.Count + ' plugins, nothing placed') 'Green'
  Say ('  ' + (Join-Path $Record 'layout.json') + ', files.txt, plugins.txt, loadorder.txt')
  if ($KeepPlugins) {
    Say ('  and ' + $keptCount + ' plugins, the copies the layout places, in ' + (Join-Path $Record 'plugins'))
    Say ('  and ' + $menuCount + ' files SkyUI''s menu check reads, in ' + (Join-Path $Record 'menus'))
  }
  Say '  Next: for a draft, compare the layout with the collection record before publishing. For a new published revision, follow docs/COLLECTION-REVISIONS.md to update the records and rebuild content.'
  Write-Host ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

$recDir = Join-Path $Game 'Thornswood Layout'
if ($WhatIf) {
  Head 'What it would do'
  Say ('  place ' + $placed.Count + ' files in ' + $Game + ' and write ' + $recDir + '\layout.json, files.txt, plugins.txt and loadorder.txt')
  Write-Host ''
  Say ('Nothing in ' + $Game + ' was changed.') 'Green'
  Remove-Tree $script:Work; $script:Work = ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

# ---------------------------------------------------------------- the target ---
Head ('Laying it out in ' + $Game)
$oldFiles = Join-Path $recDir 'files.txt'
$old = @{}
if (Test-Path -LiteralPath $oldFiles) {
  foreach ($line in [IO.File]::ReadAllLines($oldFiles)) {
    if (-not $line -or $line.StartsWith('#')) { continue }
    $c = $line.Split("`t")
    if ($c.Count -ne 4) { Die ($oldFiles + ' has a line that is not sha256, size, file id and path: ' + $line) }
    $old[$c[3].ToLowerInvariant()] = [pscustomobject]@{ Sha256 = $c[0]; Size = [long]$c[1]; Rel = $c[3] }
  }
  $changedOld = @()
  # placed.tsv stamps each file as the last run placed it (HashStamps.ps1),
  # so one still as placed is not read again; the new files.txt has read
  # this run's copy already (#4388). Any other is read and held to files.txt.
  $placedStamps = Read-HashStamps (Join-Path $recDir 'placed.tsv')
  $sha256Of = { param([string]$p) [Thornswood.Layout.NexusLayout]::Sha256Of($p) }
  foreach ($o in $old.Values) {
    $f = Join-Path $Game $o.Rel
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { continue }
    if (-not (Test-HashAsRecorded $placedStamps $o.Rel $f $o.Size $o.Sha256 $sha256Of)) { $changedOld += $o.Rel }
  }
  if ($changedOld.Count) { Die ('These files of the layout already in ' + $Game + ' are not what its files.txt says, so something else wrote them and they are not taken out: ' + (($changedOld | Select-Object -First 20) -join ', ') + $(if ($changedOld.Count -gt 20) { ' and ' + ($changedOld.Count - 20) + ' more' } else { '' })) }
  Say ('  the layout there now has ' + $old.Count + ' files, all as its files.txt says')
}
$foreign = @($placed | Where-Object { -not $old.ContainsKey($_.Rel.ToLowerInvariant()) -and (Test-Path -LiteralPath (Join-Path $Game $_.Rel)) } | ForEach-Object { $_.Rel })
if ($foreign.Count) { Die ('These are in ' + $Game + ' already and no layout put them there, so they are not written over: ' + (($foreign | Select-Object -First 20) -join ', ') + $(if ($foreign.Count -gt 20) { ' and ' + ($foreign.Count - 20) + ' more' } else { '' })) }

$script:Changed = 'In ' + $Game + ': the earlier layout''s files are being taken out.'
foreach ($o in $old.Values) { $f = Join-Path $Game $o.Rel; if (Test-Path -LiteralPath $f -PathType Leaf) { [IO.File]::SetAttributes($f, [IO.FileAttributes]::Normal); [IO.File]::Delete($f) } }
# A run cut part way through a copy leaves that file's .part (CopyWhole in
# NexusLayout.cs, #4303); it is this script's own, for a name files.txt lists.
foreach ($o in $old.Values) { $f = Join-Path $Game ($o.Rel + '.part'); if (Test-Path -LiteralPath $f -PathType Leaf) { [IO.File]::SetAttributes($f, [IO.FileAttributes]::Normal); [IO.File]::Delete($f) } }
foreach ($n in 'layout.json', 'files.txt', 'plugins.txt', 'loadorder.txt', 'slidersets.json', 'placed.tsv') { $f = Join-Path $recDir $n; if (Test-Path -LiteralPath $f) { [IO.File]::Delete($f) } }
# Folders the old layout left empty go too, deepest first; Data and the
# game folder stay.
foreach ($d in @($old.Values | ForEach-Object { Split-Path -Parent $_.Rel } | Where-Object { $_ } | Sort-Object -Unique | Sort-Object { $_.Length } -Descending)) {
  $p = $d
  while ($p -and $p -ne 'Data') {
    $full = Join-Path $Game $p
    if ((Test-Path -LiteralPath $full) -and -not @(Get-ChildItem -LiteralPath $full -Force).Count) { [IO.Directory]::Delete($full) }
    $p = Split-Path -Parent $p
  }
}

# files.txt first, saying the layout is not whole yet, so a stop part way
# leaves a record a run again can take out.
New-Item -ItemType Directory -Force -Path $recDir | Out-Null
$whole = $lines[0]
$lines[0] = '# Install-NexusRevision.ps1: collection ' + $Slug + ' revision ' + $Revision + '. Being placed; layout.json is written when it is whole.'
Write-Crlf $oldFiles $lines
$script:Changed = 'In ' + $Game + ': the earlier layout is out and this one is part way in. Thornswood Layout\files.txt lists every file this run meant to place; run the same command again to put the rest in.'
$linked = 0; $copied = 0
$used = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$x = $null
try {
  foreach ($x in $placed) {
    $to = Join-Path $Game $x.Rel
    # One unpacked file placed twice is copied the second time, so no two
    # names in the layout are one file.
    if ($used.Add($x.Full)) { if ([Thornswood.Layout.NexusLayout]::LinkOrCopy($x.Full, $to)) { $linked++ } else { $copied++ } }
    else { [Thornswood.Layout.NexusLayout]::CopyWhole($x.Full, $to); $copied++ }
  }
}
catch { Die ('Placing ' + $x.Rel + ' failed after ' + ($linked + $copied) + ' files: ' + $_.Exception.Message) }
$lines[0] = $whole
Write-LayoutRecord $recDir $true
# Each placed file stamped with the sha256 files.txt has for it, which this
# run worked out from the copy it placed: no file is read for it. Written
# only once the layout is whole, so a stop part way leaves none, and the
# next run reads every file it takes out.
$placedNow = @{}
foreach ($x in $placed) { Set-HashStamp $placedNow $x.Rel (Join-Path $Game $x.Rel) $x.Sha256 }
Save-HashStamps (Join-Path $recDir 'placed.tsv') $placedNow
$script:Changed = ''
Remove-Tree $script:Work; $script:Work = ''

Head 'Done'
Say ('  revision ' + $Revision + ' of ' + $Slug + ': ' + $placed.Count + ' files (' + $linked + ' linked from the unpacked archives, ' + $copied + ' copied), ' + $order.Count + ' plugins') 'Green'
Say ('  ' + $recDir + '\layout.json, files.txt, plugins.txt, loadorder.txt')
Say '  Next: check a draft on Dev before publishing. For a new published revision, follow docs/COLLECTION-REVISIONS.md to update the records and rebuild content.'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
