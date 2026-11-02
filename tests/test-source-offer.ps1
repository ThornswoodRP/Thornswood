<#
  test-source-offer.ps1

  Where the source of the SkyMP files Thornswood ships is, said on the site and
  in the installed folder, and said truthfully.

  WHY IT MATTERS. Entry 170 on the To Do List. The setup and every pack
  carry six files built from SkyMP (records\client-build.json), and the server
  runs a seventh (records\server-build.json). SkyMP's folders carry the GNU GPL
  and AGPL version 3, each in its own LICENSE file. Nothing Thornswood put in
  front of a stranger said where the source was: credits.md named SkyMP with
  no licence and no link, and on 24 September the installer's READ ME
  FIRST.txt was still the old multiplayer mod's one, left in the setup program's
  scratch folder. The entry's closing condition: a stranger can reach,
  "from the download page and from inside the installed folder", a page
  naming skymp5-client, skyrim-platform and skymp5-server with their licences
  that links the corresponding source.

  MEASURED 24 SEPTEMBER. git ls-remote against the public fork with no
  credentials answers 3cbf2f8779f5 for thornswood/engine-changes, the commit
  both records named that day, and the tree, compare and upstream links on the
  page all answer 200 signed out. Both records name the pinned commit since
  #1200, and this file reads them rather than holding a commit of its own.

  NOT ALL OF IT IS OURS. The 23 September installer stage also carried
  Data\Platform\UI\build.js (a webpack build of skymp5-front, GPL v3, dated
  13 September, before the fork), Data\Platform\Modules\skyrimPlatform.ts and
  Data\Scripts\MpClientPlugin.pex, none of them built here and none with a
  recorded commit. The first version of the page and the note said "All of
  it is built from" the fork, which was false. Both now name those files as
  their own group, say the gap, and point at upstream, and this checks that
  they do and that the old sentence does not come back.

  What this checks:
    - the setup's SOURCE CODE.txt, Source-Notice.ps1's note of kind setup,
      which Build-SetupFiles.ps1 writes into the launcher's Velopack package
      from the client record and the game files it packs (#4824, #4825;
      Package-Thornswood.ps1's Get-SourceNotice until then): it names every
      recorded file, follows the record when it changes, and stops on a
      file it has no source folder for. It names the SkyMP files carried
      that were not built here, as their own group, and only those present.
      The server is not in the package, so the note does not name it; the
      credits page does.
    - the install (InstallSteps.cs) copies that note and the licence texts
      into the install folder, and Uninstall.cs takes them out again.
    - credits.md names the fork, the branch, the recorded commits and every
      shipped file. A commit that is not in a record fails here. The two
      channel rows name no commit: the site fills in each feed's client
      commit, and test-credits-channels.ps1 holds that to each feed.
      It names the files not built here apart, with the gap said.
    - the download page points at it.
    - with the fork on this machine, every licence and every file to folder
      pair both notices state is read off the fork itself at the recorded
      commit. SKIP where the fork is not cloned, which is the build runner.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$Fork)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# Resolved here rather than as the param default: Windows PowerShell 5.1 leaves
