<#
  Build-OreTable.ps1

  Builds game\data\ores.json: the table the server needs to answer an ore vein.
  Nothing in it is typed from memory. It is read out of the plugins of the
  build on this machine.

  WHY THERE IS ANYTHING TO BUILD

  The server does not handle a vein today. A vein is an ACTI record whose
  behaviour is a Papyrus script (MineOreScript), the server runs no scripts,
  so mining happens on the client and nothing gates it: anybody who walks up
  to a seam works it, miner or not, novice or master. classes.md says the
  opposite. 'Mine' is the miner's verb and rank decides which source somebody
  may work at all and how much it gives.

  The gamemode can take a base over the same way the salt quarry is taken
  over: publish the base in server-bases.json (publishServerBases) and answer
  it in mp.onActivate (mineSalt). For that it needs the veins, and what each
  one gives. That is this table.

  WHERE THE ORE COMES FROM, MEASURED RATHER THAN GUESSED

  A vein names its own ore. The script attached to the record lives in the
  record's VMAD subrecord, and a script's properties are in there with it:
  script name, then a property name, a type byte, and the value. The ore is
  the object property called Ore, and an object property is a form id. So the
  ore is read out of the record, not out of the record's title.

  Nothing here falls back to matching a vein's name against an ore's name.
  VMAD reads, and every row says where it came from: readFrom in
  game\data\ores.json names the property that row was read out of. What this build
  holds, measured on 20 September: 586 records carry the script, 581 of them
  name an ore, and the five that do not are Blackreach seams that hand out a
  levelled list of gems rather than one item. Those five are listed in the
  json under skipped rather than quietly dropped, because a levelled list is
  not something the server can hand somebody as one thing.

  Read only. It touches nothing in the game folder and nothing on the VPS,
  and it proves that with a listing of the folder before and after.

  Usage:
    .\scripts\dev\Build-OreTable.ps1
    .\scripts\dev\Build-OreTable.ps1 -Data 'C:\Thornswood\Game\Data'
    .\scripts\dev\Build-OreTable.ps1 -NoInstall
    .\scripts\dev\Build-OreTable.ps1 -JsOut "$env:TEMP\ores.js"

  Exit code 1 if a vein's ore does not resolve to a record, if an ore has no
  value to rank it by, if the game folder changed under it, or if any other
  check below fails. Nothing is written unless every check passed.
#>
param(
    # The build's Data folder. Read only.
    [string]   $Data       = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    # The load order. The five Bethesda masters are always first and are never
    # in this file, so they are put in front of it.
    [string]   $PluginsTxt = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Profile\Default\plugins.txt'),
    # Overrides the load order entirely when it is given.
    [string[]] $Plugins    = @(),
    [string]   $Out        = '',
    [string]   $JsOut      = '',
    # Print the table and leave game\gamemode-tables\ORES_BY_BASE.json alone.
    [switch]   $NoInstall
)

$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
# Thornswood's own plugins are read from game\content, every other plugin
# from -Data (#2923, OwnPlugins.ps1).
. (Join-Path $PSScriptRoot 'OwnPlugins.ps1')

