<#
  Send-GameArchives.ps1

  Puts Skyrim's own archives that the content tools read on the VPS box, in
  C:\Thornswood-GameData, each checked against records\skyrim-files.json on
  this machine before it goes and on the box after it lands, and the loose
  string tables records\game-strings.json names, held to that record the
  same way. Issue #2899.

      .\scripts\mods\Send-GameArchives.ps1
      .\scripts\mods\Send-GameArchives.ps1 -Data 'D:\Steam\steamapps\common\Skyrim Special Edition\Data'
      .\scripts\mods\Send-GameArchives.ps1 -ScriptPack <folder>\papyrus-scripts.zip
      .\scripts\mods\Send-GameArchives.ps1 -Check

  WHY. Patrick, 20 Oct 2026, A on #2899 (his page answer): "All needed
  archives. Interface, Meshes0-1 and Textures0-8 (about 9.7 GB) go in a
  staff-only folder on the box." scripts\mods\Run-OnBox.ps1 runs the content
  tools on the box against a game server's plugins; the string tables, the
  start menu, the meshes and the textures those tools also read were only on
  One. With them on the box, every content tool runs from a machine with no
  game at all.

  WHAT GOES. The archives scripts\mods\OnBox.ps1 names (the twelve above,
  and since #3100 _ResourcePack.bsa, the one place the localized
  _ResourcePack.esl keeps its names: without it the hunt and ore builders
  failed on the box on 21 Oct), each held to
  the size and sha1 records\skyrim-files.json gives for the pinned Skyrim
  build, so a changed or modded archive is refused here, before anything is
  sent. Then the loose string tables records\game-strings.json names, each
  held to its size and sha256 there, into Strings. Measured 20 Oct: the
  first run from the cloud stopped Build-LastPlugin at "no strings for
  RaceCompatibility.esm", a localized master among the last plugin's whose
  tables are loose in Data\Strings and in no archive. No plugin goes, and no
  other file of a mod's. A file the box already holds with those bytes is
  not sent again.

  THE SCRIPT PACK (#3105). Every Papyrus script of the game's Data folder,
  which scripts\mods\New-ScriptPack.py packs and records\papyrus-scripts.json
  pins by size and sha256: the crime table reads every script of the load
  order, and no archive that carries one is on the box (on 26 Oct the whole
  rebuild stopped there with 14,553 scripts missing). -ScriptPack names the
  pack on this machine; it goes when the box lacks those bytes, and the run
  stops when the box lacks them and -ScriptPack names no pack, or a pack
  that is not the recorded one.

  ON THE BOX. C:\Thornswood-GameData is made locked (SYSTEM's and
  Administrators' only, Lock-Folder.ps1 -Only) and nothing serves it. Each
  file arrives as .incoming-<name> at the top of the folder, is hashed there,
  and takes its place only when it is the recorded bytes; then it is made
  read only to everyone but SYSTEM (OnBox.ps1 says why). An arrival that is
  not the recorded bytes is deleted and the run stops. Arriving at the top
  keeps a half-sent string table out of Strings, which every run links.

  -Check hashes what is here and asks the box what it holds, and sends
  nothing.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    # The game's Data folder on this machine.
    [string]$Data = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    # The script pack New-ScriptPack.py made, when the box needs it.
    [string]$ScriptPack = '',
    [switch]$Check,
    [string]$VpsHost = '',
    [string]$VpsUser = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\deploy\Artifact.ps1')
. (Join-Path $Here 'OnBox.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }
$target = "$VpsUser@$VpsHost"
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
$store = $ThornswoodGameArchiveStore

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

# ---------------------------------------------------------------- here ----
# Each file: where it goes in the store (and comes from under -Data), its
# size, and the hash its record gives: sha1 for Skyrim's archives, as
# Steam's manifests give them, and sha256 for the string tables.
function Get-FileHashText([string]$Path, [string]$Algo) {
    $h = if ($Algo -eq 'sha1') { [Security.Cryptography.SHA1]::Create() } else { [Security.Cryptography.SHA256]::Create() }
    $s = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($h.ComputeHash($s)) -replace '-', '').ToLowerInvariant() } finally { $s.Close() }
}
$record = Get-Content -LiteralPath (Join-Path $Here '..\..\records\skyrim-files.json') -Raw | ConvertFrom-Json
$want = [ordered]@{}
foreach ($n in $ThornswoodGameArchives) {
    $r = $record.files.('Data\' + $n)
    if (-not $r -or -not $r.sha1 -or -not $r.bytes) { throw "records\skyrim-files.json has no size and sha1 for Data\$n. Nothing was sent." }
    $want[$n] = [pscustomobject]@{ Bytes = [long]$r.bytes; Algo = 'sha1'; Hash = ([string]$r.sha1).ToLowerInvariant(); From = (Join-Path $Data $n) }
}
$strings = Get-Content -LiteralPath (Join-Path $Here '..\..\records\game-strings.json') -Raw | ConvertFrom-Json
foreach ($e in $strings.files.PSObject.Properties) {
    if ($e.Name -notmatch '^Strings\\[^\\/:*?"<>|]+$' -or -not $e.Value.sha256 -or -not $e.Value.bytes) { throw "records\game-strings.json names $($e.Name) without a size and sha256, or outside Strings. Nothing was sent." }
    $want[$e.Name] = [pscustomobject]@{ Bytes = [long]$e.Value.bytes; Algo = 'sha256'; Hash = ([string]$e.Value.sha256).ToLowerInvariant(); From = (Join-Path $Data $e.Name) }
}
$packRecord = Join-Path $Here '..\..\records\papyrus-scripts.json'
if (Test-Path -LiteralPath $packRecord) {
    $pr = Get-Content -LiteralPath $packRecord -Raw | ConvertFrom-Json
    if ($pr.file -ne $ThornswoodScriptPack -or -not $pr.sha256 -or -not $pr.bytes) { throw "records\papyrus-scripts.json does not name $ThornswoodScriptPack with a size and sha256. Nothing was sent." }
    $want[$ThornswoodScriptPack] = [pscustomobject]@{ Bytes = [long]$pr.bytes; Algo = 'sha256'; Hash = ([string]$pr.sha256).ToLowerInvariant(); From = $ScriptPack }
} elseif ($ScriptPack) {
    throw 'records\papyrus-scripts.json is not there, so the pack has no recorded bytes to be held to. Commit the record New-ScriptPack.py wrote beside the pack first. Nothing was sent.'
}

Say "Here, in $Data" 'Cyan'
$bad = @()
foreach ($n in $want.Keys) {
    $p = $want[$n].From
    # The pack is checked here only when -ScriptPack names it; when the box
    # lacks it and nothing names it, the run stops below.
    if (-not $p) { continue }
    if (-not (Test-Path -LiteralPath $p)) { $bad += "$n is not there"; continue }
    $len = (Get-Item -LiteralPath $p).Length
    if ($len -ne $want[$n].Bytes) { $bad += ("$n is {0:N0} bytes, the record says {1:N0}" -f $len, $want[$n].Bytes); continue }
    $h = Get-FileHashText $p $want[$n].Algo
    if ($h -ne $want[$n].Hash) { $bad += "$n has $($want[$n].Algo) $h, the record says $($want[$n].Hash)"; continue }
    Say ("  ok    {0}  {1:N0} bytes" -f $n, $len)
}
if ($bad.Count) {
    foreach ($b in $bad) { Say "  STOP  $b" 'Red' }
    throw ('These are not the files records\skyrim-files.json, records\game-strings.json and records\papyrus-scripts.json name, so nothing was sent. Point -Data at the game''s own Data folder, and -ScriptPack at the pack New-ScriptPack.py made.')
}

# -------------------------------------------------------------- the box ---
$lines = @()
foreach ($n in $want.Keys) { $lines += "'" + $n + "' = '" + $want[$n].Algo + ':' + $want[$n].Hash + "'" }
$table = '@{ ' + ($lines -join '; ') + ' }'
$ask = @"
`$ErrorActionPreference = 'Stop'
$(Get-ThornswoodLockedFolderScript $store -Only)
`$want = $table
foreach (`$n in `$want.Keys) {
  `$p = Join-Path '$store' `$n
  if (-not (Test-Path -LiteralPath `$p)) { 'NEEDS ' + `$n; continue }
  `$algo, `$hash = `$want[`$n].Split(':')
  `$a = if (`$algo -eq 'sha1') { [Security.Cryptography.SHA1]::Create() } else { [Security.Cryptography.SHA256]::Create() }
  `$s = [IO.File]::OpenRead(`$p)
  try { `$h = ([BitConverter]::ToString(`$a.ComputeHash(`$s)) -replace '-', '').ToLowerInvariant() } finally { `$s.Close() }
  if (`$h -eq `$hash) { 'HAS ' + `$n } else { 'NEEDS ' + `$n }
}
"@
Say ''
Say "On the box, in $store" 'Cyan'
$answer = @(Invoke-ThornswoodArtifactRemote $target $ssh $ask)
foreach ($l in @($answer | Where-Object { $_ -like 'locked *' -or $_ -like 'FAILED *' })) { Say "  $l" }
if (@($answer | Where-Object { $_ -like 'FAILED *' }).Count) { throw "the box could not lock $store. Nothing was sent." }
$has = @($answer | Where-Object { $_ -like 'HAS *' } | ForEach-Object { $_.Substring(4) })
$needs = @($answer | Where-Object { $_ -like 'NEEDS *' } | ForEach-Object { $_.Substring(6) })
if (($has.Count + $needs.Count) -ne $want.Count) { throw ('the box did not answer for every file (' + ($answer -join ' ') + '). Nothing was sent.') }
foreach ($n in $has) { Say "  has   $n" }
foreach ($n in $needs) { Say "  needs $n" 'Yellow' }
if ($Check) { Say ''; Say '-Check, so nothing was sent.'; exit 0 }
if (($needs -contains $ThornswoodScriptPack) -and -not $want[$ThornswoodScriptPack].From) {
    throw ("the box needs $ThornswoodScriptPack and -ScriptPack names no pack. Make it with: python scripts\mods\New-ScriptPack.py --out <folder>, then run this with -ScriptPack <folder>\$ThornswoodScriptPack. Nothing was sent.")
}
if (-not $needs.Count) { Say ''; Say 'The box already holds every file, so nothing was sent.' 'Green'; exit 0 }

$storeFar = $store.Replace('\', '/')
foreach ($n in $needs) {
    Say ''
    Say ("sending {0}, {1:N0} bytes" -f $n, $want[$n].Bytes)
    $incoming = '.incoming-' + (Split-Path -Leaf $n)
    Send-ThornswoodArtifactFile $want[$n].From $target $ssh ($storeFar + '/' + $incoming)
    $place = @"
`$ErrorActionPreference = 'Stop'
$(Get-ThornswoodArchiveReadOnlyScript)
`$in = Join-Path '$store' '$incoming'
`$to = Join-Path '$store' '$n'
`$a = if ('$($want[$n].Algo)' -eq 'sha1') { [Security.Cryptography.SHA1]::Create() } else { [Security.Cryptography.SHA256]::Create() }
`$s = [IO.File]::OpenRead(`$in)
try { `$h = ([BitConverter]::ToString(`$a.ComputeHash(`$s)) -replace '-', '').ToLowerInvariant() } finally { `$s.Close() }
if (`$h -ne '$($want[$n].Hash)' -or (Get-Item -LiteralPath `$in).Length -ne $($want[$n].Bytes)) {
  Remove-Item -LiteralPath `$in -Force
  'WRONG ' + `$h
  exit 1
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent `$to) | Out-Null
if (Test-Path -LiteralPath `$to) { Remove-Item -LiteralPath `$to -Force }
Move-Item -LiteralPath `$in -Destination `$to
Set-ThornswoodArchiveReadOnly `$to
'PLACED'
"@
    $out = @(Invoke-ThornswoodArtifactRemote $target $ssh $place)
    if ($out -notcontains 'PLACED') { throw ("$n did not arrive as the recorded bytes (" + ($out -join ' ') + '). It was deleted on the box; run this again.') }
    Say "  placed, read only" 'Green'
}
Say ''
Say ("The box holds all {0} files in {1}." -f $want.Count, $store) 'Green'
