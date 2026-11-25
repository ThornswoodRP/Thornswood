<#
  HashStamps.ps1

  Keeps the size, write time and hash of each file that has passed its hash,
  so a file unchanged since is not read again (#4388). Dot-sourced by
  Install-NexusRevision.ps1, for the archives in its cache (md5-passed.tsv)
  and the files a layout placed (Thornswood Layout\placed.tsv).

  A stamp passes a file only while its size and write time are what they
  were when it passed, and only for the same hash. Anything else is read
  and held to the hash again, and a file that fails loses its stamp, so a
  changed file is still refused.

  The stamp file is one line per file: write time (UTC ticks), size, hash
  and its key, tab separated. A line that is not that shape is no stamp,
  and its file is read.
#>

function Read-HashStamps([string]$Path) {
  $stamps = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $stamps }
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    $c = $line.Split("`t")
    if ($c.Count -ne 4) { continue }
    [long]$ticks = 0; [long]$size = 0
    if (-not [long]::TryParse($c[0], [ref]$ticks) -or -not [long]::TryParse($c[1], [ref]$size) -or -not $c[2] -or -not $c[3]) { continue }
    $stamps[$c[3].ToLowerInvariant()] = [pscustomobject]@{ Ticks = $ticks; Size = $size; Hash = $c[2]; Key = $c[3] }
  }
  return $stamps
}

function Save-HashStamps([string]$Path, [hashtable]$Stamps) {
  $lines = @($Stamps.Values | Sort-Object Key | ForEach-Object { [string]$_.Ticks + "`t" + [string]$_.Size + "`t" + $_.Hash + "`t" + $_.Key })
  [IO.File]::WriteAllText($Path, ((@($lines) -join "`r`n") + $(if ($lines.Count) { "`r`n" } else { '' })), (New-Object Text.UTF8Encoding($false)))
}

# Stamps a file with a hash already held to it, by its size and write time
# now. It reads nothing.
function Set-HashStamp([hashtable]$Stamps, [string]$Key, [string]$Path, [string]$Hash) {
  $fi = New-Object IO.FileInfo($Path)
  $Stamps[$Key.ToLowerInvariant()] = [pscustomobject]@{ Ticks = $fi.LastWriteTimeUtc.Ticks; Size = $fi.Length; Hash = $Hash; Key = $Key }
}

# Whether the file at $Path is $Size bytes with hash $Hash. A file the wrong
# size, or not there, is not, with no read. One whose stamp has this size,
# its write time now and this hash is, with no read. Any other is read with
# $HashOf: a pass stamps it, a fail takes its stamp out.
function Test-HashAsRecorded([hashtable]$Stamps, [string]$Key, [string]$Path, [long]$Size, [string]$Hash, [scriptblock]$HashOf) {
  $k = $Key.ToLowerInvariant()
  $fi = New-Object IO.FileInfo($Path)
  if (-not $fi.Exists -or $fi.Length -ne $Size) { $Stamps.Remove($k); return $false }
  $st = $Stamps[$k]
  if ($st -and $st.Size -eq $fi.Length -and $st.Ticks -eq $fi.LastWriteTimeUtc.Ticks -and $st.Hash -eq $Hash) { return $true }
  $got = [string](& $HashOf $Path)
  if ($got -ne $Hash) { $Stamps.Remove($k); return $false }
  Set-HashStamp $Stamps $Key $Path $Hash
  return $true
}