# $PSScriptRoot empty inside a script's param block (issue #991).
if (-not $Fork) { $Fork = & (Join-Path $Here '..\scripts\release\Where.ps1') Engine }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Read-Json([string]$p) {
    return (((Get-Content -LiteralPath $p -Raw) -replace '^\uFEFF', '') | ConvertFrom-Json)
}
function Leaf([string]$p) { return $p.Substring($p.LastIndexOf('\') + 1) }

$clientPath  = Join-Path $Here 'records\client-build.json'
$serverPath  = Join-Path $Here 'records\server-build.json'
$setupFilesPath = Join-Path $Here 'scripts\release\Build-SetupFiles.ps1'
$stepsPath   = Join-Path $Here 'launcher\app\InstallSteps.cs'
$creditsPath = Join-Path $Here 'site\data\site\credits.md'
$homeJsPath  = Join-Path $Here 'site\public\home.js'

$client = Read-Json $clientPath
$server = Read-Json $serverPath
$files  = @($client.files.PSObject.Properties.Name)
$cCommit = [string]$client.forkCommit
$sCommit = [string]$server.source.commit
$forkUrl = ([string]$client.fork).TrimEnd('/')
$ub = [string]$client.upstreamBase
Yes ('the client record names a fork, a branch and a commit (' + $cCommit + ')') ($forkUrl -and $client.forkBranch -and $cCommit -match '^[0-9a-f]{7,40}$')
Yes ('the server record names a commit (' + $sCommit.Substring(0, [Math]::Min(8, $sCommit.Length)) + ')') ($sCommit -match '^[0-9a-f]{7,40}$')
Yes ('the client record lists the six runtime files') ($files.Count -eq 6)

# Every commit a record names, full or short: the client and server records,
# and since the setup's note is Source-Notice.ps1's (#4824) with the library
# notices of the runtime note, the records those come from too, Frida's
# sources (records\frida-sources.json) and the vcpkg ports' versions
# (records\client-licences.json). A hash on the page or in the note has to be
# a prefix of one of these, or one of these of it.
$known = @(@($cCommit, $sCommit, [string]$client.upstreamBase, [string]$server.source.upstreamBase) +
    @(foreach ($r in 'frida-sources.json', 'client-licences.json') {
        [regex]::Matches([IO.File]::ReadAllText((Join-Path (Join-Path $Here 'records') $r)), '\b[0-9a-f]{7,40}\b') | ForEach-Object { $_.Value }
    })) | Where-Object { $_ -match '^[0-9a-f]{7,40}$' }
function Test-Known([string]$h) {
    foreach ($k in $known) { if ($k.StartsWith($h) -or $h.StartsWith($k)) { return $true } }
    return $false
}
function Test-Words([string]$text) {
    return (-not ($text -match '\u2014') -and -not ($text -match '(?i)\bplayers?\b'))
}

# ---- the note the setup carries ---------------------------------------------
#
# Source-Notice.ps1's note of kind setup, driven as shipped, on the carried
# files the way Build-SetupFiles.ps1 hands them over (paths in Game).
. (Join-Path $Here 'scripts\release\Source-Notice.ps1')
$licenceDir = Join-Path $Here 'installer\licences'
function Get-SetupEntries([string]$cr, [string[]]$carried, [string]$fr) {
    return @(Get-SourceNoticeEntries $cr $carried 'setup' $licenceDir $fr)
}
function Get-SetupNote([string]$cr, [string[]]$carried, [string]$fr) {
    $n = @(Get-SetupEntries $cr $carried $fr | Where-Object { $_.Name -eq 'SOURCE CODE.txt' })
    if ($n.Count -ne 1) { return '' }
    return [Text.Encoding]::UTF8.GetString($n[0].Bytes)
}

$entries = @(Get-SetupEntries $clientPath $files '')
$note = Get-SetupNote $clientPath $files ''
$rows = @()
Yes 'the setup carries one SOURCE CODE.txt' ($note -ne '')
Yes 'the note names the fork' ($note.Contains($forkUrl))
Yes 'the note names the branch' ($note.Contains([string]$client.forkBranch))
Yes 'the note names the client commit and links its tree' ($note.Contains($forkUrl + '/tree/' + $cCommit))
# New-ClientBuildRecord writes words here when upstream was not fetched,
# and the note then says it does not know, which is the honest gap.
Yes 'the note names the upstream commit it starts from, where the record has one' `
    (-not ($ub -match '^[0-9a-f]{7,40}$') -or $note.Contains($ub))
$missing = @($files | Where-Object { -not $note.Contains((Leaf $_)) })
Yes ('the note names every recorded file' + $(if ($missing.Count) { ', missing ' + ($missing -join ', ') } else { '' })) ($missing.Count -eq 0)
Yes 'the note points at the credits page for later builds' ($note.Contains('https://thornswood.net/credits'))
$stray = @([regex]::Matches($note, '\b[0-9a-f]{7,40}\b') | ForEach-Object { $_.Value } | Where-Object { -not (Test-Known $_) })
Yes 'every commit in the note is one a record names' ($stray.Count -eq 0)
Yes 'the note is plain ASCII, for Notepad' (-not ($note -match '[^\x09\x0A\x0D\x20-\x7E]'))
Yes 'the note has no em dash and never says player' (Test-Words $note)
Yes 'the note does not claim all of it is built from the fork' (-not ($note -match '(?i)All of it'))
Yes 'carrying only the recorded files, the note names no files it did not build' (-not $note.Contains('did not build'))

# The table, as "  file  folder  licence". Only the files Thornswood built:
# the group it did not build has its own heading and is checked below.
foreach ($l in ($note -split "`r?`n")) {
    $m = [regex]::Match($l, '^\s{2}(\S+)\s{2,}(skymp5-client|skyrim-platform|skymp5-server)\s{2,}(GNU A?GPL version 3)\s*$')
    if ($m.Success) { $rows += [pscustomobject]@{ File = $m.Groups[1].Value; Folder = $m.Groups[2].Value; Licence = $m.Groups[3].Value; Where = 'note' } }
}
Yes ('the note gives a folder and a licence for all six files, found ' + $rows.Count) ($rows.Count -eq 6)

# It follows the record. A different commit in the record has to come out in
# the note, and the old one must not, or the note was typed and not read.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-source-offer-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $tmp
try {
    $c2 = Read-Json $clientPath
    $c2.forkCommit = 'abcdef12'
    $cp = Join-Path $tmp 'client-build.json'
    # The note carries the licence texts of the libraries in the files
    # (client-licences.json beside the record, #3099), measured from the
    # record's own commit, so each record written here gets the real texts
    # beside it under the commit it names.
    Copy-Item -LiteralPath (Join-Path (Join-Path $Here 'records') 'client-licences') -Destination $tmp -Recurse
    function Put-Licences([string]$recordPath) {
        $l = Read-Json (Join-Path (Join-Path $Here 'records') 'client-licences.json')
        $l.forkCommit = [string](Read-Json $recordPath).forkCommit
        [IO.File]::WriteAllText((Join-Path (Split-Path -Parent $recordPath) 'client-licences.json'), ($l | ConvertTo-Json -Depth 8))
    }
    function Put-Record($o, [switch]$Bom) {
        if ($Bom) { [IO.File]::WriteAllText($cp, ($o | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($true))) }
        else { [IO.File]::WriteAllText($cp, ($o | ConvertTo-Json -Depth 6)) }
        Put-Licences $cp
    }
    Put-Record $c2
    $n2 = Get-SetupNote $cp $files ''
    Yes 'a new client commit in the record comes out in the note' ($n2.Contains('/tree/abcdef12'))
    Yes 'the old commit does not survive a new record' (-not $n2.Contains($cCommit))

    # Windows PowerShell 5.1 writes a byte order mark with -Encoding UTF8,
    # and a record saved that way still has to read.
    Put-Record $c2 -Bom
    Yes 'a record saved with a byte order mark still reads' ((Get-SetupNote $cp $files '').Contains('/tree/abcdef12'))

    # A file the record gains with no known source folder stops the setup's
    # build rather than shipping a note that leaves it out.
    $c3 = Read-Json $clientPath
    $c3.files | Add-Member -NotePropertyName 'Data\SKSE\Plugins\Unheard.dll' -NotePropertyValue ([pscustomobject]@{ sha256 = '00'; bytes = 1 })
    Put-Record $c3
    $threw = $false
    try { $null = Get-SetupNote $cp $files '' } catch { $threw = $true }
    Yes 'a recorded file with no known source folder stops it' $threw

    $threw = $false
    try { $null = Get-SetupNote (Join-Path $tmp 'nothing.json') $files '' } catch { $threw = $true }
    Yes 'a missing client record stops it' $threw

    $c4 = Read-Json $clientPath
    $c4.forkCommit = ''
    Put-Record $c4
    $threw = $false
    try { $null = Get-SetupNote $cp $files '' } catch { $threw = $true }
    Yes 'a record with no commit stops it' $threw

    # The words New-ClientBuildRecord writes when upstream was not fetched
    # say so in the note rather than passing for a commit.
    $c5 = Read-Json $clientPath
    $c5.upstreamBase = 'unknown, fetch upstream to fill this in'
    Put-Record $c5
    $n5 = Get-SetupNote $cp $files ''
    Yes 'an upstream base the record does not know is said as a gap, not printed as a commit' `
        ($n5.Contains('a commit the build record does not name') -and -not $n5.Contains('unknown, fetch'))

    # The SkyMP files carried that were not built here. Game files shaped
    # like the 23 September stage, with a record from before the front was
    # built from the fork (no front-build.json beside it), get all three
    # named, as their own group, with the gap said and no commit claimed.
    [IO.File]::Copy($clientPath, $cp, $true); Put-Licences $cp
    $extraFiles = @('Data\Platform\UI\build.js', 'Data\Platform\Modules\skyrimPlatform.ts', 'Data\Scripts\MpClientPlugin.pex')
    $n6 = Get-SetupNote $cp ($files + $extraFiles) ''
    $cut = $n6.IndexOf('did not build')
    Yes 'game files with build.js and the rest get a group for what Thornswood did not build' ($cut -gt 0)
    $tail = if ($cut -gt 0) { $n6.Substring($cut) } else { '' }
    $head6 = if ($cut -gt 0) { $n6.Substring(0, $cut) } else { $n6 }
    Yes 'that group names build.js as skymp5-front under the GNU GPL version 3' `
        ($tail -match '(?m)^\s{2}build\.js\s{2,}skymp5-front\s{2,}GNU GPL version 3\s*$')
    Yes 'that group names skyrimPlatform.ts as skyrim-platform under the GNU GPL version 3' `
        ($tail -match '(?m)^\s{2}skyrimPlatform\.ts\s{2,}skyrim-platform\s{2,}GNU GPL version 3\s*$')
    Yes 'that group names MpClientPlugin.pex and says its folder has no LICENSE' `
        ($tail -match '(?m)^\s{2}MpClientPlugin\.pex\s{2,}client-deps\s{2,}no LICENSE file in that folder\s*$')
    Yes 'that group says nobody recorded their version' ($tail -match 'nobody\s+recorded which version of SkyMP')
    Yes 'the built group does not list them' `
        (-not ($head6 -match '(?m)^\s{2}(build\.js|skyrimPlatform\.ts|MpClientPlugin\.pex)\s'))
    $stray6 = @([regex]::Matches($n6, '\b[0-9a-f]{7,40}\b') | ForEach-Object { $_.Value } | Where-Object { -not (Test-Known $_) })
    Yes 'the note with that group still carries no commit a record does not name' ($stray6.Count -eq 0)
    Yes 'the note with that group is plain ASCII and in the house words' `
        (-not ($n6 -match '[^\x09\x0A\x0D\x20-\x7E]') -and (Test-Words $n6))

    # Since #2931 every Ship builds build.js from the fork's skymp5-front
    # at the pin and holds it to records\front-build.json, so with the
    # real records it is one of the files Thornswood built, at the
    # client's commit, and leaves the group of what it did not build.
    $nf = Get-SetupNote $clientPath ($files + $extraFiles) ''
    $cutF = $nf.IndexOf('did not build')
    $headF = if ($cutF -gt 0) { $nf.Substring(0, $cutF) } else { $nf }
    $tailF = if ($cutF -gt 0) { $nf.Substring($cutF) } else { '' }
    Yes 'with front-build.json beside the client record, build.js is in the built group as skymp5-front' `
        ($headF -match '(?m)^\s{2}build\.js\s{2,}skymp5-front\s{2,}GNU GPL version 3\s*$')
    Yes '  and not in the group of what Thornswood did not build, which keeps the other two' `
        ($cutF -gt 0 -and -not ($tailF -match '(?m)^\s{2}build\.js\s') -and $tailF.Contains('skyrimPlatform.ts') -and $tailF.Contains('MpClientPlugin.pex'))
    Yes '  and the built group names the client commit' ($headF.Contains($forkUrl + '/tree/' + $cCommit))
    # A front record of another commit than the client's stops it, since
    # the note names one commit for everything Thornswood built.
    $fr = Read-Json (Join-Path $Here 'records\front-build.json')
    $fr.forkCommit = 'abcdef1234567890abcdef1234567890abcdef12'
    $fp = Join-Path $tmp 'front-build.json'
    [IO.File]::WriteAllText($fp, ($fr | ConvertTo-Json -Depth 6))
    $threw = $false
    try { $null = Get-SetupNote $clientPath ($files + $extraFiles) $fp } catch { $threw = $_.Exception.Message -match 'one commit' }
    Yes 'a front record of another commit than the client record stops it' $threw
    Remove-Item -LiteralPath $fp -Force

    # Only what is there. Game files with build.js alone name build.js alone.
    $n7 = Get-SetupNote $cp ($files + @('Data\Platform\UI\build.js')) ''
    Yes 'game files with only build.js name build.js and not the two they do not hold' `
        ($n7.Contains('skymp5-front') -and -not ($n7 -match 'skyrimPlatform\.ts|MpClientPlugin\.pex'))

    # Game files with none of them say nothing about them.
    $n8 = Get-SetupNote $cp $files ''
    Yes 'game files with none of them get no such group' (-not $n8.Contains('did not build'))
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# Built into the package from the records and the game files it carries,
# and stopped when it names nothing.
$setupFiles = Get-Content -LiteralPath $setupFilesPath -Raw
Yes 'Build-SetupFiles.ps1 writes the note of kind setup from the client record and the game files it packs' `
    ($setupFiles -match "Get-SourceNoticeEntries \(Join-Path \`$RepoDir 'records\\client-build\.json'\) \`$carried 'setup' \(Join-Path \`$RepoDir 'installer\\licences'\)" -and
     $setupFiles -match 'Write-SourceNoticeToFolder \$files \$entries')
Yes '  and stops when the game files carry no SkyMP file to name' ($setupFiles.Contains("if (`$entries.Count -eq 0) { throw 'The game files carry none of the SkyMP files"))

# The package is Velopack's, under the launcher, so the note has to be put
# where a person keeps things: the install copies it into the install folder.
$steps = Get-Content -LiteralPath $stepsPath -Raw
Yes 'InstallSteps.cs copies SOURCE CODE.txt into the install folder' `
    ($steps.Contains('CopyIfThere(Path.Combine(choice.Package, "SOURCE CODE.txt"), Path.Combine(Root, "SOURCE CODE.txt"));'))

# And the uninstall takes it out again. Finish ends with a plain rmdir of the
# install folder, which only works on an empty one, and the farewell calls
# anything it does not know "not Thornswood's".
$uninstall = Get-Content -LiteralPath (Join-Path $Here 'launcher\app\Uninstall.cs') -Raw
Yes 'Uninstall.cs removes SOURCE CODE.txt from the install folder' `
    ($uninstall -match 'leave\.Add\(Path\.Combine\(Paths\.Root, "SOURCE CODE\.txt"\)\)')

# The libraries inside the client files, with their texts beside the note (#3099).
$libs = @(Get-ClientLicences $clientPath $files)
$notListed = @($libs | Where-Object { -not ($note -match ('(?m)^\s{2}' + [regex]::Escape($_.Port + '.txt') + '\s+' + [regex]::Escape($_.Version) + '\s')) } | ForEach-Object { $_.Port })
Yes ('the note lists all ' + $libs.Count + ' of the client''s libraries with their versions' + $(if ($notListed.Count) { ', not: ' + ($notListed -join ', ') } else { '' })) ($libs.Count -gt 0 -and $notListed.Count -eq 0)
Yes '  and says their texts are in the licences folder beside it' ($note.Contains('in the licences folder beside this note'))
$libEntries = @($entries | Where-Object { $_.Name -like 'licences/*' } | ForEach-Object { $_.Name })
$noText = @($libs | Where-Object { $libEntries -notcontains ('licences/' + $_.Port + '.txt') } | ForEach-Object { $_.Port })
Yes ('  and the setup carries each one''s text in licences\' + $(if ($noText.Count) { ', not: ' + ($noText -join ', ') } else { '' })) ($libs.Count -gt 0 -and $noText.Count -eq 0)
Yes 'InstallSteps.cs replaces the licences folder in the install folder whole' `
    ($steps.Contains('string libTo = Path.Combine(Root, "licences");') -and $steps.Contains('if (Directory.Exists(libTo)) Directory.Delete(libTo, true);') -and $steps.Contains('CopyTree(libFrom, libTo);'))
Yes 'Uninstall.cs removes the licences folder from the install folder' `
    ($uninstall -match 'leave\.Add\(Path\.Combine\(Paths\.Root, "licences"\)\)')

# Full GPL / AGPL texts beside the note (issue #421), and the texts of the
# voice libraries compiled into the launcher (#4823), which took the place of
# WebView2's when the launcher stopped using it.
Yes 'installer\licences holds GPL-3.0.txt' (Test-Path -LiteralPath (Join-Path $licenceDir 'GPL-3.0.txt'))
Yes 'installer\licences holds AGPL-3.0.txt' (Test-Path -LiteralPath (Join-Path $licenceDir 'AGPL-3.0.txt'))
$voiceTexts = @('Concentus-LICENSE.txt', 'SharpSRTP-LICENSE.txt', 'BouncyCastle-LICENSE.txt')
foreach ($v in $voiceTexts) { Yes "installer\licences holds $v" (Test-Path -LiteralPath (Join-Path $licenceDir $v)) }
$agplHead = if (Test-Path -LiteralPath (Join-Path $licenceDir 'AGPL-3.0.txt')) { Get-Content -LiteralPath (Join-Path $licenceDir 'AGPL-3.0.txt') -TotalCount 5 | Out-String } else { '' }
$gplHead  = if (Test-Path -LiteralPath (Join-Path $licenceDir 'GPL-3.0.txt'))  { Get-Content -LiteralPath (Join-Path $licenceDir 'GPL-3.0.txt')  -TotalCount 5 | Out-String } else { '' }
Yes 'AGPL-3.0.txt is the GNU Affero GPL v3' ($agplHead -match 'GNU AFFERO GENERAL PUBLIC LICENSE' -and $agplHead -match 'Version 3')
Yes 'GPL-3.0.txt is the GNU GPL v3 (not Affero)' ($gplHead -match 'GNU GENERAL PUBLIC LICENSE' -and $gplHead -match 'Version 3' -and $gplHead -notmatch 'AFFERO')
$same = @('GPL-3.0.txt', 'AGPL-3.0.txt' | Where-Object {
    $n = $_; $e = @($entries | Where-Object { $_.Name -eq $n })
    $e.Count -eq 1 -and [Convert]::ToBase64String($e[0].Bytes) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $licenceDir $n))) })
Yes 'the setup carries the GPL and AGPL texts from installer\licences, byte for byte' ($same.Count -eq 2)
# Build-SetupFiles.ps1 packs the names InstallSteps.LicenceFiles lists, read
# off that one list, so the voice texts are packed when the list holds them.
$licList = [regex]::Match($steps, '(?s)static\s+readonly\s+string\[\]\s+LicenceFiles\s*=\s*\{(.*?)\};')
$notStaged = @($voiceTexts | Where-Object { -not $licList.Success -or -not $licList.Groups[1].Value.Contains('"' + $_ + '"') })
Yes ('Build-SetupFiles.ps1 puts the voice libraries'' texts in the package for the install to copy, off InstallSteps.LicenceFiles' + $(if ($notStaged.Count) { ', not: ' + ($notStaged -join ', ') } else { '' })) (
    $notStaged.Count -eq 0 -and $setupFiles.Contains("`$stepsCs = Join-Path `$RepoDir 'launcher\app\InstallSteps.cs'") -and
    $setupFiles.Contains('$launcherLicences = @([regex]::Matches($listAt.Groups[1].Value') -and
    $setupFiles.Contains("Copy-Item -LiteralPath `$from -Destination (Join-Path `$files `$lic) -Force"))
$notCopied = @(@('GPL-3.0.txt', 'AGPL-3.0.txt') + $voiceTexts | Where-Object { -not $steps.Contains('"' + $_ + '"') })
Yes ('InstallSteps.cs copies the GPL, AGPL and voice library texts into the install folder' + $(if ($notCopied.Count) { ', not: ' + ($notCopied -join ', ') } else { '' })) ($notCopied.Count -eq 0)
# The uninstall takes out every text on that same list, so a text the
# install copies is one it removes.
$uninstallsList = $uninstall.Contains('foreach (string lic in InstallSteps.LicenceFiles) leave.Add(Path.Combine(Paths.Root, lic));')
foreach ($v in @('AGPL-3.0.txt', 'GPL-3.0.txt') + $voiceTexts) {
    Yes "Uninstall.cs removes $v from the install folder, off InstallSteps.LicenceFiles" ($uninstallsList -and $licList.Success -and $licList.Groups[1].Value.Contains('"' + $v + '"'))
}
Yes 'SOURCE CODE.txt names the GPL and AGPL texts beside it' ($note -match 'AGPL-3\.0\.txt' -and $note -match 'GPL-3\.0\.txt')

# ---- where release pages said source is (#421, #907) ----------------------
$publishUpdatePath = Join-Path $Here 'scripts\release\Publish-Update.ps1'
$publishPackPath   = Join-Path $Here 'scripts\release\Publish-Pack.ps1'
$releaseYmlPath    = Join-Path $Here '.github\workflows\release.yml'
$publishUpdate = Get-Content -LiteralPath $publishUpdatePath -Raw
$publishPack   = Get-Content -LiteralPath $publishPackPath -Raw
$releaseYml    = Get-Content -LiteralPath $releaseYmlPath -Raw
# Update and optional packs have had no GitHub release page since #907 (the
# downloads are on thornswood.net and Thornswood-Releases is gone), so the
# footer those pages carried went with them. The setup's SOURCE CODE.txt,
# the credits page and release.yml's draft notes are what say where source is.
Yes 'Publish-Update.ps1 makes no GitHub release page to put a footer on (#907)' (
    $publishUpdate -notmatch 'gh release create' -and $publishUpdate -notmatch 'function Get-ReleaseSourceFooter')
Yes 'nor does Publish-Pack.ps1' ($publishPack -notmatch 'api\.github\.com/repos/.+/releases')
Yes 'launcher release.yml draft notes point at credits#source' ($releaseYml -match 'credits#source')

# ---- the credits page ------------------------------------------------------
$credits = Get-Content -LiteralPath $creditsPath -Raw
$at = $credits.IndexOf("<a id='source'></a>")
Yes 'credits.md has the #source anchor the download page links to' ($at -ge 0)
$section = ''
if ($at -ge 0) {
    $section = $credits.Substring($at)
    $next = $section.IndexOf("`n## ", $section.IndexOf('## ') + 3)
    if ($next -gt 0) { $section = $section.Substring(0, $next) }
}
Yes 'the page names the fork' ($section.Contains($forkUrl))
Yes 'the page names the branch' ($section.Contains([string]$client.forkBranch))
Yes 'the page names the client commit' ($section.Contains($cCommit))
Yes 'the page links the server commit' ($section.Contains('/tree/' + $sCommit))
Yes 'the page names the upstream commit it starts from, where the record has one' `
    (-not ($ub -match '^[0-9a-f]{7,40}$') -or $section.Contains($ub.Substring(0, 8)))
$missing = @($files | Where-Object { -not $section.Contains((Leaf $_)) })
Yes ('the page names every recorded file' + $(if ($missing.Count) { ', missing ' + ($missing -join ', ') } else { '' })) ($missing.Count -eq 0)
Yes 'the page names the server binary' ($section.Contains([string]$server.binary))
# The two channel rows say which commit each feed is serving. That commit is
# not always the one records\client-build.json holds, and it moves with every
# Ship, so the rows are hand text that names none (#421: they named 1afaf2ef
# while both feeds served 0714e444). site\server.js puts each feed's commit in
# at serve time; test-site-credits-fill.js and test-credits-channels.ps1 hold
# that. Every hash on the page has to be a record.
function Get-ChannelCell([string]$text, [string]$channel, [string]$feed) {
    $re = '(?m)^\|\s*' + [regex]::Escape($channel) + '\s*\|\s*`' + [regex]::Escape($feed) + '`\s*\|([^\r\n]*)\r?$'
    $m = [regex]::Match($text, $re)
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}
$publicCell = Get-ChannelCell $section 'Public' 'feed/version.json'
$devCell = Get-ChannelCell $section 'Dev' 'feed-dev/version.json'
Yes 'the page has the public feed row' ($null -ne $publicCell)
Yes 'the page has the dev feed row' ($null -ne $devCell)
Yes 'neither feed row names a commit of its own, so neither can go stale' (-not (([string]$publicCell + [string]$devCell) -match '[0-9a-f]{7,40}'))
$stray = @([regex]::Matches($section, '\b[0-9a-f]{7,40}\b') | ForEach-Object { $_.Value } | Where-Object { -not (Test-Known $_) })
Yes ('every commit on the page is one a record names' + $(if ($stray.Count) { ', stale: ' + ($stray -join ', ') } else { '' })) ($stray.Count -eq 0)
Yes 'the page has no em dash and never says player' (Test-Words $credits)
Yes 'the page does not claim all of it is built from the fork' (-not ($section -match '(?i)All of it'))

# The files Thornswood did not build, as their own group under their own
# heading, with the gap said and upstream linked.
$nbAt = $section.IndexOf('### SkyMP files Thornswood did not build')
Yes 'the page has a group for the SkyMP files Thornswood did not build' ($nbAt -gt 0)
$built = if ($nbAt -gt 0) { $section.Substring(0, $nbAt) } else { $section }
$notBuiltText = if ($nbAt -gt 0) { $section.Substring($nbAt) } else { '' }
Yes 'that group names build.js as skymp5-front under the GNU GPL version 3' `
    ($notBuiltText -match '(?m)^\|\s*`build\.js`[^|]*\|[^|]*\|\s*`skymp5-front`, GNU GPL version 3\s*\|')
Yes 'that group names skyrimPlatform.ts and MpClientPlugin.pex' `
    ($notBuiltText.Contains('`skyrimPlatform.ts`') -and $notBuiltText.Contains('`MpClientPlugin.pex`'))
Yes 'that group says nobody recorded their version' ($notBuiltText.Contains('nobody recorded which version of SkyMP'))
Yes 'that group links upstream SkyMP for their source' ($notBuiltText.Contains('(https://github.com/skyrim-multiplayer/skymp)'))
foreach ($l in ($built -split "`r?`n")) {
    $m = [regex]::Match($l, '^\|\s*`([^`]+)`[^|]*\|\s*`(skymp5-client|skyrim-platform|skymp5-server)`\s*\|\s*(GNU A?GPL version 3)\s*\|')
    if ($m.Success) { $rows += [pscustomobject]@{ File = $m.Groups[1].Value; Folder = $m.Groups[2].Value; Licence = $m.Groups[3].Value; Where = 'page' } }
}
$pageRows = @($rows | Where-Object { $_.Where -eq 'page' })
Yes ('the page gives a folder and a licence for all seven files, found ' + $pageRows.Count) ($pageRows.Count -eq 7)
$disagree = @()
foreach ($r in $pageRows) {
    $o = @($rows | Where-Object { $_.Where -eq 'note' -and $_.File -eq $r.File })
    if ($o.Count -and ($o[0].Folder -ne $r.Folder -or $o[0].Licence -ne $r.Licence)) { $disagree += $r.File }
}
Yes 'the page and the note agree on every folder and licence' ($disagree.Count -eq 0)

# The downloads page is drawn by the home page's script, which moved out of
# home.html into home.js in #1479 (no inline script under the content security
# policy).
$homeHtml = Get-Content -LiteralPath $homeJsPath -Raw
$dl = $homeHtml.IndexOf("here === '/downloads'")
$dlEnd = if ($dl -ge 0) { $homeHtml.IndexOf("here === '/report'", $dl) } else { -1 }
$dlCode = if ($dl -ge 0 -and $dlEnd -gt $dl) { $homeHtml.Substring($dl, $dlEnd - $dl) } else { '' }
Yes 'the download page links /credits#source beside the download' ($dlCode.Contains('href="/credits#source"'))

# ---- read off the fork itself ----------------------------------------------
#
# Every licence and every file to folder pair above is a claim. Where the fork
# is on this machine, each is checked against the fork at the recorded commit:
# the folder's LICENSE names that licence, and the folder's build is what makes
# that file.
$evidence = @{
    'skymp5-client.js'             = @('skymp5-client/package.json', '"name": "skymp5-client"')
    'SkyrimPlatform.dll'           = @('skyrim-platform/src/platform_se/CMakeLists.txt', 'OUTPUT_NAME "SkyrimPlatform"')
    'SkyrimPlatformImpl.dll'       = @('skyrim-platform/src/platform_se/CMakeLists.txt', 'OUTPUT_NAME "SkyrimPlatformImpl"')
    'SkyrimPlatformCEF.exe.hidden' = @('skyrim-platform/src/platform_se/CMakeLists.txt', 'SUFFIX ".exe.hidden"')
    'TESModPlatform.pex'           = @('skyrim-platform/src/platform_se/psc/TESModPlatform.psc', 'scriptName TESModPlatform')
    'MpClientPlugin.dll'           = @('skymp5-server/cpp/CMakeLists.txt', 'OUTPUT_NAME "MpClientPlugin"')
    'scam_native.node'             = @('skymp5-server/CMakeLists.txt', 'OUTPUT_NAME "scam_native"')
}
function Test-ForkHas([string]$commit) {
    if (-not (Test-Path -LiteralPath (Join-Path $Fork '.git'))) { return $false }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & git -C $Fork cat-file -e ($commit + '^{commit}') 2>$null; return ($LASTEXITCODE -eq 0) }
    finally { $ErrorActionPreference = $old }
}
if (-not ((Test-ForkHas $cCommit) -and (Test-ForkHas $sCommit))) {
    Write-Host ('SKIP  the fork is not at ' + $Fork + ' with both recorded commits, so the licences are not read off it here')
} else {
    # Each file at the commit its own record names: the server binary at the
    # server's, the six at the client's. Today they are the same commit.
    function Show-AtCommit([string]$commit, [string]$path) {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { return ((& git -C $Fork show ($commit + ':' + $path) 2>$null) -join "`n") }
        finally { $ErrorActionPreference = $old }
    }
    $wrongLicence = @(); $wrongFolder = @()
    foreach ($r in $rows) {
        $atCommit = if ($r.File -eq [string]$server.binary) { $sCommit } else { $cCommit }
        $lic = Show-AtCommit $atCommit ($r.Folder + '/LICENSE')
        $want = if ($r.Licence -eq 'GNU AGPL version 3') { 'GNU AFFERO GENERAL PUBLIC LICENSE' } else { 'GNU GENERAL PUBLIC LICENSE' }
        $head = (($lic -split "`n") | Where-Object { $_.Trim() } | Select-Object -First 2) -join ' '
        if (-not ($head -match [regex]::Escape($want) -and $head -match 'Version 3')) { $wrongLicence += ($r.Where + ': ' + $r.Folder) }
        if ($r.Licence -eq 'GNU GPL version 3' -and $head -match 'AFFERO') { $wrongLicence += ($r.Where + ': ' + $r.Folder) }
        $ev = $evidence[$r.File]
        if (-not $ev -or -not $ev[0].StartsWith($r.Folder + '/') -or -not (Show-AtCommit $atCommit $ev[0]).Contains($ev[1])) { $wrongFolder += ($r.Where + ': ' + $r.File) }
    }
    Yes ('every licence named matches that folder''s LICENSE at the recorded commit' + $(if ($wrongLicence.Count) { ', wrong: ' + ($wrongLicence -join ', ') } else { '' })) ($rows.Count -gt 0 -and $wrongLicence.Count -eq 0)
    Yes ('every file is built by the folder named for it' + $(if ($wrongFolder.Count) { ', wrong: ' + ($wrongFolder -join ', ') } else { '' })) ($rows.Count -gt 0 -and $wrongFolder.Count -eq 0)

    # The group Thornswood did not build. Its folders and licences are claims
    # too: skymp5-front's LICENSE is the GPL version 3, skymp5-front is the
    # package webpack names ui_webpack (the name inside build.js), and
    # client-deps has the .pex and no LICENSE and no .psc for it.
    $frontLic = ((Show-AtCommit $cCommit 'skymp5-front/LICENSE') -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 2) -join ' '
    Yes 'skymp5-front''s LICENSE is the GNU GPL version 3 at the recorded commit' `
        ($frontLic -match 'GNU GENERAL PUBLIC LICENSE' -and $frontLic -match 'Version 3' -and -not ($frontLic -match 'AFFERO'))
    Yes 'skymp5-front is the ui_webpack package build.js is built from' `
        ((Show-AtCommit $cCommit 'skymp5-front/package.json').Contains('"name": "ui_webpack"'))
    $tree = @()
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $tree = @(& git -C $Fork ls-tree -r --name-only $cCommit -- client-deps 2>$null) }
    finally { $ErrorActionPreference = $old }
    Yes 'client-deps holds MpClientPlugin.pex, with no LICENSE and no source for it' `
        (($tree -contains 'client-deps/common/Data/Scripts/MpClientPlugin.pex') -and
         -not ($tree | Where-Object { $_ -match '^client-deps/LICENSE' }) -and
         -not ($tree | Where-Object { $_ -match '(?i)/MpClientPlugin\.psc$' }))
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
