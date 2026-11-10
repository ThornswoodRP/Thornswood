<#
  test-collection-newest.ps1

      pwsh -NoProfile -File .\tests\test-collection-newest.ps1

  The two revision numbers the deploy gate stands on, both read out of Vortex's
  own state.v2: the newest Vortex KNOWS is out (Get-CollectionNewest), and the
  revision this machine HAS installed (Get-CollectionRevision). The newest half
  silently went blind on 22 September; the installed half went blind on
  27 September, because current Vortex stopped naming the mod folder for the
  collection and the folder-name reader could no longer find a number.

  WHAT HAPPENED ON 22 SEPTEMBER. Get-CollectionNewest only knew ONE shape, the
  transition text "newestVersion","from":"3","to":"4". The moment the old
  ombo2a collection's revision 5 was installed there was no transition left,
  the regex matched nothing, and
  the function answered 0. Behind is false when either number is unknown, so
  the gate that had been added the day before to stop a stale collection
  reaching the server passed without checking anything. The fix then was a
  second regex for the plain value, measured off that machine's state.v2:

      6E 65 77 65 73 74 56 65 72 73 69 6F 6E 03 22 35 22
      n  e  w  e  s  t  V  e  r  s  i  o  n  len "  5  "

  WHAT HAPPENED AGAIN, #1902. Both regexes read state.v2 as raw bytes, and
  state.v2 is a LevelDB database. The bytes above are what its write-ahead log
  holds. Once Vortex compacts the log into a table, a key shares its start
  with the key before it and the block is snappy compressed, so neither regex
  matched. Newest fell to the installed revision, which is its floor, and
  Behind read false with a newer revision known. The same went for the mod ids
  that find the collection's folder, so Check-CollectionRules skipped the
  installed collection.

  Since #1582 (the installed half) and #1902 (the newest half and the mod ids)
  all of it is read by launcher\app\VortexProfileState.cs, which reads CURRENT,
  the manifest it names, the tables and the log, with sequences, deletions and
  checksums. So every case here is a LevelDB folder written by
  tests\fixtures\vortex-state-rows.py, the writer the reader's own fixtures
  use, and the keys sit in the compressed table unless a case says otherwise.
  The real functions are pointed at each case through APPDATA, so what is
  under test is what ships.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$LoadOrderPath)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $LoadOrderPath) { $LoadOrderPath = Join-Path $Here 'scripts\mods\LoadOrder.ps1' }
. $LoadOrderPath

