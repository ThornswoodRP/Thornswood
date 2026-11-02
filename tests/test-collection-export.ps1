<#
  test-collection-export.ps1

      pwsh -NoProfile -File .\tests\test-collection-export.ps1

  How scripts\mods\LoadOrder.ps1 finds the collection.json an authored
  collection leaves only inside Vortex's export archive:
  Get-CollectionExportArchive (which archive, best first),
  Expand-CollectionJson (read out of a .zip, cached by path, size and time)
  and Get-CollectionJsonPath (the loose file first). Check-CollectionRules and
  the revision gate read the collection through these. Made up folders and
  .zip archives in a scratch folder; no Vortex, no 7-Zip needed, no network.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $Repo 'scripts\mods\LoadOrder.ps1')
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-coll-export-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$made = New-Object Collections.Generic.List[string]
function Zip([string]$path, [hashtable]$entries, [datetime]$when) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    $z = [IO.Compression.ZipFile]::Open($path, 'Create')
    try {
        foreach ($k in $entries.Keys) {
            $e = $z.CreateEntry($k)
            $w = New-Object IO.StreamWriter($e.Open())
            try { $w.Write([string]$entries[$k]) } finally { $w.Dispose() }
        }
    } finally { $z.Dispose() }
    [IO.File]::SetLastWriteTimeUtc($path, $when)
}
function Names($list) { return (@($list | ForEach-Object { $_.Name }) -join '|') }
function Track($p) { if ($p) { [void]$made.Add((Split-Path -Parent $p)) }; return $p }

try {
    $old = [datetime]'2026-10-01T00:00:00Z'; $new = [datetime]'2026-10-09T00:00:00Z'
    $f = Join-Path $T 'staging'
    New-Item -ItemType Directory -Force -Path $f | Out-Null

    Yes 'a folder that is not there has no archive' ((@(Get-CollectionExportArchive (Join-Path $T 'nope'))).Count -eq 0)
    Yes 'an empty folder has no archive' ((@(Get-CollectionExportArchive $f)).Count -eq 0)

    Zip (Join-Path $f 'SomeMod-1-0.zip') @{ 'collection.json' = '{"mod":true}' } $new
    Yes "a mod's archive in the staging root is not the collection" ((@(Get-CollectionExportArchive $f)).Count -eq 0)

    Zip (Join-Path $f 'collection-root.zip') @{ 'collection.json' = '{"rev":"root"}' } $new
    Zip (Join-Path $f 'export\other.zip') @{ 'collection.json' = '{"rev":"other"}' } $new
    Zip (Join-Path $f 'export\collection-old.zip') @{ 'collection.json' = '{"rev":"old"}' } $old
    Zip (Join-Path $f 'export\collection-new.zip') @{ 'x\collection.json' = '{"rev":"deep"}'; 'collection.json' = '{"rev":"new"}' } $new
    [IO.File]::WriteAllText((Join-Path $f 'export\notes.txt'), 'not an archive')
    $order = Names (Get-CollectionExportArchive $f)
    Yes "export before the root, collection* before others, newest first ($order)" ($order -eq 'collection-new.zip|collection-old.zip|other.zip|collection-root.zip')

    $a = @(Get-CollectionExportArchive $f)[0]
    $j = Track (Expand-CollectionJson $a)
    Yes 'the collection.json nearest the top of the archive is read' ($j -and ([IO.File]::ReadAllText($j) -eq '{"rev":"new"}'))
    Yes '  into the temp cache, not the staging folder' ($j -and -not $j.StartsWith($f, [StringComparison]::OrdinalIgnoreCase))
    $again = Expand-CollectionJson $a
    Yes '  and a second read is the same cached file' ($again -eq $j)

    # A re-export: other bytes, another time. The cache must not hand back the old JSON.
    Zip (Join-Path $f 'export\collection-new.zip') @{ 'collection.json' = '{"rev":"re-exported, longer"}' } $new.AddMinutes(5)
    $j2 = Track (Expand-CollectionJson (Get-Item -LiteralPath (Join-Path $f 'export\collection-new.zip')))
    Yes 'a re-exported archive is read again, not served from the old cache' ($j2 -and $j2 -ne $j -and ([IO.File]::ReadAllText($j2) -eq '{"rev":"re-exported, longer"}'))

    Yes 'no archive gives no JSON' ($null -eq (Expand-CollectionJson $null))
    Zip (Join-Path $T 'empty\export\collection-empty.zip') @{ 'readme.txt' = 'nothing' } $new
    $none = Expand-CollectionJson (Get-Item -LiteralPath (Join-Path $T 'empty\export\collection-empty.zip'))
    Yes 'an archive with no collection.json gives no JSON' ($null -eq $none -or -not (Test-Path -LiteralPath $none))

    $p = Track (Get-CollectionJsonPath $f)
    Yes 'Get-CollectionJsonPath reads the best archive when there is no loose file' ($p -and ([IO.File]::ReadAllText($p) -eq '{"rev":"re-exported, longer"}'))
    Yes '  and names the archive it came out of' ([string]$script:CollectionJsonFrom -like ('*' + [IO.Path]::DirectorySeparatorChar + [IO.Path]::Combine('export', 'collection-new.zip')))
    [IO.File]::WriteAllText((Join-Path $f 'collection.json'), '{"rev":"loose"}')
    $p = Get-CollectionJsonPath $f
    Yes 'a loose collection.json wins over any archive' ($p -eq (Join-Path $f 'collection.json') -and $script:CollectionJsonFrom -eq '')
    Yes 'no folder gives no path' ($null -eq (Get-CollectionJsonPath ''))
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($d in $made) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }