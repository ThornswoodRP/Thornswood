<#
  LoadOrder.ps1

  The load order as the game counts it, and how to put a plugin list into the
  server's order. Dot-sourced by Publish-Update.ps1, so the reference plugin
  list that goes into a pack ships in the order the server actually runs.

  The same rule as launcher\app\LoadOrder.cs in the launcher, function for
  function, and the two are held to identical output by a test. Change one,
  change the other.

  The game hands a normal index to the five masters, then to every plugin
  Skyrim.ccc names that is in Data, then to every enabled entry of plugins.txt
  that is in Data. Light plugins (an .esl, or the ESL flag in the header) get
  no normal index and are skipped throughout. The client compares that list
  with the server's manifest position by position, and one name out of place
  is LOAD ORDER ERROR for the session.

  Light plugins have an order of their own (#1715): a light index is a
  plugin's place among the light plugins the game loads, and every form in it
  is 0xFE000000 | (index << 12) | local id. Get-LoadOrderLight is that order,
  and Get-LoadOrderReordered with the names the game loads first puts a list
  into the server's whole order, light plugins included, the way
  LoadOrder.LightOrder and LoadOrder.Reorder do in the launcher.
#>

. (Join-Path $PSScriptRoot '..\release\Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named
$script:LoadOrderMasters = 'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'

<#
  Read one Vortex state.v2 file as Latin1 text. Every byte becomes one character
  so the LevelDB length bytes (controls) survive for the regexes below.
  [Text.Encoding]::Latin1 is null on Windows PowerShell 5.1; code page 28591 is
  the same mapping on 5.1 and on PowerShell 7 (#527).
#>
function Get-VortexStateText([string]$Path) {
    $raw = [IO.File]::ReadAllBytes($Path)
    return [Text.Encoding]::GetEncoding(28591).GetString($raw)
}

# Vortex's own folder, under %APPDATA% as Vortex keeps it. Off Windows (a
# cloud session) APPDATA is not set, and Join-Path stopped on the null before
# anything was asked; the platform's own folder for it takes its place, which
# holds no Vortex, so every lookup below finds none, as on a Windows machine
# without Vortex. The same rule as Where.ps1's machine data (#2872).
function Get-VortexDir {
    $a = $env:APPDATA
    if (-not $a) { $a = [Environment]::GetFolderPath('ApplicationData') }
    return (Join-Path $a 'Vortex')
}

function Get-VortexStateDir {
    return (Join-Path (Get-VortexDir) 'state.v2')
}


<#
  Which revision of the collection this machine has installed, or 0.

  The same rule as Checks.CollectionRevision in the launcher, and it is here
  because the SHIPPING machine's answer is the one that goes in the feed: the
  server's load order and the reference plugin list are both derived from this
  machine's Vortex deployment, so the revision it is on is the revision the
  release agrees with.

  Found on 22 September, and this is why it exists: this machine was on
  revision 2 while the collection on Nexus was on 4. Nothing said so, because
  the only test was whether one named file existed and that file was not in
  the collection at all. Two revisions of drift, on the machine that builds
  the server.

  WHERE THE NUMBER COMES FROM, and why this was rewritten on 27 September.
  The first version read the revision out of the name Vortex gave the mod
  folder:

      %APPDATA%\Vortex\skyrimse\mods\collection_ombo2a_2_2026-09-15T21-08-00Z
                                                slug  ^ revision

  Current Vortex does not name the folder that way any more. It names it for
  the mod id it made up, with no slug and no number in it at all:

      %APPDATA%\Vortex\skyrimse\mods\vortex_collection_ZRT7NjhN_

  So the folder name stopped being able to answer the question, Have went to
  0 on every up to date machine, Get-CollectionState.Known went false, and
  Deploy-Gamemode's revision gate refused every deploy unless -IgnoreRevision.

  The honest source is Vortex's own state, not the folder name. When Vortex
  installs a collection it records, against the mod, the slug it was installed
  from and the revision NUMBER it is on. That is independent of what the folder
  is called, so it answers for both eras. It is read the same way
  Get-CollectionNewest reads state.v2, through the read-only LevelDB reader
  (#1582, #1902), which opens no database handle and takes no lock. The old
  folder-name parse stays as a fallback for a machine that only has the legacy
  folders and no readable state.
#>
function Get-CollectionRevision([string]$Slug) {
    if (-not $Slug) { return 0 }
    $fromState = Get-CollectionRevisionFromState $Slug
    if ($fromState -gt 0) { return $fromState }
    return Get-CollectionRevisionFromFolder $Slug
}

<#
  Installed revision from Vortex's current compressed LevelDB metadata, or 0.
  The shared C# reader honors CURRENT, sequences, tombstones and CRCs, matching
  collectionSlug and revisionNumber to one installed mod. Locally authored
  vortex_collection_* mods may link through newestFileId to a cached matching
  slug. An unrelated cached revision never establishes what is installed.
#>
function Get-CollectionRevisionFromState([string]$Slug) {
    if (-not $Slug) { return 0 }
    $st = Get-VortexStateDir
    if (-not (Test-Path -LiteralPath $st)) { return 0 }
    try {
        Import-VortexStateReader
        return [Thornswood.VortexProfileState]::CollectionRevision($st, $Slug)
    } catch { return 0 }
}

function Import-VortexStateReader {
    if ('Thornswood.VortexProfileState' -as [type]) { return }
    $source = Join-Path $PSScriptRoot '..\..\launcher\app\VortexProfileState.cs'
    if ($PSVersionTable.PSVersion.Major -le 5) {
        Add-Type -LiteralPath $source -ReferencedAssemblies System.dll,System.Core.dll,System.Xml.dll
    } else { Add-Type -LiteralPath $source }
}
<#
  The legacy fallback: the revision out of the old folder name, or 0. Kept for
  a machine that still has collection_<slug>_<rev>_<when> folders and no state
  to read. Current Vortex does not write these any more; see
  Get-CollectionRevision above.
#>
function Get-CollectionRevisionFromFolder([string]$Slug) {
    if (-not $Slug) { return 0 }
    $dir = Join-Path (Get-VortexDir) 'skyrimse\mods'
    if (-not (Test-Path -LiteralPath $dir)) { return 0 }
    $best = 0
    foreach ($d in (Get-ChildItem -LiteralPath $dir -Directory -Filter ("collection_" + $Slug + "_*") -EA SilentlyContinue)) {
        $rest = $d.Name.Substring(("collection_" + $Slug + "_").Length)
        $cut = $rest.IndexOf('_')
        if ($cut -le 0) { continue }
        $n = 0
        if (-not [int]::TryParse($rest.Substring(0, $cut), [ref]$n)) { continue }
        if ($n -gt $best) { $best = $n }
    }
    return $best
}

<#
  The mod ids Vortex has recorded against a collection slug, from state.v2.
  Empty when state cannot be read or names no collection with that slug. Used
  to find the collection's mod folder now that the folder is named for the mod
  id rather than the slug (see Get-CollectionInstalledFolder).

  Read through the shared reader, with the tie Get-CollectionRevisionFromState
  uses: collectionSlug against the mod, or for a collection authored here
  newestFileId linked to a cached revision of the slug. Until #1902 this
  matched raw bytes, which find nothing once Vortex compacts the keys into a
  compressed table, and Check-CollectionRules then skipped the installed
  collection. The launcher has no copy: it never looks for the collection's
  folder, and the one it had was removed with no caller (#1957).
#>
function Get-CollectionModIds([string]$Slug) {
    $none = [string[]]@()
    if (-not $Slug) { return , $none }
    $st = Get-VortexStateDir
    if (-not (Test-Path -LiteralPath $st)) { return , $none }
    try {
        Import-VortexStateReader
        return , [string[]][Thornswood.VortexProfileState]::CollectionModIds($st, $Slug)
    } catch { return , $none }
}

<#
  The staging folder holding the installed collection's collection.json, or
  $null. Check-CollectionRules needs the file itself, not just the number, and
  the folder is no longer named for the slug, so this maps slug to mod id
  through state (new naming) and falls back to the collection_<slug>_<rev>_*
  folder (legacy). The newest revision wins in both cases.
#>
function Get-CollectionInstalledFolder([string]$Slug) {
    if (-not $Slug) { return $null }
    $dir = Join-Path (Get-VortexDir) 'skyrimse\mods'
    if (-not (Test-Path -LiteralPath $dir)) { return $null }

    # New naming: folder is the mod id from state. Prefer a folder the JSON can
    # be read out of, loose or inside an export archive; otherwise the staging
    # folder itself (draft installs often omit collection.json). Never invent a
    # revision from the opaque folder name.
    $withJson = New-Object Collections.Generic.List[object]
    $without = New-Object Collections.Generic.List[object]
    foreach ($id in (Get-CollectionModIds $Slug)) {
        foreach ($d in (Get-ChildItem -LiteralPath $dir -Directory -Filter ($id + '*') -EA SilentlyContinue)) {
            if ((Test-Path -LiteralPath (Join-Path $d.FullName 'collection.json')) -or
                @(Get-CollectionExportArchive $d.FullName).Count -gt 0) { [void]$withJson.Add($d) }
            else { [void]$without.Add($d) }
        }
    }
    if ($withJson.Count -gt 0) { return ($withJson | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1) }
    if ($without.Count -gt 0) { return ($without | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1) }

    # Legacy naming: collection_<slug>_<rev>_<when>, highest revision wins.
    $best = $null
    $bestRev = -1
    foreach ($d in (Get-ChildItem -LiteralPath $dir -Directory -Filter ('collection_' + $Slug + '_*') -EA SilentlyContinue)) {
        $m = [regex]::Match($d.Name, '^collection_' + [regex]::Escape($Slug) + '_(\d+)_')
        if (-not $m.Success) { continue }
        $r = [int]$m.Groups[1].Value
        if ($r -gt $bestRev) { $bestRev = $r; $best = $d }
    }
    return $best
}

<#
  Where Get-CollectionJsonPath last read a collection.json from when it was
  not loose: the full path of the export archive, or '' when the loose file
  was used. Set on every call so a caller can say which file it read.
#>
$script:CollectionJsonFrom = ''

<#
  Vortex's export archives under an installed collection's staging folder,
  best first, or an empty array.

  WHY THIS EXISTS. Measured on the shipping machine on 27 September against
  collection 7essxf: the installed folder
  %APPDATA%\Vortex\skyrimse\mods\vortex_collection_ZRT7NjhN_ holds NO loose
  collection.json. The JSON is inside export\collection_0.7z, which is what
  Vortex writes when the collection is authored on the machine rather than
  subscribed to. Check-CollectionRules looked only for the loose file, so on
  that machine it stopped with "no collection.json at ...\collection.json"
  and exited 1 unless somebody unpacked the archive and passed -Collection.

  Best first means: the export folder before the staging folder's own root,
  a name starting with collection before any other name, and the newest
  write time before an older one. In the staging folder's own root only a
  collection* name counts, because anything else there is a mod's archive
  and not the collection.
#>
function Get-CollectionExportArchive([string]$Folder) {
    # The archives go out one by one, so every caller's @(...) is the list and
    # its Count the number of archives. It used to return the list as one
    # object, so @(...) held one item even with no archive at all: Count was
    # never 0, and a caller's foreach got the whole list as one "archive".
    if (-not $Folder -or -not (Test-Path -LiteralPath $Folder -PathType Container)) { return }
    $found = New-Object Collections.Generic.List[object]
    $places = @((Join-Path $Folder 'export'), $Folder)
    for ($i = 0; $i -lt $places.Count; $i++) {
        if (-not (Test-Path -LiteralPath $places[$i] -PathType Container)) { continue }
        foreach ($f in (Get-ChildItem -LiteralPath $places[$i] -File -EA SilentlyContinue)) {
            if ($f.Extension -ne '.7z' -and $f.Extension -ne '.zip') { continue }
            $named = 1
            if ($f.Name -like 'collection*') { $named = 0 }
            if ($i -gt 0 -and $named -ne 0) { continue }
            [void]$found.Add([pscustomobject]@{ File = $f; Place = $i; Named = $named })
        }
    }
    if ($found.Count -eq 0) { return }
    $sorted = @($found | Sort-Object Place, Named, @{ Expression = { $_.File.LastWriteTimeUtc }; Descending = $true })
    foreach ($x in $sorted) { $x.File }
}

<#
  The 7-Zip on this machine, or $null. Only used to read one collection.json
  out of a Vortex export archive, so nothing here installs it: a machine
  without 7-Zip is told to pass the extracted file with -Collection instead.
  Vortex's own copy counts, since a machine with Vortex on it usually has one.
#>
function Get-SevenZipPath {
    $spots = New-Object Collections.Generic.List[string]
    if ($env:ProgramFiles) {
        [void]$spots.Add((Join-Path $env:ProgramFiles '7-Zip\7z.exe'))
        [void]$spots.Add((Join-Path $env:ProgramFiles 'Black Tree Gaming Ltd\Vortex\resources\7z.exe'))
    }
    if (${env:ProgramFiles(x86)}) { [void]$spots.Add((Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe')) }
    if ($env:LOCALAPPDATA) {
        [void]$spots.Add((Join-Path $env:LOCALAPPDATA 'Programs\7-Zip\7z.exe'))
        [void]$spots.Add((Join-Path $env:LOCALAPPDATA 'Programs\Vortex\resources\7z.exe'))
    }
    foreach ($p in $spots) { if (Test-Path -LiteralPath $p -PathType Leaf) { return $p } }
    foreach ($n in '7z', '7za', '7zz') {
        $c = @(Get-Command $n -CommandType Application -EA SilentlyContinue) | Select-Object -First 1
        if ($c) { return $c.Source }
    }
    return $null
}

<#
  One collection.json read out of an export archive, cached under the temp
  folder, or $null.

  Read only where it matters: nothing is written into Vortex's folders. The
  cache path carries the archive's path, size and write time, so a re-exported
  archive never reads back an old JSON and a second run costs nothing. A .zip
  is opened with what .NET already has; a .7z needs 7-Zip, and without it this
  returns $null and the caller says so.
#>
function Expand-CollectionJson($Archive) {
    if (-not $Archive -or -not (Test-Path -LiteralPath $Archive.FullName -PathType Leaf)) { return $null }
    $key = $Archive.FullName + '|' + $Archive.Length + '|' + $Archive.LastWriteTimeUtc.Ticks
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($key))).Replace('-', '').Substring(0, 16)
    } finally { $sha.Dispose() }
    $cache = Join-Path (Join-Path ([IO.Path]::GetTempPath()) 'thornswood-collection') $hash
    $out = Join-Path $cache 'collection.json'
    if (Test-Path -LiteralPath $out -PathType Leaf) { return $out }
    $null = New-Item -ItemType Directory -Force -Path $cache -EA SilentlyContinue
    if (-not (Test-Path -LiteralPath $cache -PathType Container)) { return $null }

    if ($Archive.Extension -eq '.zip') {
        try {
            Add-Type -AssemblyName System.IO.Compression.FileSystem -EA SilentlyContinue
            $zip = [IO.Compression.ZipFile]::OpenRead($Archive.FullName)
            try {
                $entry = @($zip.Entries | Where-Object { $_.Name -eq 'collection.json' } |
                        Sort-Object { $_.FullName.Length }) | Select-Object -First 1
                if ($entry) { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $out, $true) }
            } finally { $zip.Dispose() }
        } catch { }
        if (Test-Path -LiteralPath $out -PathType Leaf) { return $out }
    }

    $exe = Get-SevenZipPath
    if ($exe) {
        # 7-Zip writes to stderr on a warning, which is a terminating error in
        # the callers that run with ErrorActionPreference Stop, so it is
        # relaxed around the call.
        $was = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { & $exe e -y ('-o' + $cache) $Archive.FullName 'collection.json' -r 2>&1 | Out-Null } catch { }
        finally { $ErrorActionPreference = $was }
        if (Test-Path -LiteralPath $out -PathType Leaf) { return $out }
    }
    Remove-Item -LiteralPath $cache -Recurse -Force -EA SilentlyContinue
    return $null
}

<#
  The collection.json for an installed collection's staging folder, or $null.

  The loose file when it is there, which is what a subscribed install writes.
  Otherwise the one inside the newest export archive, unpacked to the temp
  cache, which is the only copy an authored collection leaves on the machine.
  $script:CollectionJsonFrom names the archive it came out of, or is '' for
  the loose file, so the caller can print where it read.
#>
function Get-CollectionJsonPath([string]$Folder) {
    $script:CollectionJsonFrom = ''
    if (-not $Folder) { return $null }
    $loose = Join-Path $Folder 'collection.json'
    if (Test-Path -LiteralPath $loose -PathType Leaf) { return $loose }
    foreach ($a in @(Get-CollectionExportArchive $Folder)) {
        $out = Expand-CollectionJson $a
        if ($out) { $script:CollectionJsonFrom = $a.FullName; return $out }
    }
    return $null
}

<#
  The newest collection revision VORTEX KNOWS ABOUT for a slug, or 0.

  Read through the shared reader (launcher\app\VortexProfileState.cs). The
  launcher has no copy: it never asks for the newest revision, and the one
  it had was removed with no caller (#1957). Highest wins of:
    1. the newestVersion Vortex records against the collection's own mod,
       tied to the slug the way the installed revision is
    2. collections###revisions###<id>###info###revisionNumber for a cached
       revision of the slug
    3. the installed revision, as the floor, so Known stays true on a current
       draft with no newestVersion key

  Until #1902 this matched raw bytes in every file of state.v2: the plain
  newestVersion value, and the "newestVersion","from":"3","to":"4" transition
  text. Those are whole only in the write-ahead log. Once Vortex compacts them
  into a compressed table nothing matched, Newest fell to the installed
  revision, and Behind read false with a newer revision known. Neither text
  was tied to a mod or a slug, so any mod whose version went from one whole
  number to another counted as a revision. The newestVersion Vortex keeps on
  the collection's own mod is the number, read from current state; another
  mod's newestVersion is that mod's version, not a revision.

  0 when nothing can be read, which Get-CollectionState reports as not Known.
#>
function Get-CollectionNewest([string]$Slug) {
    if (-not $Slug) { return 0 }
    $st = Get-VortexStateDir
    if (-not (Test-Path -LiteralPath $st)) { return 0 }
    try {
        Import-VortexStateReader
        return [Thornswood.VortexProfileState]::CollectionNewest($st, $Slug)
    } catch { return 0 }
}

<#
  Is this machine's collection behind what Vortex knows is out there?

  Returns a small object rather than a bool, because every caller wants to
  say the two numbers and a bool cannot. Behind is $false when either number
  is unknown: silence beats a guess in both directions. Newest is asked for
  this collection's slug so a second collection on the same machine cannot
  make Known false or Behind true by accident.
#>
function Get-CollectionState([string]$Url) {
    $slug = Get-CollectionSlug $Url
    $have = Get-CollectionRevision $slug
    $newest = Get-CollectionNewest $slug
    return [pscustomobject]@{
        Slug     = $slug
        Have     = $have
        Newest   = $newest
        Behind   = ($have -gt 0 -and $newest -gt 0 -and $have -lt $newest)
        Known    = ($have -gt 0 -and $newest -gt 0)
    }
}

<#
  The Vortex profile folder whose name is $Name (default Thornswood), or $null.
  Bake and Ship must read this profile, never whichever profile last wrote
  Windows' live plugins.txt (#557).
#>
function Get-VortexProfileDir([string]$Name = 'Thornswood') {
    if (-not $Name) { return $null }
    $profilesRoot = Join-Path (Get-VortexDir) 'skyrimse\profiles'
    if (-not (Test-Path -LiteralPath $profilesRoot)) { return $null }
    $st = Get-VortexStateDir
    if (Test-Path -LiteralPath (Join-Path $st 'CURRENT')) {
        # The current LevelDB metadata survives compaction; transition text does not.
        Import-VortexStateReader
        try { return [Thornswood.VortexProfileState]::Find($st, $profilesRoot, $Name) }
        catch { throw 'Vortex profile metadata cannot be verified. Finish its deployment, close Vortex, then retry. Do not create another profile to work around unreadable state.' }
    }
    $ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    if (Test-Path -LiteralPath $st) {
        $pairRe = '"profileId"\s*:\s*"([^"]+)"\s*,\s*"profileName"\s*:\s*"' + [regex]::Escape($Name) + '"'
        $pairRe2 = '"profileName"\s*:\s*"' + [regex]::Escape($Name) + '"\s*,\s*"profileId"\s*:\s*"([^"]+)"'
        foreach ($f in (Get-ChildItem -LiteralPath $st -File -EA SilentlyContinue)) {
            try {
                $txt = Get-VortexStateText $f.FullName
                foreach ($m in [regex]::Matches($txt, $pairRe)) { [void]$ids.Add($m.Groups[1].Value) }
                foreach ($m in [regex]::Matches($txt, $pairRe2)) { [void]$ids.Add($m.Groups[1].Value) }
            } catch { }
        }
    }
    foreach ($id in $ids) {
        $dir = Join-Path $profilesRoot $id
        if (Test-Path -LiteralPath (Join-Path $dir 'plugins.txt')) { return $dir }
        if (Test-Path -LiteralPath $dir) { return $dir }
    }
    return $null
}

<#
  Require the named Vortex profile. Throws when missing: bake and Ship must
  not fall through to another profile's list.
#>
function Assert-VortexProfile([string]$Name = 'Thornswood') {
    $dir = Get-VortexProfileDir $Name
    if ($dir) { return $dir }
    throw ("Vortex profile '$Name' was not found. In Vortex, create or switch to a profile named $Name, deploy the collection, then try again. Looked under %APPDATA%\Vortex\skyrimse\profiles and state.v2.")
}

<#
  Compare plugins.txt / loadorder.txt copies that must agree on a ship machine.
  Returns difference lines (empty when they match or fewer than two exist).
#>
function Get-LoadOrderCopyDiffs([hashtable]$Copies) {
    $diffs = New-Object Collections.Generic.List[string]
    if (-not $Copies -or $Copies.Count -lt 2) { return [string[]]$diffs.ToArray() }
    $names = @($Copies.Keys | Sort-Object)
    for ($i = 0; $i -lt $names.Count; $i++) {
        for ($j = $i + 1; $j -lt $names.Count; $j++) {
            $aName = $names[$i]; $bName = $names[$j]
            $aPath = [string]$Copies[$aName]; $bPath = [string]$Copies[$bName]
            if (-not $aPath -or -not $bPath) { continue }
            if (-not (Test-Path -LiteralPath $aPath)) { continue }
            if (-not (Test-Path -LiteralPath $bPath)) { continue }
            $aLines = @(Get-Content -LiteralPath $aPath -ErrorAction SilentlyContinue)
            $bLines = @(Get-Content -LiteralPath $bPath -ErrorAction SilentlyContinue)
            $aEn = @($aLines | ForEach-Object { Get-LoadOrderEnabledName $_ } | Where-Object { $_ })
            $bEn = @($bLines | ForEach-Object { Get-LoadOrderEnabledName $_ } | Where-Object { $_ })
            $mismatch = Get-LoadOrderFirstMismatch $aEn $bEn
            if ($mismatch -ge 0) {
                $aAt = if ($mismatch -lt $aEn.Count) { $aEn[$mismatch] } else { '(end)' }
                $bAt = if ($mismatch -lt $bEn.Count) { $bEn[$mismatch] } else { '(end)' }
                [void]$diffs.Add(("$aName vs $bName first differ at index {0}: {1} vs {2}" -f $mismatch, $aAt, $bAt))
            } elseif ($aEn.Count -ne $bEn.Count) {
                [void]$diffs.Add(("$aName vs $bName length {0} vs {1}" -f $aEn.Count, $bEn.Count))
            }
        }
    }
    return [string[]]$diffs.ToArray()
}

# "7essxf" out of https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf
function Get-CollectionSlug([string]$Url) {
    if (-not $Url) { return '' }
    $at = $Url.LastIndexOf('/collections/', [StringComparison]::OrdinalIgnoreCase)
    if ($at -lt 0) { return '' }
    $s = $Url.Substring($at + '/collections/'.Length).Trim()
    $q = $s.IndexOfAny([char[]]('/', '?', '#'))
    if ($q -ge 0) { $s = $s.Substring(0, $q) }
    if ($s -notmatch '^[A-Za-z0-9]+$') { return '' }
    return $s
}

function Test-LoadOrderMaster([string]$Name) {
    $n = "$Name".Trim()
    foreach ($m in $script:LoadOrderMasters) {
        if ([string]::Equals($m, $n, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

# An .esl, or the ESL flag in the TES4 header: Checks.TakesNoPlace in the
# launcher. A header that cannot be read answers true, as Checks.IsLight does.
# A file that is not there answers false; missing is the "not in Data" issue's.
function Test-LoadOrderLight([string]$Path) {
    if ($Path -match '\.esl$') { return $true }
    if (-not [IO.File]::Exists($Path)) { return $false }
    try {
        $b = New-Object byte[] 12
        $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        try { $n = $fs.Read($b, 0, 12) } finally { $fs.Close() }
        if ($n -lt 12) { return $true }
        if ([Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'TES4') { return $true }
        return (([BitConverter]::ToUInt32($b, 8) -band 0x200) -ne 0)
    } catch { return $true }
}

# The plugin an enabled line switches on, or $null for a comment, a blank or a
# disabled line.
function Get-LoadOrderEnabledName([string]$Line) {
    $s = "$Line".Trim()
    if (-not $s.StartsWith('*')) { return $null }
    $n = $s.Substring(1).Trim()
    if ($n.Length -eq 0) { return $null }
    return $n
}

# The full plugin order the game will use. $IsLightOrMissing and $ExistsInData
# are script blocks taking the plugin name as their one argument.
function Get-LoadOrderGame([string[]]$Enabled, [scriptblock]$IsLightOrMissing, [string[]]$Ccc, [scriptblock]$ExistsInData) {
    $order = New-Object Collections.Generic.List[string]
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($m in $script:LoadOrderMasters) { [void]$order.Add($m); [void]$seen.Add($m) }
    foreach ($names in @($Ccc, $Enabled)) {
        foreach ($raw in @($names)) {
            $n = "$raw".Trim()
            if ($n.Length -eq 0 -or $seen.Contains($n)) { continue }
            if ($null -ne $ExistsInData -and -not (& $ExistsInData $n)) { continue }
            if ($null -ne $IsLightOrMissing -and (& $IsLightOrMissing $n)) { continue }
            [void]$seen.Add($n)
            [void]$order.Add($n)
        }
    }
    return ,[string[]]$order.ToArray()
}

# The light plugin order the game will use: the Skyrim.ccc entries that are in
# Data and light, then the enabled entries that are in Data and light, each
# once. LoadOrder.LightOrder. $IsLight and $ExistsInData take the plugin name.
function Get-LoadOrderLight([string[]]$Enabled, [scriptblock]$IsLight, [string[]]$Ccc, [scriptblock]$ExistsInData) {
    $order = New-Object Collections.Generic.List[string]
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($m in $script:LoadOrderMasters) { [void]$seen.Add($m) }
    foreach ($names in @($Ccc, $Enabled)) {
        foreach ($raw in @($names)) {
            $n = "$raw".Trim()
            if ($n.Length -eq 0 -or $seen.Contains($n)) { continue }
            if ($null -ne $ExistsInData -and -not (& $ExistsInData $n)) { continue }
            if ($null -ne $IsLight -and -not (& $IsLight $n)) { continue }
            [void]$seen.Add($n)
            [void]$order.Add($n)
        }
    }
    return ,[string[]]$order.ToArray()
}

# An official Creation Club plugin, by its name: cc, three letters for who made
# it, SSE and three digits (ccBGSSSE001-Fish.esm, ccQDRSSE001-SurvivalMode.esl).
# LoadOrder.IsCreation in the launcher. #479: Special Edition is all Thornswood
# needs, and somebody who owns the Anniversary upgrade still plays.
function Test-LoadOrderCreation([string]$Name) {
    # -match is case blind, the way the game reads names.
    return ("$Name".Trim() -match '^cc[a-z]{3}sse\d{3}.*\.es[mlp]$')
}

# What an enabled list switches on that the reference does not, in list order,
# each once: LoadOrder.NotInBuild. An official Creation Club plugin that takes
# no place in the game's order (light, or not in Data) is not counted, because
# it moves nothing the server compares. A full one that is in Data still is.
function Get-LoadOrderNotInBuild([string[]]$Enabled, [string[]]$Reference, [scriptblock]$IsLightOrMissing) {
    $want = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($r in @($Reference)) { $t = "$r".Trim(); if ($t.Length) { [void]$want.Add($t) } }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $out = New-Object Collections.Generic.List[string]
    foreach ($raw in @($Enabled)) {
        $n = "$raw".Trim()
        if ($n.Length -eq 0 -or $want.Contains($n) -or -not $seen.Add($n)) { continue }
        if ((Test-LoadOrderCreation $n) -and ($null -eq $IsLightOrMissing -or (& $IsLightOrMissing $n))) { continue }
        [void]$out.Add($n)
    }
    return ,[string[]]$out.ToArray()
}

# The first position where the two lists name different plugins, or where one
# of them ends; -1 when they are the same list.
function Get-LoadOrderFirstMismatch([string[]]$Game, [string[]]$Manifest) {
    $g = if ($null -eq $Game) { 0 } else { $Game.Count }
    $m = if ($null -eq $Manifest) { 0 } else { $Manifest.Count }
    $n = [Math]::Max($g, $m)
    for ($i = 0; $i -lt $n; $i++) {
        if ($i -ge $g -or $i -ge $m) { return $i }
        if (-not [string]::Equals("$($Game[$i])".Trim(), "$($Manifest[$i])".Trim(), [StringComparison]::OrdinalIgnoreCase)) { return $i }
    }
    return -1
}

# The same plugins.txt lines with the full enabled plugins in the server's
# order. A line moves only when it enables a plugin the server names and that
# plugin is not light; those lines' positions are refilled top to bottom in the
# server's order, and every other line keeps its index. The masters are skipped
# on the server's side. A light plugin the server names holds its place. A
# plugin the server names that no line enables is not this function's to
# switch on: $null comes back and the list is left as it was.
#
# $LoadedFirst is the names the game loads before any list (Skyrim.ccc), which
# are skipped on the server's side the way the masters are: a server that
# loads light plugins names _ResourcePack.esl and no plugin list carries it.
# With $IsLight $null and the server's whole order, every line the server
# names moves into that order, light plugins included (LoadOrder.Reorder).
function Get-LoadOrderReordered([string[]]$Lines, [string[]]$Manifest, [scriptblock]$IsLight, [string[]]$LoadedFirst = @()) {
    if ($null -eq $Lines -or $null -eq $Manifest) { return $null }
    $first = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($f in @($LoadedFirst)) { $t = "$f".Trim(); if ($t.Length) { [void]$first.Add($t) } }
    $at = [Collections.Generic.Dictionary[string, int]]::new([StringComparer]::OrdinalIgnoreCase)
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        $name = Get-LoadOrderEnabledName $Lines[$i]
        if ($null -eq $name) { continue }
        if ($at.ContainsKey($name)) { return $null }
        $at[$name] = $i
    }
    $order = New-Object Collections.Generic.List[string]
    $slots = New-Object Collections.Generic.List[int]
    $placed = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($raw in $Manifest) {
        $n = "$raw".Trim()
        if ($n.Length -eq 0 -or (Test-LoadOrderMaster $n) -or $first.Contains($n) -or $placed.Contains($n)) { continue }
        [void]$placed.Add($n)
        if (-not $at.ContainsKey($n)) { return $null }
        $line = $at[$n]
        if ($null -ne $IsLight -and (& $IsLight $n)) { continue }
        [void]$order.Add($Lines[$line])
        [void]$slots.Add($line)
    }
    $slots.Sort()
    $result = [string[]]$Lines.Clone()
    for ($k = 0; $k -lt $slots.Count; $k++) { $result[$slots[$k]] = $order[$k] }
    return ,$result
}

# How many lines Get-LoadOrderReordered changed, and the plugin now sitting on
# the first of them.
function Get-LoadOrderMoved([string[]]$Before, [string[]]$After) {
    $n = 0
    $first = $null
    if ($null -ne $Before -and $null -ne $After -and $Before.Count -eq $After.Count) {
        for ($i = 0; $i -lt $Before.Count; $i++) {
            if ([string]::Equals($Before[$i], $After[$i], [StringComparison]::Ordinal)) { continue }
            if ($null -eq $first) {
                $first = Get-LoadOrderEnabledName $After[$i]
                if ($null -eq $first) { $first = $After[$i] }
            }
            $n++
        }
    }
    return [pscustomobject]@{ Count = $n; First = $first }
}

# The manifest's plugin names that no line enables, for saying which ones,
# skipping the names the game loads first as Get-LoadOrderReordered does.
function Get-LoadOrderNotEnabled([string[]]$Lines, [string[]]$Manifest, [string[]]$LoadedFirst = @()) {
    $missing = New-Object Collections.Generic.List[string]
    if ($null -eq $Lines -or $null -eq $Manifest) { return ,[string[]]$missing.ToArray() }
    $first = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($f in @($LoadedFirst)) { $t = "$f".Trim(); if ($t.Length) { [void]$first.Add($t) } }
    $have = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($l in $Lines) {
        $name = Get-LoadOrderEnabledName $l
        if ($null -ne $name) { [void]$have.Add($name) }
    }
    foreach ($raw in $Manifest) {
        $n = "$raw".Trim()
        if ($n.Length -eq 0 -or (Test-LoadOrderMaster $n) -or $first.Contains($n) -or $have.Contains($n)) { continue }
        if (-not $missing.Contains($n)) { [void]$missing.Add($n) }
    }
    return ,[string[]]$missing.ToArray()
}

# A plugin list's lines, and how the file is written, so it can be written
# back the same way: the game stops on a byte order mark, and a changed
# newline is a changed file to everything that hashes it.
function Read-LoadOrderFile([string]$Path) {
    $raw = [IO.File]::ReadAllBytes($Path)
    $bom = ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF)
    $skip = if ($bom) { 3 } else { 0 }
    $text = (New-Object Text.UTF8Encoding($false)).GetString($raw, $skip, $raw.Length - $skip)
    $nl = if ($text.IndexOf("`r`n", [StringComparison]::Ordinal) -ge 0) { "`r`n" } else { "`n" }
    $trailing = $text.EndsWith("`n")
    $lines = New-Object Collections.Generic.List[string]
    foreach ($l in ($text -split "`r`n|`n")) { [void]$lines.Add($l) }
    if ($trailing -and $lines.Count -gt 0) { $lines.RemoveAt($lines.Count - 1) }
    return [pscustomobject]@{ Lines = [string[]]$lines.ToArray(); Bom = $bom; NewLine = $nl; Trailing = $trailing }
}

function Write-LoadOrderFile([string]$Path, [string[]]$Lines, $Like) {
    $body = New-Object Collections.Generic.List[byte]
    if ($Like.Bom) { $body.AddRange([byte[]](0xEF, 0xBB, 0xBF)) }
    $text = ($Lines -join $Like.NewLine)
    if ($Like.Trailing) { $text += $Like.NewLine }
    $body.AddRange((New-Object Text.UTF8Encoding($false)).GetBytes($text))
    [IO.File]::WriteAllBytes($Path, $body.ToArray())
}

# Where the launcher on this machine reads the server's manifest: the same
# address as Verify.ServerBase, on the resources port SkyMp.ResourcePortFor
# works out from config.json. The main server on 7777 serves resources on
# 3000; any other port, the dev server's 7787 among them, serves them on the
# game port plus one.
function Get-LoadOrderManifestUrl([string]$Root) {
    $cfgPath = Join-Path $Root 'config.json'
    if (-not (Test-Path -LiteralPath $cfgPath)) { throw "no config.json at $cfgPath" }
    $raw = [IO.File]::ReadAllBytes($cfgPath)
    $skip = if ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF) { 3 } else { 0 }
    $cfg = ConvertFrom-ThornswoodJson ([Text.Encoding]::UTF8.GetString($raw, $skip, $raw.Length - $skip)) $cfgPath
    $addr = ''
    $portText = ''
    if ($cfg.PSObject.Properties.Name -contains 'ServerAddress') { $addr = [string]$cfg.ServerAddress }
    if ($cfg.PSObject.Properties.Name -contains 'ServerPort') { $portText = [string]$cfg.ServerPort }
    if (-not $addr) { throw "$cfgPath names no ServerAddress" }
    $port = 0
    if (-not [int]::TryParse($portText, [ref]$port) -or $port -le 0) { $port = 7777 }
    $rp = if ($port -eq 7777) { 3000 } else { $port + 1 }
    return "http://${addr}:$rp/api/servers/thornswood/manifest.json"
}

# The plugin names out of a manifest's JSON, in the server's order, or $null
# when it is not a manifest.
function ConvertFrom-LoadOrderManifest([string]$Json) {
    try { $doc = $Json | ConvertFrom-Json } catch { return $null }
    if ($null -eq $doc -or -not ($doc.PSObject.Properties.Name -contains 'mods') -or $null -eq $doc.mods) { return $null }
    $names = New-Object Collections.Generic.List[string]
    foreach ($m in @($doc.mods)) {
        if ($null -eq $m -or -not ($m.PSObject.Properties.Name -contains 'filename')) { continue }
        $f = "$($m.filename)"
        if ($f.Length) { [void]$names.Add($f) }
    }
    if ($names.Count -eq 0) { return $null }
    return ,[string[]]$names.ToArray()
}

# The whole of a manifest: Full, the plugin names that take a normal index
# (its mods, as ConvertFrom-LoadOrderManifest reads them); Light, the light
# plugins in light index order, which a server that loads them publishes as
# "light" (#1715) and an older one does not, so it is empty then; and All,
# the server's whole order, full and light together ("loadOrder"), or Full
# when there is no light list. $null when it is not a manifest.
function ConvertFrom-LoadOrderManifestDoc([string]$Json) {
    $full = ConvertFrom-LoadOrderManifest $Json
    if ($null -eq $full) { return $null }
    $doc = $Json | ConvertFrom-Json
    $light = New-Object Collections.Generic.List[string]
    if ($doc.PSObject.Properties.Name -contains 'light' -and $null -ne $doc.light) {
        foreach ($m in @($doc.light)) {
            if ($null -eq $m -or -not ($m.PSObject.Properties.Name -contains 'filename')) { continue }
            $f = "$($m.filename)"
            if ($f.Length) { [void]$light.Add($f) }
        }
    }
    $all = New-Object Collections.Generic.List[string]
    if ($light.Count -and $doc.PSObject.Properties.Name -contains 'loadOrder' -and $null -ne $doc.loadOrder) {
        foreach ($p in @($doc.loadOrder)) { $f = @("$p".Trim() -split '[\\/]')[-1]; if ($f.Length) { [void]$all.Add($f) } }
    }
    if ($all.Count -eq 0) { foreach ($f in $full) { [void]$all.Add($f) } }
    return [pscustomobject]@{ Full = $full; Light = [string[]]$light.ToArray(); All = [string[]]$all.ToArray() }
}

# The server's whole manifest (ConvertFrom-LoadOrderManifestDoc), fetched, or
# $null when the server does not answer. The same fetch as
# Get-LoadOrderManifest, read once into both shapes.
function Get-LoadOrderManifestDoc([string]$Url, [int]$TimeoutMs = 4000) {
    try {
        $req = [Net.WebRequest]::Create($Url)
        $req.Timeout = $TimeoutMs
        $req.ReadWriteTimeout = $TimeoutMs
        $req.UserAgent = 'ThornswoodPublish'
        $res = $req.GetResponse()
        try {
            $sr = New-Object IO.StreamReader($res.GetResponseStream())
            try { $json = $sr.ReadToEnd() } finally { $sr.Close() }
        } finally { $res.Close() }
    } catch { return $null }
    return ConvertFrom-LoadOrderManifestDoc $json
}

# The server's manifest, fetched, or $null when the server does not answer.
function Get-LoadOrderManifest([string]$Url, [int]$TimeoutMs = 4000) {
    $doc = Get-LoadOrderManifestDoc $Url $TimeoutMs
    if ($null -eq $doc) { return $null }
    return ,$doc.Full
}
