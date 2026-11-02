<#
  Build-SpellTable.ps1

  Builds game\data\spells.json: the table the server needs to hand somebody a
  spell. Nothing in it is typed from memory. It is read out of the game's own
  master files on this machine.

  The server grants a spell with

      mp.callPapyrusFunction('method', 'Actor', 'AddSpell', <the actor>,
                             [{ type: 'espm', desc: '12fcd:Skyrim.esm' }, false])

  and that desc is a form id in hex plus the plugin the record belongs to.
  Guessing form ids is how a character ends up with the wrong spell or none,
  so this reads the SPEL records instead.

  What it does, in order:
    - reads the spell names out of the book in game\ui\thornswood-skills.js
      (DATA.spells), so the table covers exactly what the panel offers
    - reads the five master files, walks the SPEL top group in each, and pulls
      each record's editor id, name and kind
    - the masters are localised, so a record's name is a number into a string
      table. The English tables live inside Skyrim - Interface.bsa on this
      machine rather than loose in Data\Strings, so the BSA is read for them.
      A record whose name cannot be resolved falls back to its editor id and
      is reported as such
    - picks one record per name (see the knobs below), writes game\data\spells.json
      and prints the same table as a JavaScript object literal, because the
      server ships as one file and cannot read the json

  Read only. It touches nothing in the game folder and nothing on the VPS.

  Usage:
    .\scripts\dev\Build-SpellTable.ps1
    .\scripts\dev\Build-SpellTable.ps1 -Data 'C:\Thornswood\Game\Data'
    .\scripts\dev\Build-SpellTable.ps1 -JsOut "$env:TEMP\spells.js"

  Exit code 1 if a name in the book has no record, if two names land on the
  same record, or if a name had to be resolved by a rule other than the first.
#>
param(
    [string]   $Data     = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    [string]   $Book     = '',
    [string]   $Out      = '',
    [string]   $JsOut    = '',
    [string[]] $Plugins  = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'),
    # Print the table and leave its file in game\gamemode-tables alone.
    [switch]   $NoInstall
)

$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
# Thornswood's own plugins are read from game\content, every other plugin
# from -Data (#2923, OwnPlugins.ps1).
. (Join-Path $PSScriptRoot 'OwnPlugins.ps1')

# ---------------------------------------------------------------- knobs ----
# classes.md is the rulebook and it does not settle either of these. They are
# the two judgement calls this script makes, and they are here so they are in
# one place rather than buried in the code.
#
# LANGUAGE: which string table the names come from. classes.md says nothing
# about language; the server and the panel are English, so English.
$LANGUAGE = 'english'
#
# PICK: Skyrim has many SPEL records sharing one name. "Fireball" is fourteen
# records: the one a person casts, the left and right hand copies the game
# swaps in, six trap versions and a few belonging to one quest. classes.md
# does not say which is the spell somebody learns, so this script measures it
# rather than choosing: the spell a person learns is the one a spell tome
# teaches. Every BOOK record with the teaches-spell flag points at a SPEL
# record, and that is the record this table uses.
#
# The fallbacks, in order, for a name no tome teaches. Each one is reported
# per spell in spells.json so nobody has to trust the rule without looking.
#   1 'tome'  the record a spell tome teaches
#   2 'edid'  the record whose editor id is the name with the spaces taken out
#   3 'only'  there was only one record with that name
# A name that needs 2 or 3 is printed and makes the run fail, so it gets read
# by a person before it ships.
$PICK_ORDER = @('tome', 'edid', 'only')

if (-not $Book) { $Book = Join-Path $PSScriptRoot '..\..\game\ui\thornswood-skills.js' }
if (-not $Out)  { $Out  = Join-Path $PSScriptRoot '..\..\game\data\spells.json' }

$fail = 0
function Ok  ($m) { Write-Host "  ok    $m" -ForegroundColor Green }
function Bad ($m) { Write-Host "  FAIL  $m" -ForegroundColor Red; $script:fail++ }
function Note($m) { Write-Host "        $m" -ForegroundColor DarkGray }

# ------------------------------------------------------------ the pieces ----

