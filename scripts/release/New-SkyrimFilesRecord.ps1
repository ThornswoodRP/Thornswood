<#
.SYNOPSIS
  Records every file of the pinned Skyrim build, from the depot manifests the
  Downgrade asks Steam for, into records\skyrim-files.json.

.DESCRIPTION
  Thornswood's own game folder takes three kinds of file and nothing else
  (issue #1232): Skyrim's own, what Vortex deployed by Vortex's own record,
  and Thornswood's own. Mods a person put into their Steam copy by hand stay
  out of it, because people play vanilla Skyrim from Steam with their own mods
  and Thornswood runs from its own folder. "Skyrim's own" has to come from a
  real list rather than from guessing by folder, and this is that list.

  The build is pinned in records\skyrim-pin.json: three depots of app 489830,
  each at one manifest, which are exactly what the Downgrade button asks Steam
  for (download_depot). Steam keeps every manifest it has fetched in its own
  depotcache folder as <depot>_<manifest>.manifest, so a machine that has
  downloaded the pinned build (the Downgrade, or Steam itself while it was
  current) has the three. Each is Steam's own format: sections of a four
  byte kind and a four byte length, the first a list of every file in the
  depot with its size and SHA-1, the second which depot and manifest it is.
  This reads the files out of them, checks each manifest is the depot and
  manifest the pin names and that its file names are not encrypted, and
  writes one line per file: the path under the game folder, its bytes, its
  SHA-1 and its depot.

  Build-Launcher.ps1 puts the record inside the launcher, which reads it back
  in OwnGame (OwnGameKinds.cs). Run this in the same pull request as a move of
  the pin; launcher\tests\test-skyrim-pin.ps1 fails while the two disagree.

  Read only apart from the one file it writes. It never starts Steam and never
  talks to the VPS.

.PARAMETER Steam
  Steam's own folder, where depotcache is. Read from Steam's registry entry
  when not given.

.PARAMETER Pin
  The pin to record the files of.

.PARAMETER Out
  The record to write. Committed to this repo.

.EXAMPLE
  .\scripts\release\New-SkyrimFilesRecord.ps1
#>
[CmdletBinding()]
param(
  [string]$Steam,
  [string]$Pin,
  [string]$Out
)
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named
if (-not $Pin) { $Pin = Join-Path $PSScriptRoot '..\..\records\skyrim-pin.json' }
if (-not $Out) { $Out = Join-Path $PSScriptRoot '..\..\records\skyrim-files.json' }

function Die([string]$why) { Write-Host $why -ForegroundColor Red; exit 1 }

if (-not $Steam) {
  try { $Steam = (Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -Name SteamPath -ErrorAction Stop).SteamPath } catch { $Steam = '' }
}
if (-not $Steam -or -not (Test-Path -LiteralPath $Steam)) { Die 'Could not find Steam on this machine. Pass -Steam with the folder Steam is installed in.' }
$Steam = [IO.Path]::GetFullPath($Steam.Replace('/', '\'))

if (-not (Test-Path -LiteralPath $Pin)) { Die "The pin is not at $Pin." }
$pinDoc = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $Pin -Raw) $Pin
if (-not $pinDoc.build -or -not $pinDoc.appId -or @($pinDoc.depots).Count -eq 0) { Die "$Pin has no build, appId or depots." }

# Steam's own section kinds in a manifest file.
$PayloadKind  = [uint32]'0x71F617D0'
$MetadataKind = [uint32]'0x1F4812BE'
$EndKind      = [uint32]'0x32C415AB'
# EDepotFileFlag: a folder, not a file.
$DirectoryFlag = 64

function Read-Varint([byte[]]$b, [ref]$at) {
  [uint64]$v = 0
  $shift = 0
  while ($true) {
    if ($at.Value -ge $b.Length) { throw 'the manifest ends in the middle of a number' }
    $x = $b[$at.Value]
    $at.Value++
    $v = $v -bor ([uint64]($x -band 0x7f) -shl $shift)
    if (($x -band 0x80) -eq 0) { return $v }
    $shift += 7
    if ($shift -gt 63) { throw 'a number in the manifest is too long' }
  }
}

# Skips one field of the given wire type; returns the bytes of a length
# delimited one.
function Skip-Field([byte[]]$b, [ref]$at, [int]$wire) {
  switch ($wire) {
    0 { $null = Read-Varint $b $at }
    1 { $at.Value += 8 }
    2 { $n = [int](Read-Varint $b $at); $at.Value += $n }
    5 { $at.Value += 4 }
    default { throw "a field of wire type $wire, which Steam's manifests do not use" }
  }
}

function Read-Manifest([string]$path) {
  $b = [IO.File]::ReadAllBytes($path)
  $files = New-Object System.Collections.Generic.List[object]
  $meta = @{}
  $i = 0
  while ($i + 8 -le $b.Length) {
    $kind = [BitConverter]::ToUInt32($b, $i)
    $len = [int][BitConverter]::ToUInt32($b, $i + 4)
    if ($kind -eq $EndKind) { break }
    $start = $i + 8
    $end = $start + $len
    if ($end -gt $b.Length) { throw 'a section runs past the end of the file' }
    if ($kind -eq $PayloadKind) {
      $p = $start
      while ($p -lt $end) {
        $key = Read-Varint $b ([ref]$p)
        $field = [int]($key -shr 3); $wire = [int]($key -band 7)
        if ($field -ne 1 -or $wire -ne 2) { Skip-Field $b ([ref]$p) $wire; continue }
        $n = [int](Read-Varint $b ([ref]$p))
        $q = $p; $qEnd = $p + $n
        $name = $null; [uint64]$size = 0; [uint64]$flags = 0; $sha = ''
        while ($q -lt $qEnd) {
          $k2 = Read-Varint $b ([ref]$q)
          $f2 = [int]($k2 -shr 3); $w2 = [int]($k2 -band 7)
          if ($w2 -eq 0 -and $f2 -eq 2) { $size = Read-Varint $b ([ref]$q) }
          elseif ($w2 -eq 0 -and $f2 -eq 3) { $flags = Read-Varint $b ([ref]$q) }
          elseif ($w2 -eq 2 -and ($f2 -eq 1 -or $f2 -eq 5)) {
            $l2 = [int](Read-Varint $b ([ref]$q))
            if ($f2 -eq 1) { $name = [Text.Encoding]::UTF8.GetString($b, $q, $l2) }
            else { $sha = -join ($b[$q..($q + $l2 - 1)] | ForEach-Object { $_.ToString('x2') }) }
            $q += $l2
          }
          else { Skip-Field $b ([ref]$q) $w2 }
        }
        $p = $qEnd
        if (-not $name) { throw 'a file in the manifest has no name' }
        if (($flags -band $DirectoryFlag) -ne 0) { continue }
        $files.Add([pscustomobject]@{ Path = $name.Replace('/', '\').TrimStart('\'); Bytes = $size; Sha1 = $sha })
      }
    }
    elseif ($kind -eq $MetadataKind) {
      $p = $start
      while ($p -lt $end) {
        $key = Read-Varint $b ([ref]$p)
        $field = [int]($key -shr 3); $wire = [int]($key -band 7)
        if ($wire -eq 0) { $meta[$field] = Read-Varint $b ([ref]$p) } else { Skip-Field $b ([ref]$p) $wire }
      }
    }
    $i = $end
  }
  return @{ Files = $files; Depot = $meta[1]; Manifest = $meta[2]; Encrypted = $meta[4] }
}

$all = @{}
$depotLines = @()
foreach ($d in @($pinDoc.depots)) {
  $path = Join-Path $Steam ('depotcache\{0}_{1}.manifest' -f $d.id, $d.manifest)
  if (-not (Test-Path -LiteralPath $path)) {
    Die ("Steam has not kept the manifest for depot $($d.id) at manifest $($d.manifest) on this machine ($path). " +
         "Press Downgrade in the launcher once, or type download_depot $($pinDoc.appId) $($d.id) $($d.manifest) into Steam's console, so Steam fetches it, then run this again.")
  }
  try { $m = Read-Manifest $path } catch { Die "Could not read $path as a Steam depot manifest: $($_.Exception.Message)." }
  if ([string]$m.Depot -ne [string]$d.id -or [string]$m.Manifest -ne [string]$d.manifest) {
    Die "$path says it is depot $($m.Depot) at manifest $($m.Manifest), not depot $($d.id) at $($d.manifest), so it is not the pinned build's."
  }
  if ($m.Encrypted -and [uint64]$m.Encrypted -ne 0) { Die "$path has its file names encrypted, so its files cannot be listed." }
  if ($m.Files.Count -eq 0) { Die "$path lists no files." }
  foreach ($f in $m.Files) {
    if ($all.ContainsKey($f.Path)) { Die "$($f.Path) is in more than one of the pinned depots." }
    $all[$f.Path] = [pscustomobject]@{ Bytes = $f.Bytes; Sha1 = $f.Sha1; Depot = [string]$d.id }
  }
  $depotLines += ('    {{ "id": "{0}", "manifest": "{1}", "files": {2} }}' -f $d.id, $d.manifest, $m.Files.Count)
}

$exe = $all['SkyrimSE.exe']
if (-not $exe) { Die 'None of the pinned depots has SkyrimSE.exe, so they are not the game.' }
if ($pinDoc.expectedExeBytes -and [uint64]$exe.Bytes -ne [uint64]$pinDoc.expectedExeBytes) {
  Die "The pinned depots' SkyrimSE.exe is $($exe.Bytes) bytes and the pin says $($pinDoc.expectedExeBytes), so the pin and its depots disagree."
}

$lines = @()
# Ordinal, so Windows PowerShell and pwsh write the same file.
[string[]]$keys = @($all.Keys)
[Array]::Sort($keys, [StringComparer]::OrdinalIgnoreCase)
foreach ($k in $keys) {
  $v = $all[$k]
  $lines += ('    "{0}": {{ "bytes": {1}, "sha1": "{2}", "depot": "{3}" }}' -f $k.Replace('\', '\\'), $v.Bytes, $v.Sha1, $v.Depot)
}
$text = "{`n" +
  '  "build": "' + $pinDoc.build + "`",`n" +
  '  "appId": ' + $pinDoc.appId + ",`n" +
  "  `"depots`": [`n" + ($depotLines -join ",`n") + "`n  ],`n" +
  "  `"files`": {`n" + ($lines -join ",`n") + "`n  }`n}`n"
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Out), $text, (New-Object Text.UTF8Encoding($false)))
Write-Host ("Recorded {0} files of Skyrim {1} from {2} depot manifests into {3}." -f $all.Count, $pinDoc.build, @($pinDoc.depots).Count, [IO.Path]::GetFullPath($Out))
