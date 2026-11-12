<#
  test-4811-dead-record-scripts.ps1

      pwsh -NoProfile -File .\tests\test-4811-dead-record-scripts.ps1

  #4811. Remove-DeadRecords.ps1 and Remove-DeadConditions.py each did one job
  on Thornswood-Content.esp in September (the sixteen Writs, the rank
  manuals and the conditions that tested for them) and sat on in
  scripts\mods as if they were tools. Nothing in the plugin matches either
  one's default prefixes any more, nothing calls them, and their defaults
  had gone wrong (Remove-DeadConditions read its own folder for the plugin;
  the proof Remove-DeadRecords gave read the content plugin alone). They are
  retired the way #1179's one-offs were: in scripts\oneoff, each refusing to
  run, with a row in scripts\oneoff\README.md and none in the mods index.

  WHAT THIS HOLDS:
    1. The content plugin holds nothing either would act on: no record whose
       editor id starts with any of their default prefixes, read from every
       record, a compressed one inflated.
    2. Neither is in scripts\mods; both are in scripts\oneoff.
    3. Each refuses to run before it reads or writes anything:
       Remove-DeadRecords.ps1 is run and must stop with the plugin unchanged;
       Remove-DeadConditions.py raises SystemExit as its first statement
       after its docstring (read, since this machine may have no Python).
    4. scripts\README.md has no row for either, and scripts\oneoff\README.md
       has one for each that says it refuses to run (#4811).
    5. No tracked file names either at its old scripts\mods path.

  Nothing leaves this machine.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function P([string[]]$parts) { $p = $Repo; foreach ($x in $parts) { $p = Join-Path $p $x }; return $p }

# ---- 1. nothing left for them in the plugin ------------------------------------
# Their default prefixes: Remove-DeadRecords.ps1's -Prefixes and
# Remove-DeadConditions.py's --prefixes.
$prefixes = @('ThornswoodWrit', 'ThornswoodMining', 'ThornswoodSmithing', 'ThornswoodWoodcutter', 'ThornswoodAlchemy')
$plugin = P @('game', 'content', 'Thornswood-Content.esp')
$b = [IO.File]::ReadAllBytes($plugin)
function U32($buf, $i) { [BitConverter]::ToUInt32($buf, $i) }
function Tag($buf, $i) { [Text.Encoding]::ASCII.GetString($buf, $i, 4) }
# A compressed record's data is its uncompressed size, then a zlib stream.
function RecordData($r) {
    $d = New-Object byte[] $r.Size
    [Array]::Copy($b, $r.At, $d, 0, $r.Size)
    if (-not ($r.Flags -band 0x40000)) { return ,$d }
    $ms = New-Object IO.MemoryStream(, $d, 6, $d.Length - 6)
    $ds = New-Object IO.Compression.DeflateStream($ms, [IO.Compression.CompressionMode]::Decompress)
    $out = New-Object IO.MemoryStream
    try { $ds.CopyTo($out) } finally { $ds.Dispose(); $ms.Dispose() }
    return ,$out.ToArray()
}
$recs = New-Object Collections.Generic.List[object]
function Walk([int]$s, [int]$e) {
    $p = $s
    while ($p + 24 -le $e) {
        $t = Tag $b $p; $size = U32 $b ($p + 4)
        if ($t -eq 'GRUP') { Walk ($p + 24) ($p + $size); $p += $size; continue }
        $recs.Add([pscustomobject]@{ Tag = $t; Flags = (U32 $b ($p + 8)); Fid = (U32 $b ($p + 12)); At = $p + 24; Size = $size })
        $p += 24 + $size
    }
}
Walk (24 + (U32 $b 4)) $b.Length
$compressed = @($recs | Where-Object { $_.Flags -band 0x40000 }).Count
Yes ("the content plugin is read whole: {0} records, {1} of them compressed" -f $recs.Count, $compressed) ($recs.Count -gt 100)
$hits = New-Object Collections.Generic.List[string]
$named = 0
foreach ($r in $recs) {
    $d = RecordData $r
    $i = 0
    while ($i + 6 -le $d.Length) {
        $st = [Text.Encoding]::ASCII.GetString($d, $i, 4); $ss = [BitConverter]::ToUInt16($d, $i + 4)
        if ($st -eq 'EDID') {
            $named++
            $e = [Text.Encoding]::ASCII.GetString($d, $i + 6, $ss).TrimEnd([char]0)
            foreach ($px in $prefixes) { if ($e.StartsWith($px, [StringComparison]::Ordinal)) { $hits.Add(('{0} 0x{1:X8} {2}' -f $r.Tag, $r.Fid, $e)) } }
            break
        }
        $i += 6 + $ss
    }
}
Yes ("  and $named of them carry an editor id, so the prefixes were looked for") ($named -gt 100)
foreach ($h in $hits) { Write-Host "      matches a default prefix: $h" }
Yes ('no record matches either script''s default prefixes (' + ($prefixes -join ', ') + ')') ($hits.Count -eq 0)

# ---- 2. where they are ---------------------------------------------------------
$names = @('Remove-DeadRecords.ps1', 'Remove-DeadConditions.py')
foreach ($n in $names) {
    Yes "$n is not in scripts\mods" (-not (Test-Path -LiteralPath (P @('scripts', 'mods', $n))))
    Yes "  it is in scripts\oneoff" (Test-Path -LiteralPath (P @('scripts', 'oneoff', $n)))
}

# ---- 3. each refuses to run -------------------------------------------------------
$dr = P @('scripts', 'oneoff', 'Remove-DeadRecords.ps1')
if (Test-Path -LiteralPath $dr) {
    $before = (Get-FileHash -LiteralPath $plugin -Algorithm SHA256).Hash
    $ErrorActionPreference = 'Continue'
    $out = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $dr -NoPause 2>&1 | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Yes 'Remove-DeadRecords.ps1 refuses to run' ($code -ne 0 -and $out -match 'retired' -and $out -match '#4811')
    Yes '  and the content plugin is as it was' ((Get-FileHash -LiteralPath $plugin -Algorithm SHA256).Hash -eq $before)
} else { Yes 'Remove-DeadRecords.ps1 refuses to run' $false }
$dc = P @('scripts', 'oneoff', 'Remove-DeadConditions.py')
if (Test-Path -LiteralPath $dc) {
    $py = [IO.File]::ReadAllText($dc)
    $m = [regex]::Match($py, '^\s*(?:"""[\s\S]*?""")\s*(\S[^\r\n]*)')
    Yes 'Remove-DeadConditions.py raises SystemExit as its first statement after its docstring' ($m.Success -and $m.Groups[1].Value.StartsWith('raise SystemExit('))
    Yes '  saying it is retired' ($py -match 'raise SystemExit\([^)]*retired' -and $py -match '#4811')
} else { Yes 'Remove-DeadConditions.py raises SystemExit as its first statement after its docstring' $false }

# ---- 4. the indexes -----------------------------------------------------------------
$index = [IO.File]::ReadAllText((P @('scripts', 'README.md')))
$oneoff = [IO.File]::ReadAllText((P @('scripts', 'oneoff', 'README.md')))
foreach ($n in $names) {
    Yes "scripts\README.md has no row for $n" (-not $index.Contains($n))
    $row = @($oneoff -split "`n" | Where-Object { $_ -match ('^\|\s*`' + [regex]::Escape($n) + '`') })
    Yes "  scripts\oneoff\README.md has a row for it that says it refuses to run (#4811)" ($row.Count -eq 1 -and $row[0] -match 'refuses to run' -and $row[0] -match '#4811')
}

# ---- 5. nothing names the old path ------------------------------------------------
$all = @(& git -C $Repo ls-files)
Yes ('git lists the checkout''s files (' + $all.Count + ')') ($all.Count -gt 500)
$old = [regex]('mods[\\/]Remove-Dead(Records\.ps1|Conditions\.py)')
$left = @()
foreach ($f in $all) {
    if ($f -eq 'tests/test-4811-dead-record-scripts.ps1') { continue }
    if ($f -notmatch '\.(md|ps1|psm1|js|ts|cs|py|json|yml|yaml|txt|cmd|bat|html)$') { continue }
    $full = Join-Path $Repo $f
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $i = 0
    foreach ($line in ([IO.File]::ReadAllText($full) -split "`n")) { $i++; if ($old.IsMatch($line)) { $left += ('{0}:{1}' -f $f, $i) } }
}
foreach ($l in $left) { Write-Host "      still names the old path: $l" }
Yes 'no tracked file names either at its scripts\mods path' ($left.Count -eq 0)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