# A record's data is zlib when flag 0x00040000 is set: four bytes of
# decompressed size, then the stream. DeflateStream wants the two byte zlib
# header gone, hence the +2.
function Expand-RecordData([byte[]]$src, [int]$offset, [int]$outLen) {
    $ms = New-Object System.IO.MemoryStream(, $src)
    $ms.Position = $offset + 2
    $ds = New-Object System.IO.Compression.DeflateStream($ms, [System.IO.Compression.CompressionMode]::Decompress)
    $out = New-Object byte[] $outLen
    $got = 0
    while ($got -lt $outLen) {
        $n = $ds.Read($out, $got, $outLen - $got)
        if ($n -le 0) { break }
        $got += $n
    }
    $ds.Dispose()
    $ms.Dispose()
    if ($got -ne $outLen) { throw "a compressed record unpacked to $got bytes, not $outLen" }
    return $out
}

# Pulls every .STRINGS file out of a BSA, by name, uncompressed. Version 105
# (Skyrim Special Edition): 24 byte folder records, a name block after them.
function Get-BsaStringFiles([string]$bsaPath) {
    $b = [System.IO.File]::ReadAllBytes($bsaPath)
    if ([System.Text.Encoding]::ASCII.GetString($b, 0, 3) -ne 'BSA') { throw "not a BSA: $bsaPath" }
    $version   = [BitConverter]::ToUInt32($b, 4)
    $folderOff = [BitConverter]::ToUInt32($b, 8)
    $archFlags = [BitConverter]::ToUInt32($b, 12)
    $folderCnt = [BitConverter]::ToUInt32($b, 16)
    $fileCnt   = [BitConverter]::ToUInt32($b, 20)
    $totFileN  = [BitConverter]::ToUInt32($b, 28)
    if ($version -ne 105) { throw "BSA version $version is not the Special Edition's 105: $bsaPath" }
    # 0x4 would mean every file in it is compressed, and in a version 105
    # archive that compression is LZ4, which this cannot unpack
    if ($archFlags -band 0x4) { throw "the archive is compressed throughout and cannot be read here: $bsaPath" }

    $sizes  = New-Object 'System.Collections.Generic.List[uint32]'
    $starts = New-Object 'System.Collections.Generic.List[uint32]'
    $nameBlock = 0
    for ($f = 0; $f -lt $folderCnt; $f++) {
        $o = [int]$folderOff + $f * 24
        $cnt      = [int][BitConverter]::ToUInt32($b, $o + 8)
        $blockOff = [BitConverter]::ToUInt64($b, $o + 16)
        # the folder record's offset counts the file name block in, so take it out
        $q = [int]($blockOff - $totFileN)
        $q += 1 + $b[$q]        # the folder's own name, a length byte then the text
        for ($i = 0; $i -lt $cnt; $i++) {
            $sizes.Add([BitConverter]::ToUInt32($b, $q + $i * 16 + 8))
            $starts.Add([BitConverter]::ToUInt32($b, $q + $i * 16 + 12))
        }
        $end = $q + $cnt * 16
        if ($end -gt $nameBlock) { $nameBlock = $end }
    }

    $out = @{}
    $q = $nameBlock
    for ($i = 0; $i -lt $fileCnt; $i++) {
        $s = $q
        while ($b[$q] -ne 0) { $q++ }
        $name = [System.Text.Encoding]::ASCII.GetString($b, $s, $q - $s).ToLowerInvariant()
        $q++
        if (-not $name.EndsWith('.strings')) { continue }
        $size = $sizes[$i]
        if ($size -band 0x40000000) {
            # the archive's default is uncompressed (flags 0x3); a file that
            # flips that would be LZ4 and this cannot read it
            Note "skipped a compressed strings file in the archive: $name"
            continue
        }
        $bytes = New-Object byte[] ([int]$size)
        [Array]::Copy($b, [int]$starts[$i], $bytes, 0, [int]$size)
        $out[$name] = $bytes
    }
    return $out
}