# ---------------------------------------------------------------- knobs ----
# classes.md is the rulebook. It settles who may mine and that rank decides
# what a source gives, and it settles nothing below. These are the judgement
# calls this script makes, and they are here in one place rather than buried
# in the code.
#
# LANGUAGE: which string table the names come from. classes.md says nothing
# about language; the server and the panel are English, so English.
$LANGUAGE = 'english'
#
# THE SCRIPT THAT MAKES A RECORD A VEIN. Measured, not assumed: across the
# whole load order of this build, MineOreScript is the only script on an ACTI
# or a FURN that carries an object property called Ore, and every record
# carrying that property carries this script. A vein is therefore a record
# with this script on it, and the ore is that property.
$VEIN_SCRIPT   = 'MineOreScript'
$ORE_PROPERTY  = 'Ore'
#
# WHAT A VEIN IS A RECORD OF. ACTI in this build. FURN is scanned as well
# because some builds put a vein on furniture, and a FURN vein would be
# silently missing from the table rather than reported if this only looked at
# ACTI. The counts per record type are printed.
$VEIN_TYPES    = @('ACTI', 'FURN')
#
# THE RANKS, AND WHERE THEY CUT. classes.md sets four ranks and says rank
# decides which source somebody may work and how much it gives. IT DOES NOT
# SET THE NUMBERS. These thresholds are the ore's own value in gold, taken
# from the MISC record, and the cuts sit in the gaps this build actually has
# rather than on round numbers pulled out of the air: nothing in it is worth
# 3 to 19, nothing 26 to 29, nothing 51 to 59. Change them here, rebuild, and
# the whole table moves with them.
#
#   novice     up to 14   clay 1, quarried stone 2, iron 2
#   advanced   up to 29   orichalcum 20, corundum 20, shellbug chitin 25,
#                         quicksilver 25, silver 25
#   expert     up to 59   malachite 30, moonstone 30, gold 50
#   master     over that  ebony 60, heart stone 100 (but see RANK_BY_ORE),
#                         stalhrim 200, and the gem seams: amethyst 120,
#                         ruby 200, sapphire 400, emerald 600
#
# Iron at the bottom and ebony near the top, which is the shape to expect.
# What was not expected, and is measured rather than arranged: a handful of
# Blackreach seams name a gem in the same property an ore seam names its ore,
# so they rank by the gem's value and land at master. Clay and quarried stone
# are the HearthFires building seams and they sit at the bottom with iron.
#
# The last band has no upper bound on purpose: a mod that adds a richer ore
# lands at master rather than falling out of the table.
$RANK_BANDS = @(
    @{ Rank = 'novice';   UpTo = 14 },
    @{ Rank = 'advanced'; UpTo = 29 },
    @{ Rank = 'expert';   UpTo = 59 },
    @{ Rank = 'master';   UpTo = [int]::MaxValue }
)
#
# AN ORE WHOSE RANK IS DECIDED RATHER THAN READ OFF ITS VALUE. Keyed by the
# ore's editor id, each with the rank and the reason, and every one is printed
# by name when the table is built. An ore named here that the load order does
# not carry fails the build, so an entry cannot outlive its ore quietly.
#
# DLC2HeartStone: master, by its price, the rank the miner page gives it
# (docs/systems/classes/miner.md, issue #1380). From 28 September (issue
# #398) it was advanced, because 160 of the Bladebinder's 161 staves wanted
# one and the whole half's cost sat on master. The book now keeps only the
# staves whose spell is in the college book, and the Bladebinder page says it
# in so many words: "Heart stone is master mining, one place, because the book
# no longer needs a novice to pull it." It stays named here so the change of
# mind is one line and its reason is printed with every build.
$RANK_BY_ORE = [ordered]@{
    'DLC2HeartStone' = @{ Rank = 'master'; Why = 'the miner page ranks it master, by its price (issue #1380); it was advanced from 28 September (issue #398) while the Bladebinder book still needed a novice to pull it' }
}
#
# WHAT A VEIN GIVES. The miner page: one swing takes 1 ore, and a chance of
# one more, at every rank that may work the seam. The chance grows with the
# rank (the table on that page, which mineOre rolls); the most a swing gives
# does not. Below the vein's own rank it gives nothing at all, because rank
# decides which source somebody may work AT ALL. So each row carries four
# pairs, novice first, the least and the most one swing gives, and a pair of
# zeroes means that rank cannot work that seam. Until issue #1380 the ceiling
# climbed a rank at a time, 1-2 at novice to 1-5 at master, the salt quarry's
# shape, which the plan does not use for a seam.
$YIELD_FLOOR   = 1
$YIELD_EXTRA   = 1     # the most one swing gives is $YIELD_FLOOR + $YIELD_EXTRA
$RANK_ORDER    = @('novice', 'advanced', 'expert', 'master')

if (-not $Out) { $Out = Join-Path $PSScriptRoot '..\..\game\data\ores.json' }

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
# has to say Skyrim.esm. A form id inside a VMAD property is numbered the same
# way, which is what makes the ore resolvable.
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

# form id -> 'hex:owning plugin', the desc the server takes. The top byte is an
# index into the plugin's master list; the plugin's own records carry the index
# one past the end of it.
function DescOf([uint32]$formId, $masters, [string]$plugin) {
    $mi = [int]($formId -shr 24)
    $owner = $plugin
    if ($mi -lt $masters.Count) { $owner = $masters[$mi] }
    return ('{0:x}' -f ($formId -band 0xFFFFFF)) + ':' + $owner
}

<#
  Every script on a record, with its object properties, out of a VMAD.

  The layout, which is the whole reason this script can read an ore at all:
    int16  version       2 to 5. 4 and up put a status byte after a script
                         name and after a property's type byte
    int16  object format 1 puts a form id first in an object property,
                         2 puts it last. Everything in this build is 2
    uint16 how many scripts
    then, per script:
      wstring name (a uint16 length and that many characters, no terminator)
      [uint8 status, version 4 and up]
      uint16 how many properties
      then, per property:
        wstring name
        uint8  type: 1 object, 2 string, 3 int32, 4 float, 5 bool,
               11 to 15 the arrays of those
        [uint8 status, version 4 and up]
        the value, whose length the type decides

  Object properties are the ones that matter here and they are eight bytes:
  two unused, a two byte alias index, and the four byte form id, in that order
  when the object format is 2. Everything else is stepped over by length.

  Returns a list of @{ Name = script name; Props = @{ property name = form id } }
  and throws on anything it cannot step over, because a VMAD half read is a
  table with the wrong ore in it.
