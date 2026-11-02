<#
  RecordShape.ps1

  The shape and version each high-risk JSON record must have, checked fail
  closed (#2180, first slice). docs\JSON-STATE-INVENTORY.md lists every
  critical JSON file, who writes it and who reads it. This file holds the
  contract for the records in that list that a release or deploy trusts most:

      server-build        records\server-build.json      the server build every deploy is held to
      client-build        records\client-build.json      the client build Ship and the launcher are held to
      front-build         records\front-build.json       the front build Go.ps1 unpacks into Data\Platform\UI (#2754)
      client-licences     records\client-licences.json   the vcpkg libraries in the client files and their texts' sha256 (#3099)
      most-online         records\most-online.json       the seat count the engine and gamemode take, main's and dev's
      collection-plugins  records\collection-plugins.json  the collection's plugin bytes (#2019)
      skyrim-pin          records\skyrim-pin.json        the Skyrim build a release is pinned to
      skyrim-files        records\skyrim-files.json      every file of that build (the launcher embeds it)
      ui-gone             records\ui-gone.json           the files every pack deletes (Ship and the launcher)
      generated           records\generated.json         what the launcher builds on each computer (#3715)
      shipped-not-ours    records\shipped-not-ours.json  other authors' files our old packs shipped, deleted by sha256 (#1178)

      $doc = Read-ThornswoodRecord -Path <file> -Kind server-build
      $problems = Get-ThornswoodRecordProblems -Doc $doc -Kind server-build

  Read-ThornswoodRecord reads through ConvertFrom-ThornswoodJson (an empty or
  broken file names itself), then throws, naming the file, on:
    - a version this checkout does not know. Most records predate a version
      field and are read as version 1 when there is none; a record from a
      newer checkout that says 2 is refused rather than half understood.
    - a missing or wrongly typed field the readers depend on.
  No record is rewritten and no field is added: this is the check, not a
  migration. scripts\release\Check-Records.ps1 runs it over the committed
  records, and tests\test-record-shapes.ps1 holds it.
  Runs in PowerShell 7.
#>
# Slice 4 (#2180): the box has no checkout, so the scripts that run there get
# this file's text with Read-JsonFile.ps1's in front of it ($ThornswoodRecordShapeText
# in Swap.ps1), or the two files beside them (Install-ThornswoodServer.ps1,
# sent by Publish-Server.ps1). Either way ConvertFrom-ThornswoodJson is
# already defined, and only a reader that has not loaded it loads it here.
if (-not (Get-Command ConvertFrom-ThornswoodJson -EA SilentlyContinue)) { . (Join-Path $PSScriptRoot 'Read-JsonFile.ps1') }

# Which versions each kind is understood at, and whether the file must say so.
$script:ThornswoodRecordKinds = [ordered]@{
    'server-build'       = @{ File = 'records\server-build.json';       Versions = @(1); MustSay = $false }
    'client-build'       = @{ File = 'records\client-build.json';       Versions = @(1); MustSay = $false }
    # #2754: the front, built from the same fork commit (Build-Front.ps1).
    'front-build'        = @{ File = 'records\front-build.json';        Versions = @(1); MustSay = $false }
    # #3099: which licence text goes with which client file (New-ClientLicenceRecord.ps1).
    'client-licences'    = @{ File = 'records\client-licences.json';    Versions = @(1); MustSay = $false }
    'most-online'        = @{ File = 'records\most-online.json';        Versions = @(1); MustSay = $false }
    'collection-plugins' = @{ File = 'records\collection-plugins.json'; Versions = @(1); MustSay = $true }
    # Slice 3 (#2180): the release records the launcher and Ship are built on.
    'skyrim-pin'         = @{ File = 'records\skyrim-pin.json';         Versions = @(1); MustSay = $false }
    'skyrim-files'       = @{ File = 'records\skyrim-files.json';       Versions = @(1); MustSay = $false }
    'ui-gone'            = @{ File = 'records\ui-gone.json';            Versions = @(1); MustSay = $false }
    'generated'          = @{ File = 'records\generated.json';          Versions = @(1); MustSay = $false }
    # #1178: what every release record deletes where the bytes still match.
    'shipped-not-ours'   = @{ File = 'records\shipped-not-ours.json';   Versions = @(1); MustSay = $true }
    # Slice 5 (#2180): the feed store's files. No committed file: each channel's
    # store holds its own (Check-Records -Feed <folder> reads them).
    'feed-version'       = @{ File = $null; Feed = 'version.json';      Versions = @(1); MustSay = $false }
    'feed-published'     = @{ File = $null; Feed = 'published.json';    Versions = @(1); MustSay = $false; NoVersion = $true }
    'feed-releases'      = @{ File = $null; Feed = 'releases.json';     Versions = @(1); MustSay = $false; NoVersion = $true; List = $true }
    # Slice 4 (#2180): a server's own settings, read on the box. No committed
    # file (File is $null, so Check-Records skips it): each server keeps its own.
    'server-settings'    = @{ File = $null;                             Versions = @(1); MustSay = $false }
}

function Get-ThornswoodRecordProp($o, [string]$name) {
    if ($null -eq $o -or $o -isnot [psobject]) { return $null }
    $p = $o.PSObject.Properties[$name]
    # The comma keeps a list a list, even an empty one, instead of unrolling it.
    if ($p) { return , $p.Value }
    return $null
}
function Test-ThornswoodWhole($v, [int64]$min) {
    if ($null -eq $v -or $v -is [bool] -or $v -is [string]) { return $false }
    $n = 0L
    if (-not [int64]::TryParse([string]$v, [ref]$n)) { return $false }
    return ($n -ge $min -and [string]$n -eq [string]$v)
}
function Test-ThornswoodHex($v, [int]$min, [int]$max) {
    return ($v -is [string] -and $v -match ('^[0-9a-fA-F]{' + $min + ',' + $max + '}$'))
}
# A files map: { "<path>": { "sha256": ..., "bytes": ... }, ... }, not empty.
function Get-ThornswoodFilesMapProblems($files, [string]$what) {
    $out = @()
    if ($null -eq $files -or $files -isnot [psobject] -or $files -is [array] -or $files -is [string] -or @($files.PSObject.Properties).Count -eq 0) {
        return @("$what is missing, empty, or not a map of file to sha256 and bytes")
    }
    foreach ($p in $files.PSObject.Properties) {
        if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $p.Value 'sha256') 64 64)) { $out += "$what.$($p.Name) has no sha256" }
        if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $p.Value 'bytes') 0)) { $out += "$what.$($p.Name) has no whole bytes" }
    }
    return $out
}

