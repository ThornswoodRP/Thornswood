<#
  Remove-DeadRecords.ps1

  RETIRED. DO NOT RUN (#4811). It did its one job in September: the sixteen
  Writs of the old trade system, and with Remove-DeadConditions.py the rank
  manuals. On 12 November no record in Thornswood-Content.esp matched its
  default prefix (372 records read, none compressed), nothing called it, and
  its proof that nothing points at a record read the content plugin alone,
  though the gamemode keys records by form id and other plugins master this
  one. It refuses to run, and the rest of the file is kept for the history
  of how those records went.

  Deletes records from Thornswood-Content.esp that nothing uses any more, and
  refuses to delete one that anything still points at.

  WHY

  Patrick, 21 September: "the books were supposed to be replaced with our new
  system", and then "let's clean up the historical stuff so it's not all a mess
  when we try to change and implement things and people don't download more
  than what they even need".

  WHAT GOES, AND WHY EACH ONE IS DEAD

    ThornswoodWrit*   sixteen books, one per trade of the OLD sixteen trade
                      system: warrior, hunter, mage, smith, miner, woodworker,
                      alchemist, bard, cook, enchanter, farmer, fisher,
                      merchant, priest, scholar and thief. The five classes and
                      eight professions replaced all sixteen, so a Writ of the
                      Bard is a book about a trade this server does not have.
                      Nothing live reads one: the only references are in
                      tools\thornswood-src, which is a historical pipeline, and
                      in its own tests.

  WHAT DOES NOT GO, AND THIS MATTERS

    ThornswoodPassage*  NINE of these key CHARGEN.towns in gamemode.js. The
                        creation panel's town list is literally keyed by their
                        form ids, so deleting them breaks choosing a home. They
                        stay. The tenth, Ravenrock, is unused, and it stays too
                        rather than being deleted for the sake of one record.
    Thornswood*Novice/Advanced/Expert/Master  the seventeen rank manuals still
                        do something: reading one counts once as work in the
                        ladder it is about. They are placed nowhere, which is a
                        separate entry on the list, not a reason to delete them.

  WHAT IT PROVES BEFORE IT WRITES

  Same discipline as the editor id rename of 21 September, whose parser this
  borrowed (that script did its one job and is gone, #400). It reads the file and writes it back byte for byte first, because a
  parser that cannot reproduce what it was given has no business editing it.
  Then, for every record it is about to delete, it searches every other record
  in the file for that form id, INCLUDING the hundred compressed ones, which it
  inflates. A compressed record is where a placed reference lives, so leaving
  them unsearched would be leaving out the only place the answer could be. If
  anything at all points at a candidate, nothing is written.

  Afterwards it checks the result: every record that was not deleted is still
  there, in the same order, with the same form id, type, flags and bytes.

  THIS IS A SHIPPED FILE, so its size changing means a release and every client
  downloading it again.

  Usage:
    .\scripts\oneoff\Remove-DeadRecords.ps1 -Check
    .\scripts\oneoff\Remove-DeadRecords.ps1

  Exit code 1 if anything points at a candidate, if the parse does not round
  trip, or if the result does not verify.
#>
[CmdletBinding()]
param(
    [string]$Data,
    [string]$Plugin = 'Thornswood-Content.esp',
    # Editor id prefixes to remove. NOT a knob to widen casually: every name
    # here was checked against the live gamemode before it was added.
    [string[]]$Prefixes = @('ThornswoodWrit'),
    [switch]$Check,
    [switch]$NoPause
)

# The refusal comes before anything else, so no part of it can run by
# accident (#4811, as #1179 retired the others in scripts\oneoff).
throw ('STOP. Remove-DeadRecords.ps1 is retired and changes nothing (#4811). No record in ' +
       'Thornswood-Content.esp matches its prefixes any more, and its proof that nothing points ' +
       'at a record read the content plugin alone.')

$ErrorActionPreference = 'Stop'

if (-not $Data) {
    $repo = & (Join-Path $PSScriptRoot '..\release\Where.ps1') Repo
    $Data = Join-Path $repo 'game\content'
}

function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Ok($m)  { Write-Host ('  ok    ' + $m) -ForegroundColor Green }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

$path = Join-Path $Data $Plugin
if (-not (Test-Path -LiteralPath $path)) { Die "no $Plugin at $path" }
$bytes = [System.IO.File]::ReadAllBytes($path)

Head 'The file'
Say ("  {0}" -f $path)
Say ("  {0:N0} bytes" -f $bytes.Length)

function U32($i) { [BitConverter]::ToUInt32($bytes, $i) }
function TAG($i) { [System.Text.Encoding]::ASCII.GetString($bytes, $i, 4) }

function Inflate([byte[]]$raw) {
    $ms = New-Object System.IO.MemoryStream(, [byte[]]$raw[2..($raw.Length - 1)])
    $ds = New-Object System.IO.Compression.DeflateStream($ms, [System.IO.Compression.CompressionMode]::Decompress)
    $out = New-Object System.IO.MemoryStream
    try { $ds.CopyTo($out) } catch { return $null } finally { $ds.Dispose(); $ms.Dispose() }
    return $out.ToArray()
}

function ParseNodes([int]$start, [int]$end) {
    $out = New-Object 'System.Collections.Generic.List[object]'
    $p = $start
    while ($p + 24 -le $end) {
        $type = TAG $p
        $size = U32 ($p + 4)
        if ($type -eq 'GRUP') {
            if ($size -lt 24 -or $p + $size -gt $end) { Die "a group at $p says it is $size bytes, which does not fit" }
            $out.Add([pscustomobject]@{
                Kind = 'GRUP'; Header = $bytes[$p..($p + 23)]
                Children = (ParseNodes ($p + 24) ($p + $size)); Data = $null
                Type = $type; FormId = 0; Flags = 0; EditorId = ''; Plain = $null })
            $p += $size
        } else {
            if ($p + 24 + $size -gt $end) { Die "a record at $p says its data is $size bytes, which does not fit" }
            $flags = U32 ($p + 8)
            $data = $(if ($size -gt 0) { [byte[]]$bytes[($p + 24)..($p + 24 + $size - 1)] } else { [byte[]]@() })
            $compressed = (($flags -band 0x00040000) -ne 0)
            # Plain is what gets searched for a form id: the data itself when it
            # is not compressed, and the inflated body when it is.
            $plain = $data
            if ($compressed) {
                $plain = $null
                if ($data.Length -gt 6) { $plain = Inflate ([byte[]]$data[4..($data.Length - 1)]) }
                if (-not $plain) { Die ("a compressed record at $p would not inflate, so nothing can be proved about it") }
            }
            $edid = ''
            if (-not $compressed) {
                $s = 0
                while ($s + 6 -le $plain.Length) {
                    $st = [System.Text.Encoding]::ASCII.GetString($plain, $s, 4)
                    $ssz = [int][BitConverter]::ToUInt16($plain, $s + 4)
                    if ($ssz -le 0 -or $s + 6 + $ssz -gt $plain.Length) { break }
                    if ($st -eq 'EDID') { $edid = [System.Text.Encoding]::ASCII.GetString($plain, $s + 6, $ssz - 1); break }
                    $s += 6 + $ssz
                }
            }
            $out.Add([pscustomobject]@{
                Kind = 'REC'; Header = $bytes[$p..($p + 23)]; Children = $null
                Data = $data; Type = $type; FormId = U32 ($p + 12); Flags = $flags
                EditorId = $edid; Plain = $plain })
            $p += 24 + $size
        }
    }
    if ($p -ne $end) { Die "the walk from $start stopped at $p and should have stopped at $end" }
    return , $out
}

function Serialise($nodes, [System.IO.MemoryStream]$ms) {
    foreach ($n in $nodes) {
        if ($n.Kind -eq 'GRUP') {
            $inner = New-Object System.IO.MemoryStream
            Serialise $n.Children $inner
            $body = $inner.ToArray()
            # A group that has lost every child is written as an empty group
            # rather than removed: removing it would change the shape of the
            # file beyond what was asked for, and an empty top group is legal.
            $hdr = $n.Header.Clone()
            [Array]::Copy([BitConverter]::GetBytes([uint32]($body.Length + 24)), 0, $hdr, 4, 4)
            $ms.Write($hdr, 0, 24)
            if ($body.Length) { $ms.Write($body, 0, $body.Length) }
        } else {
            $hdr = $n.Header.Clone()
            [Array]::Copy([BitConverter]::GetBytes([uint32]$n.Data.Length), 0, $hdr, 4, 4)
            $ms.Write($hdr, 0, 24)
            if ($n.Data.Length) { $ms.Write($n.Data, 0, $n.Data.Length) }
        }
    }
}

$headerSize = U32 4
$tes4 = $bytes[0..(24 + $headerSize - 1)]
$tree = ParseNodes (24 + $headerSize) $bytes.Length

Head 'Can the parser reproduce the file it was given'
$ms = New-Object System.IO.MemoryStream
$ms.Write($tes4, 0, $tes4.Length)
Serialise $tree $ms
$rt = $ms.ToArray()
if ($rt.Length -ne $bytes.Length) { Die ("the round trip came out {0:N0} bytes against {1:N0}" -f $rt.Length, $bytes.Length) }
for ($i = 0; $i -lt $bytes.Length; $i++) { if ($rt[$i] -ne $bytes[$i]) { Die "the round trip differs at byte $i" } }
Ok ("parsed and written back byte for byte, {0:N0} bytes" -f $rt.Length)

$all = New-Object 'System.Collections.Generic.List[object]'
function Flatten($nodes) { foreach ($n in $nodes) { if ($n.Kind -eq 'GRUP') { Flatten $n.Children } else { $all.Add($n) } } }
Flatten $tree

Head 'What would go'
$targets = @($all | Where-Object { $e = $_.EditorId; $e -and ($Prefixes | Where-Object { $e -like ($_ + '*') }).Count -gt 0 })
if ($targets.Count -eq 0) {
    Ok 'nothing matches. There is nothing to remove.'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}
foreach ($t in $targets) { Say ('  {0}  0x{1:X7}  {2}' -f $t.Type, $t.FormId, $t.EditorId) }

Head 'Does anything still point at them'
$ids = @{}
foreach ($t in $targets) { $ids[$t.FormId] = $t.EditorId }
$hits = 0
foreach ($r in $all) {
    if ($ids.ContainsKey($r.FormId)) { continue }
    if (-not $r.Plain) { continue }
    for ($i = 0; $i + 4 -le $r.Plain.Length; $i++) {
        $v = [BitConverter]::ToUInt32($r.Plain, $i)
        if ($ids.ContainsKey($v)) {
            Say ('  POINTED AT: {0} 0x{1:X7} holds 0x{2:X7} ({3})' -f $r.Type, $r.FormId, $v, $ids[$v]) 'Yellow'
            $hits++
        }
    }
}
if ($hits -gt 0) { Die "$hits reference(s) to records this was asked to delete. Nothing was written." }
$comp = @($all | Where-Object { ($_.Flags -band 0x00040000) -ne 0 })
Ok ("nothing points at any of them, and that includes all {0} compressed records, every one inflated" -f $comp.Count)

if ($Check) {
    Head 'Nothing was written'
    Say ('  -Check. {0} record(s) would go.' -f $targets.Count)
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ---------------------------------------------------------------- remove ----
function Prune($nodes) {
    $keep = New-Object 'System.Collections.Generic.List[object]'
    foreach ($n in $nodes) {
        if ($n.Kind -eq 'GRUP') { $n.Children = (Prune $n.Children); $keep.Add($n); continue }
        if ($ids.ContainsKey($n.FormId)) { continue }
        $keep.Add($n)
    }
    return , $keep
}
$tree = Prune $tree

$ms2 = New-Object System.IO.MemoryStream
$ms2.Write($tes4, 0, $tes4.Length)
Serialise $tree $ms2
$result = $ms2.ToArray()

Head 'Proving the result'
$orig = $all
$bytesOld = $bytes
$bytes = $result
$after = ParseNodes (24 + (U32 4)) $bytes.Length
$bytes = $bytesOld
$afterFlat = New-Object 'System.Collections.Generic.List[object]'
function Flatten2($nodes) { foreach ($n in $nodes) { if ($n.Kind -eq 'GRUP') { Flatten2 $n.Children } else { $afterFlat.Add($n) } } }
Flatten2 $after

$expected = @($orig | Where-Object { -not $ids.ContainsKey($_.FormId) })
if ($afterFlat.Count -ne $expected.Count) {
    Die ("the result holds {0} records and {1} were expected" -f $afterFlat.Count, $expected.Count)
}
for ($i = 0; $i -lt $expected.Count; $i++) {
    $a = $expected[$i]; $c = $afterFlat[$i]
    if ($a.Type -ne $c.Type -or $a.FormId -ne $c.FormId -or $a.Flags -ne $c.Flags) {
        Die ("record $i does not match: 0x{0:X} became 0x{1:X}" -f $a.FormId, $c.FormId)
    }
    if ($a.Data.Length -ne $c.Data.Length) { Die ("record 0x{0:X} changed size" -f $a.FormId) }
    for ($j = 0; $j -lt $a.Data.Length; $j++) {
        if ($a.Data[$j] -ne $c.Data[$j]) { Die ("record 0x{0:X} changed at byte $j" -f $a.FormId) }
    }
}
Ok ("{0} records kept, every one byte for byte as it was, in the same order" -f $expected.Count)
Ok ("{0} records removed" -f ($orig.Count - $expected.Count))

<#
  THE HEADER'S RECORD COUNT, which this used to leave alone and should not have.

  HEDR carries the number of records in the file after a version float. Deleting
  sixteen records without changing it leaves the file saying it holds sixteen
  more than it does. Measured 21 September: the header had said 408 since before
  this script existed while the file held 392, so the rename before it and this
  script after it had both walked past a number that was already wrong, and the
  trim made it worse. The engine plainly does not read it, because the plugin has
  been shipping and working in that state, but a wrong number in a file is a
  thing somebody trusts later.

  So it is written from what is actually there, every time, rather than adjusted
  by however many went. Adjusting a wrong number keeps it wrong.
#>
$hedr = -1
for ($i = 24; $i -lt (24 + 100) -and $i + 4 -le $result.Length; $i++) {
    if ([System.Text.Encoding]::ASCII.GetString($result, $i, 4) -eq 'HEDR') { $hedr = $i; break }
}
if ($hedr -lt 0) { Die 'no HEDR in the header, so the record count cannot be set' }
$countAt = $hedr + 6 + 4
$claimed = [BitConverter]::ToInt32($result, $countAt)
[Array]::Copy([BitConverter]::GetBytes([int]$afterFlat.Count), 0, $result, $countAt, 4)
if ($claimed -ne $afterFlat.Count) {
    Ok ("the header said {0} records and the file holds {1}. Set to {1}." -f $claimed, $afterFlat.Count)
} else {
    Ok ("the header record count reads {0}, which is what is in the file" -f $afterFlat.Count)
}

Head 'Writing'
$backup = $path + '.before-trim-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
[System.IO.File]::WriteAllBytes($backup, $bytes)
Say ('  kept the original as ' + (Split-Path -Leaf $backup))
[System.IO.File]::WriteAllBytes($path, $result)
Say ("  {0:N0} bytes, was {1:N0}" -f $result.Length, $bytes.Length)
Say ''
Say '  This is a shipped file, so this needs a release like the rename did.'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