#>
function Read-Vmad([byte[]]$v) {
    $out = New-Object 'System.Collections.Generic.List[object]'
    if ($v.Length -lt 6) { throw "a VMAD of $($v.Length) bytes is too short to hold a header" }
    $version = [BitConverter]::ToInt16($v, 0)
    $format  = [BitConverter]::ToInt16($v, 2)
    if ($version -lt 2 -or $version -gt 5) { throw "VMAD version $version is not one this can read" }
    if ($format -ne 1 -and $format -ne 2) { throw "VMAD object format $format is not one this can read" }
    $count = [int][BitConverter]::ToUInt16($v, 4)
    $p = 6
    for ($s = 0; $s -lt $count; $s++) {
        $nl = [int][BitConverter]::ToUInt16($v, $p); $p += 2
        $name = [System.Text.Encoding]::GetEncoding(1252).GetString($v, $p, $nl); $p += $nl
        if ($version -ge 4) { $p += 1 }
        $pc = [int][BitConverter]::ToUInt16($v, $p); $p += 2
        $props = @{}
        for ($q = 0; $q -lt $pc; $q++) {
            $pl = [int][BitConverter]::ToUInt16($v, $p); $p += 2
            $pn = [System.Text.Encoding]::GetEncoding(1252).GetString($v, $p, $pl); $p += $pl
            $pt = [int]$v[$p]; $p += 1
            if ($version -ge 4) { $p += 1 }
            switch ($pt) {
                1  {
                    if ($format -eq 1) { $props[$pn] = [BitConverter]::ToUInt32($v, $p) }
                    else               { $props[$pn] = [BitConverter]::ToUInt32($v, $p + 4) }
                    $p += 8
                }
                2  { $sl = [int][BitConverter]::ToUInt16($v, $p); $p += 2 + $sl }
                3  { $p += 4 }
                4  { $p += 4 }
                5  { $p += 1 }
                11 { $n2 = [int][BitConverter]::ToUInt32($v, $p); $p += 4 + $n2 * 8 }
                12 { $n2 = [int][BitConverter]::ToUInt32($v, $p); $p += 4
                     for ($z = 0; $z -lt $n2; $z++) { $sl = [int][BitConverter]::ToUInt16($v, $p); $p += 2 + $sl } }
                13 { $n2 = [int][BitConverter]::ToUInt32($v, $p); $p += 4 + $n2 * 4 }
                14 { $n2 = [int][BitConverter]::ToUInt32($v, $p); $p += 4 + $n2 * 4 }
                15 { $n2 = [int][BitConverter]::ToUInt32($v, $p); $p += 4 + $n2 }
                default { throw "property $pn on script $name has type $pt, which this cannot step over" }
            }
            if ($p -gt $v.Length) { throw "script $name ran past the end of the VMAD" }
        }
        $out.Add(@{ Name = $name; Props = $props })
    }
    return $out
}

# A listing of the game folder: name, size and last write, for the files this
# reads and the folder they sit in. Taken before and after so the promise that
# nothing was touched is measured rather than asserted.
function Get-FolderPrint([string]$dir) {
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $n = 0
    foreach ($d in @($dir, (Join-Path $dir 'Strings'))) {
        if (-not (Test-Path -LiteralPath $d)) { continue }
        foreach ($f in (Get-ChildItem -LiteralPath $d -File -Force | Sort-Object Name)) {
            $lines.Add(('{0}|{1}|{2:o}' -f $f.Name, $f.Length, $f.LastWriteTimeUtc))
            $n++
        }
    }
    $text = $lines -join "`n"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = [BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text))).Replace('-', '')
    $sha.Dispose()
    return [pscustomobject]@{ Count = $n; Hash = $hash.ToLowerInvariant() }
}

# ------------------------------------------------------- the load order -----

Write-Host ''
Write-Host 'the load order' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $Data)) { throw "not found: $Data" }

$before = Get-FolderPrint $Data
Ok ("{0}: {1} files before this ran, {2}" -f $Data, $before.Count, $before.Hash.Substring(0, 16))

$order = New-Object 'System.Collections.Generic.List[string]'
if ($Plugins.Count -gt 0) {
    foreach ($p in $Plugins) { if (-not $order.Contains($p)) { $order.Add($p) } }
    Ok ("{0} plugins, given on the command line" -f $order.Count)
} else {
    if (-not (Test-Path -LiteralPath $PluginsTxt)) { throw "not found: $PluginsTxt" }
    # The five masters, then each '*' line; a line with no '*' is a plugin
    # switched off, which the game does not load (OwnPlugins.ps1, #1622,
    # #1712, #2976).
    foreach ($p in (Get-LoadOrder $PluginsTxt)) { $order.Add($p) }
    $offCount = (Get-SwitchedOff $PluginsTxt).Count
    Ok ("{0} plugins: the five masters, then {1}" -f $order.Count, $PluginsTxt)
    if ($offCount -gt 0) { Note "$offCount line(s) in that list are switched off and were left out" }
}