function Get-ThornswoodRecordProblems {
    param([Parameter(Mandatory)][AllowNull()]$Doc, [Parameter(Mandatory)][string]$Kind)
    if (-not $script:ThornswoodRecordKinds.Contains($Kind)) { throw "no record kind '$Kind' (known: $(@($script:ThornswoodRecordKinds.Keys) -join ', '))" }
    $k = $script:ThornswoodRecordKinds[$Kind]
    if ($k.ContainsKey('List')) {
        # releases.json is a list, newest first, of the release records a
        # rollback reads (Release-Baseline.ps1 New-FeedReleaseEntry).
        if ($Doc -isnot [array]) { $Doc = @($Doc) }
        $out = @()
        $i = 0
        foreach ($r in @($Doc)) {
            $w = "release $i"
            if ($null -eq $r -or $r -isnot [psobject] -or $r -is [array] -or $r -is [string]) { $out += "$w is not an object"; $i++; continue }
            $id = Get-ThornswoodRecordProp $r 'id'
            if (-not ($id -is [string]) -or -not $id.Trim()) { $out += "$w has no id" } else { $w = "release $id" }
            if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $r 'sha256') 64 64)) { $out += "$w has no sha256" }
            if (-not ((Get-ThornswoodRecordProp $r 'url') -is [string]) -or -not (Get-ThornswoodRecordProp $r 'url')) { $out += "$w has no url" }
            if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $r 'entries') 0)) { $out += "$w has no whole entries" }
            foreach ($s in 'lastPack', 'to') { $v = Get-ThornswoodRecordProp $r $s; if ($null -ne $v -and $v -isnot [string]) { $out += "$w.$s is there and not text" } }
            $i++
        }
        return $out
    }
    if ($null -eq $Doc -or $Doc -isnot [psobject] -or $Doc -is [array] -or $Doc -is [string]) { return @('it is not a JSON object') }
    if ($k.ContainsKey('NoVersion')) {
        # published.json is the baseline map, file to hash, written whole by
        # ConvertTo-BaselineJson: every value is text, and a "version" key is
        # a file name like any other.
        $out = @()
        foreach ($p in $Doc.PSObject.Properties) { if ($p.Value -isnot [string]) { $out += "$($p.Name) is not text" } }
        return $out
    }
    $out = @()
    $ver = Get-ThornswoodRecordProp $Doc 'version'
    if ($null -eq $ver) {
        if ($k.MustSay) { $out += 'it has no version' }
    } elseif (-not (Test-ThornswoodWhole $ver 1) -or $k.Versions -notcontains [int]$ver) {
        $out += ("it is version {0}, and this checkout knows {1}: update the checkout, or the record came from somewhere else" -f $ver, ($k.Versions -join ', '))
        return $out
    }
    switch ($Kind) {
        'server-build' {
            if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $Doc 'sha256') 64 64)) { $out += 'sha256 is missing or not 64 hex digits' }
            if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $Doc 'bytes') 1)) { $out += 'bytes is missing or not a whole number above zero' }
            if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp (Get-ThornswoodRecordProp $Doc 'source') 'commit') 40 40)) { $out += 'source.commit is missing or not a full commit SHA' }
            $out += @(Get-ThornswoodFilesMapProblems (Get-ThornswoodRecordProp $Doc 'files') 'files')
            $lp = Get-ThornswoodRecordProp $Doc 'lightPlugins'
            if ($null -ne $lp -and $lp -isnot [bool]) { $out += 'lightPlugins is there and not true or false' }
        }
        'client-build' {
            if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $Doc 'forkCommit') 7 40)) { $out += 'forkCommit is missing or not a commit SHA' }
            $out += @(Get-ThornswoodFilesMapProblems (Get-ThornswoodRecordProp $Doc 'files') 'files')
        }
        'client-licences' {
            if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $Doc 'forkCommit') 7 40)) { $out += 'forkCommit is missing or not a commit SHA' }
            $files = Get-ThornswoodRecordProp $Doc 'files'
            if ($null -eq $files -or $files -isnot [psobject] -or $files -is [array] -or $files -is [string] -or @($files.PSObject.Properties).Count -eq 0) { $out += 'files is missing, empty, or not a map of client file to its ports' }
            $ports = Get-ThornswoodRecordProp $Doc 'ports'
            if ($null -eq $ports -or $ports -isnot [psobject] -or $ports -is [array] -or $ports -is [string]) { $out += 'ports is missing or not a map of port to its text' }
            else {
                foreach ($p in $ports.PSObject.Properties) {
                    if ($p.Name -notmatch '^[a-z0-9]+(-[a-z0-9]+)*$') { $out += "ports.$($p.Name) is not a vcpkg port name" }
                    if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $p.Value 'sha256') 64 64)) { $out += "ports.$($p.Name) has no sha256" }
                    if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $p.Value 'bytes') 1)) { $out += "ports.$($p.Name) has no whole bytes" }
                    if (-not ((Get-ThornswoodRecordProp $p.Value 'version') -is [string])) { $out += "ports.$($p.Name) has no version" }
                }
                if ($null -ne $files -and $files -is [psobject]) {
                    foreach ($f in $files.PSObject.Properties) {
                        foreach ($n in @($f.Value)) { if (-not $ports.PSObject.Properties[[string]$n]) { $out += "files.$($f.Name) names $n, which ports does not list" } }
                    }
                }
            }
            # The fork's own noticed folders and the npm packages in
            # skymp5-client.js (#3751). A client measured before that has none.
            $libs = Get-ThornswoodRecordProp $Doc 'libraries'
            if ($null -ne $libs) {
                if ($libs -isnot [psobject] -or $libs -is [array] -or $libs -is [string]) { $out += 'libraries is there and not a map of library to its text' }
                else {
                    foreach ($p in $libs.PSObject.Properties) {
                        if ($p.Name -notmatch '^[a-z0-9][a-z0-9._-]*$') { $out += "libraries.$($p.Name) is not a name a text can safely have" }
                        if (@('fork', 'npm') -notcontains [string](Get-ThornswoodRecordProp $p.Value 'kind')) { $out += "libraries.$($p.Name) is not of kind fork or npm" }
                        if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $p.Value 'sha256') 64 64)) { $out += "libraries.$($p.Name) has no sha256" }
                        if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $p.Value 'bytes') 1)) { $out += "libraries.$($p.Name) has no whole bytes" }
                        if (-not @(Get-ThornswoodRecordProp $p.Value 'in').Count) { $out += "libraries.$($p.Name) is in no file" }
                    }
                }
            }
        }
        'front-build' {
            if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $Doc 'forkCommit') 40 40)) { $out += 'forkCommit is missing or not a full commit SHA' }
            $out += @(Get-ThornswoodFilesMapProblems (Get-ThornswoodRecordProp $Doc 'files') 'files')
            # The npm packages in build.js, each with its text (#3751).
            $pk = Get-ThornswoodRecordProp $Doc 'packages'
            if ($null -eq $pk -or $pk -isnot [psobject] -or $pk -is [array] -or $pk -is [string]) { $out += 'packages is missing or not a map of package to its text' }
            else {
                foreach ($p in $pk.PSObject.Properties) {
                    if ($p.Name -notmatch '^npm-[a-z0-9][a-z0-9._-]*$') { $out += "packages.$($p.Name) is not an npm-<name>-<version> text name" }
                    if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $p.Value 'sha256') 64 64)) { $out += "packages.$($p.Name) has no sha256" }
                    if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $p.Value 'bytes') 1)) { $out += "packages.$($p.Name) has no whole bytes" }
                    if (-not ((Get-ThornswoodRecordProp $p.Value 'version') -is [string])) { $out += "packages.$($p.Name) has no version" }
                }
            }
        }
        'most-online' {
            # Main's numbers are the record's own, and dev's, when it has its
            # own (Patrick, 12 Oct), are the same three keys in a dev object.
            $sets = @(@{ Pre = ''; O = $Doc })
            $dev = Get-ThornswoodRecordProp $Doc 'dev'
            if ($null -ne $dev) {
                if ($dev -isnot [System.Management.Automation.PSCustomObject]) { $out += 'dev is there and not an object of people, staffSeats and voice' }
                else { $sets += @{ Pre = 'dev.'; O = $dev } }
            }
            foreach ($set in $sets) {
                $o = $set.O; $pre = $set.Pre
                if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $o 'people') 1)) { $out += "${pre}people is missing or not a whole number above zero" }
                elseif ([int64](Get-ThornswoodRecordProp $o 'people') -gt 1000) { $out += "${pre}people is over 1000, the engine's limit" }
                $s = Get-ThornswoodRecordProp $o 'staffSeats'
                if ($null -ne $s -and -not (Test-ThornswoodWhole $s 0)) { $out += "${pre}staffSeats is there and not a whole number" }
                # The most people who hold a voice place at once (#481, #3570);
                # MaxOnline.ps1 holds it to no fewer than the seats.
                $v = Get-ThornswoodRecordProp $o 'voice'
                if ($null -ne $v -and -not (Test-ThornswoodWhole $v 1)) { $out += "${pre}voice is there and not a whole number above zero" }
            }
        }
        'skyrim-pin' {
            # What Publish-Update writes into version.json and the launcher's
            # Downgrade asks Steam for: the build, the exe sizes, three depots.
            if (-not ((Get-ThornswoodRecordProp $Doc 'build') -is [string] -and (Get-ThornswoodRecordProp $Doc 'build') -match '^\d+(\.\d+){2,3}$')) { $out += 'build is missing or not a version like 1.6.1170' }
            if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $Doc 'appId') 1)) { $out += 'appId is missing or not a whole number above zero' }
            foreach ($k in 'expectedExeBytes', 'newerExeBytes') { if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $Doc $k) 1)) { $out += "$k is missing or not a whole number above zero" } }
            $deps = Get-ThornswoodRecordProp $Doc 'depots'
            if ($null -eq $deps -or $deps -isnot [array] -or @($deps).Count -ne 3) { $out += 'depots is missing or not three depots' }
            else {
                foreach ($d in @($deps)) {
                    $id = Get-ThornswoodRecordProp $d 'id'; $m = Get-ThornswoodRecordProp $d 'manifest'
                    if (-not ($id -is [string] -and $id -match '^\d+$') -or -not ($m -is [string] -and $m -match '^\d+$')) { $out += 'a depot is not an id and a manifest, each digits in a string' }
                }
            }
        }
        'skyrim-files' {
            if (-not ((Get-ThornswoodRecordProp $Doc 'build') -is [string] -and (Get-ThornswoodRecordProp $Doc 'build') -match '^\d+(\.\d+){2,3}$')) { $out += 'build is missing or not a version like 1.6.1170' }
            if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $Doc 'appId') 1)) { $out += 'appId is missing or not a whole number above zero' }
            $files = Get-ThornswoodRecordProp $Doc 'files'
            if ($null -eq $files -or $files -isnot [psobject] -or $files -is [array] -or $files -is [string] -or @($files.PSObject.Properties).Count -eq 0) { $out += 'files is missing, empty, or not a map of file to bytes, sha1 and depot' }
            else {
                foreach ($p in $files.PSObject.Properties) {
                    if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $p.Value 'bytes') 0)) { $out += "files.$($p.Name) has no whole bytes" }
                    if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $p.Value 'sha1') 40 40)) { $out += "files.$($p.Name) has no sha1" }
                    $dp = Get-ThornswoodRecordProp $p.Value 'depot'
                    if (-not ($dp -is [string] -and $dp -match '^\d+$')) { $out += "files.$($p.Name) has no depot" }
                }
            }
        }
        'ui-gone' {
            # What every pack deletes and OwnGame.Foreign keeps out (#1318).
            $dae = Get-ThornswoodRecordProp $Doc 'daedric'
            if ($null -eq $dae -or $dae -isnot [psobject] -or $dae -is [array] -or $dae -is [string] -or @($dae.PSObject.Properties).Count -eq 0) { $out += 'daedric is missing, empty, or not a map of file name to sha256' }
            else { foreach ($p in $dae.PSObject.Properties) { if (-not (Test-ThornswoodHex $p.Value 64 64)) { $out += "daedric.$($p.Name) is not a sha256" } } }
            $un = Get-ThornswoodRecordProp $Doc 'unused'
            if ($null -eq $un -or $un -isnot [array] -or @($un).Count -eq 0) { $out += 'unused is missing, empty, or not a list of file names' }
            elseif (@($un | Where-Object { -not ($_ -is [string]) -or -not $_.Trim() }).Count) { $out += 'unused has an entry that is not a file name' }
        }
        'shipped-not-ours' {
            # Other authors' loose files earlier packs shipped as ours, by the
            # bytes they had (#1178). Publish-Update turns each into a gone
            # line the launcher acts on only while the file still matches, so
            # every path is a file under Data and nothing that climbs out.
            $files = Get-ThornswoodRecordProp $Doc 'files'
            $out += @(Get-ThornswoodFilesMapProblems $files 'files')
            if ($null -ne $files -and $files -is [psobject] -and $files -isnot [array] -and $files -isnot [string]) {
                foreach ($p in $files.PSObject.Properties) {
                    if ($p.Name -notmatch '^Data\\[^\\/:*?"<>|]' -or $p.Name -match '(^|\\)\.\.?(\\|$)' -or $p.Name -match '[/:*?"<>|]' -or $p.Name.Contains('\\') -or $p.Name.EndsWith('\')) { $out += "files.$($p.Name) is not a file under Data" }
                }
            }
        }
        'generated' {
            # What the launcher builds on each computer (#1247, #3715). Either
            # part may be left out; what is there must be the shape Generated.cs
            # reads (GeneratedList.Parse, which the launcher holds it to as well).
            $pan = Get-ThornswoodRecordProp $Doc 'pandora'
            $bod = Get-ThornswoodRecordProp $Doc 'bodyslide'
            if ($null -eq $pan -and $null -eq $bod) { $out += 'it has neither pandora nor bodyslide, so it builds nothing' }
            if ($null -ne $pan) {
                $pp = Get-ThornswoodRecordProp $pan 'patches'
                if ($null -eq $pp -or $pp -isnot [array] -or @($pp | Where-Object { -not ($_ -is [string]) }).Count) { $out += 'pandora.patches is missing or not a list of patch codes' }
            }
            if ($null -ne $bod) {
                $ss = Get-ThornswoodRecordProp $bod 'sets'
                if ($null -eq $ss -or $ss -isnot [array] -or @($ss | Where-Object { -not ($_ -is [string]) -or -not $_.Trim() }).Count) { $out += 'bodyslide.sets is missing or not a list of set names' }
                $of = Get-ThornswoodRecordProp $bod 'outfits'
                if ($null -ne $of -and ($of -isnot [array] -or @($of | Where-Object { -not ($_ -is [string]) -or -not $_.Trim() }).Count)) { $out += 'bodyslide.outfits is there and not a list of set names' }
                $sl = Get-ThornswoodRecordProp $bod 'sliders'
                if ($null -ne $sl -and ($sl -isnot [psobject] -or $sl -is [array] -or $sl -is [string])) { $out += 'bodyslide.sliders is there and not a map' }
            }
        }
        'feed-version' {
            # What every launcher reads, held to launcher\app\Config.cs
            # VersionDoc. Its serializer throws on one value of the wrong JSON
            # type, and a throw is the whole document unread: every launcher
            # then says there was no answer and shuts Play. So each member is
            # held to what that serializer takes: text members take a string,
            # a number or null; int and long members a whole number; arrays a
            # list or null; objects an object or null.
            $lv = Get-ThornswoodRecordProp $Doc 'launcherVersion'
            if (-not ($lv -is [string]) -or $lv -notmatch '^\d+(\.\d+){1,3}$') { $out += 'launcherVersion is missing or not a version like 1.2.3' }
            $lu = Get-ThornswoodRecordProp $Doc 'launcherUrl'
            if ($lu -is [string] -and $lu -and -not (Test-ThornswoodHex (Get-ThornswoodRecordProp $Doc 'launcherSha256') 64 64)) { $out += 'launcherUrl is set and launcherSha256 is not 64 hex digits' }
            $text = 'launcherVersion', 'launcherUrl', 'launcherSha256', 'serverAddress', 'collectionUrl', 'serverPort', 'expectedExeBytes', 'newerExeBytes',
                    'updateRepo', 'updateFeedUrl', 'voicePort', 'voiceUrl', 'discordAppId', 'siteUrl', 'presenceImage', 'message', 'maintenance', 'minLauncher', 'mainVersion'
            foreach ($n in $text) {
                $p = $Doc.PSObject.Properties[$n]
                if ($p -and $null -ne $p.Value -and -not ($p.Value -is [string] -or (Test-ThornswoodWhole $p.Value ([int64]::MinValue)))) { $out += "$n is not text, so the launcher would not read the feed" }
            }
            foreach ($n in 'collectionRevision', 'maxOnline') {
                $p = $Doc.PSObject.Properties[$n]
                if ($p -and -not (Test-ThornswoodWhole $p.Value 0)) { $out += "$n is there and not a whole number, so the launcher would not read the feed" }
            }
            $cr = Get-ThornswoodRecordProp $Doc 'clientRuntime'
            if ($null -ne $cr) {
                if ($cr -isnot [psobject] -or $cr -is [array] -or $cr -is [string]) { $out += 'clientRuntime is not an object' }
                else {
                    if (-not ((Get-ThornswoodRecordProp $cr 'url') -is [string])) { $out += 'clientRuntime.url is missing' }
                    if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $cr 'sha256') 64 64)) { $out += 'clientRuntime.sha256 is not 64 hex digits' }
                    if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $cr 'bytes') 1)) { $out += 'clientRuntime.bytes is not a whole number above zero' }
                }
            }
            $deps = Get-ThornswoodRecordProp $Doc 'depots'
            if ($null -ne $deps) {
                if ($deps -isnot [array]) { $out += 'depots is not a list' }
                else { foreach ($d in @($deps)) { foreach ($m in 'id', 'manifest') { $v = Get-ThornswoodRecordProp $d $m; if (-not ($v -is [string] -and $v -match '^\d+$')) { $out += "a depot's $m is not digits in a string" } } } }
            }
            foreach ($list in 'packs', 'optional') {
                $pk = Get-ThornswoodRecordProp $Doc $list
                if ($null -eq $pk) { continue }
                if ($pk -isnot [array]) { $out += "$list is not a list"; continue }
                foreach ($q in @($pk)) {
                    $id = Get-ThornswoodRecordProp $q 'id'
                    if (-not ($id -is [string]) -or -not $id) { $out += "a $list entry has no id"; continue }
                    if (-not ((Get-ThornswoodRecordProp $q 'url') -is [string]) -or -not (Get-ThornswoodRecordProp $q 'url')) { $out += "$list.$id has no url" }
                    if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $q 'sha256') 64 64)) { $out += "$list.$id has no sha256" }
                    foreach ($s in 'notes', 'name') { $v = Get-ThornswoodRecordProp $q $s; if ($null -ne $v -and $v -isnot [string]) { $out += "$list.$id.$s is not text" } }
                    $b = $q.PSObject.Properties['bytes']
                    if ($b -and -not (Test-ThornswoodWhole $b.Value 0)) { $out += "$list.$id.bytes is not a whole number" }
                }
            }
            $nw = Get-ThornswoodRecordProp $Doc 'news'
            if ($null -ne $nw) {
                if ($nw -isnot [array]) { $out += 'news is not a list' }
                else {
                    foreach ($e in @($nw)) {
                        foreach ($s in 'date', 'title', 'body') { $v = Get-ThornswoodRecordProp $e $s; if ($null -ne $v -and $v -isnot [string]) { $out += "a news item's $s is not text" } }
                        foreach ($s in 'details', 'files') { $v = Get-ThornswoodRecordProp $e $s; if ($null -ne $v -and ($v -isnot [array] -or @($v | Where-Object { $_ -isnot [string] }).Count)) { $out += "a news item's $s is not a list of text" } }
                    }
                }
            }
            # Not a launcher member: what Publish-Update and Rollback-Feed read
            # to find the last release (Release-Baseline.ps1 Get-FeedBaselinePointer).
            $bl = Get-ThornswoodRecordProp $Doc 'baseline'
            if ($null -ne $bl -and (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $bl 'sha256') 64 64) -or -not ((Get-ThornswoodRecordProp $bl 'url') -is [string]))) { $out += 'baseline is there without a sha256 and a url' }
        }
        'server-settings' {
            # What the box-side scripts read before they stop or start
            # anything: the port picks the process and the health check, and
            # dataDir and privDir say where the world is. skymp itself reads
            # the rest, and a broken key there is the server's to report.
            $port = Get-ThornswoodRecordProp $Doc 'port'
            if (-not (Test-ThornswoodWhole $port 1) -or [int64]$port -gt 65535) { $out += 'port is missing or not a whole number from 1 to 65535' }
            foreach ($k in 'dataDir', 'privDir') {
                $v = Get-ThornswoodRecordProp $Doc $k
                if ($null -ne $v -and (-not ($v -is [string]) -or -not $v.Trim())) { $out += "$k is there and not a folder name" }
            }
            $lo = Get-ThornswoodRecordProp $Doc 'loadOrder'
            if ($null -ne $lo -and ($lo -isnot [array] -or @($lo | Where-Object { -not ($_ -is [string]) -or -not $_.Trim() }).Count)) { $out += 'loadOrder is there and not a list of plugin paths' }
        }
        'collection-plugins' {
            $rows = Get-ThornswoodRecordProp $Doc 'plugins'
            if ($null -eq $rows -or @($rows).Count -eq 0) { $out += 'plugins is missing or empty' }
            else {
                $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
                foreach ($r in @($rows)) {
                    $n = Get-ThornswoodRecordProp $r 'name'
                    if (-not ($n -is [string]) -or -not $n) { $out += 'a plugins row has no name'; continue }
                    if (-not $seen.Add($n)) { $out += "plugins lists $n twice" }
                    if (-not (Test-ThornswoodWhole (Get-ThornswoodRecordProp $r 'size') 0)) { $out += "plugins.$n has no whole size" }
                    if (-not (Test-ThornswoodHex (Get-ThornswoodRecordProp $r 'sha256') 64 64)) { $out += "plugins.$n has no sha256" }
                }
            }
        }
    }
    return $out
}

function Read-ThornswoodRecord {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Kind)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "there is no $Kind record at $Path" }
    $doc = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $Path -Raw) $Path
    $bad = @(Get-ThornswoodRecordProblems -Doc $doc -Kind $Kind)
    if ($bad.Count) { throw ("{0} is not a {1} record this checkout can trust: {2}" -f $Path, $Kind, ($bad -join '; ')) }
    return $doc
}
