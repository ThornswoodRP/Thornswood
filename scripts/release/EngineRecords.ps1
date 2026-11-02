<#
  EngineRecords.ps1

  The records engine.yml makes for a pin, carried from the run to the pin
  pull request in the run's log (#3399). Dot-sourced by
  .github\workflows\engine.yml and scripts\release\Get-EngineRecords.ps1;
  tests\test-3399-engine-records.ps1.

  WHAT IS CARRIED. The four things a pin pull request takes from the run
  (engine\README.md, The engine built in CI):
    records\server-build.json
    records\client-build.json
    records\client-licences.json
    records\client-licences\<port>.txt, every text and no other file
  in one zip, entries named records/<...> with /, in ordinal order, which
  LogHandBack.ps1 prints between the ENGINE-RECORDS lines. The engine itself
  is not carried: it is the fork's own build, which the public fork keeps
  (EngineArtifact.ps1 says why and how a Ship machine takes it).

  WHAT IS HELD before they are written into a checkout. Only those names,
  each a plain path under records\; the two build records parse and name one
  fork commit (the server record's source.commit, which the client record's
  forkCommit starts); and that commit is the one the checkout's engine\skymp
  is pinned to in its index, so the records go in with the pin move and
  never under another commit. Then records\client-licences\ is replaced
  whole, so a text the new build no longer has goes.

  It runs in PowerShell 7 (#5356).
#>

. (Join-Path $PSScriptRoot 'LogHandBack.ps1')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Put together from two halves (LogHandBack.ps1, THE SHAPE).
$EngineRecordsMark = 'ENGINE' + '-RECORDS'
$EngineRecordsTop = @('server-build.json', 'client-build.json', 'client-licences.json')

# Whether a name in the bundle is one of the four things it carries.
function Test-EngineRecordsName([string]$Name) {
    foreach ($t in $EngineRecordsTop) { if ($Name -ceq ('records/' + $t)) { return $true } }
    return ($Name -cmatch '^records/client-licences/[A-Za-z0-9][A-Za-z0-9._+-]*\.txt$' -and $Name -notmatch '\.\.')
}

# The bundle of the records in the checkout at $Repo, as zip bytes.
function New-EngineRecordsBundle([string]$Repo) {
    $files = [ordered]@{}
    foreach ($t in $EngineRecordsTop) {
        $p = Join-Path $Repo ('records\' + $t)
        if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "there is no records\$t to hand back" }
        $files['records/' + $t] = [IO.File]::ReadAllBytes($p)
    }
    $texts = Join-Path (Join-Path $Repo 'records') 'client-licences'
    foreach ($f in @(Get-ChildItem -LiteralPath $texts -File -ErrorAction SilentlyContinue)) { $files['records/client-licences/' + $f.Name] = [IO.File]::ReadAllBytes($f.FullName) }
    [string[]]$names = @($files.Keys)
    [Array]::Sort($names, [StringComparer]::Ordinal)
    $ms = New-Object IO.MemoryStream
    $za = New-Object IO.Compression.ZipArchive($ms, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($n in $names) {
            if (-not (Test-EngineRecordsName $n)) { throw "$n is not a record the bundle carries" }
            $e = $za.CreateEntry($n, [IO.Compression.CompressionLevel]::Optimal)
            $s = $e.Open()
            try { $s.Write($files[$n], 0, $files[$n].Length) } finally { $s.Dispose() }
        }
    } finally { $za.Dispose() }
    return , $ms.ToArray()
}

# The files in a bundle, name -> bytes. Throws on a name it does not carry,
# a name twice, or one of the three records missing.
function Read-EngineRecordsBundle([byte[]]$Bytes) {
    $out = [ordered]@{}
    $ms = New-Object IO.MemoryStream (, $Bytes)
    $za = New-Object IO.Compression.ZipArchive($ms, [IO.Compression.ZipArchiveMode]::Read)
    try {
        foreach ($e in $za.Entries) {
            $n = [string]$e.FullName
            if (-not (Test-EngineRecordsName $n)) { throw "the records handed back hold $n, which is not one of them" }
            if ($out.Contains($n)) { throw "the records handed back hold $n twice" }
            $buf = New-Object IO.MemoryStream
            $s = $e.Open()
            try { $s.CopyTo($buf) } finally { $s.Dispose() }
            $out[$n] = $buf.ToArray()
        }
    } finally { $za.Dispose() }
    foreach ($t in $EngineRecordsTop) { if (-not $out.Contains('records/' + $t)) { throw "the records handed back have no records\$t" } }
    return $out
}

# The fork commit the bundle's records name. Throws a sentence when they name
# none, or two.
function Get-EngineRecordsCommit($Files) {
    $text = { param($n) [Text.Encoding]::UTF8.GetString($Files[$n]).TrimStart([char]0xFEFF) }
    $s = $null; $c = $null
    try { $s = (& $text 'records/server-build.json') | ConvertFrom-Json } catch { throw 'the server-build.json handed back does not read as JSON' }
    try { $c = (& $text 'records/client-build.json') | ConvertFrom-Json } catch { throw 'the client-build.json handed back does not read as JSON' }
    $commit = ''
    if ($s.PSObject.Properties['source'] -and $s.source -and $s.source.PSObject.Properties['commit']) { $commit = ([string]$s.source.commit).ToLowerInvariant() }
    if ($commit -notmatch '^[0-9a-f]{40}$') { throw 'the server-build.json handed back names no fork commit (source.commit)' }
    $short = ''
    if ($c.PSObject.Properties['forkCommit']) { $short = ([string]$c.forkCommit).ToLowerInvariant() }
    if (-not $short -or -not $commit.StartsWith($short)) { throw "the client-build.json handed back names fork commit '$short' and the server-build.json $commit, so they are not one engine" }
    return $commit
}

# Writes the bundle's records into the checkout at $Repo: the three records
# over the checkout's, and records\client-licences\ replaced whole.
function Save-EngineRecords($Files, [string]$Repo) {
    $texts = Join-Path (Join-Path $Repo 'records') 'client-licences'
    if (Test-Path -LiteralPath $texts) { Remove-Item -LiteralPath $texts -Recurse -Force }
    $null = New-Item -ItemType Directory -Force -Path $texts
    foreach ($n in @($Files.Keys)) {
        $to = Join-Path $Repo ($n.Replace('/', [IO.Path]::DirectorySeparatorChar))
        [IO.File]::WriteAllBytes($to, $Files[$n])
    }
}