$missing = New-Object 'System.Collections.Generic.List[string]'
foreach ($p in $order) { if (-not (Test-Path -LiteralPath (Get-PluginPath $Data $p))) { $missing.Add($p) } }
if ($missing.Count -gt 0) {
    Bad ("{0} plugin(s) in the load order are not in {1}: {2}" -f $missing.Count, $Data, ($missing -join ', '))
} else {
    Ok 'every plugin in the load order is on disk'
}

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
foreach ($pl in $order) {
    $path = Get-PluginPath $Data $pl
    if (-not (Test-Path -LiteralPath $path)) { continue }
    # only a plugin flagged localised keeps its names in a string table
    $head = New-Object byte[] 12
    $fs = [System.IO.File]::OpenRead($path)
    [void]$fs.Read($head, 0, 12)
    $fs.Dispose()
    if (-not ([BitConverter]::ToUInt32($head, 8) -band 0x80)) { continue }

    $base = [System.IO.Path]::GetFileNameWithoutExtension($pl).ToLowerInvariant()
    $want = $base + '_' + $LANGUAGE + '.strings'
    $loose = Join-Path $looseDir $want
    if (Test-Path -LiteralPath $loose) {
        $tables[$pl] = @{ Table = (Read-StringTable ([System.IO.File]::ReadAllBytes($loose))); Where = 'Data\Strings' }
        continue
    }
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($pl)
    foreach ($cand in @(($stem + '.bsa'), ($stem + ' - Interface.bsa'), 'Skyrim - Interface.bsa')) {
        $files = Get-BsaCached $cand
        if ($files -and $files.ContainsKey($want)) {
            $tables[$pl] = @{ Table = (Read-StringTable $files[$want]); Where = $cand }
            break
        }
    }
    if ($tables.ContainsKey($pl)) {
        Ok ("{0}: {1} strings, from {2}" -f $pl, $tables[$pl].Table.Count, $tables[$pl].Where)
    } else {
        # a plugin flagged localised with no table can only fall back to editor
        # ids, and then an ore in the table has an editor id where its name goes
        Bad ("{0}: localised and no $LANGUAGE string table found; its names fall back to editor ids" -f $pl)
    }
}
foreach ($pl in $order) {
    if ($tables.ContainsKey($pl) -and $tables[$pl].Where -eq 'Data\Strings') {
        Ok ("{0}: {1} strings, from {2}" -f $pl, $tables[$pl].Table.Count, $tables[$pl].Where)
    }
}
Note ("{0} of {1} plugins are localised and needed a string table" -f $tables.Count, $order.Count)

# --------------------------------------------------- the veins and the ore ---

Write-Host ''
Write-Host 'records' -ForegroundColor Cyan

# desc -> the ore, last one in the load order wins, because that is the record
# the game is using
$ores  = @{}
# desc -> the vein, same rule
$veins = New-Object System.Collections.Specialized.OrderedDictionary
$vmadBroken = New-Object 'System.Collections.Generic.List[string]'
$perType = @{}
$oreNameFromEdid = 0

foreach ($pl in $order) {
    $path = Get-PluginPath $Data $pl
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $b = [System.IO.File]::ReadAllBytes($path)
    if ([System.Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'TES4') { Bad "not a plugin: $path"; continue }
    $headerSize = [int][BitConverter]::ToUInt32($b, 4)
    $localized  = [bool]([BitConverter]::ToUInt32($b, 8) -band 0x80)
    $masters    = Get-PluginMasters $b $headerSize
    $strTable = $null
    if ($tables.ContainsKey($pl)) { $strTable = $tables[$pl].Table }

    $hereVeins = 0
    $hereOres  = 0
    $i = 24 + $headerSize
    while ($i + 24 -le $b.Length) {
        if ([System.Text.Encoding]::ASCII.GetString($b, $i, 4) -ne 'GRUP') { break }
        $groupSize = [int][BitConverter]::ToUInt32($b, $i + 4)
        if ($groupSize -lt 24) { break }
        $label = [System.Text.Encoding]::ASCII.GetString($b, $i + 8, 4)
        if (($VEIN_TYPES -contains $label) -or $label -eq 'MISC') {
            $j = $i + 24
            $groupEnd = $i + $groupSize
            while ($j + 24 -le $groupEnd) {
                $type     = [System.Text.Encoding]::ASCII.GetString($b, $j, 4)
                $dataSize = [int][BitConverter]::ToUInt32($b, $j + 4)
                $recFlags = [BitConverter]::ToUInt32($b, $j + 8)
                $formId   = [BitConverter]::ToUInt32($b, $j + 12)
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
                    $value = -1
                    $vmad = $null
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
                        } elseif ($sub -eq 'VMAD') {
                            $vmad = New-Object byte[] $sz
                            [Array]::Copy($rec, $k, $vmad, 0, $sz)
                        } elseif ($sub -eq 'DATA' -and $label -eq 'MISC' -and $sz -ge 8) {
                            # MISC DATA: four bytes of value in gold, then the
                            # weight as a float. The value is what ranks a vein.
                            $value = [int][BitConverter]::ToUInt32($rec, $k)
                        }
                        $k += $sz
                    }

                    $desc = DescOf $formId $masters $pl

                    if ($label -eq 'MISC') {
                        if (-not $full) { $full = $edid; $fullFrom = 'the editor id' }
                        $ores[$desc] = [pscustomobject]@{
                            Desc = $desc; Edid = $edid; Name = $full; NameFrom = $fullFrom
                            Value = $value; SeenIn = $pl
                        }
                        $hereOres++
                    } elseif ($vmad) {
                        $scripts = $null
                        try {
                            $scripts = Read-Vmad $vmad
                        } catch {
                            $vmadBroken.Add(("{0} {1} in {2}: {3}" -f $label, $desc, $pl, $_.Exception.Message))
                        }
                        if ($scripts) {
                            foreach ($sc in $scripts) {
                                if ($sc.Name -ne $VEIN_SCRIPT) { continue }
                                $oreForm = 0
                                $readFrom = 'the ' + $ORE_PROPERTY + ' property of ' + $VEIN_SCRIPT
                                foreach ($key in $sc.Props.Keys) {
                                    if ($key -eq $ORE_PROPERTY) { $oreForm = $sc.Props[$key] }
                                }
                                $oreDesc = ''
                                if ($oreForm -ne 0) { $oreDesc = DescOf ([uint32]$oreForm) $masters $pl }
                                if (-not $full) { $full = $edid; $fullFrom = 'the editor id' }
                                $veins[$desc] = [pscustomobject]@{
                                    Desc = $desc; Edid = $edid; Name = $full; NameFrom = $fullFrom
                                    Type = $label; Plugin = $desc.Split(':')[1]; SeenIn = $pl
                                    Local = ($formId -band 0xFFFFFF)
                                    OreDesc = $oreDesc; ReadFrom = $readFrom
                                }
                                if (-not $perType.ContainsKey($label)) { $perType[$label] = 0 }
                                $perType[$label] = $perType[$label] + 1
                                $hereVeins++
                                break
                            }
                        }
                    }
                }
                $j += 24 + $dataSize
            }
        }
        $i += $groupSize
    }
    if ($hereVeins -gt 0) { Ok ("{0}: {1} veins, {2} MISC records" -f $pl, $hereVeins, $hereOres) }
}