# A .STRINGS file: a count, a size, then count pairs of (string id, offset),
# then the text. Each string is zero terminated and has no length in front of
# it, which is what separates .STRINGS from .ILSTRINGS and .DLSTRINGS.
function Read-StringTable([byte[]]$bytes) {
    $count = [int][BitConverter]::ToUInt32($bytes, 0)
    $dataStart = 8 + $count * 8
    $t = @{}
    for ($i = 0; $i -lt $count; $i++) {
        $id  = [BitConverter]::ToUInt32($bytes, 8 + $i * 8)
        $off = [int][BitConverter]::ToUInt32($bytes, 8 + $i * 8 + 4)
        $p = $dataStart + $off
        $s = $p
        while ($bytes[$p] -ne 0) { $p++ }
        $t[$id] = [System.Text.Encoding]::GetEncoding(1252).GetString($bytes, $s, $p - $s)
    }
    return $t
}

# The masters a plugin declares, in order. A record's form id carries the
# index of the file it really belongs to in its top byte, so an Update.esm
# record with 00 up there is a Skyrim.esm record being overridden and the desc
# has to say Skyrim.esm.
function Get-PluginMasters([byte[]]$b, [int]$headerSize) {
    $masters = New-Object 'System.Collections.Generic.List[string]'
    $p = 24
    $end = 24 + $headerSize
    while ($p + 6 -le $end) {
        $t = [System.Text.Encoding]::ASCII.GetString($b, $p, 4)
        $sz = [int][BitConverter]::ToUInt16($b, $p + 4)
        if ($t -eq 'MAST') {
            $masters.Add([System.Text.Encoding]::GetEncoding(1252).GetString($b, $p + 6, $sz - 1))
        }
        $p += 6 + $sz
    }
    # ',' on purpose. A bare 'return $masters' is unrolled on the way out, and
    # a plugin with exactly one master then comes back as the bare string
    # 'Skyrim.esm' instead of a list of one. Its .Count still reads 1, so
    # nothing complains, but $masters[0] indexes the STRING and hands back the
    # character 'S', and every overridden record in Update.esm, Dawnguard.esm,
    # HearthFires.esm and Dragonborn.esm gets the desc '77e1c:S'. Those four
    # have exactly one master each, so this is the common case, not the odd one.
    # Proved in a shell before it was fixed: a one element List[string] returned
    # bare has GetType().Name = String, .Count = 1 and [0] = 'S'.
    return ,$masters.ToArray()
}

$SPELL_TYPES  = @('spell', 'disease', 'power', 'lesser power', 'ability', 'poison', '', '', '', '', 'addiction', 'voice power')
$CAST_TYPES   = @('constant effect', 'fire and forget', 'concentration')
$DELIVERIES   = @('self', 'contact', 'aimed', 'target actor', 'target location')

# One json string, quoted and escaped. Written here rather than reached for
# with ConvertTo-Json so the file comes out the same on 5.1 and on 7.
function JsonStr($s) {
    $t = [string]$s
    $t = $t.Replace('\', '\\')
    $t = $t.Replace('"', '\"')
    $t = $t.Replace("`r", '\r')
    $t = $t.Replace("`n", '\n')
    $t = $t.Replace("`t", '\t')
    return '"' + $t + '"'
}

# Every table and gamemode block this writes is joined with LF, the ending
# .gitattributes gives these files on every checkout (#3029). Until then each
# run took the ending of the file it found, because a checkout with autocrlf
# held them CRLF and the agents' VM and the runners' clones LF (#1622, #1787,
# #1828), so a run on One rewrote every table it touched.
$Eol = "`n"

function KindName($list, $i) {
    if ($i -ge 0 -and $i -lt $list.Count -and $list[$i]) { return $list[$i] }
    return "unknown ($i)"
}

# ------------------------------------------------------- the book's names ---

Write-Host ''
Write-Host 'the book' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $Book)) { throw "not found: $Book" }
$js = Get-Content -LiteralPath $Book -Raw
$at = $js.IndexOf('    spells: {')
if ($at -lt 0) { throw "no DATA.spells in $Book" }
$from = $js.IndexOf('schools: {', $at)
# Tested before it is used: IndexOf with a start of -1 throws its own error
# about startIndex and hides what is actually wrong with the book.
if ($from -lt 0) { throw "could not read the schools out of DATA.spells in $Book" }
$to   = $js.IndexOf("`n    },", $from)
if ($to -lt 0) { throw "could not read the end of the schools block in $Book" }
$block = $js.Substring($from, $to - $from)

