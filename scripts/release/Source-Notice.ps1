<#
.SYNOPSIS
  The note and licence texts that go inside every download on the update feed that carries SkyMP files.

.DESCRIPTION
  Source-Notice.ps1

  Publish-Update.ps1 dot-sources this. It puts a note saying where the source
  is, and the GNU GPL and AGPL texts, inside the client runtime zip and inside
  every pack that carries a SkyMP file.

  WHY IT EXISTS. Issue #421. The six files in records\client-build.json are
  SkyMP, under the GNU GPL version 3 (MpClientPlugin.dll under the AGPL), and
  both licences ask that a copy of the licence and directions to the source go
  with the files. The setup does that (SOURCE CODE.txt and the texts,
  Build-SetupFiles.ps1). The feed did not: on 28 September the dev feed's
  client-runtime-267ac311.zip and the live feed's client-runtime-a922b480.zip
  held the six files and nothing else, and a pack that carried one of them
  said nothing either. Those are the downloads the launcher takes the files
  from, so they are what hands them on.

  THE LAUNCHER IGNORES WHAT THIS ADDS. ClientRuntime.cs takes out of the
  client runtime zip only the six paths the record names, and Updater.Install
  unpacks only game\ and profile\ entries of a pack (and reads delete.txt). So
  a note and two texts at the top of either zip travel with the download and
  change nothing a launcher does.

  THE LIBRARIES INSIDE THEM (#3099). The four native files of the six link
  the fork's vcpkg libraries statically, so each library's code is inside
  the file that uses it, and the MIT and BSD ones ask for their notice to go
  with every binary copy. records\client-licences.json, beside the client
  record, says which library is in which file (the fork's build reads each
  file's program database; New-ClientLicenceRecord.ps1 records it), and
  records\client-licences\<port>.txt is each one's text as vcpkg installed
  it. A download that carries one of those files carries, in licences\
  beside the note, the text of every library in the files it carries, and
  the note lists them. Version 2 of the note is the first that does.

  THE CODE THAT DOES NOT COME THROUGH VCPKG (#3751). The same record also
  lists, as libraries, the fork's own folders under a notice of their own
  (Tilted Phoques' libraries under skyrim-platform\src\tilted, papyrus-vm,
  viet and libespm) and the npm packages webpack put in skymp5-client.js,
  each with its text in client-licences\ under its own name; a client
  measured before #3751 has none. build.js is webpack's build of
  skymp5-front, and front-build.json beside the client record lists the npm
  packages in it, each with its text in front-licences\ beside it
  (Build-Front.ps1). A download that carries build.js as that build carries
  those texts too, in the same licences folder, and the note lists them
  with the rest.

  WHERE FRIDA'S PARTS ARE (#3287). Version 3 is the first that names the
  Release of their archives, records\frida-sources.json; see
  $SourceNoticeBundled below.

  $SourceNoticeVersion goes into the feed's clientRuntime entry. A client
  runtime already on the feed without it (or with an older one) is published
  again even though its commit did not move, so the zip that carries the note
  replaces the one that did not.

  The setup's SOURCE CODE.txt is written from the same entries
  (Build-SetupFiles.ps1 calls Get-SourceNoticeEntries), and
  tests\test-source-offer.ps1 holds the two to each other.
#>

$SourceNoticeVersion = 3

# Each SkyMP file the feed can carry, by its path in the game folder. Built:
# from the fork at the commit client-build.json names. Front: build.js, which
# every Ship builds from the fork's skymp5-front at the pin since #2931 and
# holds to front-build.json beside the client record. Not built: taken from
# upstream SkyMP, with no recorded commit (THIRD-PARTY.md, "From upstream
# SkyMP, not built here").
$SourceNoticeFiles = [ordered]@{
    'Data\SKSE\Plugins\MpClientPlugin.dll'                                     = @('skymp5-server',   'GNU AGPL version 3', 'built')
    'Data\SKSE\Plugins\SkyrimPlatform.dll'                                     = @('skyrim-platform', 'GNU GPL version 3',  'built')
    'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformImpl.dll'    = @('skyrim-platform', 'GNU GPL version 3',  'built')
    'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformCEF.exe.hidden' = @('skyrim-platform', 'GNU GPL version 3', 'built')
    'Data\Platform\Plugins\skymp5-client.js'                                   = @('skymp5-client',   'GNU GPL version 3',  'built')
    'Data\Scripts\TESModPlatform.pex'                                          = @('skyrim-platform', 'GNU GPL version 3',  'built')
    'Data\Platform\UI\build.js'                                                = @('skymp5-front',    'GNU GPL version 3',  'front')
    'Data\Platform\Modules\skyrimPlatform.ts'                                  = @('skyrim-platform', 'GNU GPL version 3',  'upstream')
    'Data\Scripts\MpClientPlugin.pex'                                          = @('client-deps',     'no LICENSE file in that folder', 'upstream')
}

# Libraries inside a port's own prebuilt library, by port, with where their
# source is. frida-gum's port installs Frida's devkit, and its frida-gum.lib
# holds gum and the libraries Frida's releng/deps.mk builds it with (#3287).
# glib, gobject and proxy-libintl are the LGPL, which a copy under the GPL
# turns into a duty to say where their source is. records\frida-sources.json
# names each part, the commit Frida built it from and its archive on one
# permanent Release of Thornswood's repository (Patrick, C on #3287, 26 Oct
# 2026), and, while its forksUp is true, Thornswood's own fork of each of
# Frida's repositories, tagged at that commit. Version 3 of the note is the
# first that names the Release. Anybody can reach it once the repository is
# public, and until then the note names the forks beside it, so no note ever
# points only at something gone (Publish-FridaSources.ps1 -ForksMayGo says
# when the forks may go).
$SourceNoticeBundled = [ordered]@{
    'frida-gum' = @{ Maker = 'Frida'; Record = (Join-Path $PSScriptRoot '..\..\records\frida-sources.json') }
}

# A bundled port's record, read when a note needs it, so a stand-in folder
# with no such record works until something carries the port. Throws a
# sentence when the record is missing or names no parts: the directions are
# owed with the file (#3287), so the release stops.
function Get-SourceNoticeBundle([string]$Port) {
    $path = [string]$SourceNoticeBundled[$Port].Record
    if (-not (Test-Path -LiteralPath $path)) { throw "$path is missing. Where the source of what is inside $Port is has to go with the files it is in (#3287)." }
    $r = [IO.File]::ReadAllText($path).TrimStart([char]0xFEFF) | ConvertFrom-Json
    if (-not @($r.parts).Count -or -not $r.release.tag) { throw "$path names no parts or no Release" }
    return $r
}

<#
  The vcpkg libraries inside the files of $Carried, from client-licences.json
  beside $ClientRecord, in name order, each @{ Port; Version; Licence; Files
  (the carried files it is in, by leaf name); Bytes (its text, held to the
  record's sha256 and size) }. Empty when $Carried holds none of those files.
  Throws a sentence when the record is missing, is of another commit than the
  client record, or a text is missing or not the one it names: those texts
  are owed with the files (#3099), so the release stops. The record's
  libraries (#3751) come in the same list, the same way, in name order
  after the ports.
#>
function Get-ClientLicences([string]$ClientRecord, [string[]]$Carried) {
    $dir = Split-Path -Parent $ClientRecord
    $path = Join-Path $dir 'client-licences.json'
    if (-not (Test-Path -LiteralPath $path)) { throw "$path is missing. The licence texts of the libraries inside the SkyMP files have to go with them (#3099)." }
    $raw = "$(Get-Content -LiteralPath $path -Raw)"
    if (-not $raw.Trim([char]0xFEFF, ' ', [char]9, [char]13, [char]10)) { throw "$path is empty" }
    $l = $raw.TrimStart([char]0xFEFF) | ConvertFrom-Json
    $c = "$(Get-Content -LiteralPath $ClientRecord -Raw)".TrimStart([char]0xFEFF) | ConvertFrom-Json
    if ([string]$l.forkCommit -ne [string]$c.forkCommit) { throw "$path is the build of $($l.forkCommit) and client-build.json of $($c.forkCommit). The texts go with the files they were measured in." }
    $carriedFiles = @{}
    foreach ($p in @($l.files.PSObject.Properties)) {
        foreach ($x in @($Carried)) { if ($x -and $x.Equals([string]$p.Name, [StringComparison]::OrdinalIgnoreCase)) { $carriedFiles[[string]$p.Name] = @($p.Value); break } }
    }
    $out = @()
    foreach ($p in @($l.ports.PSObject.Properties | Sort-Object Name)) {
        $n = [string]$p.Name
        $in = @($carriedFiles.Keys | Where-Object { $carriedFiles[$_] -contains $n } | Sort-Object)
        if (-not $in.Count) { continue }
        $text = Join-Path $dir ('client-licences\' + $n + '.txt')
        if (-not (Test-Path -LiteralPath $text -PathType Leaf)) { throw "$text is missing. client-licences.json names it, and it has to go with the files $n is in (#3099)." }
        $bytes = [IO.File]::ReadAllBytes($text)
        $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
        if ($sha -ne ([string]$p.Value.sha256).ToLowerInvariant() -or $bytes.Length -ne [long]$p.Value.bytes) { throw "$text is not the text client-licences.json names for $n" }
        $out += [pscustomobject]@{
            Port = $n; Version = [string]$p.Value.version; Licence = [string]$p.Value.licence
            Files = @($in | ForEach-Object { $_.Substring($_.LastIndexOf('\') + 1) } | Sort-Object); Bytes = $bytes
        }
    }
    $lp = $l.PSObject.Properties['libraries']
    if ($lp -and $lp.Value) {
        foreach ($p in @($lp.Value.PSObject.Properties | Sort-Object Name)) {
            $n = [string]$p.Name
            if ($l.ports.PSObject.Properties[$n]) { throw "$path names $n as both a port and a library" }
            $in = @()
            foreach ($f in @($p.Value.in)) { foreach ($x in @($Carried)) { if ($x -and $x.Equals([string]$f, [StringComparison]::OrdinalIgnoreCase)) { $in += [string]$f; break } } }
            if (-not $in.Count) { continue }
            $out += Read-NoticeText (Join-Path $dir ('client-licences\' + $n + '.txt')) $p.Value $n $in 'client-licences.json' '#3751'
        }
    }
    return $out
}

# One text a record names, held to its sha256 and size, as Get-ClientLicences
# gives it. Throws a sentence when it is missing or another text.
function Read-NoticeText([string]$Text, $Entry, [string]$Name, [string[]]$In, [string]$Record, [string]$Issue) {
    if (-not (Test-Path -LiteralPath $Text -PathType Leaf)) { throw "$Text is missing. $Record names it, and it has to go with the files $Name is in ($Issue)." }
    $bytes = [IO.File]::ReadAllBytes($Text)
    $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    if ($sha -ne ([string]$Entry.sha256).ToLowerInvariant() -or $bytes.Length -ne [long]$Entry.bytes) { throw "$Text is not the text $Record names for $Name" }
    return [pscustomobject]@{
        Port = $Name; Version = [string]$Entry.version; Licence = [string]$Entry.licence
        Files = @($In | ForEach-Object { $_.Substring($_.LastIndexOf('\') + 1) } | Sort-Object); Bytes = $bytes
    }
}

<#
  The npm packages inside build.js (#3751), from $FrontRecord's packages and
  their texts in front-licences beside it, in the shape Get-ClientLicences
  gives. Throws a sentence when the record lists none (a front recorded
  before #3751) or a text is missing or not the one it names: those texts are
  owed with build.js, so the release stops.
#>
function Get-FrontLicences([string]$FrontRecord) {
    $raw = "$(Get-Content -LiteralPath $FrontRecord -Raw)"
    $f = $raw.TrimStart([char]0xFEFF) | ConvertFrom-Json
    $pk = $f.PSObject.Properties['packages']
    if (-not $pk -or $null -eq $pk.Value) { throw "$FrontRecord lists no packages. The licences of the npm packages inside build.js have to go with it (#3751): record the front with Build-Front.ps1 -Record." }
    $dir = Join-Path (Split-Path -Parent $FrontRecord) 'front-licences'
    $out = @()
    foreach ($p in @($pk.Value.PSObject.Properties | Sort-Object Name)) {
        $out += Read-NoticeText (Join-Path $dir ([string]$p.Name + '.txt')) $p.Value ([string]$p.Name) @('Data\Platform\UI\build.js') 'front-build.json' '#3751'
    }
    return $out
}

# Two lists in that shape as one, by name: a name in both is one text, in
# the files of both. Throws when one name has two texts.
function Join-NoticeLicences($A, $B) {
    $by = [ordered]@{}
    foreach ($x in @(@($A) + @($B) | Where-Object { $_ })) {
        if (-not $by.Contains($x.Port)) { $by[$x.Port] = $x; continue }
        $have = $by[$x.Port]
        if ([Convert]::ToBase64String($have.Bytes) -ne [Convert]::ToBase64String($x.Bytes)) { throw "$($x.Port) has two different texts, and they would go out under one name" }
        $have.Files = @(@($have.Files) + @($x.Files) | Sort-Object -Unique)
    }
    return @($by.Values | Sort-Object Port)
}

<#
  The lines a note says about those libraries, or none for none.
#>
function Get-ClientLicenceLines($Licences) {
    $Licences = @(@($Licences) | Where-Object { $_ })
    if (-not $Licences.Count) { return @() }
    $lines = @(
        'The SkyMP files are built with these libraries, and code from each is',
        'inside the files named. Each library''s copyright notice and licence, as',
        'it gives them, is in the licences folder beside this note, named for it:',
        ''
    )
    foreach ($x in @($Licences)) {
        $lic = if ($x.Licence) { $x.Licence } else { 'its own terms' }
        $lines += ('  {0,-31} {1,-15} {2}' -f ($x.Port + '.txt'), $x.Version, $lic)
        $lines += ('    in ' + ($x.Files -join ', '))
    }
    $lines += @('')
    foreach ($x in @($Licences)) {
        if (-not $SourceNoticeBundled.Contains($x.Port)) { continue }
        $by = $SourceNoticeBundled[$x.Port]
        $b = Get-SourceNoticeBundle $x.Port
        $lines += @(
            ($x.Port + ' is ' + $by.Maker + '''s own build, and it holds other libraries too.'),
            ('Their licences are in licences\' + $x.Port + '.txt as well. Their source, at'),
            ('the commits ' + $by.Maker + ' built them from, is in these archives on'),
            'Thornswood''s release of them:',
            ('  https://github.com/' + $b.release.repo + '/releases/tag/' + $b.release.tag),
            ''
        )
        foreach ($p in @($b.parts)) {
            $lines += ('  ' + $p.holds)
            $lines += ('    ' + $p.archive)
        }
        $lines += @('')
        if ($b.forksUp) {
            $lines += @(
                'Until that repository is public, the same commits are in Thornswood''s',
                ('copies of ' + $by.Maker + '''s repositories:')
            )
            foreach ($p in @($b.parts)) {
                $lines += ('  ' + $p.holds)
                $lines += ('    https://github.com/' + ([string]$b.release.repo).Split('/')[0] + '/' + $p.name + '/tree/' + $p.commit)
            }
            $lines += @('')
        }
    }
    return $lines
}

<#
  The files to put at the top of a download that carries $Carried (paths in
  the game folder), as a list of @{ Name; Bytes }. Empty when none of them is
  a SkyMP file, so a pack of our own files gets nothing.

  $Kind 'runtime' is the client runtime zip: its note is README.txt and says
  what the download is. 'pack' is an update pack: its note is SOURCE CODE.txt,
  the name the installer gives the same note. 'setup' is the launcher's
  Velopack package (#4825, Build-SetupFiles.ps1): its note is SOURCE CODE.txt,
  which the install copies into the install folder (InstallSteps.cs), so it
  says what the install put into the Skyrim folder.

  Throws when a recorded file has no known source folder, so a new file in
  client-build.json stops the release until somebody says where it is from.

  build.js counts as built when $FrontRecord (front-build.json beside the
  client record, unless named) is there, and throws when that record is the
  build of another commit than the client record's, so the note never names
  one commit for files built from two. With no front record it is said as
  SkyMP's own, with no commit, as before #2931.
#>
function Get-SourceNoticeEntries([string]$ClientRecord, [string[]]$Carried, [string]$Kind, [string]$LicenceDir, [string]$FrontRecord) {
    if ($Kind -notin 'runtime', 'pack', 'setup') { throw "Kind is runtime, pack or setup, not $Kind" }
    $any = $false
    foreach ($x in @($Carried)) { if ($x -and $SourceNoticeFiles.Contains($x)) { $any = $true; break } }
    if (-not $any) { return @() }
    if (-not (Test-Path -LiteralPath $ClientRecord)) { throw "$ClientRecord is missing" }
    # An empty record reads as $null; say so, rather than a method call on $null.
    $raw = "$(Get-Content -LiteralPath $ClientRecord -Raw)"
    if (-not $raw.Trim([char]0xFEFF, ' ', [char]9, [char]13, [char]10)) { throw "$ClientRecord is empty" }
    $c = $raw.TrimStart([char]0xFEFF) | ConvertFrom-Json
    $fork = ([string]$c.fork).TrimEnd('/')
    if (-not $fork -or -not $c.forkCommit) { throw 'client-build.json names no fork or no commit' }
    $recorded = @($c.files.PSObject.Properties.Name)
    foreach ($r in $recorded) {
        if (-not $SourceNoticeFiles.Contains($r)) { throw "client-build.json lists $r, which has no known source folder" }
    }

    if (-not $FrontRecord) { $FrontRecord = Join-Path (Split-Path -Parent $ClientRecord) 'front-build.json' }
    $frontBuilt = $false
    if (Test-Path -LiteralPath $FrontRecord) {
        $fRaw = "$(Get-Content -LiteralPath $FrontRecord -Raw)"
        if (-not $fRaw.Trim([char]0xFEFF, ' ', [char]9, [char]13, [char]10)) { throw "$FrontRecord is empty" }
        $fc = ([string]($fRaw.TrimStart([char]0xFEFF) | ConvertFrom-Json).forkCommit).ToLowerInvariant()
        $cc = ([string]$c.forkCommit).ToLowerInvariant()
        if (-not $fc -or -not ($fc.StartsWith($cc) -or $cc.StartsWith($fc))) {
            throw "$FrontRecord is the build of $fc and client-build.json of $cc. The note names one commit for what Thornswood built."
        }
        $frontBuilt = $true
    }

    $built = @(); $upstream = @()
    foreach ($k in $SourceNoticeFiles.Keys) {
        $has = $false
        foreach ($x in @($Carried)) { if ($x -and $x.Equals($k, [StringComparison]::OrdinalIgnoreCase)) { $has = $true; break } }
        if (-not $has) { continue }
        $v = $SourceNoticeFiles[$k]
        $leaf = $k.Substring($k.LastIndexOf('\') + 1)
        $row = ('  {0,-34}{1,-18}{2}' -f $leaf, $v[0], $v[1])
        if (($v[2] -eq 'built' -and ($recorded -contains $k)) -or ($v[2] -eq 'front' -and $frontBuilt)) { $built += $row } else { $upstream += $row }
    }
    if (-not $built.Count -and -not $upstream.Count) { return @() }

    $ub = [string]$c.upstreamBase
    $base = if ($ub -match '^[0-9a-f]{7,40}$') { 'SkyMP commit ' + $ub } else { 'SkyMP, at a commit the build record does not name' }

    if ($Kind -eq 'runtime') {
        $note = 'README.txt'
        $lines = @(
            'THORNSWOOD CLIENT RUNTIME',
            '=========================',
            '',
            'This download is the SkyMP files the Thornswood launcher puts into your',
            'Skyrim folder. The launcher fetches it by itself when one of them is',
            'missing or is not the build it expects, takes them out, and deletes the',
            'download. Nothing here needs copying by hand.',
            '',
            'WHERE THE SOURCE CODE IS',
            ''
        )
    } elseif ($Kind -eq 'setup') {
        $note = 'SOURCE CODE.txt'
        $lines = @(
            'THORNSWOOD: WHERE THE SOURCE CODE IS',
            '====================================',
            '',
            'Thornswood''s setup put SkyMP files into your Skyrim folder, listed below,',
            'and the launcher''s updates can bring newer builds of them.',
            ''
        )
    } else {
        $note = 'SOURCE CODE.txt'
        $lines = @(
            'THORNSWOOD: WHERE THE SOURCE CODE IS',
            '====================================',
            '',
            'This update from the Thornswood launcher carries SkyMP files, listed below.',
            ''
        )
    }
    $lines += @(
        'SkyMP is free software. Anybody can read its source or download it, with no',
        'account.',
        ''
    )
    if ($built.Count) {
        $lines += @(
            'These are built from Thornswood''s public copy of SkyMP, with Thornswood''s',
            'changes on top:',
            ('  commit    ' + $c.forkCommit + ', branch ' + $c.forkBranch),
            ('  source    ' + $fork + '/tree/' + $c.forkCommit),
            ('  based on  ' + $base),
            '',
            'Each file, the folder of SkyMP it is built from, and the licence in that',
            'folder''s LICENSE file:',
            ''
        ) + $built + @('')
    }
    if ($upstream.Count) {
        $lines += @(
            'These come from SkyMP itself. Thornswood did not build them, and nobody',
            'recorded which version of SkyMP they came from, so no commit is named for',
            'them here. Their source is SkyMP''s own, at the address below. Each file,',
            'the folder of SkyMP it belongs to, and that folder''s licence:',
            ''
        ) + $upstream + @('')
    }
    $libs = @(Get-ClientLicences $ClientRecord $Carried)
    # build.js as the recorded front build: the npm packages in it (#3751).
    $frontCarried = $false
    foreach ($x in @($Carried)) { if ($x -and $x.Equals('Data\Platform\UI\build.js', [StringComparison]::OrdinalIgnoreCase)) { $frontCarried = $true; break } }
    if ($frontBuilt -and $frontCarried) { $libs = @(Join-NoticeLicences $libs (Get-FrontLicences $FrontRecord)) }
    $lines += @(
        'SkyMP itself is https://github.com/skyrim-multiplayer/skymp',
        '',
        'The full licence texts are beside this note:',
        '  GPL-3.0.txt     GNU GPL version 3 (skymp5-client, skyrim-platform, skymp5-front)',
        '  AGPL-3.0.txt    GNU AGPL version 3 (skymp5-server, which MpClientPlugin.dll is built from)',
        ''
    ) + (Get-ClientLicenceLines $libs) + @(
        'https://thornswood.net/credits#source says where the source of everything',
        'Thornswood hands out is.',
        ''
    )

    $utf8 = New-Object Text.UTF8Encoding($false)
    $out = @(@{ Name = $note; Bytes = $utf8.GetBytes(($lines -join "`r`n")) })
    foreach ($lic in @('GPL-3.0.txt', 'AGPL-3.0.txt')) {
        $p = Join-Path $LicenceDir $lic
        if (-not (Test-Path -LiteralPath $p)) { throw "$p is missing. The GPL and AGPL texts have to go with the SkyMP files (#421)." }
        $out += @{ Name = $lic; Bytes = [IO.File]::ReadAllBytes($p) }
    }
    foreach ($x in $libs) { $out += @{ Name = ('licences/' + $x.Port + '.txt'); Bytes = $x.Bytes } }
    return $out
}

# Writes those entries into the folder $Dir, the client runtime's stage
# before it is zipped: an entry under licences/ goes in that folder.
function Write-SourceNoticeToFolder([string]$Dir, $Entries) {
    foreach ($n in @($Entries)) {
        if ($null -eq $n) { continue }
        $to = Join-Path $Dir ($n.Name.Replace('/', '\'))
        $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to)
        [IO.File]::WriteAllBytes($to, $n.Bytes)
    }
}

# Writes those entries at the top of an open ZipArchive.
function Add-SourceNoticeToZip($Zip, $Entries) {
    foreach ($n in @($Entries)) {
        if ($null -eq $n) { continue }
        $e = $Zip.CreateEntry($n.Name, [IO.Compression.CompressionLevel]::Optimal)
        $s = $e.Open()
        try { $s.Write($n.Bytes, 0, $n.Bytes.Length) } finally { $s.Dispose() }
    }
}