Ok ("{0} veins in all, {1} MISC records to look an ore up in" -f $veins.Count, $ores.Count)
foreach ($t in ($perType.Keys | Sort-Object)) { Note ("{0}: {1} (counting overrides, which are folded together below)" -f $t, $perType[$t]) }
if ($vmadBroken.Count -gt 0) {
    Bad ("{0} VMAD block(s) would not parse, so their veins are missing from the table" -f $vmadBroken.Count)
    foreach ($v in $vmadBroken) { Note ("  " + $v) }
} else {
    Ok 'every VMAD on a vein parsed to the end'
}
if ($veins.Count -eq 0) { Bad 'no veins found at all, which means the script that makes a record a vein is not what this thinks it is' }

# ------------------------------------------------------------- the ranking --

Write-Host ''
Write-Host 'the ore, and the rank' -ForegroundColor Cyan

function RankOf([int]$value) {
    foreach ($band in $RANK_BANDS) {
        if ($value -le $band.UpTo) { return $band.Rank }
    }
    return $RANK_BANDS[$RANK_BANDS.Count - 1].Rank
}

# The yield pairs, novice first. Below the vein's own rank a seam gives
# nothing, because rank decides which source somebody may work at all.
function YieldFor([string]$rank) {
    $need = [array]::IndexOf($RANK_ORDER, $rank)
    $pairs = New-Object 'System.Collections.Generic.List[string]'
    for ($t = 0; $t -lt $RANK_ORDER.Count; $t++) {
        if ($t -lt $need) { $pairs.Add('[0, 0]') }
        # the whole -f goes in brackets of its own: inside .Add(...) a comma is
        # the next argument to Add, not the next thing to format
        else { $pairs.Add(('[{0}, {1}]' -f $YIELD_FLOOR, ($YIELD_FLOOR + $YIELD_EXTRA))) }
    }
    return '[' + ($pairs -join ', ') + ']'
}

$table   = New-Object System.Collections.Specialized.OrderedDictionary
$detail  = New-Object System.Collections.Specialized.OrderedDictionary
$skipped = New-Object 'System.Collections.Generic.List[object]'
$byOre   = @{}
$namedSeen = @{}

foreach ($r in $RANK_BY_ORE.Values) {
    if ($RANK_ORDER -notcontains $r.Rank) { Bad ("RANK_BY_ORE names a rank that is not one of the four: {0}" -f $r.Rank) }
}