# name -> the school and rank it sits under, in the order the book lists them
$wanted = New-Object System.Collections.Specialized.OrderedDictionary
$school = ''
foreach ($m in [regex]::Matches($block, "(?m)^\s*(\w+):\s*\{|(novice|advanced|expert|master):\s*\[([^\]]*)\]")) {
    if ($m.Groups[1].Success) { $school = $m.Groups[1].Value; continue }
    $rank = $m.Groups[2].Value
    foreach ($q in [regex]::Matches($m.Groups[3].Value, "'([^']+)'")) {
        $nm = $q.Groups[1].Value
        if ($wanted.Contains($nm)) {
            Bad "the book lists $nm twice, in $($wanted[$nm].School) and in $school"
        } else {
            $wanted[$nm] = [pscustomobject]@{ School = $school; Rank = $rank }
        }
    }
}
Ok ("{0} spell names in DATA.spells, across {1} schools" -f $wanted.Count, (($wanted.Values | ForEach-Object { $_.School } | Sort-Object -Unique).Count))

# ------------------------------------------------------- the string tables --

Write-Host ''
Write-Host 'names' -ForegroundColor Cyan
$tables = @{}
$looseDir = Join-Path $Data 'Strings'
# A localised plugin's table is loose in Data\Strings, or in an archive: its
# own (_ResourcePack.esl's is in _ResourcePack.bsa), or Skyrim - Interface.bsa
# for the five masters. The same places Build-HuntTable.ps1 and
# Build-HarvestTable.ps1 look (#3349: this read only Skyrim - Interface.bsa,
# and stopped on _ResourcePack.esl once dev's load order carried it).
$bsaCache = @{}
function Get-BsaCached([string]$name) {
    if ($bsaCache.ContainsKey($name)) { return $bsaCache[$name] }
    $p = Join-Path $Data $name
    if (-not (Test-Path -LiteralPath $p)) { $bsaCache[$name] = $null; return $null }
    $got = $null
    try { $got = Get-BsaStringFiles $p } catch { Note ("could not read {0}: {1}" -f $name, $_.Exception.Message); $got = $null }
    $bsaCache[$name] = $got
    return $got
}
foreach ($pl in $Plugins) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($pl).ToLowerInvariant()
    $want = $base + '_' + $LANGUAGE + '.strings'
    $loose = Join-Path $looseDir $want
    if (Test-Path -LiteralPath $loose) {
        $tables[$pl] = @{ Table = (Read-StringTable ([System.IO.File]::ReadAllBytes($loose))); Where = 'Data\Strings' }
        continue
    }
    # only a plugin flagged localised keeps its names in a string table, so
    # only its archives are opened
    $path = Get-PluginPath $Data $pl
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $head = New-Object byte[] 12
    $fs = [System.IO.File]::OpenRead($path)
    [void]$fs.Read($head, 0, 12)
    $fs.Dispose()
    if (-not ([BitConverter]::ToUInt32($head, 8) -band 0x80)) { continue }
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($pl)
    foreach ($cand in @(($stem + '.bsa'), ($stem + ' - Interface.bsa'), 'Skyrim - Interface.bsa')) {
        $files = Get-BsaCached $cand
        if ($files -and $files.ContainsKey($want)) {
            $tables[$pl] = @{ Table = (Read-StringTable $files[$want]); Where = $cand }
            break
        }
    }
}
foreach ($pl in $Plugins) {
    if ($tables.ContainsKey($pl)) {
        Ok ("{0}: {1} strings, from {2}" -f $pl, $tables[$pl].Table.Count, $tables[$pl].Where)
        continue
    }
    # a plugin that keeps its names inside its own records needs no table; one
    # that is flagged localised and has none can only fall back to editor ids,
    # and then a name in the book will not match anything
    $p = Get-PluginPath $Data $pl
    $localised = $false
    if (Test-Path -LiteralPath $p) {
        $head = New-Object byte[] 12
        $fs = [System.IO.File]::OpenRead($p)
        [void]$fs.Read($head, 0, 12)
        $fs.Dispose()
        $localised = [bool]([BitConverter]::ToUInt32($head, 8) -band 0x80)
    }
    if ($localised) { Bad ("{0}: localised and no $LANGUAGE string table found; its names fall back to editor ids" -f $pl) }
    else { Note ("{0}: no string table, and it does not need one; its names are in its own records" -f $pl) }
}

