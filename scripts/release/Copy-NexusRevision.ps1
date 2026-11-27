<#
.SYNOPSIS
  Copies a published revision of one Thornswood collection on Nexus Mods into another, as that collection's next revision, and publishes it; with -New it makes the Dev collection from it (#7193).

.DESCRIPTION
  Copies a published revision of one Thornswood collection on Nexus Mods into
  another, as that collection's next revision, and publishes it; with -New it
  makes the Dev collection from it (#7193).

      pwsh scripts/release/Copy-NexusRevision.ps1 -Slug 7essxf -Revision 13 -New -WhatIf
      pwsh scripts/release/Copy-NexusRevision.ps1 -Slug 7essxf -Revision 13 -New
      pwsh scripts/release/Copy-NexusRevision.ps1 -Slug <dev slug> -Revision 2 -To 7essxf -Number 14

  WHY. Until 27 November 2026 main and Dev had one collection, 7essxf. Every
  merged mod change published its next revision there for Dev, and Vortex
  offered it to everybody on main as an update straight away, before main ran
  it: revision 13 was out on 27 November while main ran 12, and testers on
  main kept taking it. One machine could not keep main and Dev on two
  revisions either. So Dev has a collection of its own, where every merged
  change is published, and main's collection takes the same revision only
  when the build that carries it is promoted to main.

  WHAT A COPY IS. The archive of the source revision, downloaded from Nexus
  with the key, with every entry, patch, rule and file as it is. Only the
  page's text, the name and the summary are those of the collection it goes
  to, from records\collection-page.json (its "dev" name and summary for the
  Dev collection, the one records\collection.json's "dev" names), written by nexus-collection.js --copy, which stops on any
  other change. The new archive is held to the same files and folders as the
  source's before it goes up, and every mod in it to what its page allows
  (collection-permissions.js), as a publish of New-NexusRevision.ps1 is.

  WHERE IT GOES. -To names the collection; it has to have no draft waiting,
  because Nexus keeps one draft at a time. -Number is the revision number the
  copy has to become there, and the run stops before it writes when that is
  not the next: promote-main.yml copies Dev's revisions to main's collection
  in order, so main's revision for each is known when the build is made. -New
  makes a new collection, the Dev collection, whose first revision is this
  one; the run prints its slug.

  A collection Nexus publishes into has to have a category: the new
  collection, and one -To names that has none, is given the source's
  (PATCH /v3/collections/<id>) before the publish. Then the revision is
  published (publishRevision) and read back as the collection's newest. A revision copied from one already published is not
  checked again as a draft would be: it is the same revision.

  Last line, for a workflow to read:
      copied <slug> <revision> to <slug> <revision>

  tests\test-7193-copy-revision.ps1 runs it against the stand-in Nexus.

.PARAMETER Slug
  The collection the revision is copied from. 7essxf unless said otherwise.

.PARAMETER Revision
  The published revision of -Slug that is copied. Its newest unless said.

.PARAMETER To
  The collection it is copied into.

.PARAMETER New
  Makes a new collection from it instead, the Dev collection.

.PARAMETER Number
  The revision number it has to become in -To. Any other number stops the
  run before anything is written.

.PARAMETER PageRecord
  records\collection-page.json unless said otherwise.

.PARAMETER Permissions
  What each mod's page allows: records\collection-permissions.json unless
  said otherwise.

.PARAMETER CollectionRecord
  records\collection.json unless said otherwise, whose "dev" names the Dev
  collection.

.PARAMETER Game
  The game's domain on Nexus. skyrimspecialedition unless said otherwise.

.PARAMETER WaitSeconds
  How long to wait for Nexus to process the upload. 600 unless said otherwise.

.PARAMETER WhatIf
  Downloads and builds everything and says each write it would make. Writes
  nothing to Nexus.

.PARAMETER NoPause
  Does not wait for Enter at the end or on a stop.
#>
[CmdletBinding()]
param(
  [string]$Slug = '7essxf',
  [int]$Revision = 0,
  [string]$To = '',
  [switch]$New,
  [int]$Number = 0,
  [string]$PageRecord,
  [string]$Permissions,
  [string]$CollectionRecord,
  [string]$Game = 'skyrimspecialedition',
  [int]$WaitSeconds = 600,
  [switch]$WhatIf,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Nexus.ps1')
. (Join-Path $Here 'Read-JsonFile.ps1')

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
if (-not $PageRecord) { $PageRecord = Join-Path $Here '..\..\records\collection-page.json' }
if (-not $CollectionRecord) { $CollectionRecord = Join-Path $Here '..\..\records\collection.json' }
if (-not $Permissions) { $Permissions = Join-Path $Here '..\..\records\collection-permissions.json' }

# A program run with its output kept apart from its errors (as
# New-NexusRevision.ps1 runs 7-Zip and node).
function Invoke-Tool([string]$exe, [string[]]$arguments, [string]$cwd = '') {
  $q = @($arguments | ForEach-Object { '"' + (($_ -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"' })
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe; $psi.Arguments = ($q -join ' ')
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  if ($cwd) { $psi.WorkingDirectory = $cwd }
  $p = [Diagnostics.Process]::Start($psi)
  $err = $p.StandardError.ReadToEndAsync()
  $out = $p.StandardOutput.ReadToEnd()
  $p.WaitForExit()
  return [pscustomobject]@{ Code = $p.ExitCode; Out = $out; Err = $err.Result }
}
function Get-ArchivePaths([string]$sz, [string]$archive) {
  $r = Invoke-Tool $sz @('l', '-slt', $archive)
  if ($r.Code -ne 0) { throw ('7-Zip could not list ' + $archive + ': ' + $r.Err.Trim()) }
  $after = $false
  $paths = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($r.Out -split "`r?`n")) {
    if ($line -eq '----------') { $after = $true; continue }
    if ($after -and $line.StartsWith('Path = ')) { $paths.Add($line.Substring(7).Replace('/', '\')) }
  }
  return @($paths | Sort-Object)
}
function Read-Collection([string]$slug, [string]$what) {
  $q = '{ collection(slug: "' + $slug + '", domainName: "' + $Game + '") { id name category { id name } latestPublishedRevision { id revisionNumber } draftRevisionNumber } }'
  $c = Get-NexusField (Step { Invoke-NexusGraph $q $null ('Reading collection ' + $slug + $what) }) 'collection'
  if (-not [string](Get-NexusField $c 'id')) { Die ('Nexus has no collection ' + $slug + ' on ' + $Game + '.') }
  return $c
}

Write-Host ''
Write-Host '  THORNSWOOD  -  a collection revision copied to another collection' -ForegroundColor White
if ($WhatIf) { Say '  -WhatIf: reads only, and says what it would write.' 'Yellow' }
foreach ($s in @($Slug) + @($(if ($To) { $To }))) { if ($s -notmatch '^[a-z0-9]+$') { Die ($s + ' is not a collection slug.') } }
if ($Game -notmatch '^[a-z0-9]+$') { Die ('-Game ' + $Game + ' is not a game domain.') }
if ([bool]$New -eq [bool]$To) { Die 'Say where the revision goes: -To <slug> for a collection there is, or -New for the Dev collection.' }
if ($To -eq $Slug) { Die ('-To is ' + $To + ', the collection it is copied from.') }
if ($New -and $Number -gt 1) { Die ('A new collection''s first revision is revision 1, not ' + $Number + '.') }
if (-not (Test-Path -LiteralPath $PageRecord -PathType Leaf)) { Die ('There is no page record at ' + $PageRecord + '.') }
$page = Step { ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($PageRecord)) $PageRecord }
# The Dev collection's name and summary are the page's "dev"; the Dev
# collection is the one records\collection.json's "dev" names, and any other
# a copy goes to is main's.
$channel = 'main'
if ($New) { $channel = 'dev' }
elseif (Test-Path -LiteralPath $CollectionRecord) {
  $rec = Step { ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($CollectionRecord)) $CollectionRecord }
  if ($rec.PSObject.Properties['dev'] -and $rec.dev -and [string]$rec.dev.collection -eq $To) { $channel = 'dev' }
}
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die 'node is not on this machine, and nexus-collection.js writes collection.json the way Vortex does.' }
$sz = Find-SevenZip
if (-not $sz) { Die ('7-Zip is not on this machine (it looked for ' + (Get-SevenZipLooked) + '), and the collection is a 7z archive.') }
[void](Step { Read-NexusKey })
Say ('  key from ' + $script:NexusKeyFrom) 'DarkGray'

# ---------------------------------------------------------- the source ---
$src = Read-Collection $Slug ''
$latest = [int](Get-NexusField (Get-NexusField $src 'latestPublishedRevision') 'revisionNumber')
if (-not $Revision) { $Revision = $latest }
if ($Revision -lt 1 -or $Revision -gt $latest) { Die ('Revision ' + $Revision + ' of ' + $Slug + ' is not published: its newest is ' + $latest + '.') }
Head ('From ' + $Slug + ' revision ' + $Revision)
Say ('  "' + (Get-NexusField $src 'name') + '", id ' + (Get-NexusField $src 'id') + ', revision ' + $latest + ' its newest')
$srcCat = Get-NexusField $src 'category'
$srcCatId = if ($srcCat) { [int](Get-NexusField $srcCat 'id') } else { 0 }
$srcCatName = if ($srcCat) { [string](Get-NexusField $srcCat 'name') } else { '' }

# ---------------------------------------------------------- the target ---
$targetId = ''
$next = 1
$dstCatId = 0
if ($To) {
  $dst = Read-Collection $To ''
  $targetId = [string](Get-NexusField $dst 'id')
  $draft = Get-NexusField $dst 'draftRevisionNumber'
  $tl = Get-NexusField $dst 'latestPublishedRevision'
  $tLatest = if ($tl) { [int](Get-NexusField $tl 'revisionNumber') } else { 0 }
  if ($draft) { Die ('Revision ' + $draft + ' of ' + $To + ' is a draft waiting, and Nexus keeps one draft at a time. Publish or discard it first (New-NexusRevision.ps1 -Slug ' + $To + ' -Publish or -Discard ' + $draft + ').') }
  $next = $tLatest + 1
  $dc = Get-NexusField $dst 'category'
  if ($dc) { $dstCatId = [int](Get-NexusField $dc 'id') }
  Head ('To ' + $To + ' revision ' + $next)
  Say ('  "' + (Get-NexusField $dst 'name') + '", id ' + $targetId + ', revision ' + $tLatest + ' its newest, no draft; the ' + $channel + ' collection')
}
else { Head 'To a new collection, the Dev collection, as its revision 1' }
# Nexus publishes no revision of a collection without a category (#7193), and
# one made here has none, so it takes the source's, as one -To has none does.
$giveCategory = -not $dstCatId
if ($giveCategory -and -not $srcCatId) { Die ($Slug + ' has no category to give ' + $(if ($To) { $To } else { 'the new collection' }) + ', and Nexus publishes no revision of a collection without one. Nothing was copied.') }
if ($Number -and $Number -ne $next) { Die ('The copy would be revision ' + $next + ' of ' + $(if ($To) { $To } else { 'the new collection' }) + ', and -Number says it has to be ' + $Number + '. Nothing was copied.') }

# ------------------------------------------------------------ the copy ---
$scratch = & (Join-Path $Here 'Get-ScratchDir.ps1') ('nexus-copy-' + $Slug + '-' + $Revision)
$base = Join-Path $scratch 'base'; $build = Join-Path $scratch 'build'; $outDir = Join-Path $scratch 'out'; $dl = Join-Path $scratch 'download'
foreach ($d in $base, $build, $outDir, $dl) {
  if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
$got = Step { Receive-NexusRevisionArchive $Slug $Game $Revision $dl }
if ($got.Status -ne 'published') { Die ('Revision ' + $Revision + ' of ' + $Slug + ' is ' + $got.Status + ', not published, and only a published revision is copied.') }
Say ('  ' + $got.Path + ', ' + $got.Size.ToString('N0') + ' bytes, md5 ' + $got.Md5Hex)
$r = Invoke-Tool $sz @('x', '-y', ('-o' + $base), $got.Path)
if ($r.Code -ne 0) { Die ('7-Zip could not unpack revision ' + $Revision + ': ' + $r.Err.Trim()) }
$basePaths = @(Step { Get-ArchivePaths $sz $got.Path })
$baseJson = Join-Path $base 'collection.json'
if (-not (Test-Path -LiteralPath $baseJson)) { Die ('Revision ' + $Revision + '''s archive has no collection.json at its top, so it is not a collection Vortex made.') }
Copy-Item -Path (Join-Path $base '*') -Destination $build -Recurse -Force
$payloadJson = Join-Path $scratch 'payload.json'
$r = Invoke-Tool $node.Source @((Join-Path $Here 'nexus-collection.js'), '--copy', $baseJson, (Resolve-Path -LiteralPath $PageRecord).Path, $channel, (Join-Path $build 'collection.json'), $payloadJson)
if ($r.Code -ne 0) { Die ($r.Err.Trim() + ' Nothing was built.') }
$name = (($r.Out -split "`r?`n") | Where-Object { $_.StartsWith("copy`tname`t") } | Select-Object -First 1)
if ($name) { $name = $name.Substring(10) }
Say ('  named "' + $name + '", with the page''s text for the ' + $channel + ' collection')

$pr = Invoke-Tool $node.Source @((Join-Path $Here 'collection-permissions.js'), 'check', '--record', $Permissions, (Join-Path $build 'collection.json'))
if ($pr.Code -ne 0) { Die ('A mod in revision ' + $Revision + ' may not go out by ' + (Split-Path -Leaf $Permissions) + ': ' + ($pr.Out + $pr.Err).Trim()) }
Say '  every mod in it is ours or its page allows it in a collection' 'Green'

$out = Join-Path $outDir ('collection_' + $next + '.7z')
$tops = @(Get-ChildItem -LiteralPath $build -Force | ForEach-Object { $_.Name })
$r = Invoke-Tool $sz (@('a', '-t7z', '-y', $out) + $tops) $build
if ($r.Code -ne 0) { Die ('7-Zip could not pack the copy: ' + $r.Err.Trim()) }
$newPaths = @(Step { Get-ArchivePaths $sz $out })
$gone = @($basePaths | Where-Object { $newPaths -notcontains $_ })
$extra = @($newPaths | Where-Object { $basePaths -notcontains $_ })
if ($gone.Count -or $extra.Count) { Die ('The copy does not hold the same files and folders as revision ' + $Revision + ' (missing: ' + ($gone -join ', ') + '; extra: ' + ($extra -join ', ') + '). Nothing was sent.') }
$facts = Step { Get-NexusArchiveFacts $out }
Say ('  ' + $out + ', ' + $facts.Size.ToString('N0') + ' bytes, md5 ' + $facts.Md5Hex + ', the same ' + $newPaths.Count + ' files and folders')
$payloadText = ([IO.File]::ReadAllText($payloadJson)).Trim()
$path = if ($To) { '/v3/collections/' + $targetId + '/revisions' } else { '/v3/collections' }

if ($WhatIf) {
  Head 'What it would write'
  Say ('  POST /v3/uploads  {"size_bytes":' + $facts.Size + ',"filename":"' + $facts.Name + '","md5":"' + $facts.Md5Hex + '"}, the archive to the address it gives, finalise, wait until available')
  Say ('  POST ' + $path + '  {"upload_id":"<that upload>","collection_data":<' + $payloadText.Length + ' characters, in ' + $payloadJson + '>}')
  if ($giveCategory) { Say ('  PATCH /v3/collections/' + $(if ($To) { $targetId } else { '<its id>' }) + '  {"category_id":' + $srcCatId + '}, ' + $Slug + '''s category "' + $srcCatName + '"') }
  Say '  then the GraphQL mutation publishRevision on the revision it makes'
  Write-Host ''
  Say 'Nothing was written to Nexus.' 'Green'
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

Head 'Uploading'
$up = Step { Send-NexusUpload $facts { param($line) Say ('  ' + $line) } $WaitSeconds }
$script:Done.Add('upload ' + $up + ' is processed and available, attached to nothing')
$body = '{"upload_id":' + (ConvertTo-Json $up) + ',"collection_data":' + $payloadText + '}'
$made = Get-NexusField (Step { Invoke-NexusApi 'POST' $path $body $(if ($To) { 'Making revision ' + $next + ' of ' + $To } else { 'Making the Dev collection' }) }) 'data'
$script:Done.Clear()
$toSlug = if ($To) { $To } else { [string](Get-NexusField $made 'slug') }
$num = [int](Get-NexusField $made 'revision_number')
$revId = [string]$(if ($To) { Get-NexusField $made 'id' } else { Get-NexusField $made 'revision_id' })
if (-not $To) { $script:Done.Add('collection ' + $toSlug + ' made (id ' + (Get-NexusField $made 'id') + ')') }
$script:Done.Add('revision ' + $num + ' of ' + $toSlug + ' made as ' + (Get-NexusField $made 'revision_status') + ' (id ' + $revId + ')')
if ($toSlug -notmatch '^[a-z0-9]+$' -or -not $revId) { Die ('Nexus answered without a slug and revision id this can read (slug "' + $toSlug + '", revision id "' + $revId + '").') }
if ($num -ne $next) { Die ('Nexus numbered the copy ' + $num + ', not ' + $next + ', so it was left a draft. Discard it (New-NexusRevision.ps1 -Slug ' + $toSlug + ' -Discard ' + $num + ') and find what else made a revision there.') }

if ($giveCategory) {
  $catOf = if ($To) { $targetId } else { [string](Get-NexusField $made 'id') }
  Step { Set-NexusCollectionCategory $catOf $srcCatId ('Giving ' + $toSlug + ' ' + $Slug + '''s category') }
  $script:Done.Add($toSlug + ' given ' + $Slug + '''s category "' + $srcCatName + '" (' + $srcCatId + ')')
  Say ('  ' + $toSlug + ' has ' + $Slug + '''s category, "' + $srcCatName + '"')
}
$mut = 'mutation publishRevision($revisionId: ID!) { publishRevision(revisionId: $revisionId) { success } }'
$res = Step { Invoke-NexusGraph $mut ([ordered]@{ revisionId = $revId }) ('Publishing revision ' + $num + ' of ' + $toSlug) }
if ((Get-NexusField (Get-NexusField $res 'publishRevision') 'success') -ne $true) { Die ('Nexus answered the publish of revision ' + $num + ' of ' + $toSlug + ' without saying it succeeded. Look at the collection''s page before running this again.') }
$script:Done.Add('revision ' + $num + ' of ' + $toSlug + ' published')
$now = Read-Collection $toSlug ' again'
$nowLatest = [int](Get-NexusField (Get-NexusField $now 'latestPublishedRevision') 'revisionNumber')
if ($nowLatest -ne $num) { Die ('Nexus said the publish succeeded, but the newest published revision of ' + $toSlug + ' still reads as ' + $nowLatest + '.') }
Head 'Done'
Say ('  ' + $Slug + ' revision ' + $Revision + ' is ' + $toSlug + ' revision ' + $num + ', published: https://www.nexusmods.com/games/' + $Game + '/collections/' + $toSlug) 'Green'
Write-Host ''
Write-Host ('copied ' + $Slug + ' ' + $Revision + ' to ' + $toSlug + ' ' + $num)
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