foreach ($desc in $veins.Keys) {
    $v = $veins[$desc]
    if (-not $v.OreDesc) {
        $skipped.Add([pscustomobject]@{ Desc = $desc; Edid = $v.Edid; Why = 'the vein has no ' + $ORE_PROPERTY + ' property, or it is set to none' })
        continue
    }
    if (-not $ores.ContainsKey($v.OreDesc)) {
        Bad ("{0} ({1}) points its {2} at {3} and there is no such record in the load order" -f $v.Edid, $desc, $ORE_PROPERTY, $v.OreDesc)
        continue
    }
    $ore = $ores[$v.OreDesc]
    if ($ore.Value -lt 0) {
        Bad ("{0} has no value in its MISC record, so nothing ranks the veins that give it" -f $ore.Name)
        continue
    }
    if ($ore.NameFrom -eq 'the editor id') { $oreNameFromEdid++ }
    $rank = RankOf $ore.Value
    if ($RANK_BY_ORE.Contains([string]$ore.Edid)) {
        $rank = $RANK_BY_ORE[[string]$ore.Edid].Rank
        $namedSeen[[string]$ore.Edid] = $true
    }
    $table[$desc] = [pscustomobject]@{
        Ore = $ore.Desc; Name = $ore.Name; Rank = $rank; Yield = (YieldFor $rank)
    }
    $detail[$desc] = [ordered]@{
        editorId    = $v.Edid
        plugin      = $v.Plugin
        formId      = '0x' + ('{0:X6}' -f $v.Local)
        recordType  = $v.Type
        veinName    = $v.Name
        ore         = $ore.Desc
        oreEditorId = $ore.Edid
        oreName     = $ore.Name
        oreValue    = $ore.Value
        # the plugin whose version of the ore this is. The last one in the
        # load order wins, because that is the record the game uses, and its
        # value is what put the vein in the rank below
        oreFrom     = $ore.SeenIn
        rank        = $rank
        readFrom    = $v.ReadFrom
        nameFrom    = $ore.NameFrom
    }
    $key = $ore.Desc
    if (-not $byOre.ContainsKey($key)) {
        $byOre[$key] = [pscustomobject]@{ Name = $ore.Name; Edid = $ore.Edid; Value = $ore.Value; Rank = $rank; SeenIn = $ore.SeenIn; Veins = 0 }
    }
    $byOre[$key].Veins = $byOre[$key].Veins + 1
}

if ($skipped.Count -gt 0) {
    # Not a failure. A seam that gives only gems is a real thing in the game
    # and it is listed rather than quietly dropped.
    Note ("{0} vein(s) name no ore and are left out of the table:" -f $skipped.Count)
    foreach ($s in $skipped) { Note ("  {0}  {1}" -f $s.Desc, $s.Edid) }
}
foreach ($e in $RANK_BY_ORE.Keys) {
    if ($namedSeen.ContainsKey($e)) {
        Note ("{0} is ranked {1} by RANK_BY_ORE rather than by its value: {2}" -f $e, $RANK_BY_ORE[$e].Rank, $RANK_BY_ORE[$e].Why)
    } else {
        Bad ("RANK_BY_ORE names {0} and no vein in this load order gives it, so the entry is out of date" -f $e)
    }
}
if ($oreNameFromEdid -gt 0) {
    Bad ("{0} vein(s) would carry an editor id where the ore's name goes" -f $oreNameFromEdid)
} elseif ($table.Count -gt 0) {
    Ok 'every ore in the table has a real name out of a string table or its own record'
}

Write-Host ''
# The plugin column is the one that is easy to miss: it is the version of the
# ore the game is using, and its value is what put every vein below it in the
# rank it is in. A mod that reprices an ore moves the seams that give it.
Write-Host ("  {0,-38} {1,-24} {2,6}  {3,-9} {4,-5} {5}" -f 'ore', 'editor id', 'value', 'rank', 'veins', 'the version in use')
foreach ($k in ($byOre.Keys | Sort-Object { $byOre[$_].Value })) {
    $o = $byOre[$k]
    Write-Host ("  {0,-38} {1,-24} {2,6}  {3,-9} {4,-5} {5}" -f ($o.Name + ' (' + $k + ')'), $o.Edid, $o.Value, $o.Rank, $o.Veins, $o.SeenIn)
}

$spread = @{}
foreach ($desc in $table.Keys) {
    $r = $table[$desc].Rank
    if (-not $spread.ContainsKey($r)) { $spread[$r] = 0 }
    $spread[$r] = $spread[$r] + 1
}
Write-Host ''
foreach ($r in $RANK_ORDER) {
    $n = 0
    if ($spread.ContainsKey($r)) { $n = $spread[$r] }
    Note ("{0,-9} {1} vein(s)" -f $r, $n)
}
$empty = @($RANK_ORDER | Where-Object { -not $spread.ContainsKey($_) })
if ($empty.Count -gt 0) {
    # Not a failure either: the thresholds are a knob and a build may simply
    # have no ore in a band. It is said out loud so nobody has to wonder.
    Note ("no vein lands at: {0}. The thresholds are in the knobs at the top of this file." -f ($empty -join ', '))
} else {
    Ok 'all four ranks have veins'
}