# --------------------------------------------------------- the SPEL records -

Write-Host ''
Write-Host 'records' -ForegroundColor Cyan
$records = New-Object 'System.Collections.Generic.List[object]'
$taught  = @{}
$fromEdid = 0

foreach ($pl in $Plugins) {
    $path = Get-PluginPath $Data $pl
    if (-not (Test-Path -LiteralPath $path)) { Bad "not found: $path"; continue }
    $b = [System.IO.File]::ReadAllBytes($path)
    if ([System.Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'TES4') { Bad "not a plugin: $path"; continue }
    $headerSize = [int][BitConverter]::ToUInt32($b, 4)
    $localized  = [bool]([BitConverter]::ToUInt32($b, 8) -band 0x80)
    $masters    = Get-PluginMasters $b $headerSize
    $strTable = $null
    if ($tables.ContainsKey($pl)) { $strTable = $tables[$pl].Table }

    $spels = 0
    $tomes = 0
    $i = 24 + $headerSize
    while ($i + 24 -le $b.Length) {
        if ([System.Text.Encoding]::ASCII.GetString($b, $i, 4) -ne 'GRUP') { break }
        $groupSize = [int][BitConverter]::ToUInt32($b, $i + 4)
        if ($groupSize -lt 24) { break }
        $label = [System.Text.Encoding]::ASCII.GetString($b, $i + 8, 4)
        if ($label -eq 'SPEL' -or $label -eq 'BOOK') {
            $j = $i + 24
            $groupEnd = $i + $groupSize
            while ($j + 24 -le $groupEnd) {
                $type      = [System.Text.Encoding]::ASCII.GetString($b, $j, 4)
                $dataSize  = [int][BitConverter]::ToUInt32($b, $j + 4)
                $recFlags  = [BitConverter]::ToUInt32($b, $j + 8)
                $formId    = [BitConverter]::ToUInt32($b, $j + 12)
                if ($type -eq $label) {
                    if ($recFlags -band 0x00040000) {
                        $outLen = [int][BitConverter]::ToUInt32($b, $j + 24)
                        $rec = Expand-RecordData $b ($j + 28) $outLen
                    } else {
                        $rec = New-Object byte[] $dataSize
                        [Array]::Copy($b, $j + 24, $rec, 0, $dataSize)
                    }
                    $k = 0
                    $over = 0
                    $edid = ''
                    $full = ''
                    $fullFrom = ''
                    $sType = -1
                    $cType = -1
                    $deliv = -1
                    $cost  = -1
                    $teaches = 0
                    while ($k + 6 -le $rec.Length) {
                        $sub = [System.Text.Encoding]::ASCII.GetString($rec, $k, 4)
                        $sz  = [int][BitConverter]::ToUInt16($rec, $k + 4)
                        $k += 6
                        # XXXX carries the real size of the subrecord after it,
                        # for anything bigger than two bytes can say
                        if ($over -gt 0) { $sz = $over; $over = 0 }
                        if ($sub -eq 'XXXX') { $over = [int][BitConverter]::ToUInt32($rec, $k); $k += $sz; continue }
                        if ($sub -eq 'EDID' -and $sz -gt 1) {
                            $edid = [System.Text.Encoding]::GetEncoding(1252).GetString($rec, $k, $sz - 1)
                        } elseif ($sub -eq 'FULL') {
                            if ($localized -and $sz -eq 4) {
                                $sid = [BitConverter]::ToUInt32($rec, $k)
                                if ($strTable -and $strTable.ContainsKey($sid)) {
                                    $full = $strTable[$sid]
                                    $fullFrom = 'string table'
                                }
                            } elseif ($sz -gt 1) {
                                $full = [System.Text.Encoding]::GetEncoding(1252).GetString($rec, $k, $sz - 1)
                                $fullFrom = 'the record'
                            }
                        } elseif ($sub -eq 'SPIT' -and $sz -ge 24) {
                            $cost  = [int][BitConverter]::ToUInt32($rec, $k)
                            $sType = [int][BitConverter]::ToUInt32($rec, $k + 8)
                            $cType = [int][BitConverter]::ToUInt32($rec, $k + 16)
                            $deliv = [int][BitConverter]::ToUInt32($rec, $k + 20)
                        } elseif ($sub -eq 'DATA' -and $label -eq 'BOOK' -and $sz -ge 16) {
                            # BOOK flags: 0x04 is teaches a spell, and then the
                            # four bytes after them are the spell's form id
                            if ($rec[$k] -band 0x04) { $teaches = [BitConverter]::ToUInt32($rec, $k + 4) }
                        }
                        $k += $sz
                    }

                    if ($label -eq 'BOOK') {
                        if ($teaches -ne 0) {
                            $mi = [int]($teaches -shr 24)
                            $owner = $pl
                            if ($mi -lt $masters.Count) { $owner = $masters[$mi] }
                            $taught[(('{0:x}' -f ($teaches -band 0xFFFFFF)) + ':' + $owner)] = $true
                            $tomes++
                        }
                    } else {
                        if (-not $full) {
                            $full = $edid
                            $fullFrom = 'the editor id'
                            $fromEdid++
                        }
                        $mi = [int]($formId -shr 24)
                        $owner = $pl
                        if ($mi -lt $masters.Count) { $owner = $masters[$mi] }
                        $local = $formId -band 0xFFFFFF
                        $records.Add([pscustomobject]@{
                            Full     = $full
                            FullFrom = $fullFrom
                            Edid     = $edid
                            Plugin   = $owner
                            SeenIn   = $pl
                            Local    = $local
                            Desc     = ('{0:x}' -f $local) + ':' + $owner
                            Kind     = (KindName $SPELL_TYPES $sType) + ', ' + (KindName $CAST_TYPES $cType) + ', ' + (KindName $DELIVERIES $deliv)
                            Cost     = $cost
                        })
                        $spels++
                    }
                }
                $j += 24 + $dataSize
            }
        }
        $i += $groupSize
    }
    Ok ("{0}: {1} SPEL records, {2} books that teach a spell" -f $pl, $spels, $tomes)
}
Ok ("{0} SPEL records in all, {1} spells taught by a book" -f $records.Count, $taught.Count)
if ($fromEdid -gt 0) { Note "$fromEdid records had no readable name and fell back to their editor id" }

# ------------------------------------------------------------ the picking ---

Write-Host ''
Write-Host 'picking' -ForegroundColor Cyan
$byName = @{}
foreach ($r in $records) {
    if (-not $byName.ContainsKey($r.Full)) { $byName[$r.Full] = New-Object 'System.Collections.Generic.List[object]' }
    $byName[$r.Full].Add($r)
}

function Flatten($s) { return (($s -replace '[^A-Za-z0-9]', '').ToLowerInvariant()) }

$table  = New-Object System.Collections.Specialized.OrderedDictionary
$detail = New-Object System.Collections.Specialized.OrderedDictionary
$holes  = New-Object 'System.Collections.Generic.List[string]'
$soft   = New-Object 'System.Collections.Generic.List[string]'

foreach ($name in $wanted.Keys) {
    if (-not $byName.ContainsKey($name)) { $holes.Add($name); continue }
    # .ToArray() rather than @(...): PowerShell 7.6.6 throws "Argument types do
    # not match" when @() is wrapped round a List[object].
    $cands = $byName[$name].ToArray()
    $chosen = $null
    $how = ''
    foreach ($rule in $PICK_ORDER) {
        if ($rule -eq 'tome') {
            $hit = @($cands | Where-Object { $taught.ContainsKey($_.Desc) })
            $descs = @($hit | ForEach-Object { $_.Desc } | Sort-Object -Unique)
            if ($descs.Count -eq 1) { $chosen = $hit[0]; $how = 'the record a spell tome teaches'; break }
        } elseif ($rule -eq 'edid') {
            $hit = @($cands | Where-Object { (Flatten $_.Edid) -eq (Flatten $name) })
            $descs = @($hit | ForEach-Object { $_.Desc } | Sort-Object -Unique)
            if ($descs.Count -eq 1) { $chosen = $hit[0]; $how = 'the record whose editor id is the name'; break }
        } elseif ($rule -eq 'only') {
            $descs = @($cands | ForEach-Object { $_.Desc } | Sort-Object -Unique)
            if ($descs.Count -eq 1) { $chosen = $cands[0]; $how = 'the only record with that name'; break }
        }
    }
    if (-not $chosen) {
        $holes.Add($name)
        Bad ("{0}: {1} records with that name and no rule settles it" -f $name, $cands.Count)
        foreach ($c in $cands) { Note ("  {0}  {1}" -f $c.Desc, $c.Edid) }
        continue
    }
    if ($how -ne 'the record a spell tome teaches') { $soft.Add(("{0} ({1})" -f $name, $how)) }
    $table[$name] = $chosen.Desc
    $detail[$name] = [ordered]@{
        desc     = $chosen.Desc
        editorId = $chosen.Edid
        plugin   = $chosen.Plugin
        formId   = '0x' + ('{0:X6}' -f $chosen.Local)
        kind     = $chosen.Kind
        cost     = $chosen.Cost
        school   = $wanted[$name].School
        rank     = $wanted[$name].Rank
        nameFrom = $chosen.FullFrom
        pickedBy = $how
    }
}

if ($holes.Count -gt 0) {
    Bad ("{0} name(s) in the book have no record in the game files: {1}" -f $holes.Count, ($holes -join ', '))
} else {
    Ok ("all {0} names in the book resolved" -f $table.Count)
}
if ($soft.Count -gt 0) {
    Bad ("{0} name(s) needed a fallback rule, read them before this ships: {1}" -f $soft.Count, ($soft -join '; '))
} elseif ($table.Count -gt 0) {
    Ok 'every one of them is the record a spell tome teaches'
}

# duplicates: two names on one record is a table with a hole in it
$seen = @{}
$dupes = New-Object 'System.Collections.Generic.List[string]'
foreach ($name in $table.Keys) {
    $d = $table[$name]
    if ($seen.ContainsKey($d)) { $dupes.Add(("{0} and {1} both point at {2}" -f $seen[$d], $name, $d)) }
    else { $seen[$d] = $name }
}
if ($dupes.Count -gt 0) { foreach ($d in $dupes) { Bad $d } } else { Ok 'no two names point at the same record' }

# the ids: hex digits and a plugin named. Four is a real length here, not a
# fault: gamemode.js already carries 9456:PlayFluteLuteDrum.esp, and a small
# plugin with low form ids would have been called wrong by a stricter test.
$oddIds = @($table.Keys | Where-Object { $table[$_] -cnotmatch '^[0-9a-f]{1,8}:[^:]+\.es[mpl]$' })
if ($oddIds.Count -gt 0) {
    foreach ($o in $oddIds) { Bad ("{0} has an id that does not look right: {1}" -f $o, $table[$o]) }
} else {
    Ok 'every desc is hex digits and a plugin'
}

$perPlugin = @{}
foreach ($name in $detail.Keys) {
    $p = $detail[$name].plugin
    if (-not $perPlugin.ContainsKey($p)) { $perPlugin[$p] = 0 }
    $perPlugin[$p] = $perPlugin[$p] + 1
}
foreach ($p in ($perPlugin.Keys | Sort-Object)) { Note ("{0}: {1}" -f $p, $perPlugin[$p]) }

# ------------------------------------------------------------- the writing -

Write-Host ''
Write-Host 'writing' -ForegroundColor Cyan
# The json is written out by hand rather than with ConvertTo-Json, and there is
# no timestamp in it, so that the same game files give byte for byte the same
# file: ConvertTo-Json lays out Windows PowerShell 5.1 and PowerShell 7
# differently, and a rebuild that changed nothing would be a whole-file diff.
# It is joined with LF, as everything this writes is.
$jsonEol = $Eol
$docLines = New-Object 'System.Collections.Generic.List[string]'
$docLines.Add('{')
$docLines.Add('  "builtBy": ' + (JsonStr 'scripts\dev\Build-SpellTable.ps1') + ',')
$docLines.Add('  "source": ' + (JsonStr ('the SPEL records of ' + ($Plugins -join ', '))) + ',')
$docLines.Add('  "language": ' + (JsonStr $LANGUAGE) + ',')
$docLines.Add('  "count": ' + $table.Count + ',')
$docLines.Add('  "spells": {')
$n = 0
foreach ($name in $table.Keys) {
    $n++
    $comma = ','
    if ($n -eq $table.Count) { $comma = '' }
    $docLines.Add('    ' + (JsonStr $name) + ': ' + (JsonStr $table[$name]) + $comma)
}
$docLines.Add('  },')
$docLines.Add('  "detail": {')
$n = 0
foreach ($name in $detail.Keys) {
    $n++
    $comma = ','
    if ($n -eq $detail.Count) { $comma = '' }
    $d = $detail[$name]
    $docLines.Add('    ' + (JsonStr $name) + ': {')
    $fields = New-Object 'System.Collections.Generic.List[string]'
    foreach ($f in $d.Keys) {
        if ($f -eq 'cost') { $fields.Add('      "' + $f + '": ' + $d[$f]) }
        else { $fields.Add('      "' + $f + '": ' + (JsonStr ([string]$d[$f]))) }
    }
    $docLines.Add(($fields -join (',' + $jsonEol)))
    $docLines.Add('    }' + $comma)
}
$docLines.Add('  }')
$docLines.Add('}')
$json = ($docLines -join $jsonEol) + $jsonEol

# A run that failed leaves the table it could not rebuild exactly as it was.
# It used to write whatever it had: pointing -Data at a folder that is not
# there took a good 85 spell table down to 240 bytes of nothing, and the file
# is not in git, so there was nothing to get back. Nothing is written until
# every check above has passed.
if ($fail -gt 0) {
    Bad ("{0} check(s) failed, so {1} was left exactly as it was" -f $fail, $Out)
} else {
    [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
    Ok ("wrote {0} ({1} spells, {2} bytes)" -f $Out, $table.Count, $json.Length)
}

$lines = New-Object 'System.Collections.Generic.List[string]'
$lines.Add('/* Built by scripts\dev\Build-SpellTable.ps1 out of the game''s own SPEL records.')
$lines.Add('     ' + $table.Count + ' spells, the same table as game\data\spells.json.')
$lines.Add('     The gamemode reads it from game\gamemode-tables\SPELL_IDS.json. Do not hand edit. */')
$lines.Add('  var SPELL_IDS = {')
$n = 0
foreach ($name in $table.Keys) {
    $n++
    $comma = ','
    if ($n -eq $table.Count) { $comma = '' }
    $lines.Add(("  '{0}': '{1}'{2}" -f ($name -replace "'", "\'"), $table[$name], $comma))
}
$lines.Add('};')
$literal = $lines -join [Environment]::NewLine


# ---------------------------------------------------------------- install --
#
# The gamemode reads the table from game\gamemode-tables\SPELL_IDS.json when
# it loads (#5191): until then this wrote it between markers in gamemode.js,
# and every content change rewrote the same lines there. -NoInstall prints it
# and leaves the file alone.
#
if (-not $NoInstall -and $fail -eq 0) {
    . (Join-Path $PSScriptRoot 'GamemodeTables.ps1')
    $rows = New-Object 'System.Collections.Generic.List[string]'
    foreach ($name in $table.Keys) { $rows.Add((JsonStr ([string]$name)) + ':' + (JsonStr ([string]$table[$name]))) }
    $changed = Write-GamemodeTable 'SPELL_IDS' ('{' + ($rows -join ',') + '}')
    if ($changed) { Ok ("wrote {0} spells into {1}" -f $table.Count, (Get-GamemodeTableFile 'SPELL_IDS')) }
    else { Ok ("{0} already holds these {1} spells" -f (Get-GamemodeTableFile 'SPELL_IDS'), $table.Count) }
}

Write-Host ''
Write-Host 'the same table, as JavaScript (the gamemode reads its file in game\gamemode-tables):' -ForegroundColor Cyan
Write-Host $literal
if ($JsOut) {
    [System.IO.File]::WriteAllText($JsOut, $literal, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ''
    Ok "wrote $JsOut"
}

Write-Host ''
if ($fail) {
    Write-Host "$fail check(s) failed. Read those before the table ships." -ForegroundColor Red
    exit 1
}
Write-Host ("the table is complete: {0} spells, none missing, none doubled." -f $table.Count) -ForegroundColor Green
