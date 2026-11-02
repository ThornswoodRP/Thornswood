<#
  Front.ps1

      . (Join-Path $PSScriptRoot 'Front.ps1')

  What Build-Front.ps1 and Go.ps1 share about the front build, the page
  skymp5-front's webpack makes for Data\Platform\UI: the record of it, the
  zip it travels in, and the check that a zip is the recorded build.

  WHY. Until 20 October the front was local\thornswood-front.zip, built on
  One from nobody knew which commit and checked by nothing, and Go.ps1
  unpacked whatever was there. Measured that day (#1317): the zip predated
  the fork's #40, so every release still shipped four commercial faces, DIN
  Pro and Futura PT, as hashed .ttf files under Data\Platform\UI, a month
  after the fork had taken them out. Patrick's A on #2754 builds the front
  from the pinned fork instead, in the cloud or anywhere, so the build is
  recorded like the client's (records\front-build.json) and a zip that is not
  that build is refused.

  Runs in PowerShell 7, on Windows and Linux.
#>

$ThornswoodFrontRecordPath = Join-Path $PSScriptRoot '..\..\records\front-build.json'
# The licence text of each npm package webpack put in build.js, one file per
# package, named as the record's packages name them (#3751).
$ThornswoodFrontLicencesDir = Join-Path $PSScriptRoot '..\..\records\front-licences'

function Add-ThornswoodZipTypes {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
}

function Get-ThornswoodSha256OfStream([IO.Stream]$s) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($s)) -replace '-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