# every desc is hex digits and a plugin, the same test the spell table makes
$oddIds = New-Object 'System.Collections.Generic.List[string]'
foreach ($desc in $table.Keys) {
    if ($desc -cnotmatch '^[0-9a-f]{1,8}:[^:]+\.es[mpl]$') { $oddIds.Add("the vein $desc") }
    if ($table[$desc].Ore -cnotmatch '^[0-9a-f]{1,8}:[^:]+\.es[mpl]$') { $oddIds.Add("the ore of $desc, " + $table[$desc].Ore) }
}
if ($oddIds.Count -gt 0) {
    foreach ($o in $oddIds) { Bad ("an id that does not look right: {0}" -f $o) }
} else {
    Ok 'every desc is hex digits and a plugin'
}

# a vein that is its own ore, or an ore that is a vein, would be a table that
# hands somebody the seam they are standing at
$crossed = @($table.Keys | Where-Object { $veins.Contains($table[$_].Ore) })
if ($crossed.Count -gt 0) {
    foreach ($c in $crossed) { Bad ("{0} gives {1}, which is itself a vein" -f $c, $table[$c].Ore) }
} else {
    Ok 'no vein hands out another vein'
}

$perPlugin = @{}
foreach ($desc in $detail.Keys) {
    $p = $detail[$desc].plugin
    if (-not $perPlugin.ContainsKey($p)) { $perPlugin[$p] = 0 }
    $perPlugin[$p] = $perPlugin[$p] + 1
}
foreach ($p in ($perPlugin.Keys | Sort-Object)) { Note ("{0}: {1} vein(s)" -f $p, $perPlugin[$p]) }

# ------------------------------------------------------------- the writing -

Write-Host ''
Write-Host 'writing' -ForegroundColor Cyan

