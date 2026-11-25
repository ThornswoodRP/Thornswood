<#
  Send-NexusFile.ps1

  Uploads a new version of one of our files on Nexus Mods, in place of the
  version it has now, from a local archive (#2914).

      .\scripts\release\Send-NexusFile.ps1 -Mod 192762 -Archive <the .7z or .zip> -Version 1.0.1 -WhatIf
      .\scripts\release\Send-NexusFile.ps1 -Mod 192762 -Archive <the .7z or .zip> -Version 1.0.1 -UpdateModVersion

  WHY. Until 20 October Patrick did this by hand on the website for
  Thornswood Content (mod 192001) and the Thornswood Client Runtime (mod
  192762), both on skyrimspecialedition. This does it with his API key
  (Nexus.ps1 says where the key is read from and where it is sent), so the
  release desk runs it, on One or in a cloud session. The first use is the
  Client Runtime 1.0.1 upload for #421.

  WHAT IT DOES, in the order of the v3 API (https://api.nexusmods.com/openapi.yaml,
  read on 20 October; Nexus's own upload action does the same steps):
    1. reads the mod (GET /v3/games/<game>/mods/<mod>), its files
       (GET /v3/mods/<id>/files) and each file's versions
       (GET /v3/mod-files/<id>/versions), and picks the file to add a version
       to: the one -File names, by the file id the website shows or by the
       file's name, or the only file the mod has;
    2. refuses before anything is written when the version string is already
       on that file, when the name or version has a character Nexus refuses,
       or when the archive's name cannot go in the upload header;
    3. uploads the archive: POST /v3/uploads with its size and md5, the bytes
       to the address Nexus gives back with Content-MD5, then finalise
       (POST /v3/uploads/<id>/finalise), then waits until GET /v3/uploads/<id>
       says available. Above 100 MiB the upload has to be multipart, which
       cannot carry an md5; the parts go up bound to the file's
       CRC-64/NVME instead, the integrity check that path offers;
    4. makes the new version (POST /v3/mod-files/<id>/versions) with the
       name, the version, the category the newest version has now, and
       archive_existing_file, so the version it replaces moves to Archived
       (-KeepOldVersion leaves it where it is); mod manager downloads stay on,
       because the collection installs through Vortex, and it stays the
       primary mod manager download when the version it replaces was;
    5. reads the new version back (GET /v3/mod-file-versions/<id>) and prints
       its file id, the archive's size and its md5, which is what the
       collection revision and THIRD-PARTY.md need next;
    6. with -Changelog, adds the text to the mod's changelog for that version
       (POST /v3/mods/<id>/changelogs).

  -WhatIf does every read in 1 and 2, works out the md5, and prints each
  write it would make with its body, then stops. Nothing is written.

  WHEN A STEP FAILS it stops with a sentence that says what failed and what is
  on Nexus because of this run. Nothing is tried again. An upload that is
  still being processed when the wait runs out can be carried on with
  -UploadId and the same arguments; nothing was made from it yet.

  First real run 20 October (Client Runtime 1.0.1, #421): it stopped at the
  multipart complete, which the storage refuses with the checksum header the
  spec asks for; see Send-NexusUpload in Nexus.ps1.

.PARAMETER Mod
  The mod's number on the website, as in nexusmods.com/skyrimspecialedition/mods/192762.

.PARAMETER Game
  The game's domain on Nexus. skyrimspecialedition unless said otherwise.

.PARAMETER File
  Which file of the mod gets the new version: a file id the website shows
  for any version of it (the number in ?file_id=), the file's id in the v3
  API, or the file's name. Left out when the mod has one file.

.PARAMETER Archive
  The local archive to upload.

.PARAMETER Version
  The new version's version string, letters, digits, dots and dashes.

.PARAMETER Name
  The new version's name. The file's name as it is now unless said otherwise.

.PARAMETER Category
  main, optional or miscellaneous. The category the newest version has now
  unless said otherwise.

.PARAMETER Description
  The new version's description on the Files tab.

.PARAMETER Changelog
  Text added to the mod's changelog for this version.

.PARAMETER UpdateModVersion
  Also sets the mod's own version to this one (update_mod_version).

.PARAMETER KeepOldVersion
  Leaves the version this replaces where it is instead of archiving it.

.PARAMETER UploadId
  Carries on from an upload already sent and finalised: waits for it and
  makes the version from it.

.PARAMETER WaitSeconds
  How long to wait for Nexus to process the upload. 600 unless said otherwise.

.PARAMETER WhatIf
  Reads everything and says each write it would make. Writes nothing.

.PARAMETER NoPause
  Does not wait for Enter at the end or on a stop.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Mod,
  [string]$Game = 'skyrimspecialedition',
  [string]$File,
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Name,
  [ValidateSet('', 'main', 'optional', 'miscellaneous')][string]$Category = '',
  [string]$Description,
  [string]$Changelog,
  [switch]$UpdateModVersion,
  [switch]$KeepOldVersion,
  [string]$UploadId,
  [int]$WaitSeconds = 600,
  [switch]$WhatIf,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Nexus.ps1')

# What this run has changed on Nexus so far, said with every stop.
$script:Done = New-Object System.Collections.Generic.List[string]

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if ($script:Done.Count) { Write-Host ('On Nexus from this run: ' + ($script:Done -join '; ') + '.') -ForegroundColor Yellow }
  else { Write-Host 'Nothing was changed on Nexus.' -ForegroundColor Yellow }
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}
function Step([scriptblock]$b) { try { return (& $b) } catch { Die $_.Exception.Message } }

Write-Host ''
Write-Host '  THORNSWOOD  -  a new file version on Nexus Mods' -ForegroundColor White
if ($WhatIf) { Say '  -WhatIf: reads only, and says what it would write.' 'Yellow' }

# ------------------------------------------------- refused before any read ---
# The patterns are CreateModFileVersionRequest's own.
if ($Mod -notmatch '^\d+$') { Die ('-Mod is the number in the mod''s address, as 192762; ' + $Mod + ' is not one.') }
if ($Version.Length -gt 50 -or $Version -notmatch '^[a-zA-Z0-9.-]+$') { Die ('-Version ' + $Version + ' is not a version Nexus takes: letters, digits, dots and dashes, at most 50.') }
if ($Name -and ($Name.Length -gt 50 -or $Name -notmatch "^[a-zA-Z0-9 _'().-]+$")) { Die ('-Name ' + $Name + ' is not a name Nexus takes: letters, digits, spaces and _ '' ( ) . - only, at most 50.') }
if ($WaitSeconds -lt 1) { Die '-WaitSeconds has to be at least 1.' }
$facts = Step { Get-NexusArchiveFacts $Archive }
[void](Step { Read-NexusKey })

Head 'The archive'
Say ('  ' + $facts.Path)
Say ('  ' + $facts.Size.ToString('N0') + ' bytes, md5 ' + $facts.Md5Hex)
Say ('  key from ' + $script:NexusKeyFrom) 'DarkGray'

# ---------------------------------------------------------------- reads ---
Head 'On Nexus now'
$modInfo = Step { Get-NexusField (Invoke-NexusApi 'GET' ('/v3/games/' + $Game + '/mods/' + $Mod) '' ('Reading mod ' + $Mod)) 'data' }
$modUid = [string](Get-NexusField $modInfo 'id')
if (-not $modUid) { Die ('Nexus answered for mod ' + $Mod + ' without its id.') }
Say ('  mod ' + $Mod + ', ' + (Get-NexusField $modInfo 'name') + ' (id ' + $modUid + ')')
$files = @(@(Get-NexusField (Get-NexusField (Step { Invoke-NexusApi 'GET' ('/v3/mods/' + $modUid + '/files') '' ('Reading the files of mod ' + $Mod) }) 'data') 'mod_files') | Where-Object { $_ })
if (-not $files.Count) { Die ('Mod ' + $Mod + ' has no files on Nexus, so there is nothing to add a version to. A first file is made on the website.') }

$byFile = @{}
foreach ($f in $files) {
  $fid = [string](Get-NexusField $f 'id')
  $vs = @(@(Get-NexusField (Get-NexusField (Step { Invoke-NexusApi 'GET' ('/v3/mod-files/' + $fid + '/versions') '' ('Reading the versions of file ' + (Get-NexusField $f 'name')) }) 'data') 'versions') | Where-Object { $_ })
  $byFile[$fid] = $vs
}
function Latest($vs) {
  $live = @($vs | Where-Object { @('removed', 'archived') -notcontains [string](Get-NexusField $_ 'category') })
  if (-not $live.Count) { $live = @($vs) }
  return ($live | Sort-Object { [DateTimeOffset](Get-NexusField $_ 'uploaded_at') } | Select-Object -Last 1)
}
function Describe($f) {
  $l = Latest $byFile[[string](Get-NexusField $f 'id')]
  if (-not $l) { return ('  "' + (Get-NexusField $f 'name') + '", id ' + (Get-NexusField $f 'id') + ', no versions') }
  return ('  "' + (Get-NexusField $f 'name') + '", id ' + (Get-NexusField $f 'id') + ', newest ' + (Get-NexusField $l 'version') + ' as file id ' + (Get-NexusField $l 'game_scoped_id') + ' (' + (Get-NexusField $l 'category') + ')')
}

$target = $null
if ($File) {
  $hits = @($files | Where-Object {
      $fid = [string](Get-NexusField $_ 'id')
      $fid -eq $File -or ([string](Get-NexusField $_ 'name')) -ieq $File -or @($byFile[$fid] | Where-Object { [string](Get-NexusField $_ 'game_scoped_id') -eq $File }).Count
    })
  if ($hits.Count -ne 1) {
    $why = if ($hits.Count) { 'more than one file of mod ' + $Mod + ' answers to "' + $File + '"' } else { 'no file of mod ' + $Mod + ' answers to "' + $File + '"' }
    Write-Host ''; foreach ($f in $files) { Say (Describe $f) }
    Die ($why + '. Its files are listed above; give -File one of their ids or names.')
  }
  $target = $hits[0]
}
elseif ($files.Count -eq 1) { $target = $files[0] }
else {
  Write-Host ''; foreach ($f in $files) { Say (Describe $f) }
  Die ('Mod ' + $Mod + ' has ' + $files.Count + ' files, listed above. Say which one gets the new version with -File.')
}

$fileUid = [string](Get-NexusField $target 'id')
$versions = @($byFile[$fileUid])
$latest = Latest $versions
Say ('  file "' + (Get-NexusField $target 'name') + '", id ' + $fileUid + ', ' + $versions.Count + ' versions')
if ($latest) { Say ('  newest: ' + (Get-NexusField $latest 'version') + ', file id ' + (Get-NexusField $latest 'game_scoped_id') + ', ' + (Get-NexusField $latest 'category') + ', uploaded ' + (Get-NexusField $latest 'uploaded_at')) }

$clash = @($versions | Where-Object { ([string](Get-NexusField $_ 'version')) -ieq $Version })
if ($clash.Count) { Die ('Version ' + $Version + ' is already on that file, as file id ' + (Get-NexusField $clash[0] 'game_scoped_id') + '. Give the new one a version of its own.') }

if (-not $Name) { $Name = [string](Get-NexusField $target 'name') }
if ($Name.Length -gt 50 -or $Name -notmatch "^[a-zA-Z0-9 _'().-]+$") { Die ('The file''s name, ' + $Name + ', is not one Nexus takes for a version; give one with -Name.') }
if (-not $Category) {
  $Category = [string](Get-NexusField $latest 'category')
  if (@('main', 'optional', 'miscellaneous') -notcontains $Category) { Die ('The newest version is in "' + $Category + '", which a new version cannot be; say main, optional or miscellaneous with -Category.') }
}

$ver = [ordered]@{
  upload_id                 = '(the upload above)'
  name                      = $Name
  version                   = $Version
  file_category             = $Category
  archive_existing_file     = (-not $KeepOldVersion)
  update_mod_version        = [bool]$UpdateModVersion
  allow_mod_manager_download = $true
}
if ($latest -and (Get-NexusField $latest 'is_primary') -eq $true) { $ver.primary_mod_manager_download = $true }
if ($Description) { $ver.description = $Description }

# --------------------------------------------------------------- writes ---
if ($WhatIf) {
  Head 'What it would write'
  if ($UploadId) { Say ('  carry on from upload ' + $UploadId + ': wait for it with GET /v3/uploads/' + $UploadId) }
  elseif ($facts.Size -le $script:NexusSinglePartMax) {
    Say ('  POST /v3/uploads  {"size_bytes":' + $facts.Size + ',"filename":"' + $facts.Name + '","md5":"' + $facts.Md5Hex + '"}')
    Say ('  PUT the ' + $facts.Size.ToString('N0') + ' bytes to the address it gives, with Content-MD5 ' + $facts.Md5Base64 + ' and Content-Disposition attachment; filename="' + $facts.Name + '"')
  }
  else {
    Say ('  POST /v3/uploads/multipart  {"size_bytes":' + $facts.Size + ',"filename":"' + $facts.Name + '","crc64nvme":"<worked out when it runs>"}')
    Say '  PUT each part to the addresses it gives, then POST the parts list to its complete address'
  }
  if (-not $UploadId) { Say '  POST /v3/uploads/<id>/finalise, then GET /v3/uploads/<id> until it says available' }
  Say ('  POST /v3/mod-files/' + $fileUid + '/versions  ' + ($ver | ConvertTo-Json -Compress))
  if ($latest -and -not $KeepOldVersion) { Say ('  which archives ' + (Get-NexusField $latest 'version') + ' (file id ' + (Get-NexusField $latest 'game_scoped_id') + ')') }
  if ($Changelog) { Say ('  POST /v3/mods/' + $modUid + '/changelogs  ' + ([ordered]@{ version = $Version; changelog = $Changelog } | ConvertTo-Json -Compress)) }
  Write-Host ''
  Say 'Nothing was written. Run it again without -WhatIf to make the upload.' 'Green'
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

Head 'Uploading'
$said = { param($line) Say ('  ' + $line) }
if ($UploadId) {
  Say ('  carrying on from upload ' + $UploadId)
  $asked = Step { Wait-NexusUpload $UploadId $WaitSeconds }
  Say ('  available, after ' + $asked + ' asks')
  $up = $UploadId
}
else {
  $up = Step { Send-NexusUpload $facts $said $WaitSeconds }
}
$script:Done.Add('upload ' + $up + ' is processed and available, attached to nothing')

Head 'The new version'
$ver.upload_id = $up
$made = Step { Invoke-NexusApi 'POST' ('/v3/mod-files/' + $fileUid + '/versions') ($ver | ConvertTo-Json -Compress) ('Making version ' + $Version + ' of "' + $Name + '"') }
$newVid = [string](Get-NexusField (Get-NexusField (Get-NexusField $made 'data') 'version') 'id')
if (-not $newVid) { Die ('Nexus answered the new version without its id, so it cannot be read back. Look at the mod''s Files tab: version ' + $Version + ' may be there.') }
$script:Done.Clear()
$script:Done.Add('version ' + $Version + ' of "' + $Name + '" made from upload ' + $up + ' (version id ' + $newVid + ')')
if ($latest -and -not $KeepOldVersion) { $script:Done.Add((Get-NexusField $latest 'version') + ' archived') }
$back = Step { Get-NexusField (Invoke-NexusApi 'GET' ('/v3/mod-file-versions/' + $newVid) '' 'Reading the new version back') 'data' }
$newFileId = [string](Get-NexusField $back 'game_scoped_id')
Say ('  ' + (Get-NexusField $back 'name') + ' ' + (Get-NexusField $back 'version') + ', ' + (Get-NexusField $back 'category'))

if ($Changelog) {
  [void](Step { Invoke-NexusApi 'POST' ('/v3/mods/' + $modUid + '/changelogs') ([ordered]@{ version = $Version; changelog = $Changelog } | ConvertTo-Json -Compress) ('Adding the changelog for ' + $Version) })
  $script:Done.Add('changelog added for ' + $Version)
  Say '  changelog added'
}

Head 'Done'
Say ('  File id  ' + $newFileId) 'Green'
Say ('  Size     ' + $facts.Size + ' bytes') 'Green'
Say ('  md5      ' + $facts.Md5Hex) 'Green'
Say ('  https://www.nexusmods.com/' + $Game + '/mods/' + $Mod + '?tab=files&file_id=' + $newFileId)
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