# Each file in a folder, by its name relative to the folder with / between
# parts, to its sha256 and bytes, in ordinal order.
function Get-ThornswoodFolderFiles([string]$Folder) {
    $root = (Resolve-Path -LiteralPath $Folder).ProviderPath.TrimEnd('\', '/')
    $out = [ordered]@{}
    $all = @(Get-ChildItem -LiteralPath $root -File -Recurse | ForEach-Object {
        [pscustomobject]@{ Rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/'); Full = $_.FullName; Bytes = $_.Length }
    })
    foreach ($f in @($all | Sort-Object { $_.Rel } -Culture '' -CaseSensitive)) {
        $s = [IO.File]::OpenRead($f.Full)
        try { $h = Get-ThornswoodSha256OfStream $s } finally { $s.Dispose() }
        $out[$f.Rel] = [pscustomobject]@{ sha256 = $h; bytes = [long]$f.Bytes }
    }
    return $out
}

# Each file in a zip, the same way.
function Get-ThornswoodZipFiles([string]$Zip) {
    Add-ThornswoodZipTypes
    $out = [ordered]@{}
    $z = [IO.Compression.ZipFile]::OpenRead($Zip)
    try {
        foreach ($e in @($z.Entries | Where-Object { $_.Name } | Sort-Object { $_.FullName.Replace('\', '/') } -Culture '' -CaseSensitive)) {
            $s = $e.Open()
            try { $h = Get-ThornswoodSha256OfStream $s } finally { $s.Dispose() }
            $out[$e.FullName.Replace('\', '/')] = [pscustomobject]@{ sha256 = $h; bytes = [long]$e.Length }
        }
    } finally { $z.Dispose() }
    return $out
}

# A zip of the folder's files, in ordinal order with one fixed time, so the
# same build makes the same zip on any machine.
function Write-ThornswoodFrontZip([string]$Folder, [string]$Zip) {
    Add-ThornswoodZipTypes
    $root = (Resolve-Path -LiteralPath $Folder).ProviderPath.TrimEnd('\', '/')
    if (Test-Path -LiteralPath $Zip) { Remove-Item -LiteralPath $Zip -Force }
    $dir = Split-Path -Parent $Zip
    if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $when = New-Object DateTimeOffset 2000, 1, 1, 0, 0, 0, ([TimeSpan]::Zero)
    $z = [IO.Compression.ZipFile]::Open($Zip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($rel in @((Get-ThornswoodFolderFiles $root).Keys)) {
            $e = $z.CreateEntry($rel, [IO.Compression.CompressionLevel]::Optimal)
            $e.LastWriteTime = $when
            $w = $e.Open()
            try {
                $r = [IO.File]::OpenRead((Join-Path $root $rel))
                try { $r.CopyTo($w) } finally { $r.Dispose() }
            } finally { $w.Dispose() }
        }
    } finally { $z.Dispose() }
}

function Get-ThornswoodFullPath([string]$Path) {
    return [IO.Path]::GetFullPath(($Path -replace '[\\/]', [IO.Path]::DirectorySeparatorChar)).TrimEnd([char]'\', [char]'/')
}

# Whether $Fork is a clone of its own. An engine\skymp submodule that was
# never fetched, which is how a cloud checkout starts, is an empty folder, and
# git run in it answers for the checkout around it: until 22 Oct Build-Front
# then said the fork "does not have" the pinned commit and named a fetch that
# changed nothing (the cloud Desk's first dev Ship, #3315).
function Test-ThornswoodForkClone([string]$Fork) {
    if (-not $Fork -or -not (Test-Path -LiteralPath $Fork -PathType Container)) { return $false }
    $top = (& git -C $Fork rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $top) { return $false }
    return [string]::Equals((Get-ThornswoodFullPath "$top".Trim()), (Get-ThornswoodFullPath $Fork), [StringComparison]::OrdinalIgnoreCase)
}

function Read-ThornswoodFrontRecord([string]$Path = $ThornswoodFrontRecordPath) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "there is no front build record at $Path" }
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8).TrimStart([char]0xFEFF) | ConvertFrom-Json
}

# What is wrong with a set of files against the record: a file it does not
# list, a file with other bytes, a file it lists that is not there. None is
# the recorded build.
function Get-ThornswoodFrontProblems($Files, $Record) {
    $want = @{}
    foreach ($p in $Record.files.PSObject.Properties) { $want[$p.Name] = $p.Value }
    $out = @()
    foreach ($k in @($Files.Keys)) {
        if (-not $want.ContainsKey($k)) { $out += "$k is not in the recorded build"; continue }
        if ($Files[$k].sha256 -ne ([string]$want[$k].sha256).ToLowerInvariant()) { $out += "$k is not the recorded bytes" }
    }
    foreach ($k in @($want.Keys | Sort-Object)) { if (-not $Files.Contains($k)) { $out += "$k, which the build makes, is missing" } }
    return $out
}

# THE PACKAGES INSIDE build.js (#3751). webpack bundles npm packages into
# build.js under their own licences, MIT and BSD among them, which ask for
# their notice to go with every copy, and until 27 October nothing recorded
# which: the @license comments some of them leave in it were the only notice,
# and a minifier setting drops those. The front is webpack's development
# build, which names every module it holds on a line of its own,
# /***/ "<loaders>!<path>":, so the packages are read from build.js itself,
# and each one's licence from the folder webpack took it from.

# The folders, under the folder the front was built in, of the npm packages
# in a development build. A bundle that names no module (a production build)
# stops this, rather than reading as one with no packages.
function Get-ThornswoodBundlePackages([string]$Bundle) {
    $dirs = New-Object 'System.Collections.Generic.SortedSet[string]' ([StringComparer]::Ordinal)
    $modules = 0
    foreach ($line in [IO.File]::ReadLines($Bundle)) {
        if ($line -notmatch '^/\*\*\*/ "(.+)":\s*$') { continue }
        $modules++
        $id = $Matches[1]
        $res = $id.Substring($id.LastIndexOf('!') + 1)
        if ($res -match '^\./(.*node_modules/(?:@[^/]+/)?[^/]+)/') { [void]$dirs.Add($Matches[1]) }
    }
    if (-not $modules) { throw "$Bundle names no module, so it is not webpack's development build and the packages inside it cannot be read from it" }
    return ,@($dirs)
}

# A package's name, version, declared licence and licence text, read from
# its folder. Several licence files are given together, each under a line
# naming it; a package with none stops this, since its notice is owed.
function Get-ThornswoodPackageNotice([string]$Dir) {
    $pj = Join-Path $Dir 'package.json'
    if (-not (Test-Path -LiteralPath $pj -PathType Leaf)) { throw "$Dir has no package.json" }
    $j = [IO.File]::ReadAllText($pj) | ConvertFrom-Json
    $lic = $null
    if ($j.license -is [string]) { $lic = $j.license }
    elseif ($j.license -and $j.license.type) { $lic = [string]$j.license.type }
    elseif ($j.licenses) { $lic = (@($j.licenses | ForEach-Object { if ($_ -is [string]) { $_ } else { [string]$_.type } }) -join ' OR ') }
    $files = @(Get-ChildItem -LiteralPath $Dir -File | Where-Object { $_.Name -match '(?i)^(licen[cs]e|copying)([.-].*)?$' } | Sort-Object Name)
    if (-not $files.Count) { throw "$($j.name) $($j.version) is in build.js and carries no licence file in $Dir. Its notice is owed and there is nothing to give." }
    if ($files.Count -eq 1) { $bytes = [IO.File]::ReadAllBytes($files[0].FullName) }
    else {
        $utf8 = New-Object Text.UTF8Encoding($false)
        $ms = New-Object IO.MemoryStream
        foreach ($f in $files) {
            $h = $utf8.GetBytes("==> $($f.Name) <==`n")
            $ms.Write($h, 0, $h.Length)
            $b = [IO.File]::ReadAllBytes($f.FullName)
            $ms.Write($b, 0, $b.Length)
            $ms.WriteByte(10)
        }
        $bytes = $ms.ToArray()
    }
    return [pscustomobject]@{ Name = [string]$j.name; Version = [string]$j.version; Licence = $lic; Bytes = $bytes }
}

# The text's name for a package: npm-<name>-<version>, with a scope's @
# dropped and its / a -.
function Get-ThornswoodPackageTextName([string]$Name, [string]$Version) {
    $n = 'npm-' + $Name.TrimStart('@').Replace('/', '-') + '-' + $Version
    if ($n -notmatch '^[a-z0-9][a-z0-9._-]*$') { throw "$Name $Version makes the text name $n, which is not one a file can safely have" }
    return $n
}

# The packages in the build.js of $Dist, built in $Front, by text name, each
# @{ package; version; licence; from; sha256; bytes; Text (its bytes) }, in
# name order. One package at one version in two folders is one entry.
function Get-ThornswoodFrontPackages([string]$Dist, [string]$Front) {
    $out = [ordered]@{}
    $found = @{}
    foreach ($d in (Get-ThornswoodBundlePackages (Join-Path $Dist 'build.js'))) {
        $p = Get-ThornswoodPackageNotice (Join-Path $Front ($d -replace '/', [IO.Path]::DirectorySeparatorChar))
        $n = Get-ThornswoodPackageTextName $p.Name $p.Version
        if ($found.ContainsKey($n)) { continue }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $h = ([BitConverter]::ToString($sha.ComputeHash($p.Bytes)) -replace '-', '').ToLowerInvariant() } finally { $sha.Dispose() }
        $found[$n] = [ordered]@{ package = $p.Name; version = $p.Version; licence = $p.Licence; from = $d; sha256 = $h; bytes = [long]$p.Bytes.Length; Text = $p.Bytes }
    }
    foreach ($n in @($found.Keys | Sort-Object -Culture '' -CaseSensitive)) { $out[$n] = $found[$n] }
    return $out
}

# What is wrong with measured packages against the record: one it does not
# list, one with another text, one it lists that the build has not got.
function Get-ThornswoodFrontPackageProblems($Packages, $Record) {
    $want = @{}
    $rp = $Record.PSObject.Properties['packages']
    if ($rp -and $rp.Value) { foreach ($p in $rp.Value.PSObject.Properties) { $want[$p.Name] = $p.Value } }
    $out = @()
    foreach ($k in @($Packages.Keys)) {
        if (-not $want.ContainsKey($k)) { $out += "build.js holds $k, which the record does not list"; continue }
        if ($Packages[$k].sha256 -ne ([string]$want[$k].sha256).ToLowerInvariant()) { $out += "$k's licence text is not the recorded one" }
    }
    foreach ($k in @($want.Keys | Sort-Object)) { if (-not $Packages.Contains($k)) { $out += "the record lists $k, which build.js does not hold" } }
    return $out
}