$after = Get-FolderPrint $Data
if ($after.Hash -ne $before.Hash -or $after.Count -ne $before.Count) {
    Bad ("the game folder changed while this ran: {0} files and {1} before, {2} and {3} after" -f `
         $before.Count, $before.Hash.Substring(0, 16), $after.Count, $after.Hash.Substring(0, 16))
} else {
    Ok ("the game folder is exactly as it was: {0} files, {1}" -f $after.Count, $after.Hash.Substring(0, 16))
}

# The json is written out by hand rather than with ConvertTo-Json, and there is
# no timestamp in it, so that the same game files give byte for byte the same
# file: ConvertTo-Json lays out Windows PowerShell 5.1 and PowerShell 7
# differently, and a rebuild that changed nothing would be a whole-file diff.
# It is joined with LF, as everything this writes is.
$jsonEol = $Eol
$docLines = New-Object 'System.Collections.Generic.List[string]'
$docLines.Add('{')
$docLines.Add('  "builtBy": ' + (JsonStr 'scripts\dev\Build-OreTable.ps1') + ',')
$docLines.Add('  "source": ' + (JsonStr ('the ' + ($VEIN_TYPES -join ' and ') + ' records carrying ' + $VEIN_SCRIPT + ', across ' + $order.Count + ' plugins in load order, and the MISC records their ' + $ORE_PROPERTY + ' property points at')) + ',')
$docLines.Add('  "language": ' + (JsonStr $LANGUAGE) + ',')
$docLines.Add('  "readFrom": ' + (JsonStr ('the VMAD subrecord of each vein: script ' + $VEIN_SCRIPT + ', object property ' + $ORE_PROPERTY)) + ',')
$docLines.Add('  "yield": ' + (JsonStr 'four pairs, novice first: the least and the most one swing gives at that rank, 1 and a chance of one more. A pair of zeroes means that rank cannot work that seam.') + ',')
$docLines.Add('  "count": ' + $table.Count + ',')
$docLines.Add('  "ranks": {')
$rn = 0
foreach ($band in $RANK_BANDS) {
    $rn++
    $comma = ','
    if ($rn -eq $RANK_BANDS.Count) { $comma = '' }
    $upTo = $band.UpTo
    if ($upTo -eq [int]::MaxValue) { $docLines.Add('    ' + (JsonStr $band.Rank) + ': ' + (JsonStr 'anything above the band before it') + $comma) }
    else { $docLines.Add('    ' + (JsonStr $band.Rank) + ': ' + (JsonStr ('an ore worth up to ' + $upTo + ' gold')) + $comma) }
}
$docLines.Add('  },')
# The ores ranked by RANK_BY_ORE rather than by the bands above, with the
# reason, so a row whose rank does not match its oreValue says why.
$docLines.Add('  "rankNamedOutright": {')
$rn = 0
foreach ($e in $RANK_BY_ORE.Keys) {
    $rn++
    $comma = ','
    if ($rn -eq $RANK_BY_ORE.Count) { $comma = '' }
    $docLines.Add('    ' + (JsonStr $e) + ': ' + (JsonStr ($RANK_BY_ORE[$e].Rank + ': ' + $RANK_BY_ORE[$e].Why)) + $comma)
}
$docLines.Add('  },')
$docLines.Add('  "ores": {')
$n = 0
foreach ($desc in $table.Keys) {
    $n++
    $comma = ','
    if ($n -eq $table.Count) { $comma = '' }
    $r = $table[$desc]
    $docLines.Add('    ' + (JsonStr $desc) + ': { "ore": ' + (JsonStr $r.Ore) + ', "name": ' + (JsonStr $r.Name) +
                  ', "rank": ' + (JsonStr $r.Rank) + ', "yield": ' + $r.Yield + ' }' + $comma)
}
$docLines.Add('  },')
$docLines.Add('  "skipped": [')
$n = 0
foreach ($s in $skipped) {
    $n++
    $comma = ','
    if ($n -eq $skipped.Count) { $comma = '' }
    $docLines.Add('    { "desc": ' + (JsonStr $s.Desc) + ', "editorId": ' + (JsonStr $s.Edid) + ', "why": ' + (JsonStr $s.Why) + ' }' + $comma)
}
$docLines.Add('  ],')
$docLines.Add('  "detail": {')
$n = 0
foreach ($desc in $detail.Keys) {
    $n++
    $comma = ','
    if ($n -eq $detail.Count) { $comma = '' }
    $d = $detail[$desc]
    $docLines.Add('    ' + (JsonStr $desc) + ': {')
    $fields = New-Object 'System.Collections.Generic.List[string]'
    foreach ($f in $d.Keys) {
        if ($f -eq 'oreValue') { $fields.Add('      "' + $f + '": ' + $d[$f]) }
        else { $fields.Add('      "' + $f + '": ' + (JsonStr ([string]$d[$f]))) }
    }
    $docLines.Add(($fields -join (',' + $jsonEol)))
    $docLines.Add('    }' + $comma)
}
$docLines.Add('  }')
$docLines.Add('}')
$json = ($docLines -join $jsonEol) + $jsonEol

# A run that failed leaves the table it could not rebuild exactly as it was.
# Nothing is written until every check above has passed, for the same reason
# the spell table does it: a bad -Data left that one 240 bytes of nothing.
if ($fail -gt 0) {
    Bad ("{0} check(s) failed, so {1} was left exactly as it was" -f $fail, $Out)
} else {
    [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
    Ok ("wrote {0} ({1} veins, {2} bytes)" -f $Out, $table.Count, $json.Length)
}

# ----------------------------------------------------------- the literal ---

$lines = New-Object 'System.Collections.Generic.List[string]'
$lines.Add('  /* Built by scripts\dev\Build-OreTable.ps1 out of the game''s own records. Do not hand edit.')
$lines.Add('     ' + $table.Count + ' ore veins, the same table as game\data\ores.json.')
$lines.Add('')
$lines.Add('     Vein base -> the ore it gives, that ore''s name, the rank it takes to')
$lines.Add('     work it, and what it gives at novice, advanced, expert and master.')
$lines.Add('     A pair of zeroes is a rank that cannot work that seam at all. The')
$lines.Add('     ore is the Ore property of the vein''s MineOreScript, read out of the')
$lines.Add('     record, and the rank is the ore''s value in gold unless RANK_BY_ORE')
$lines.Add('     in the build script names it. */')
$lines.Add('  var ORES_BY_BASE = {')
$n = 0
foreach ($desc in $table.Keys) {
    $n++
    $comma = ','
    if ($n -eq $table.Count) { $comma = '' }
    $r = $table[$desc]
    $lines.Add('    ' + (JsonStr $desc) + ': { ore: ' + (JsonStr $r.Ore) + ', name: ' + (JsonStr $r.Name) +
               ', rank: ' + (JsonStr $r.Rank) + ', yield: ' + $r.Yield + ' }' + $comma)
}
$lines.Add('  };')
$literal = $lines -join [Environment]::NewLine

# ---------------------------------------------------------------- install --
#
# The gamemode reads the table from game\gamemode-tables\ORES_BY_BASE.json
# when it loads (#5191): until then this wrote it between markers in
# gamemode.js, and every content change rewrote the same lines there.
# -NoInstall prints it and leaves the file alone.
#
if (-not $NoInstall -and $fail -eq 0) {
    . (Join-Path $PSScriptRoot 'GamemodeTables.ps1')
    $rows = New-Object 'System.Collections.Generic.List[string]'
    foreach ($desc in $table.Keys) {
        $r = $table[$desc]
        $rows.Add((JsonStr $desc) + ':{"ore":' + (JsonStr $r.Ore) + ',"name":' + (JsonStr $r.Name) +
                  ',"rank":' + (JsonStr $r.Rank) + ',"yield":' + $r.Yield + '}')
    }
    $changed = Write-GamemodeTable 'ORES_BY_BASE' ('{' + ($rows -join ',') + '}')
    if ($changed) { Ok ("wrote {0} veins into {1}" -f $table.Count, (Get-GamemodeTableFile 'ORES_BY_BASE')) }
    else { Ok ("{0} already holds these {1} veins" -f (Get-GamemodeTableFile 'ORES_BY_BASE'), $table.Count) }
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
Write-Host ("the table is complete: {0} veins, every one of them with an ore read out of its own record." -f $table.Count) -ForegroundColor Green