$pass = 0; $fail = 0
function Yes($what, $cond) {
  if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
  else       { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-newest-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$state = Join-Path $root 'Vortex\state.v2'
$null = New-Item -ItemType Directory -Force -Path $state
$realAppData = $env:APPDATA

# One row is one flattened key, joined by ###, and the JSON Vortex stores for
# it; $null in the log is the key deleted. The installed revision and
# newestVersion are recorded against the mod, tied to the collection by the
# slug recorded against the same mod id.
$cases = Join-Path $root 'cases'
$spec = [ordered]@{}
function Row([string]$key, $json) { [pscustomobject]@{ key = $key; value = $json } }
function Attr([string]$modId, [string]$name, $valueJson) {
  Row "persistent###mods###skyrimse###$modId###attributes###$name" $valueJson
}
function RevInfo([string]$revId, [string]$slug, [int]$num) {
  Row "persistent###collections###revisions###$revId###info###collection###slug" ('"' + $slug + '"')
  Row "persistent###collections###revisions###$revId###info###revisionNumber" ([string]$num)
}
# Rows in the compressed table are state as Vortex leaves it after compaction;
# rows in the log are a change as Vortex writes it before compaction.
function Case([string]$name, [object[]]$table, [object[]]$log) {
  $spec[$name] = [ordered]@{ table = $table; log = $log }
}
# The same rows both ways: <name> in the table, <name>-log in the log.
function Both([string]$name, [object[]]$rows) {
  Case $name $rows @()
  Case ($name + '-log') @() $rows
}
function Put([string]$name, [byte[]]$bytes) {
  [IO.File]::WriteAllBytes((Join-Path $state $name), $bytes)
}
function Clear-State { Get-ChildItem $state -File | Remove-Item -Force }
function At([string]$case) { $env:APPDATA = Join-Path $cases $case }

$z = 'vortex_collection_ZRT7NjhN_'
$a = 'vortex_collection_AAbb99xx_'
$ombo = 'https://www.nexusmods.com/games/skyrimspecialedition/collections/ombo2a'
$essx = 'https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf'

# The newest half.
Case 'newest-current' @((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '5'), (Attr $z 'newestVersion' '"5"')) @()
Case 'newest-behind' @((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '4'), (Attr $z 'newestVersion' '"5"')) @()
Case 'newest-log-after-table' @((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '4'), (Attr $z 'newestVersion' '"4"')) @(
  Attr $z 'newestVersion' '"5"')
Case 'newest-deleted' @((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '5'), (Attr $z 'newestVersion' '"7"')) @(
  Attr $z 'newestVersion' $null)
Case 'newest-two-digit' @((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '12'), (Attr $z 'newestVersion' '"12"')) @()
Case 'newest-other-mod' @((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '5'), (Attr $z 'newestVersion' '"5"'),
  (Attr 'SkyUI_12604' 'newestVersion' '"99"')) @()
Case 'newest-two-collections' @((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '5'), (Attr $z 'newestVersion' '"5"'),
  (Attr $a 'collectionSlug' '"7essxf"'), (Attr $a 'revisionNumber' '12'), (Attr $a 'newestVersion' '"13"')) @()
Case 'newest-cache' (@((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '5')) + @(RevInfo '796316' 'ombo2a' 6)) @()
Case 'newest-not-a-revision' @((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '5'), (Attr $z 'newestVersion' '"1.2.0"')) @()
Case 'newest-corrupt' @((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '5'), (Attr $z 'newestVersion' '"5"')) @()

# The installed half, and the shapes both halves and the mod ids read.
Case 'installed' @((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '5')) @()
Case 'installed-two' @((Attr $z 'collectionSlug' '"ombo2a"'), (Attr $z 'revisionNumber' '5'),
  (Attr $a 'collectionSlug' '"7essxf"'), (Attr $a 'revisionNumber' '12')) @()
Both 'draft' (@((Attr $z 'collectionSlug' '"7essxf"'), (Attr $z 'revisionNumber' '1')) + @(RevInfo '796316' '7essxf' 1))
Both 'authoring' (@((Attr $z 'newestFileId' '796316'), (Attr $z 'newestVersion' '"1"')) + @(RevInfo '796316' '7essxf' 1))
Both 'slug-only' @(Attr $z 'collectionSlug' '"7essxf"')

try {
  $specPath = Join-Path $root 'cases.json'
  [IO.File]::WriteAllText($specPath, (ConvertTo-Json -InputObject $spec -Depth 6), (New-Object Text.UTF8Encoding($false)))
  & python (Join-Path $Here 'tests\fixtures\vortex-state-rows.py') $cases $specPath
  if ($LASTEXITCODE) { throw 'tests\fixtures\vortex-state-rows.py could not write the cases' }
  # A checksum that does not match is state that cannot be trusted.
  $table = Join-Path $cases 'newest-corrupt\Vortex\state.v2\000001.ldb'
  $bytes = [IO.File]::ReadAllBytes($table); $bytes[0] = $bytes[0] -bxor 1
  [IO.File]::WriteAllBytes($table, $bytes)

  # ---- the newest half, from a compacted table (#1902) ----------------------
  At 'newest-current'
  Yes 'the current newestVersion is read out of a compressed table' ((Get-CollectionNewest 'ombo2a') -eq 5)

  # The case #1902 is about: installed at 4 with Vortex knowing 5 is out.
  # Before it, the table hid the 5, Newest fell to the installed 4, and
  # Behind read false.
  At 'newest-behind'
  $behind = Get-CollectionState $ombo
  Yes 'a newer revision in the table is read: Newest 5 over the installed 4' ($behind.Newest -eq 5 -and $behind.Have -eq 4)
  Yes 'so Behind is true and Known is true' ($behind.Behind -and $behind.Known)

  At 'newest-log-after-table'
  Yes 'a newestVersion written to the log after compaction wins over the table' ((Get-CollectionNewest 'ombo2a') -eq 5)

  # A deleted key is no longer state, and the old value under it in the
  # table does not count. Newest falls to the installed revision.
  At 'newest-deleted'
  Yes 'a newestVersion deleted in the log is not read; the installed 5 is the floor' ((Get-CollectionNewest 'ombo2a') -eq 5)

  At 'newest-two-digit'
  Yes 'two digit revisions read whole, not truncated' ((Get-CollectionNewest 'ombo2a') -eq 12)

  # The raw reader took any newestVersion that was a whole number in quotes,
  # whichever mod it was recorded against.
  At 'newest-other-mod'
  Yes 'another mod''s newestVersion is that mod''s version, not a revision' ((Get-CollectionNewest 'ombo2a') -eq 5)

  At 'newest-two-collections'
  Yes 'ombo2a reads its own newest 5, not the other collection''s 13' ((Get-CollectionNewest 'ombo2a') -eq 5)
  Yes 'and 7essxf reads its own 13' ((Get-CollectionNewest '7essxf') -eq 13)

  At 'newest-cache'
  Yes 'a cached revision of the slug counts as known' ((Get-CollectionNewest 'ombo2a') -eq 6)
  Yes 'and a cached revision of another slug does not' ((Get-CollectionNewest '7essxf') -eq 0)

  At 'newest-not-a-revision'
  Yes 'a newestVersion that is not a whole number is not read as one' ((Get-CollectionNewest 'ombo2a') -eq 5)

  # ---- when it genuinely cannot tell ---------------------------------------
  # 0 has to keep meaning "could not read", because Behind is false on 0 and
  # the deploy gate refuses on an unreadable revision rather than passing.
  At 'newest-corrupt'
  $corrupt = Get-CollectionState $ombo
  Yes 'a table whose checksum does not match reads 0, not a guess' ($corrupt.Newest -eq 0 -and $corrupt.Have -eq 0)
  Yes 'and Known is false, so the gate says it could not read' (-not $corrupt.Known)

  $env:APPDATA = $root
  Clear-State
  Yes 'a state folder with no database in it reads 0' ((Get-CollectionNewest 'ombo2a') -eq 0)

  # The text the raw reader matched, in a folder with no CURRENT, is not a
  # database and says nothing.
  Put '000124.log' ([Text.Encoding]::ASCII.GetBytes('newestVersion' + [char]3 + '"5"'))
  Yes 'raw newestVersion bytes outside a database are not read' ((Get-CollectionNewest 'ombo2a') -eq 0)
  Clear-State

  $env:APPDATA = Join-Path $root 'no-such-folder'
  Yes 'no state.v2 at all reads 0' ((Get-CollectionNewest 'ombo2a') -eq 0)
  Yes 'and no slug reads 0' ((Get-CollectionNewest '') -eq 0)

  # ---- the installed revision (Have), read from state under the new naming --
  # Vortex stopped naming the mod folder for the collection (it is
  # vortex_collection_<opaque id>_ now), so the installed revision NUMBER is
  # read from state.v2, tied to the collection by its slug.
  At 'installed'
  Yes 'the installed revision is read from state under vortex_collection_* naming' ((Get-CollectionRevision 'ombo2a') -eq 5)

  # Two collections installed at once, ombo2a on main and 7essxf on dev: each
  # answers about its own, tied by the mod id, never the other's number.
  At 'installed-two'
  Yes 'ombo2a reads its own 5, not the other collection''s 12' ((Get-CollectionRevision 'ombo2a') -eq 5)
  Yes 'and 7essxf reads its own 12' ((Get-CollectionRevision '7essxf') -eq 12)
  Yes 'and each one''s mod id is its own' `
    (((Get-CollectionModIds 'ombo2a') -join ',') -eq $z -and ((Get-CollectionModIds '7essxf') -join ',') -eq $a)

  # The legacy folder is still read when there is no state to read: a machine
  # that only ever had the old collection_<slug>_<rev>_* folders.
  $env:APPDATA = $root
  Clear-State
  $legacyMods = Join-Path $root 'Vortex\skyrimse\mods'
  $null = New-Item -ItemType Directory -Force -Path (Join-Path $legacyMods 'collection_ombo2a_4_2026-09-20T10-00-00Z')
  $null = New-Item -ItemType Directory -Force -Path (Join-Path $legacyMods 'collection_ombo2a_5_2026-09-22T22-26-11Z')
  Yes 'with no state, the legacy folder name is still read, newest wins' ((Get-CollectionRevision 'ombo2a') -eq 5)
  Remove-Item -LiteralPath $legacyMods -Recurse -Force -EA SilentlyContinue

  # Have and Newest together, the two numbers Deploy-Gamemode stands on: with
  # the collection installed at 5 and Vortex knowing 5 is newest, the state is
  # Known and not Behind, which is a deploy that no longer needs -IgnoreRevision.
  At 'newest-current'
  $csReady = Get-CollectionState $ombo
  Yes 'Get-CollectionState reads Have from state' ($csReady.Have -eq 5)
  Yes 'and Known is true, so the deploy gate reads a real revision without -IgnoreRevision' ($csReady.Known)
  Yes 'and Behind is false when Have matches Newest' (-not $csReady.Behind)

  foreach ($w in '', '-log') {
    $where = if ($w) { 'in the log' } else { 'in a compacted table' }

    # ---- Known without newestVersion (draft / first revision) --------------
    At ('draft' + $w)
    $csDraft = Get-CollectionState $essx
    Yes "draft $($where): without newestVersion, Have still reads 1 from state" ($csDraft.Have -eq 1)
    Yes "draft $($where): and Newest is 1 from the cached revision and the installed floor" ($csDraft.Newest -eq 1)
    Yes "draft $($where): so Known is true on a current draft with no newestVersion key" ($csDraft.Known)
    Yes "draft $($where): and the mod id is found" (((Get-CollectionModIds '7essxf') -join ',') -eq $z)

    # ---- authoring shape: newestFileId, no collectionSlug (live ship PC) ----
    At ('authoring' + $w)
    $csAuthor = Get-CollectionState $essx
    Yes "authoring $($where): without collectionSlug, Have still reads 1 via newestFileId and the revisions cache" ($csAuthor.Have -eq 1)
    Yes "authoring $($where): and Newest is 1 so Known is true" ($csAuthor.Newest -eq 1 -and $csAuthor.Known)
    Yes "authoring $($where): ombo2a stays 0 when only 7essxf is wired through newestFileId" ((Get-CollectionRevision 'ombo2a') -eq 0)
    Yes "authoring $($where): ModIds finds vortex_collection_* via newestFileId" (((Get-CollectionModIds '7essxf') -join ',') -eq $z)
    Yes "authoring $($where): and no mod id for a slug nothing is tied to" ((Get-CollectionModIds 'ombo2a').Count -eq 0)
    $modsDirA = Join-Path $env:APPDATA 'Vortex\skyrimse\mods'
    $opaqueA = Join-Path $modsDirA $z
    $null = New-Item -ItemType Directory -Force -Path $opaqueA
    $foundA = Get-CollectionInstalledFolder '7essxf'
    Yes "authoring $($where): InstalledFolder maps via newestFileId when collectionSlug is absent" `
      ($null -ne $foundA -and ([IO.Path]::GetFullPath($foundA.FullName) -eq [IO.Path]::GetFullPath($opaqueA)))
    Remove-Item -LiteralPath $modsDirA -Recurse -Force -EA SilentlyContinue

    # ---- InstalledFolder via state, with or without collection.json --------
    At ('slug-only' + $w)
    $modsDir = Join-Path $env:APPDATA 'Vortex\skyrimse\mods'
    $opaque = Join-Path $modsDir $z
    $null = New-Item -ItemType Directory -Force -Path $opaque
    $found = Get-CollectionInstalledFolder '7essxf'
    Yes "slug-only $($where): InstalledFolder maps slug to vortex_collection_* without collection.json" `
      ($null -ne $found -and ([IO.Path]::GetFullPath($found.FullName) -eq [IO.Path]::GetFullPath($opaque)))
    Set-Content -LiteralPath (Join-Path $opaque 'collection.json') -Value '{}' -Encoding ASCII
    $found2 = Get-CollectionInstalledFolder '7essxf'
    Yes "slug-only $($where): InstalledFolder still returns the state-mapped folder with collection.json" `
      ($null -ne $found2 -and ([IO.Path]::GetFullPath($found2.FullName) -eq [IO.Path]::GetFullPath($opaque)))
    Remove-Item -LiteralPath $modsDir -Recurse -Force -EA SilentlyContinue
  }

  # ---- Thornswood profile lock helper --------------------------------------
  $env:APPDATA = $root
  Clear-State
  $profLog = [Text.Encoding]::ASCII.GetBytes(
    '{"type":"mod-enabled","data":{"profileId":"ZRT7NjhN_","profileName":"Thornswood"}}')
  Put '000200.log' $profLog
  $profDir = Join-Path $root 'Vortex\skyrimse\profiles\ZRT7NjhN_'
  $null = New-Item -ItemType Directory -Force -Path $profDir
  Set-Content -LiteralPath (Join-Path $profDir 'plugins.txt') -Value '*Skyrim.esm' -Encoding ASCII
  $got = Get-VortexProfileDir 'Thornswood'
  Yes 'Get-VortexProfileDir finds the Thornswood profile by name in state' `
    ($null -ne $got -and ([IO.Path]::GetFullPath($got) -eq [IO.Path]::GetFullPath($profDir)))
  Remove-Item -LiteralPath (Join-Path $root 'Vortex\skyrimse\profiles') -Recurse -Force -EA SilentlyContinue

  # ---- what the callers see ------------------------------------------------
  Clear-State
  $blind = Get-CollectionState $essx
  Yes 'with nothing readable, Known is false' (-not $blind.Known)
  Yes 'and Behind is false too, so the bool alone cannot tell them apart' (-not $blind.Behind)
}
finally {
  $env:APPDATA = $realAppData
  Remove-Item -LiteralPath $root -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
if ($fail) { exit 1 }
