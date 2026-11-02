<#
  test-source-notice.ps1

      pwsh -NoProfile -File .\tests\test-source-notice.ps1

  The update feed's downloads that carry SkyMP files carry, beside them, a
  note saying where their source is and the GNU GPL and AGPL texts.

  WHY IT MATTERS. Issue #421. The six files in records\client-build.json are
  SkyMP, under the GNU GPL version 3 and (MpClientPlugin.dll) the AGPL, and
  both ask that the licence and the directions to the source go with the
  files. The installer did that since #788. The feed did not: on 28 September
  client-runtime-267ac311.zip on the dev feed and client-runtime-a922b480.zip
  on the live one held the six files and nothing else, and those downloads
  are where the launcher takes the files from.

  What this checks:
    - Source-Notice.ps1 writes README.txt (client runtime) or SOURCE CODE.txt
      (pack) from the record, naming the commit, the fork's tree, the branch,
      the upstream base and every file the download carries with its folder
      and licence, and puts GPL-3.0.txt and AGPL-3.0.txt from
      installer\licences beside it.
    - Each folder and licence agrees with the setup's SOURCE CODE.txt, the
      note of kind setup Build-SetupFiles.ps1 puts in the launcher's Velopack
      package (#4825; Package-Thornswood.ps1's Get-SourceNotice until #4824).
    - A pack of only our own files gets nothing; a SkyMP file taken from
      upstream is named apart with no commit; a recorded file with no known
      folder stops it.
    - A download carrying a native file carries, in licences\, the text of
      every vcpkg library inside the files it carries, byte for byte as
      records\client-licences\ holds it, and the note lists each with its
      version, licence and files (#3099). A record of another commit, or a
      text that is not the one recorded, stops it.
    - A zip written the way Publish-Update writes it holds the three at its
      top level and the texts under licences/, and Check-Secrets passes it.
    - Publish-Update.ps1 calls it for every pack part and for the client
      runtime, and a client runtime already on the feed without the note is
      published again.
    - The launcher takes nothing but game files out of either zip, so the
      note changes nothing a launcher does.

  Read only apart from its own temp folder.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Read-Json([string]$p) { return (((Get-Content -LiteralPath $p -Raw) -replace '^﻿', '') | ConvertFrom-Json) }
function Text($entries, [string]$name) {
    foreach ($e in @($entries)) { if ($e -and $e.Name -eq $name) { return [Text.Encoding]::UTF8.GetString($e.Bytes) } }
    return ''
}
function Names($entries) { return @(@($entries) | Where-Object { $_ } | ForEach-Object { $_.Name }) }

$record   = Join-Path $Repo 'records\client-build.json'
$libRecord = Join-Path $Repo 'records\client-licences.json'
$libTexts = Join-Path $Repo 'records\client-licences'
$licences = Join-Path $Repo 'installer\licences'
$notice   = Join-Path $Repo 'scripts\release\Source-Notice.ps1'
$publish  = Join-Path $Repo 'scripts\release\Publish-Update.ps1'

Yes 'scripts\release\Source-Notice.ps1 is there' (Test-Path -LiteralPath $notice)
. $notice

$c = Read-Json $record
$six = @($c.files.PSObject.Properties.Name)
$commit = [string]$c.forkCommit
$fork = ([string]$c.fork).TrimEnd('/')
function Leaf([string]$p) { return $p.Substring($p.LastIndexOf('\') + 1) }

# ---- the client runtime zip's README ---------------------------------------
$rt = @(Get-SourceNoticeEntries $record $six 'runtime' $licences)
$lr = Read-Json $libRecord
$ports = @($lr.ports.PSObject.Properties.Name | Sort-Object)
$wantNames = @('README.txt', 'GPL-3.0.txt', 'AGPL-3.0.txt') + @($ports | ForEach-Object { 'licences/' + $_ + '.txt' })
Yes ('the client runtime gets README.txt, GPL-3.0.txt, AGPL-3.0.txt and the ' + $ports.Count + ' library texts: ' + ((Names $rt) -join ', ')) `
    (((Names $rt) -join '|') -eq ($wantNames -join '|'))
$readme = Text $rt 'README.txt'
Yes ('it names the recorded commit ' + $commit + ' and links its tree') ($readme.Contains($fork + '/tree/' + $commit))
Yes 'it names the branch' ($readme.Contains([string]$c.forkBranch))
Yes 'it names the upstream commit it starts from, where the record has one' `
    (-not ([string]$c.upstreamBase -match '^[0-9a-f]{7,40}$') -or $readme.Contains([string]$c.upstreamBase))
$missing = @($six | Where-Object { -not $readme.Contains((Leaf $_)) })
Yes ('it names all six files' + $(if ($missing.Count) { ', missing ' + ($missing -join ', ') } else { '' })) ($missing.Count -eq 0)
Yes 'it names MpClientPlugin.dll as skymp5-server, GNU AGPL version 3' `
    ($readme -match '(?m)^\s{2}MpClientPlugin\.dll\s{2,}skymp5-server\s{2,}GNU AGPL version 3\s*$')
Yes 'it names the two texts beside it' ($readme.Contains('GPL-3.0.txt') -and $readme.Contains('AGPL-3.0.txt'))
Yes 'it points at the credits page' ($readme.Contains('https://thornswood.net/credits#source'))
Yes 'it says the launcher fetches it and nothing needs copying by hand' ($readme -match 'fetches it by itself' -and $readme -match 'by hand')
Yes 'it is plain ASCII, for Notepad' (-not ($readme -match '[^\x09\x0A\x0D\x20-\x7E]'))
Yes 'it has no em dash and never says player' (-not ($readme -match '—') -and -not ($readme -match '(?i)\bplayers?\b'))
Yes 'with every file built, it names no upstream group' (-not $readme.Contains('Thornswood did not build'))
$gplBytes  = [IO.File]::ReadAllBytes((Join-Path $licences 'GPL-3.0.txt'))
$agplBytes = [IO.File]::ReadAllBytes((Join-Path $licences 'AGPL-3.0.txt'))
$gplOut  = @($rt | Where-Object { $_.Name -eq 'GPL-3.0.txt' })[0].Bytes
$agplOut = @($rt | Where-Object { $_.Name -eq 'AGPL-3.0.txt' })[0].Bytes
Yes 'GPL-3.0.txt is installer\licences\GPL-3.0.txt, byte for byte' ([Convert]::ToBase64String($gplOut) -eq [Convert]::ToBase64String($gplBytes))
Yes 'AGPL-3.0.txt is installer\licences\AGPL-3.0.txt, byte for byte' ([Convert]::ToBase64String($agplOut) -eq [Convert]::ToBase64String($agplBytes))

# ---- the libraries inside them (#3099) ----------------------------------------
Yes ('records\client-licences.json is of the client record''s commit ' + $commit) ([string]$lr.forkCommit -eq $commit)
$badText = @()
foreach ($n in $ports) {
    $out = @($rt | Where-Object { $_.Name -eq ('licences/' + $n + '.txt') })[0].Bytes
    $want = [IO.File]::ReadAllBytes((Join-Path $libTexts ($n + '.txt')))
    if ([Convert]::ToBase64String($out) -ne [Convert]::ToBase64String($want)) { $badText += $n }
}
Yes ('every licences\<port>.txt is records\client-licences\<port>.txt, byte for byte' + $(if ($badText.Count) { ', differ: ' + ($badText -join ', ') } else { '' })) ($badText.Count -eq 0)
$unlisted = @()
foreach ($n in $ports) {
    $r = $lr.ports.$n
    $lic = if ($r.licence) { [string]$r.licence } else { 'its own terms' }
    $row = '(?m)^\s{2}' + [regex]::Escape($n + '.txt') + '\s+' + [regex]::Escape([string]$r.version) + '\s+' + [regex]::Escape($lic) + '\s*$'
    $files = (@($r.in | ForEach-Object { Leaf ([string]$_) }) | Sort-Object) -join ', '
    $inRow = '(?m)^\s{4}in ' + [regex]::Escape($files) + '\s*$'
    if (-not ($readme -match $row) -or -not ($readme -match ($row.Replace('\s*$', '\s*\r?\n') + $inRow.Substring(4)))) { $unlisted += $n }
}
Yes ('the README lists every library with its version, licence and the files it is in' + $(if ($unlisted.Count) { ', not: ' + ($unlisted -join ', ') } else { '' })) ($unlisted.Count -eq 0)
$impl = @($six | Where-Object { $_ -match 'SkyrimPlatformImpl\.dll$' })
$implPorts = @($lr.files.($impl[0]) | Sort-Object)
$ie = @(Get-SourceNoticeEntries $record $impl 'pack' $licences)
Yes ('a pack carrying only SkyrimPlatformImpl.dll carries the texts of its ' + $implPorts.Count + ' libraries and no others') `
    (((@(Names $ie) | Where-Object { $_ -like 'licences/*' }) -join '|') -eq ((@($implPorts | ForEach-Object { 'licences/' + $_ + '.txt' })) -join '|'))
# The libraries inside frida-gum's own build (#3287): the Release of their
# archives, each archive, and while the record says forksUp, our forks at
# Frida's commits, all from records\frida-sources.json.
$implNote = Text $ie 'SOURCE CODE.txt'
$fsRec = Read-Json (Join-Path $Repo 'records\frida-sources.json')
$bundled = @($fsRec.parts)
$relUrl = 'https://github.com/' + $fsRec.release.repo + '/releases/tag/' + $fsRec.release.tag
$noArchive = @($bundled | Where-Object { -not ($implNote -match ('(?m)^\s{4}' + [regex]::Escape($_.archive) + '\s*$')) } | ForEach-Object { $_.name })
Yes ('a pack carrying SkyrimPlatformImpl.dll names the Release of the ' + $bundled.Count + ' libraries inside frida-gum''s build, and each archive' + $(if ($noArchive.Count) { ', not: ' + ($noArchive -join ', ') } else { '' })) `
    ($bundled.Count -eq 6 -and $noArchive.Count -eq 0 -and $implNote.Contains($relUrl) -and $readme.Contains($relUrl))
$noTree = @($bundled | Where-Object { -not $implNote.Contains('https://github.com/EvilPatrick06/' + $_.name + '/tree/' + $_.commit) } | ForEach-Object { $_.name })
Yes ('  and our forks at Frida''s commits while the record says they are up' + $(if ($noTree.Count) { ', not: ' + ($noTree -join ', ') } else { '' })) `
    ($(if ($fsRec.forksUp) { $noTree.Count -eq 0 } else { $noTree.Count -eq $bundled.Count }))
# With forksUp false the note names the Release alone.
$fsCopy = Join-Path ([IO.Path]::GetTempPath()) ('ts-frida-sources-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
$down = Read-Json (Join-Path $Repo 'records\frida-sources.json'); $down.forksUp = $false
[IO.File]::WriteAllText($fsCopy, ($down | ConvertTo-Json -Depth 6))
$was = $SourceNoticeBundled['frida-gum'].Record
$SourceNoticeBundled['frida-gum'].Record = $fsCopy
$downNote = Text (Get-SourceNoticeEntries $record $impl 'pack' $licences) 'SOURCE CODE.txt'
$SourceNoticeBundled['frida-gum'].Record = $fsCopy + '.gone'
$threw = ''
try { $null = Get-SourceNoticeEntries $record $impl 'pack' $licences } catch { $threw = $_.Exception.Message }
$SourceNoticeBundled['frida-gum'].Record = $was
Remove-Item -LiteralPath $fsCopy -Force
Yes '  and once the forks are down, the Release alone' ($downNote.Contains($relUrl) -and -not $downNote.Contains('/frida-glib/tree/') -and -not $downNote.Contains('Until that repository'))
Yes '  and with no record it stops, saying so' ($threw -match 'is missing\. Where the source of what is inside frida-gum is')
Yes '  and a pack carrying only MpClientPlugin.dll names none of them' `
    (-not (Text (Get-SourceNoticeEntries $record @('Data\SKSE\Plugins\MpClientPlugin.dll') 'pack' $licences) 'SOURCE CODE.txt').Contains('frida-glib'))
Yes '  and its note names none of the libraries only the other files have' `
    (-not ((Text $ie 'SOURCE CODE.txt') -match '(?m)^\s{2}slikenet\.txt\s'))

# ---- the same folders and licences as the setup's note ---------------------
$setupNote = Text (Get-SourceNoticeEntries $record $six 'setup' $licences) 'SOURCE CODE.txt'
Yes 'the setup''s note is SOURCE CODE.txt, and says what the install put into the Skyrim folder' ($setupNote.Contains('Thornswood''s setup put SkyMP files into your Skyrim folder'))
$rowRx = '^\s{2}(\S+)\s{2,}(\S+)\s{2,}(GNU A?GPL version 3)\s*$'
$want = @{}
foreach ($l in ($setupNote -split "`r?`n")) { $m = [regex]::Match($l, $rowRx); if ($m.Success) { $want[$m.Groups[1].Value] = $m.Groups[2].Value + '|' + $m.Groups[3].Value } }
$bad = @()
foreach ($f in $six) {
    $leaf = Leaf $f
    $m = [regex]::Match(($readme -split "`r?`n" | Where-Object { $_ -match ('^\s{2}' + [regex]::Escape($leaf) + '\s') } | Select-Object -First 1), $rowRx)
    if (-not $want.ContainsKey($leaf) -or -not $m.Success -or $want[$leaf] -ne ($m.Groups[2].Value + '|' + $m.Groups[3].Value)) { $bad += $leaf }
}
Yes ('every file has the folder and licence the setup''s note gives it' + $(if ($bad.Count) { ', differ: ' + ($bad -join ', ') } else { '' })) ($bad.Count -eq 0)

# ---- packs -------------------------------------------------------------------
$own = @('Data\Platform\Plugins\thornswood-front.js', 'Data\Platform\UI\thornswood-select.js')
Yes 'a pack of only our own files gets nothing' (@(Get-SourceNoticeEntries $record $own 'pack' $licences | Where-Object { $_ }).Count -eq 0)
Yes 'nor does a pack of nothing, like one that only removes' (@(Get-SourceNoticeEntries $record @() 'pack' $licences | Where-Object { $_ }).Count -eq 0)
$one = @(Get-SourceNoticeEntries $record ($own + 'Data\Platform\Plugins\skymp5-client.js') 'pack' $licences)
$src = Text $one 'SOURCE CODE.txt'
Yes ('a pack carrying skymp5-client.js gets SOURCE CODE.txt and both texts: ' + ((Names $one) -join ', ')) `
    (((Names $one) -join '|') -eq 'SOURCE CODE.txt|GPL-3.0.txt|AGPL-3.0.txt')
Yes '  naming skymp5-client.js, skymp5-client, GNU GPL version 3' ($src -match '(?m)^\s{2}skymp5-client\.js\s{2,}skymp5-client\s{2,}GNU GPL version 3\s*$')
Yes '  and the recorded commit' ($src.Contains($fork + '/tree/' + $commit))
Yes '  and not the files it does not carry' (-not $src.Contains('SkyrimPlatformImpl.dll') -and -not $src.Contains('thornswood-front.js'))
Yes '  matched without regard to case' ((Names (Get-SourceNoticeEntries $record @('data\platform\plugins\SKYMP5-CLIENT.js') 'pack' $licences)) -contains 'SOURCE CODE.txt')
# build.js is built from the fork's skymp5-front at the pin by every Ship since
# #2931 and held to records\front-build.json, beside the client record.
$fb = @(Get-SourceNoticeEntries $record @('Data\Platform\UI\build.js') 'pack' $licences)
$fbText = Text $fb 'SOURCE CODE.txt'
Yes 'a pack carrying only build.js names it as built from skymp5-front, GNU GPL version 3' ($fbText -match '(?m)^\s{2}build\.js\s{2,}skymp5-front\s{2,}GNU GPL version 3\s*$')
Yes '  at the recorded commit, with no group of what Thornswood did not build' ($fbText.Contains($fork + '/tree/' + $commit) -and -not $fbText.Contains('Thornswood did not build'))

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-source-notice-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $tmp
try {
    # A client record with no front record beside it, as before #2931: build.js
    # is SkyMP's own, with no commit.
    $bare = Join-Path $tmp 'bare'
    $null = New-Item -ItemType Directory -Force -Path $bare
    [IO.File]::Copy($record, (Join-Path $bare 'client-build.json'))
    [IO.File]::Copy($libRecord, (Join-Path $bare 'client-licences.json'))
    Copy-Item -LiteralPath $libTexts -Destination (Join-Path $bare 'client-licences') -Recurse
    $up = @(Get-SourceNoticeEntries (Join-Path $bare 'client-build.json') @('Data\Platform\UI\build.js') 'pack' $licences)
    $upText = Text $up 'SOURCE CODE.txt'
    Yes 'with no front record, a pack carrying only build.js names it as SkyMP''s skymp5-front, GNU GPL version 3' ($upText -match '(?m)^\s{2}build\.js\s{2,}skymp5-front\s{2,}GNU GPL version 3\s*$')
    Yes '  says Thornswood did not build it and names no commit for it' ($upText.Contains('Thornswood did not build') -and -not $upText.Contains('/tree/'))
    Yes '  and points at upstream SkyMP' ($upText.Contains('https://github.com/skyrim-multiplayer/skymp'))
    # A front record of another commit stops it.
    $fr = Read-Json (Join-Path $Repo 'records\front-build.json')
    $fr.forkCommit = 'abcdef1234567890abcdef1234567890abcdef12'
    [IO.File]::WriteAllText((Join-Path $bare 'front-build.json'), ($fr | ConvertTo-Json -Depth 6))
    $threw = $false
    try { $null = Get-SourceNoticeEntries (Join-Path $bare 'client-build.json') @('Data\Platform\UI\build.js') 'pack' $licences } catch { $threw = $_.Exception.Message -match 'one commit' }
    Yes 'a front record of another commit than the client record stops it' $threw

    $c3 = Read-Json $record
    $c3.files | Add-Member -NotePropertyName 'Data\SKSE\Plugins\Unheard.dll' -NotePropertyValue ([pscustomobject]@{ sha256 = '00'; bytes = 1 })
    $cp = Join-Path $tmp 'client-build.json'
    [IO.File]::WriteAllText($cp, ($c3 | ConvertTo-Json -Depth 6))
    [IO.File]::Copy($libRecord, (Join-Path $tmp 'client-licences.json'))
    Copy-Item -LiteralPath $libTexts -Destination (Join-Path $tmp 'client-licences') -Recurse
    $threw = $false
    try { $null = Get-SourceNoticeEntries $cp $six 'runtime' $licences } catch { $threw = $_.Exception.Message -match 'Unheard' }
    Yes 'a recorded file with no known source folder stops it' $threw

    # The library texts are held to their record (#3099).
    $lb = Join-Path $tmp 'libs'
    $null = New-Item -ItemType Directory -Force -Path $lb
    [IO.File]::Copy($record, (Join-Path $lb 'client-build.json'))
    $lbRecord = Join-Path $lb 'client-build.json'
    $threw = $false
    try { $null = Get-SourceNoticeEntries $lbRecord $six 'runtime' $licences } catch { $threw = $_.Exception.Message -match 'client-licences\.json is missing' }
    Yes 'no client-licences.json beside the client record stops it' $threw
    Copy-Item -LiteralPath $libTexts -Destination (Join-Path $lb 'client-licences') -Recurse
    $l2 = Read-Json $libRecord
    $l2.forkCommit = 'abcdef12'
    [IO.File]::WriteAllText((Join-Path $lb 'client-licences.json'), ($l2 | ConvertTo-Json -Depth 6))
    $threw = $false
    try { $null = Get-SourceNoticeEntries $lbRecord $six 'runtime' $licences } catch { $threw = $_.Exception.Message -match 'is the build of abcdef12' }
    Yes 'a client-licences.json of another commit than the client record stops it' $threw
    [IO.File]::Copy($libRecord, (Join-Path $lb 'client-licences.json'), $true)
    $first = $ports[0]
    [IO.File]::AppendAllText((Join-Path $lb ('client-licences\' + $first + '.txt')), 'changed')
    $threw = $false
    try { $null = Get-SourceNoticeEntries $lbRecord $six 'runtime' $licences } catch { $threw = $_.Exception.Message -match ('not the text client-licences\.json names for ' + [regex]::Escape($first)) }
    Yes 'a library text that is not the one recorded stops it' $threw
    Remove-Item -LiteralPath (Join-Path $lb ('client-licences\' + $first + '.txt'))
    $threw = $false
    try { $null = Get-SourceNoticeEntries $lbRecord $six 'runtime' $licences } catch { $threw = $_.Exception.Message -match 'missing' }
    Yes 'a missing library text stops it' $threw

    # ---- the code that does not come through vcpkg (#3751) -----------------
    # The record's libraries go with the files they are in, as the ports do.
    $lx = Join-Path $tmp 'libs3751'
    $null = New-Item -ItemType Directory -Force -Path $lx
    [IO.File]::Copy($record, (Join-Path $lx 'client-build.json'))
    Copy-Item -LiteralPath $libTexts -Destination (Join-Path $lx 'client-licences') -Recurse
    $l3 = Read-Json $libRecord
    $libsAdded = [ordered]@{}
    foreach ($x in @(@('viet', 'fork', $null, 'MIT', 'Data\SKSE\Plugins\MpClientPlugin.dll'), @('npm-eventemitter3-5.0.1', 'npm', '5.0.1', 'MIT', 'Data\Platform\Plugins\skymp5-client.js'))) {
        $tp = Join-Path $lx ('client-licences\' + $x[0] + '.txt')
        [IO.File]::WriteAllText($tp, "The $($x[0]) notice`n")
        $libsAdded[$x[0]] = [ordered]@{ kind = $x[1]; version = $x[2]; licence = $x[3]; from = 'somewhere'; in = @($x[4])
            sha256 = (Get-FileHash -LiteralPath $tp -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = (Get-Item -LiteralPath $tp).Length }
    }
    $l3 | Add-Member -NotePropertyName libraries -NotePropertyValue ([pscustomobject]$libsAdded)
    [IO.File]::WriteAllText((Join-Path $lx 'client-licences.json'), ($l3 | ConvertTo-Json -Depth 6))
    $lxRecord = Join-Path $lx 'client-build.json'
    $got = @(Get-ClientLicences $lxRecord @('Data\SKSE\Plugins\MpClientPlugin.dll'))
    Yes '#3751: a library of the record goes with the files it is in, and with no other' (@($got.Port) -contains 'viet' -and @($got.Port) -notcontains 'npm-eventemitter3-5.0.1')
    $rt3 = @(Get-SourceNoticeEntries $lxRecord $six 'runtime' $licences)
    $rt3Text = Text $rt3 'README.txt'
    Yes '#3751: the client runtime carries each library''s text in licences/ and its note lists them' (
        @($rt3.Name) -contains 'licences/viet.txt' -and @($rt3.Name) -contains 'licences/npm-eventemitter3-5.0.1.txt' -and
        $rt3Text -match '(?m)^\s{2}viet\.txt\s' -and $rt3Text -match '(?m)^\s{2}npm-eventemitter3-5\.0\.1\.txt\s+5\.0\.1\s+MIT' -and $rt3Text -match 'in skymp5-client\.js')
    [IO.File]::AppendAllText((Join-Path $lx 'client-licences\viet.txt'), 'changed')
    $threw = $false
    try { $null = Get-SourceNoticeEntries $lxRecord $six 'runtime' $licences } catch { $threw = $_.Exception.Message -match 'not the text client-licences\.json names for viet' }
    Yes '#3751: a library text that is not the one recorded stops it' $threw

    # The npm packages in build.js go with it, from front-build.json beside
    # the client record and its texts in front-licences.
    $fl = @(Get-FrontLicences (Join-Path $Repo 'records\front-build.json'))
    $fpNames = @((Read-Json (Join-Path $Repo 'records\front-build.json')).packages.PSObject.Properties.Name)
    Yes '#3751: Get-FrontLicences gives every package front-build.json lists, each in build.js' ($fl.Count -gt 0 -and $fl.Count -eq $fpNames.Count -and @($fl | Where-Object { (@($_.Files) -join ',') -ne 'build.js' }).Count -eq 0)
    $packText = Text (Get-SourceNoticeEntries $record @('Data\Platform\UI\build.js') 'pack' $licences) 'SOURCE CODE.txt'
    Yes '#3751: a pack carrying build.js lists the packages in it in its note' ($packText -match '(?m)^\s{2}npm-react-[0-9.]+\.txt\s' -and $packText -match 'in build\.js')
    $fx = Join-Path $tmp 'front3751'
    $null = New-Item -ItemType Directory -Force -Path $fx
    [IO.File]::Copy($record, (Join-Path $fx 'client-build.json'))
    [IO.File]::Copy($libRecord, (Join-Path $fx 'client-licences.json'))
    Copy-Item -LiteralPath $libTexts -Destination (Join-Path $fx 'client-licences') -Recurse
    $f4 = Read-Json (Join-Path $Repo 'records\front-build.json')
    $f4.PSObject.Properties.Remove('packages')
    [IO.File]::WriteAllText((Join-Path $fx 'front-build.json'), ($f4 | ConvertTo-Json -Depth 6))
    $threw = $false
    try { $null = Get-SourceNoticeEntries (Join-Path $fx 'client-build.json') @('Data\Platform\UI\build.js') 'pack' $licences } catch { $threw = $_.Exception.Message -match 'lists no packages' }
    Yes '#3751: a front record that lists no packages stops a download carrying build.js' $threw
    $a1 = [pscustomobject]@{ Port = 'same'; Version = '1'; Licence = 'MIT'; Files = @('a.dll'); Bytes = [byte[]](1, 2) }
    $b1 = [pscustomobject]@{ Port = 'same'; Version = '1'; Licence = 'MIT'; Files = @('build.js'); Bytes = [byte[]](1, 2) }
    $j = @(Join-NoticeLicences @($a1) @($b1))
    Yes '#3751: one text named in both lists is one entry, in the files of both' ($j.Count -eq 1 -and (@($j[0].Files) -join ',') -eq 'a.dll,build.js')
    $b1.Bytes = [byte[]](3)
    $threw = $false
    try { $null = Join-NoticeLicences @($a1) @($b1) } catch { $threw = $_.Exception.Message -match 'two different texts' }
    Yes '#3751: one name with two different texts stops it' $threw
    $own2 = Join-Path $tmp 'own'
    $null = New-Item -ItemType Directory -Force -Path $own2
    Write-SourceNoticeToFolder $own2 $rt
    $onDisk = @(Get-ChildItem -LiteralPath $own2 -Recurse -File | ForEach-Object { $_.FullName.Substring($own2.Length + 1).Replace('\', '/') } | Sort-Object)
    Yes 'Write-SourceNoticeToFolder puts the texts in a licences folder beside the note, as the runtime stage has them' `
        (($onDisk -join '|') -eq (@($wantNames | Sort-Object) -join '|'))
    $threw = $false
    try { $null = Get-SourceNoticeEntries $record $six 'runtime' (Join-Path $tmp 'nolicences') } catch { $threw = $true }
    Yes 'a missing licence text stops it' $threw

    # ---- a zip, written the way Publish-Update writes a pack ----------------
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zp = Join-Path $tmp 'pack-test.zip'
    $z = [IO.Compression.ZipFile]::Open($zp, 'Create')
    try {
        $e = $z.CreateEntry('game/Data/Platform/UI/thornswood-select.js')
        $s = $e.Open(); $b = [Text.Encoding]::UTF8.GetBytes('// ours'); $s.Write($b, 0, $b.Length); $s.Dispose()
        Add-SourceNoticeToZip $z (Get-SourceNoticeEntries $record @('Data\Platform\UI\build.js') 'pack' $licences)
        Add-SourceNoticeToZip $z (Get-SourceNoticeEntries $record $own 'pack' $licences)
    } finally { $z.Dispose() }
    $z = [IO.Compression.ZipFile]::OpenRead($zp)
    try { $names = @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() }
    # build.js is the recorded front, so the texts of the npm packages in it
    # go with it, one per package front-build.json lists (#3751).
    $frontPackages = @(((Get-Content -LiteralPath (Join-Path $Repo 'records\front-build.json') -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json).packages.PSObject.Properties.Name)
    Yes ('the pack zip holds the note and both texts at its top, and the text of every npm package in build.js: ' + ($names -join ', ')) `
        ($names -contains 'SOURCE CODE.txt' -and $names -contains 'GPL-3.0.txt' -and $names -contains 'AGPL-3.0.txt' -and $frontPackages.Count -gt 0 -and
         $names.Count -eq (4 + $frontPackages.Count) -and @($frontPackages | Where-Object { $names -notcontains ('licences/' + $_ + '.txt') }).Count -eq 0)
    # A pack carrying all six, so every library text is in it for the scan.
    $zp6 = Join-Path $tmp 'pack-six.zip'
    $z = [IO.Compression.ZipFile]::Open($zp6, 'Create')
    try { Add-SourceNoticeToZip $z (Get-SourceNoticeEntries $record $six 'pack' $licences) } finally { $z.Dispose() }
    $z = [IO.Compression.ZipFile]::OpenRead($zp6)
    try { $names6 = @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() }
    Yes ('a pack carrying the six holds every library text under licences/: ' + @($names6 | Where-Object { $_ -like 'licences/*' }).Count) `
        (@($names6 | Where-Object { $_ -like 'licences/*' }).Count -eq $ports.Count)
    $out6 = (@(& (Join-Path $Repo 'scripts\dev\Check-Secrets.ps1') -Zip $zp6 *>&1 | ForEach-Object { [string]$_ }) -join "`n")
    Yes ('Check-Secrets passes a zip carrying every library text (exit ' + $LASTEXITCODE + ')') ($LASTEXITCODE -eq 0)
    if ($LASTEXITCODE -ne 0) { Write-Host $out6 }
    $scan = Join-Path $Repo 'scripts\dev\Check-Secrets.ps1'
    $out = (@(& $scan -Zip $zp *>&1 | ForEach-Object { [string]$_ }) -join "`n")
    Yes ('Check-Secrets passes a zip carrying them (exit ' + $LASTEXITCODE + ')') ($LASTEXITCODE -eq 0)
    if ($LASTEXITCODE -ne 0) { Write-Host $out }
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- Publish-Update.ps1 uses it ---------------------------------------------
$pu = Get-Content -LiteralPath $publish -Raw
Yes 'Publish-Update.ps1 dot-sources Source-Notice.ps1' ($pu.Contains(". (Join-Path `$Here 'Source-Notice.ps1')"))
$packAt = $pu.IndexOf("Head 'Building the pack'")
$packCall = $pu.IndexOf("Get-SourceNoticeEntries `$sourceRecord `$inPart 'pack' `$sourceLicences")
$deleteAt = $pu.IndexOf("CreateEntry('delete.txt')")
Yes 'every pack part gets the note, once its game files are in' ($packAt -ge 0 -and $packCall -gt $packAt -and $packCall -lt $deleteAt -and $pu.Contains('Add-SourceNoticeToZip $zip (Get-SourceNoticeEntries'))
$rtCall = $pu.IndexOf("Get-SourceNoticeEntries `$cbPath `$names 'runtime' `$sourceLicences")
$rtZip = $pu.IndexOf('[IO.Compression.ZipFile]::CreateFromDirectory($stage, $clientZip')
Yes 'the client runtime gets the note in its stage before it is zipped' ($rtCall -gt 0 -and $rtZip -gt $rtCall)
Yes 'the feed records which note the client runtime carries' ($pu -match 'notice\s+=\s+\$SourceNoticeVersion')

# The "already on the feed" test, lifted and run: a runtime already there
# without the note is published again, one with it is left alone.
$m = [regex]::Match($pu, '(?s)\$already = (.+?)\r?\n\s*if \(\$already\)')
Yes 'Publish-Update.ps1 still decides "already on the feed" in one expression' $m.Success
if ($m.Success) {
    $expr = [ScriptBlock]::Create($m.Groups[1].Value)
    $cbCommit = $commit
    $have = [pscustomobject]@{ url = 'https://thornswood.net/feed-dev/assets/x'; sha256 = 'x'; bytes = 1; forkCommit = $commit }
    Yes 'a runtime on the feed from before the note is published again' (-not [bool](& $expr))
    $have = [pscustomobject]@{ url = 'https://thornswood.net/feed-dev/assets/x'; sha256 = 'x'; bytes = 1; forkCommit = $commit; notice = $SourceNoticeVersion }
    Yes 'a runtime on the feed with the note is left alone' ([bool](& $expr))
    $have = [pscustomobject]@{ url = 'https://thornswood.net/feed-dev/assets/x'; sha256 = 'x'; bytes = 1; forkCommit = 'deadbeef'; notice = $SourceNoticeVersion }
    Yes 'a runtime of another commit is published again' (-not [bool](& $expr))
}

# ---- the Velopack package (#4825) ----------------------------------------------
# On dev the game files come from the launcher's Velopack package, which
# carries the six beside the launcher, so it carries the note and the texts
# too (Build-SetupFiles.ps1), and the install copies them into its folder.
$st = @(Get-SourceNoticeEntries $record $six 'setup' $licences)
$setupNote = Text $st 'SOURCE CODE.txt'
$wantSetup = @('SOURCE CODE.txt', 'GPL-3.0.txt', 'AGPL-3.0.txt') + @($ports | ForEach-Object { 'licences/' + $_ + '.txt' })
Yes ('the Velopack package''s game files get SOURCE CODE.txt, both texts and the library texts: ' + ((Names $st) -join ', ')) `
    (((Names $st) -join '|') -eq ($wantSetup -join '|'))
Yes '  naming the recorded commit and every one of the six, and saying setup put them there' (
    $setupNote.Contains($fork + '/tree/' + $commit) -and @($six | Where-Object { -not $setupNote.Contains((Leaf $_)) }).Count -eq 0 -and $setupNote -match 'setup put SkyMP files into your Skyrim folder')
Yes '  in plain ASCII, with no em dash and never player' (-not ($setupNote -match '[^\x09\x0A\x0D\x20-\x7E]') -and -not ($setupNote -match '(?i)\bplayers?\b'))
$bsf = Get-Content -LiteralPath (Join-Path $Repo 'scripts\release\Build-SetupFiles.ps1') -Raw
Yes 'Build-SetupFiles.ps1 writes it from the game files it carries, and refuses a package that carries none of the six' (
    $bsf.Contains(". (Join-Path `$Here 'Source-Notice.ps1')") -and
    $bsf.Contains("Get-SourceNoticeEntries (Join-Path `$RepoDir 'records\client-build.json') `$carried 'setup' (Join-Path `$RepoDir 'installer\licences')") -and
    $bsf.Contains('Write-SourceNoticeToFolder $files $entries') -and $bsf.Contains("if (`$entries.Count -eq 0) { throw"))
$steps = Get-Content -LiteralPath (Join-Path $Repo 'launcher\app\InstallSteps.cs') -Raw
Yes 'the install copies SOURCE CODE.txt, the two texts and licences\ out of the package into its folder' (
    $steps.Contains('CopyIfThere(Path.Combine(choice.Package, "SOURCE CODE.txt"), Path.Combine(Root, "SOURCE CODE.txt"));') -and
    $steps.Contains('"GPL-3.0.txt", "AGPL-3.0.txt"') -and $steps.Contains('Path.Combine(choice.Package, "licences")'))

# ---- the launcher ignores what this adds -------------------------------------
$cr = Get-Content -LiteralPath (Join-Path $Repo 'launcher\app\ClientRuntime.cs') -Raw
Yes 'ClientRuntime.cs takes out only the recorded paths it wants (Find by name)' `
    ($cr -match 'ZipArchiveEntry en = Find\(ar, rel\);' -and $cr -match 'string rel = want\[i\];')
$up2 = Get-Content -LiteralPath (Join-Path $Repo 'launcher\app\Updater.cs') -Raw
Yes 'Updater.cs skips a pack entry that is not game\, profile\ or delete.txt' `
    ($up2 -match '(?s)rel\.Equals\("delete\.txt", StringComparison\.OrdinalIgnoreCase\)\)\s*continue;\s*else if \(rel\.Equals\("ui-assets\.txt", StringComparison\.OrdinalIgnoreCase\)\)\s*\{.*?\bcontinue;\s*\}\s*else\s*continue;\s*// The fence is')

# ---- THIRD-PARTY.md says so, and not what stopped being true ----------------
$tp = Get-Content -LiteralPath (Join-Path $Repo 'THIRD-PARTY.md') -Raw
$reach = [regex]::Match($tp, '(?s)\n## How it reaches people(.+?)\n## ').Groups[1].Value
Yes 'THIRD-PARTY.md says the client runtime zip carries README.txt and the two texts (Source-Notice.ps1)' `
    ($reach.Contains('README.txt') -and $reach.Contains('GPL-3.0.txt') -and $reach.Contains('AGPL-3.0.txt') -and $reach.Contains('Source-Notice.ps1'))
Yes 'THIRD-PARTY.md no longer names Get-ReleaseSourceFooter, which #907 removed' (-not $tp.Contains('Get-ReleaseSourceFooter') -and -not $pu.Contains('function Get-ReleaseSourceFooter'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
